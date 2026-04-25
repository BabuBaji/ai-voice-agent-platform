from fastapi import APIRouter

from .chat import router as chat_router
from .tools import router as tools_router
from .rag import router as rag_router
from .widget import router as widget_router
from .voice import router as voice_router
from .live_voice import router as live_voice_router
from .web_call import router as web_call_router
from .health import router as health_router

api_router = APIRouter()
api_router.include_router(chat_router, tags=["chat"])
api_router.include_router(widget_router, tags=["widget"])
api_router.include_router(voice_router, tags=["voice"])
api_router.include_router(live_voice_router, tags=["live-voice"])
api_router.include_router(web_call_router, tags=["web-call"])
api_router.include_router(tools_router, prefix="/tools", tags=["tools"])
api_router.include_router(rag_router, prefix="/rag", tags=["rag"])
api_router.include_router(health_router, tags=["health"])
