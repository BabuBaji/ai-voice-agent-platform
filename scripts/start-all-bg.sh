#!/bin/bash
# Start the full AI Voice Agent stack in the background (no cmd windows).
# Corrected for this machine per memory/dev_runtime_state.md:
#   - Python services use the project venv (system Python 3.14 is App-Control blocked)
#   - uvicorn + tsx launched with --env-file so provider keys (Plivo/Sarvam/Deepgram/...) load
#   - per-service DATABASE_URL exported inline (overrides the global conversation_db in .env)
# Each service logs to logs/<service>.log
set -u

ROOT="/c/Users/Smartgrow/Documents/AI_VOICE_AGENT"
cd "$ROOT"
ENVFILE="$ROOT/.env"
PY="$ROOT/.venv/Scripts/python.exe"
mkdir -p logs

PG="postgresql://voiceagent:voiceagent_dev@localhost:5432"

echo "== Step 0: Docker infra =="
docker compose -f docker/docker-compose.infra.yml up -d
echo "Waiting for PostgreSQL..."
until docker exec va-postgres pg_isready -U voiceagent >/dev/null 2>&1; do sleep 1; done
echo "PostgreSQL ready"

start_node () { # name port cwd database_url
  local name=$1 port=$2 cwd=$3 db=${4:-}
  echo "  node  $name :$port"
  ( cd "$ROOT/$cwd" && \
    DATABASE_URL="$db" PORT="$port" \
    npx tsx --env-file="$ENVFILE" src/index.ts > "$ROOT/logs/$name.log" 2>&1 ) &
}

start_py () { # name port cwd database_url
  local name=$1 port=$2 cwd=$3 db=${4:-}
  echo "  py    $name :$port"
  ( cd "$ROOT/$cwd" && \
    DATABASE_URL="$db" PORT="$port" \
    "$PY" -m uvicorn --env-file "$ENVFILE" src.main:app --host 0.0.0.0 --port "$port" \
      > "$ROOT/logs/$name.log" 2>&1 ) &
}

echo "== Step 1: Node services =="
start_node identity-service   8080 services/identity-service-node "$PG/identity_db"
start_node api-gateway        3000 services/api-gateway           ""
start_node agent-service      3001 services/agent-service         "$PG/agent_db"
start_node telephony-adapter  3002 services/telephony-adapter     "$PG/conversation_db"
start_node conversation-service 3003 services/conversation-service "$PG/conversation_db"
start_node notification-service 3004 services/notification-service "$PG/notification_db"
start_node crm-service        8081 services/crm-service-node      "$PG/crm_db"
start_node workflow-service   8082 services/workflow-service-node "$PG/workflow_db"

echo "== Step 2: Python services (venv) =="
start_py ai-runtime        8000 services/ai-runtime        "$PG/knowledge_db"
start_py voice-service     8001 services/voice-service      ""
start_py analytics-service 8002 services/analytics-service "$PG/conversation_db"
start_py knowledge-service 8003 services/knowledge-service "$PG/knowledge_db"

echo "== Step 3: Frontend =="
( cd "$ROOT/frontend/admin-dashboard" && npx vite --port 5173 --host > "$ROOT/logs/frontend.log" 2>&1 ) &

echo "== All services launched; logs in logs/*.log =="
wait
