@echo off
echo ========================================
echo  AI Voice Agent Platform - Startup
echo ========================================
echo.

set "ROOT=C:\Users\Smartgrow\Documents\AI_VOICE_AGENT"
set "ENV_FILE=%ROOT%\.env"
set "VENV_PY=%ROOT%\.venv\Scripts\python.exe"

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
start "identity-service" cmd /c "cd /d %ROOT%\services\identity-service-node && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting api-gateway on :3000
start "api-gateway" cmd /c "cd /d %ROOT%\services\api-gateway && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting agent-service on :3001
start "agent-service" cmd /c "cd /d %ROOT%\services\agent-service && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting telephony-adapter on :3002
start "telephony-adapter" cmd /c "cd /d %ROOT%\services\telephony-adapter && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting conversation-service on :3003
start "conversation-service" cmd /c "cd /d %ROOT%\services\conversation-service && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting crm-service on :8081
start "crm-service" cmd /c "cd /d %ROOT%\services\crm-service-node && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting notification-service on :3004
start "notification-service" cmd /c "cd /d %ROOT%\services\notification-service && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo   Starting workflow-service on :8082
start "workflow-service" cmd /c "cd /d %ROOT%\services\workflow-service-node && npx tsx --env-file=%ENV_FILE% src/index.ts"

echo.
echo Step 3: Starting Python Services
echo.

echo   Starting ai-runtime on :8000
start "ai-runtime" cmd /c "cd /d %ROOT%\services\ai-runtime && %VENV_PY% -m uvicorn --env-file %ENV_FILE% src.main:app --host 0.0.0.0 --port 8000"

echo   Starting voice-service on :8001
start "voice-service" cmd /c "cd /d %ROOT%\services\voice-service && %VENV_PY% -m uvicorn --env-file %ENV_FILE% src.main:app --host 0.0.0.0 --port 8001"

echo   Starting knowledge-service on :8003
start "knowledge-service" cmd /c "cd /d %ROOT%\services\knowledge-service && %VENV_PY% -m uvicorn --env-file %ENV_FILE% src.main:app --host 0.0.0.0 --port 8003"

echo   Starting analytics-service on :8002
start "analytics-service" cmd /c "cd /d %ROOT%\services\analytics-service && set DATABASE_URL=postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db && %VENV_PY% -m uvicorn --env-file %ENV_FILE% src.main:app --host 0.0.0.0 --port 8002"

echo.
echo Step 4: Starting Frontend
start "frontend" cmd /c "cd /d %ROOT%\frontend\admin-dashboard && npx vite --port 5173"

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
