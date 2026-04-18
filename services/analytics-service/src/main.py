from contextlib import asynccontextmanager

from fastapi import FastAPI

from common import get_db_pool, close_db_pool, RabbitMQClient, EventBus, get_logger
from .config import settings
from .db.init import init_analytics_tables
from .api.router import api_router
from .consumer import start_consumers

logger = get_logger("analytics-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting analytics-service", port=settings.port)
    app.state.db = await get_db_pool(settings.database_url)

    # Initialize analytics-specific tables
    try:
        await init_analytics_tables(app.state.db)
        logger.info("analytics_tables_ready")
    except Exception as e:
        logger.warning("analytics_table_init_failed", error=str(e))

    # Connect to RabbitMQ for real-time metric updates
    mq = RabbitMQClient()
    try:
        await mq.connect(settings.rabbitmq_url)
        app.state.mq = mq
        app.state.event_bus = EventBus(mq)
        await start_consumers(app.state.event_bus, app.state.db)
        logger.info("rabbitmq_consumers_started")
    except Exception as e:
        logger.warning("rabbitmq_connection_failed", error=str(e))
        app.state.mq = None
        app.state.event_bus = None

    yield

    if app.state.mq:
        await app.state.mq.close()
    await close_db_pool()
    logger.info("analytics-service stopped")


app = FastAPI(
    title="Analytics Service",
    description="Call metrics, agent performance, and lead conversion tracking",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=settings.port, reload=True)
