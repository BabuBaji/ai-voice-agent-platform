#!/bin/bash
# Live monitor for in-flight voice calls. Streams to stdout in real time:
#   - new user/assistant messages from the transcript (as they're persisted)
#   - barge-in events (caller cut the agent off)
#   - Indic-letter spelling decoder hits (parsed email/phone candidate)
#   - language-switch events (caller asked "speak in English"/"Telugu lo")
#   - call lifecycle: dial → answer → hangup
#
# Usage:
#   ./scripts/live-monitor.sh              # follow ALL active calls indefinitely
#   ./scripts/live-monitor.sh <campaign>   # only calls for one campaign
#   ./scripts/live-monitor.sh --once       # one snapshot, exit
#
# The polling cadence (POLL_SEC) is intentionally short (1s) so the operator
# can see the conversation almost live. Each poll is cheap — a single SELECT
# bounded to messages newer than the previous tick.

set -u

CAMPAIGN_FILTER="${1:-}"
ONCE_MODE="false"
[ "$CAMPAIGN_FILTER" = "--once" ] && { CAMPAIGN_FILTER=""; ONCE_MODE="true"; }

POLL_SEC=1
LOG="/c/Users/Smartgrow/Documents/AI_VOICE_AGENT/logs/telephony-adapter.log"
PG_EXEC=(docker exec va-postgres psql -U voiceagent -d conversation_db -t -A -F '|')

# Colour helpers
C_RESET="$(printf '\033[0m')"
C_DIM="$(printf '\033[2m')"
C_BOLD="$(printf '\033[1m')"
C_USER="$(printf '\033[36m')"          # cyan
C_AGENT="$(printf '\033[32m')"         # green
C_HINT="$(printf '\033[33m')"          # yellow
C_BARGE="$(printf '\033[35m')"         # magenta
C_LANG="$(printf '\033[34m')"          # blue
C_CALL="$(printf '\033[1;33m')"        # bold yellow
C_ERR="$(printf '\033[31m')"           # red

# Track the highest message id we've seen, so each tick only prints new ones.
last_msg_id=""
last_log_line=0
last_call_state=""

print_header() {
  echo "${C_BOLD}AI Voice Agent — Live Monitor${C_RESET}"
  if [ -n "$CAMPAIGN_FILTER" ]; then
    echo "${C_DIM}Filter: campaign $CAMPAIGN_FILTER${C_RESET}"
  fi
  echo "${C_DIM}Poll: ${POLL_SEC}s. Press Ctrl-C to stop.${C_RESET}"
  echo ""
}

active_calls() {
  local where=""
  if [ -n "$CAMPAIGN_FILTER" ]; then
    where=" AND c.metadata->>'campaign_id' = '$CAMPAIGN_FILTER'"
  fi
  "${PG_EXEC[@]}" -c "
    SELECT c.provider_call_sid,
           COALESCE(c.called_number, '?'),
           c.status,
           EXTRACT(EPOCH FROM (NOW() - c.started_at))::int,
           COALESCE(c.conversation_id::text, '')
    FROM calls c
    WHERE c.status IN ('RINGING','IN_PROGRESS')$where
    ORDER BY c.started_at;
  " 2>/dev/null
}

new_messages() {
  local conv="$1"
  local after="$2"
  if [ -z "$after" ]; then after="00000000-0000-0000-0000-000000000000"; fi
  "${PG_EXEC[@]}" -c "
    SELECT id, role, LEFT(content, 250), to_char(created_at,'HH24:MI:SS')
    FROM messages
    WHERE conversation_id = '$conv' AND id > '$after'
    ORDER BY created_at ASC, id ASC;
  " 2>/dev/null
}

# Pull only NEW log events of interest since last tick.
new_events() {
  local total
  total=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  if [ "$last_log_line" -eq 0 ]; then last_log_line="$total"; return; fi
  if [ "$total" -gt "$last_log_line" ]; then
    sed -n "$((last_log_line + 1)),${total}p" "$LOG" 2>/dev/null \
      | grep -E '"msg":"Stream: (barge-in requested|detected spelling|user goodbye|language switch|onStart|Stream handler|backends chosen)"|"msg":"Plivo status webhook"|"msg":"Greeting:" |"msg":"Stream handler:"' \
      | while IFS= read -r line; do
          local msg sid extra
          msg=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('msg',''))" 2>/dev/null)
          sid=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('callSid',''))" 2>/dev/null)
          local short_sid="${sid:0:8}"
          case "$msg" in
            *"detected spelling"*)
              hint=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('hint',''))" 2>/dev/null)
              raw=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('userText','')[:60])" 2>/dev/null)
              echo "  ${C_HINT}[${short_sid}]${C_RESET}  ${C_HINT}DECODER${C_RESET}  raw=\"${raw}\"  →  parsed=${C_BOLD}${hint}${C_RESET}"
              ;;
            *"barge-in requested"*)
              utt=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('userText','')[:60])" 2>/dev/null)
              echo "  ${C_BARGE}[${short_sid}]${C_RESET}  ${C_BARGE}BARGE-IN${C_RESET}  \"${utt}\""
              ;;
            *"backends chosen"*)
              lang=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('language',''))" 2>/dev/null)
              stt=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('stt',''))" 2>/dev/null)
              tts=$(echo "$line" | python -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('tts',''))" 2>/dev/null)
              echo "  ${C_LANG}[${short_sid}]${C_RESET}  ${C_LANG}BACKENDS${C_RESET}  language=${lang}  stt=${stt}  tts=${tts}"
              ;;
          esac
        done
    last_log_line="$total"
  fi
}

print_header

# Per-call state: last seen message id (so we don't re-print)
declare -A LAST_MSG_BY_CONV=()
declare -A SEEN_CALL=()

iter=0
while true; do
  iter=$((iter + 1))

  # 1. Surface new lifecycle / decoder / barge-in events from the log.
  new_events

  # 2. Walk active calls; print new transcript turns.
  calls=$(active_calls)
  if [ -n "$calls" ]; then
    while IFS='|' read -r sid called status age conv; do
      [ -z "$sid" ] && continue
      short_sid="${sid:0:8}"
      # First-sight banner
      if [ -z "${SEEN_CALL[$sid]:-}" ]; then
        echo "${C_CALL}[${short_sid}]  ▶ call ${status}  →  ${called}  (age ${age}s)${C_RESET}"
        SEEN_CALL[$sid]="1"
      fi
      [ -z "$conv" ] && continue
      after="${LAST_MSG_BY_CONV[$conv]:-}"
      msgs=$(new_messages "$conv" "$after")
      if [ -n "$msgs" ]; then
        while IFS='|' read -r mid role content at; do
          [ -z "$mid" ] && continue
          LAST_MSG_BY_CONV[$conv]="$mid"
          if [ "$role" = "user" ]; then
            echo "  ${C_DIM}${at}${C_RESET}  ${C_USER}[${short_sid}] USER:${C_RESET}  ${content}"
          else
            echo "  ${C_DIM}${at}${C_RESET}  ${C_AGENT}[${short_sid}] AGENT:${C_RESET} ${content}"
          fi
        done <<< "$msgs"
      fi
    done <<< "$calls"
  else
    # Idle: print a single heartbeat dot every 10s so the operator knows
    # the monitor is alive but nothing is happening.
    if [ $((iter % 10)) -eq 0 ]; then
      echo "${C_DIM}…idle (no active calls)${C_RESET}"
    fi
  fi

  [ "$ONCE_MODE" = "true" ] && break
  sleep "$POLL_SEC"
done
