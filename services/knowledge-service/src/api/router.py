from fastapi import APIRouter

from .documents import router as documents_router
from .search import router as search_router
from .knowledge_bases import router as kb_router
from .health import router as health_router

api_router = APIRouter()
api_router.include_router(documents_router, prefix="/documents", tags=["documents"])
api_router.include_router(search_router, tags=["search"])
api_router.include_router(kb_router, prefix="/knowledge-bases", tags=["knowledge-bases"])
api_router.include_router(health_router, tags=["health"])
