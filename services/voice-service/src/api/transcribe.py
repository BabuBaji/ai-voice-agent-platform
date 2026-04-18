from fastapi import APIRouter, UploadFile, File, Form

from ..models import TranscribeResponse

router = APIRouter()


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    model: str = Form("nova-2"),
):
    """Batch audio transcription."""
    audio_bytes = await audio.read()

    # TODO: route to configured STT provider
    # Stub response
    return TranscribeResponse(
        text="[Stub transcription of uploaded audio]",
        confidence=0.95,
        language=language,
        duration_seconds=len(audio_bytes) / (16000 * 2),  # rough estimate for 16kHz 16-bit
    )
