from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from common import get_db_pool, close_db_pool, get_logger, AppError
from .config import settings
from .api.router import api_router
from .db.init import initialize_database
from .storage.s3_client import S3Client

logger = get_logger("knowledge-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting knowledge-service", port=settings.port)

    # Initialize database pool and create tables
    try:
        app.state.db = await get_db_pool(settings.database_url)
        await initialize_database(app.state.db)
        logger.info("database initialized")
    except Exception as e:
        logger.warning("database init failed, continuing without db", error=str(e))
        app.state.db = None

    # Ensure S3 bucket exists
    try:
        s3 = S3Client()
        await s3.ensure_bucket()
    except Exception as e:
        logger.warning("s3 bucket check failed", error=str(e))

    yield

    await close_db_pool()
    logger.info("knowledge-service stopped")


app = FastAPI(
    title="Knowledge Service",
    description="Document ingestion, chunking, embedding, and vector search",
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
