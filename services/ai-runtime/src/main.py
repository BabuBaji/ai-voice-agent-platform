from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from common import get_db_pool, close_db_pool, get_logger, AppError
from .config import settings
from .api.router import api_router

logger = get_logger("ai-runtime")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting ai-runtime", port=settings.port)
    try:
        app.state.db = await get_db_pool(settings.database_url)
        logger.info("database pool initialized")
    except Exception as e:
        logger.warning("database pool init failed, continuing without db", error=str(e))
        app.state.db = None
    yield
    await close_db_pool()
    logger.info("ai-runtime stopped")


app = FastAPI(
    title="AI Runtime Service",
    description="LLM orchestration, tool calling, and RAG for the AI Voice Agent Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# Open CORS — the embeddable widget is meant to be loaded on customers' own
# domains, so it must be able to POST /chat/widget cross-origin without a
# pre-shared header. (All other ai-runtime endpoints sit behind api-gateway
# and are not directly callable cross-origin in production.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.message,
            "code": exc.code,
        },
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.error("unhandled_error", error=str(exc), path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "code": "INTERNAL_ERROR",
        },
    )


app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=settings.port, reload=True)
