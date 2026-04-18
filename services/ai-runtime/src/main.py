from contextlib import asynccontextmanager

from fastapi import FastAPI

from common import get_db_pool, close_db_pool, get_logger
from .config import settings
from .api.router import api_router

logger = get_logger("ai-runtime")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting ai-runtime", port=settings.port)
    app.state.db = await get_db_pool(settings.database_url)
    yield
    await close_db_pool()
    logger.info("ai-runtime stopped")


app = FastAPI(
    title="AI Runtime Service",
    description="LLM orchestration, tool calling, and RAG for the AI Voice Agent Platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=settings.port, reload=True)
