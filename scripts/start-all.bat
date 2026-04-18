@echo off
echo ========================================
echo  AI Voice Agent Platform - Startup
echo ========================================
echo.

REM Load defaults
set JWT_SECRET=dev-secret-change-me-in-production
set REDIS_URL=redis://localhost:6379
set RABBITMQ_URL=amqp://voiceagent:voiceagent_dev@localhost:5672

echo Step 1: Starting Infrastructure (Docker)
docker compose -f docker/docker-compose.infra.yml up -d
echo Waiting for PostgreSQL...
timeout /t 10 /nobreak > nul
echo.

echo Step 2: Starting Node.js Services
echo.

echo   Starting identity-service on :8080
start "identity-service" cmd /c "cd services\identity-service-node && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/identity_db && set PORT=8080 && npx tsx src/index.ts"

echo   Starting api-gateway on :3000
start "api-gateway" cmd /c "cd services\api-gateway && set PORT=3000 && npx tsx src/index.ts"

echo   Starting agent-service on :3001
start "agent-service" cmd /c "cd services\agent-service && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/agent_db && set PORT=3001 && npx tsx src/index.ts"

echo   Starting telephony-adapter on :3002
start "telephony-adapter" cmd /c "cd services\telephony-adapter && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db && set PORT=3002 && npx tsx src/index.ts"

echo   Starting conversation-service on :3003
start "conversation-service" cmd /c "cd services\conversation-service && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db && set PORT=3003 && npx tsx src/index.ts"

echo   Starting crm-service on :8081
start "crm-service" cmd /c "cd services\crm-service-node && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db && set PORT=8081 && npx tsx src/index.ts"

echo   Starting notification-service on :3004
start "notification-service" cmd /c "cd services\notification-service && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/notification_db && set PORT=3004 && npx tsx src/index.ts"

echo   Starting workflow-service on :8082
start "workflow-service" cmd /c "cd services\workflow-service-node && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/workflow_db && set PORT=8082 && npx tsx src/index.ts"

echo.
echo Step 3: Starting Python Services
echo.

echo   Starting ai-runtime on :8000
start "ai-runtime" cmd /c "cd services\ai-runtime && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/knowledge_db && python -m uvicorn src.main:app --host 0.0.0.0 --port 8000"

echo   Starting voice-service on :8001
start "voice-service" cmd /c "cd services\voice-service && python -m uvicorn src.main:app --host 0.0.0.0 --port 8001"

echo   Starting knowledge-service on :8003
start "knowledge-service" cmd /c "cd services\knowledge-service && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/knowledge_db && python -m uvicorn src.main:app --host 0.0.0.0 --port 8003"

echo   Starting analytics-service on :8002
start "analytics-service" cmd /c "cd services\analytics-service && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/analytics_db && python -m uvicorn src.main:app --host 0.0.0.0 --port 8002"

echo.
echo Step 4: Starting Frontend
start "frontend" cmd /c "cd frontend\admin-dashboard && npx vite --port 5173"

echo.
echo ========================================
echo  All services starting!
echo ========================================
echo.
echo   Frontend:     http://localhost:5173
echo   API Gateway:  http://localhost:3000
echo   RabbitMQ UI:  http://localhost:15672
echo   MinIO UI:     http://localhost:9001
echo.
echo Close this window to stop monitoring.
echo Each service runs in its own window.
pause
