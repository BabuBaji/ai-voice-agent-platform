from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from common import get_db_pool, close_db_pool, get_logger, AppError
from .config import settings
from .api.router import api_router

logger = get_logger("voice-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting voice-service", port=settings.port)
    try:
        app.state.db = await get_db_pool(settings.database_url)
        logger.info("database pool initialized")
    except Exception as e:
        logger.warning("database pool init failed, continuing without db", error=str(e))
        app.state.db = None
    yield
    await close_db_pool()
    logger.info("voice-service stopped")


app = FastAPI(
    title="Voice Service",
    description="STT, TTS, and real-time audio streaming for the AI Voice Agent Platform",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message, "code": exc.code},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.error("unhandled_error", error=str(exc), path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "INTERNAL_ERROR"},
    )


app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=settings.port, reload=True)
