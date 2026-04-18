from fastapi import APIRouter

from .chat import router as chat_router
from .tools import router as tools_router
from .rag import router as rag_router
from .health import router as health_router

api_router = APIRouter()
api_router.include_router(chat_router, tags=["chat"])
api_router.include_router(tools_router, prefix="/tools", tags=["tools"])
api_router.include_router(rag_router, prefix="/rag", tags=["rag"])
api_router.include_router(health_router, tags=["health"])
