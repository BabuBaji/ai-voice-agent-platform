#!/bin/bash
# ngrok health watchdog. Polls the public tunnel URL every 30s; if it returns
# anything other than 200, kill any existing ngrok process and relaunch it
# against port 3002 (the telephony-adapter answer-URL host). Same static
# subdomain is used so PUBLIC_BASE_URL in .env stays valid across restarts.
#
# Without this, an ngrok session that dies silently (free-tier session
# timeout, network blip, OS sleep) makes every Plivo dial hang up immediately
# because Plivo can't reach our /webhooks/plivo/voice answer URL.
#
# Run via: nohup ./scripts/ngrok-watchdog.sh > logs/ngrok-watchdog.log 2>&1 &

set -u

NGROK_BIN="/c/Users/Smartgrow/Downloads/ngrok-v3-stable-windows-amd64/ngrok.exe"
ROOT="/c/Users/Smartgrow/Documents/AI_VOICE_AGENT"
TUNNEL_URL="${PUBLIC_BASE_URL:-https://tipped-rematch-unsworn.ngrok-free.dev}"
LOG_FILE="$ROOT/logs/ngrok-watchdog.log"
NGROK_LOG="$ROOT/logs/ngrok.log"
POLL_SEC="${NGROK_WATCHDOG_INTERVAL:-30}"

log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z')  $*" >> "$LOG_FILE"; }

restart_ngrok() {
  # Kill any existing ngrok process — taskkill is the Windows-native way that
  # works under MSYS / Git Bash. PID filter via tasklist avoids killing
  # unrelated tools.
  local pids
  pids=$(tasklist 2>/dev/null | awk '/^ngrok\.exe/ {print $2}')
  if [ -n "$pids" ]; then
    for pid in $pids; do
      taskkill //F //PID "$pid" >/dev/null 2>&1 || true
      log "killed stale ngrok pid=$pid"
    done
    sleep 2
  fi
  nohup "$NGROK_BIN" http 3002 --log stdout --log-format json > "$NGROK_LOG" 2>&1 &
  local new_pid=$!
  log "spawned ngrok pid=$new_pid"
  # Wait up to 15s for the tunnel to come up before resuming polling.
  for i in $(seq 1 15); do
    if curl -s --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -q public_url; then
      log "tunnel up after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "tunnel did NOT come up within 15s — will retry next tick"
  return 1
}

log "ngrok-watchdog started (poll=${POLL_SEC}s, url=${TUNNEL_URL})"

while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 \
    -H "ngrok-skip-browser-warning: 1" "${TUNNEL_URL}/health" 2>/dev/null || echo "000")
  if [ "$code" != "200" ]; then
    log "health=${code} — ngrok appears down, restarting"
    restart_ngrok
  fi
  sleep "$POLL_SEC"
done
