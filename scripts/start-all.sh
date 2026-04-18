#!/bin/bash
# Start all services for the AI Voice Agent Platform
# Usage: ./scripts/start-all.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE} AI Voice Agent Platform - Startup${NC}"
echo -e "${BLUE}========================================${NC}"

# Load .env if exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo -e "${GREEN}Loaded .env file${NC}"
fi

# Default env vars
export JWT_SECRET=${JWT_SECRET:-"dev-secret-change-me-in-production"}
export DATABASE_URL_IDENTITY=${DATABASE_URL_IDENTITY:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/identity_db"}
export DATABASE_URL_AGENT=${DATABASE_URL_AGENT:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/agent_db"}
export DATABASE_URL_CONVERSATION=${DATABASE_URL_CONVERSATION:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db"}
export DATABASE_URL_CRM=${DATABASE_URL_CRM:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db"}
export DATABASE_URL_KNOWLEDGE=${DATABASE_URL_KNOWLEDGE:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/knowledge_db"}
export DATABASE_URL_ANALYTICS=${DATABASE_URL_ANALYTICS:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/analytics_db"}
export DATABASE_URL_WORKFLOW=${DATABASE_URL_WORKFLOW:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/workflow_db"}
export DATABASE_URL_NOTIFICATION=${DATABASE_URL_NOTIFICATION:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/notification_db"}
export DATABASE_URL_TELEPHONY=${DATABASE_URL_TELEPHONY:-"postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db"}
export REDIS_URL=${REDIS_URL:-"redis://localhost:6379"}
export RABBITMQ_URL=${RABBITMQ_URL:-"amqp://voiceagent:voiceagent_dev@localhost:5672"}

echo ""
echo -e "${YELLOW}Step 1: Starting Infrastructure (Docker)${NC}"
docker compose -f docker/docker-compose.infra.yml up -d
echo -e "${GREEN}Infrastructure started${NC}"

echo ""
echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
until docker exec va-postgres pg_isready -U voiceagent 2>/dev/null; do
  sleep 1
done
echo -e "${GREEN}PostgreSQL ready${NC}"

echo ""
echo -e "${YELLOW}Step 2: Starting Node.js Services${NC}"

# Identity Service (port 8080)
echo -e "  Starting identity-service on :8080"
cd services/identity-service-node
DATABASE_URL=$DATABASE_URL_IDENTITY PORT=8080 npx tsx src/index.ts &
cd ../..

# API Gateway (port 3000)
echo -e "  Starting api-gateway on :3000"
cd services/api-gateway
PORT=3000 npx tsx src/index.ts &
cd ../..

# Agent Service (port 3001)
echo -e "  Starting agent-service on :3001"
cd services/agent-service
DATABASE_URL=$DATABASE_URL_AGENT PORT=3001 npx tsx src/index.ts &
cd ../..

# Telephony Adapter (port 3002)
echo -e "  Starting telephony-adapter on :3002"
cd services/telephony-adapter
DATABASE_URL=$DATABASE_URL_TELEPHONY PORT=3002 npx tsx src/index.ts &
cd ../..

# Conversation Service (port 3003)
echo -e "  Starting conversation-service on :3003"
cd services/conversation-service
DATABASE_URL=$DATABASE_URL_CONVERSATION PORT=3003 npx tsx src/index.ts &
cd ../..

# CRM Service (port 8081)
echo -e "  Starting crm-service on :8081"
cd services/crm-service-node
DATABASE_URL=$DATABASE_URL_CRM PORT=8081 npx tsx src/index.ts &
cd ../..

# Notification Service (port 3004)
echo -e "  Starting notification-service on :3004"
cd services/notification-service
DATABASE_URL=$DATABASE_URL_NOTIFICATION PORT=3004 npx tsx src/index.ts &
cd ../..

# Workflow Service (port 8082)
echo -e "  Starting workflow-service on :8082"
cd services/workflow-service-node
DATABASE_URL=$DATABASE_URL_WORKFLOW PORT=8082 npx tsx src/index.ts &
cd ../..

echo ""
echo -e "${YELLOW}Step 3: Starting Python Services${NC}"

# AI Runtime (port 8000)
echo -e "  Starting ai-runtime on :8000"
cd services/ai-runtime
DATABASE_URL=$DATABASE_URL_KNOWLEDGE PORT=8000 python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 &
cd ../..

# Voice Service (port 8001)
echo -e "  Starting voice-service on :8001"
cd services/voice-service
PORT=8001 python -m uvicorn src.main:app --host 0.0.0.0 --port 8001 &
cd ../..

# Knowledge Service (port 8003)
echo -e "  Starting knowledge-service on :8003"
cd services/knowledge-service
DATABASE_URL=$DATABASE_URL_KNOWLEDGE PORT=8003 python -m uvicorn src.main:app --host 0.0.0.0 --port 8003 &
cd ../..

# Analytics Service (port 8002)
echo -e "  Starting analytics-service on :8002"
cd services/analytics-service
DATABASE_URL=$DATABASE_URL_ANALYTICS PORT=8002 python -m uvicorn src.main:app --host 0.0.0.0 --port 8002 &
cd ../..

echo ""
echo -e "${YELLOW}Step 4: Starting Frontend${NC}"
cd frontend/admin-dashboard
npx vite --port 5173 &
cd ../..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} All services starting!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Frontend:     http://localhost:5173"
echo -e "  API Gateway:  http://localhost:3000"
echo -e "  RabbitMQ UI:  http://localhost:15672"
echo -e "  MinIO UI:     http://localhost:9001"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Wait for all background processes
wait
