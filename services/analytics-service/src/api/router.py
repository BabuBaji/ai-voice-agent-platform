from fastapi import APIRouter

from .metrics import router as metrics_router
from .dashboard import router as dashboard_router
from .health import router as health_router

api_router = APIRouter()
api_router.include_router(metrics_router, prefix="/metrics", tags=["metrics"])
api_router.include_router(dashboard_router, tags=["dashboard"])
api_router.include_router(health_router, tags=["health"])
