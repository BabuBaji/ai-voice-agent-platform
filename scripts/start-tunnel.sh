#!/bin/bash
# Rotate the ngrok public tunnel for telephony-adapter.
#
# - Starts ngrok (or reuses an already-running one)
# - Reads the public URL from ngrok's local API (http://127.0.0.1:4040)
# - Writes PUBLIC_BASE_URL into .env
# - Restarts telephony-adapter so Plivo answer_url/webhooks use the fresh URL
#
# Usage (from repo root, Git Bash):
#   ./scripts/start-tunnel.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
LOG_DIR="$REPO_ROOT/logs"
NGROK_BIN="/c/Users/Smartgrow/Downloads/ngrok-v3-stable-windows-amd64/ngrok.exe"
TELEPHONY_PORT=3002

mkdir -p "$LOG_DIR"

# Kill any existing ngrok + telephony-adapter so we start clean
tasklist 2>/dev/null | awk '/^ngrok\.exe/ {print $2}' | while read -r pid; do
  taskkill //F //PID "$pid" 2>/dev/null || true
done
telephony_pid=$(netstat -ano 2>/dev/null | grep LISTENING | grep ":${TELEPHONY_PORT}\s" | awk '{print $5}' | head -1)
if [ -n "$telephony_pid" ]; then
  taskkill //F //PID "$telephony_pid" //T 2>/dev/null || true
fi

# Start ngrok
"$NGROK_BIN" http "$TELEPHONY_PORT" --log stdout --log-format json \
  > "$LOG_DIR/ngrok.log" 2>&1 &

# Wait for its local API to come up, then pull the assigned URL
url=""
for i in $(seq 1 15); do
  sleep 1
  raw=$(curl -s --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null || true)
  url=$(echo "$raw" | grep -oE '"public_url":"https://[^"]+"' | head -1 | sed 's/.*"public_url":"//; s/"$//')
  if [ -n "$url" ]; then break; fi
done

if [ -z "$url" ]; then
  echo "ngrok did not expose a public URL in time — check $LOG_DIR/ngrok.log"
  exit 1
fi

echo "ngrok URL: $url"

# Update PUBLIC_BASE_URL in .env (cross-platform sed)
if grep -qE '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
  # Use a delimiter other than / because the URL has /
  tmp="$ENV_FILE.tmp"
  awk -v u="$url" 'BEGIN{FS=OFS="="} /^PUBLIC_BASE_URL=/{$0="PUBLIC_BASE_URL="u} {print}' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
else
  echo "PUBLIC_BASE_URL=$url" >> "$ENV_FILE"
fi
echo "wrote PUBLIC_BASE_URL to .env"

# Restart telephony-adapter with --env-file so every PLIVO_* / PUBLIC_BASE_URL
# loads from .env (not just the ones explicitly exported here).
cd "$REPO_ROOT/services/telephony-adapter"
DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db \
  PORT=$TELEPHONY_PORT \
  AGENT_SERVICE_URL=http://localhost:3001/api/v1 \
  PLIVO_SIMPLE_MODE=1 \
  npx tsx --env-file="$ENV_FILE" src/index.ts \
  > "$LOG_DIR/telephony-adapter.log" 2>&1 &

# Wait for it to come up
for i in $(seq 1 15); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:$TELEPHONY_PORT/health" || true)
  if [ "$code" = "200" ]; then
    echo "telephony-adapter up on :$TELEPHONY_PORT"
    echo "done — Plivo answer_url base = $url"
    exit 0
  fi
done
echo "telephony-adapter did not come up — check $LOG_DIR/telephony-adapter.log"
exit 1
