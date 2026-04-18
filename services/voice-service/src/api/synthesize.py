from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..models import SynthesizeRequest

router = APIRouter()


@router.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """Text to speech - returns audio stream."""
    # TODO: route to configured TTS provider
    # Stub: return empty audio bytes
    async def _generate():
        # Placeholder: yield silence bytes
        yield b"\x00" * 4096

    return StreamingResponse(
        _generate(),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )
