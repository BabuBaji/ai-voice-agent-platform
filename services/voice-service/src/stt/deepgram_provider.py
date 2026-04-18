from typing import Any, AsyncGenerator

from common import get_logger
from ..config import settings
from .base import STTProvider

logger = get_logger("deepgram-stt")


class DeepgramProvider(STTProvider):
    """Deepgram streaming STT implementation."""

    def __init__(self):
        self.api_key = settings.deepgram_api_key

    async def transcribe(self, audio: bytes, language: str = "en") -> dict[str, Any]:
        """Batch transcription using Deepgram REST API."""
        # TODO: implement with deepgram-sdk
        logger.info("transcribe_batch", audio_size=len(audio), language=language)
        return {
            "text": "[Deepgram batch transcription stub]",
            "confidence": 0.95,
            "language": language,
            "words": [],
        }

    async def stream_transcribe(
        self, audio_stream: AsyncGenerator[bytes, None], language: str = "en"
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Streaming transcription using Deepgram WebSocket API."""
        # TODO: implement with deepgram-sdk live transcription
        logger.info("transcribe_stream_start", language=language)

        async for chunk in audio_stream:
            # Stub: yield a partial transcript for each chunk
            yield {
                "text": "[streaming...]",
                "is_final": False,
                "confidence": 0.0,
            }

        yield {
            "text": "[Deepgram streaming transcription stub]",
            "is_final": True,
            "confidence": 0.95,
        }
