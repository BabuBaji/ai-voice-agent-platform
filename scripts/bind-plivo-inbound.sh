#!/bin/bash
# Bind active Plivo numbers' inbound answer_url to THIS deployment's webhook.
#
# Why: inbound calls were going BUSY because both numbers were bound to Plivo's
# "Default" Application whose answer_url pointed at a stale Contacto PHLO URL,
# not our /webhooks/plivo/voice. This creates/reuses a "VoiceAgent Inbound"
# Application pointing at PUBLIC_BASE_URL/webhooks/plivo/voice and binds every
# active Plivo number to it. Idempotent: re-running just refreshes the answer_url
# (handy if the tunnel URL ever changes). Outbound is unaffected (it sets its own
# answer_url per call at initiate time).
#
# Usage: ./scripts/bind-plivo-inbound.sh
# NOTE: deliberately NOT 'set -e' — a single transient curl/202 should not abort
# the whole bind loop; each number is bound best-effort and reported.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/.env"
AID=$(grep -E '^PLIVO_AUTH_ID=' "$ENV" | head -1 | cut -d= -f2- | tr -d '"\r')
TOK=$(grep -E '^PLIVO_AUTH_TOKEN=' "$ENV" | head -1 | cut -d= -f2- | tr -d '"\r')
PUB=$(grep -E '^PUBLIC_BASE_URL=' "$ENV" | head -1 | cut -d= -f2- | tr -d '"\r')
ANSWER="${PUB%/}/webhooks/plivo/voice"
HANGUP="${PUB%/}/webhooks/plivo/status"
APP_NAME="VoiceAgent_Inbound"
API="https://api.plivo.com/v1/Account/$AID"

if [ -z "$AID" ] || [ -z "$TOK" ] || [ -z "$PUB" ]; then
  echo "Missing PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN / PUBLIC_BASE_URL in .env"; exit 1
fi
echo "answer_url -> $ANSWER"

# 1. Find existing "VoiceAgent Inbound" app, else create it.
APP_ID=$(curl -s -u "$AID:$TOK" "$API/Application/?limit=20" --max-time 20 \
  | python -c "import sys,json; d=json.load(sys.stdin); print(next((a['app_id'] for a in d.get('objects',[]) if a.get('app_name')=='$APP_NAME'),''))" 2>/dev/null)

if [ -z "$APP_ID" ]; then
  echo "Creating Application '$APP_NAME'..."
  APP_ID=$(curl -s -u "$AID:$TOK" -X POST "$API/Application/" \
    -H 'Content-Type: application/json' \
    -d "{\"app_name\":\"$APP_NAME\",\"answer_url\":\"$ANSWER\",\"answer_method\":\"POST\",\"hangup_url\":\"$HANGUP\",\"hangup_method\":\"POST\",\"fallback_answer_url\":\"$ANSWER\",\"fallback_method\":\"POST\"}" \
    --max-time 20 | python -c "import sys,json; print(json.load(sys.stdin).get('app_id',''))" 2>/dev/null)
  echo "  created app_id=$APP_ID"
else
  echo "Reusing app_id=$APP_ID — refreshing answer_url..."
  curl -s -u "$AID:$TOK" -X POST "$API/Application/$APP_ID/" \
    -H 'Content-Type: application/json' \
    -d "{\"answer_url\":\"$ANSWER\",\"answer_method\":\"POST\",\"hangup_url\":\"$HANGUP\",\"hangup_method\":\"POST\",\"fallback_answer_url\":\"$ANSWER\",\"fallback_method\":\"POST\"}" \
    --max-time 20 >/dev/null
fi
[ -z "$APP_ID" ] && { echo "Failed to obtain app_id"; exit 1; }

# 2. Bind every owned number to this app.
for NUM in $(curl -s -u "$AID:$TOK" "$API/Number/?limit=20" --max-time 20 \
  | python -c "import sys,json; [print(n['number']) for n in json.load(sys.stdin).get('objects',[])]" 2>/dev/null); do
  echo "Binding $NUM -> app $APP_ID"
  curl -s -u "$AID:$TOK" -X POST "$API/Number/$NUM/" \
    -H 'Content-Type: application/json' -d "{\"app_id\":\"$APP_ID\"}" --max-time 20 >/dev/null
done
echo "Done. Inbound calls now route to $ANSWER"
