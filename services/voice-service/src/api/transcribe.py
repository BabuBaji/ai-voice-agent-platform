from fastapi import APIRouter, UploadFile, File, Form

from common import get_logger
from ..models import TranscribeResponse
from ..stt.deepgram_provider import DeepgramProvider

router = APIRouter()
logger = get_logger("transcribe-api")

stt_provider = DeepgramProvider()


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    model: str = Form("nova-2"),
):
    """Batch audio transcription using Deepgram."""
    audio_bytes = await audio.read()
    content_type = audio.content_type or "audio/webm"

    logger.info("transcribe_request", size=len(audio_bytes), language=language, content_type=content_type)

    result = await stt_provider.transcribe(
        audio=audio_bytes,
        language=language,
        content_type=content_type,
    )

    return TranscribeResponse(
        text=result["text"],
        confidence=result["confidence"],
        language=result["language"],
        duration_seconds=len(audio_bytes) / (16000 * 2),
    )
