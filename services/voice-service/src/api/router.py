from fastapi import APIRouter

from .transcribe import router as transcribe_router
from .synthesize import router as synthesize_router
from .stream import router as stream_router
from .ws_audio import router as ws_audio_router
from .health import router as health_router

api_router = APIRouter()
api_router.include_router(transcribe_router, tags=["stt"])
api_router.include_router(synthesize_router, tags=["tts"])
api_router.include_router(stream_router, tags=["stream"])
api_router.include_router(ws_audio_router, tags=["ws"])
api_router.include_router(health_router, tags=["health"])
