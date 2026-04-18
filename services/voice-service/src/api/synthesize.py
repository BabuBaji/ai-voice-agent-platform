from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from common import get_logger
from ..models import SynthesizeRequest
from ..tts.elevenlabs_provider import ElevenLabsProvider
from ..config import settings

router = APIRouter()
logger = get_logger("synthesize-api")

tts_provider = ElevenLabsProvider()


@router.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """Text to speech - returns streaming audio from ElevenLabs."""
    voice_id = request.voice_id or settings.default_tts_voice_id
    model = request.model or settings.tts_model

    logger.info("synthesize_request", text_length=len(request.text), voice_id=voice_id)

    return StreamingResponse(
        tts_provider.synthesize(
            text=request.text,
            voice_id=voice_id,
            model=model,
        ),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )
