from typing import Any, AsyncGenerator

from .base import STTProvider


class WhisperProvider(STTProvider):
    """OpenAI Whisper STT fallback - stub implementation."""

    async def transcribe(self, audio: bytes, language: str = "en") -> dict[str, Any]:
        # TODO: implement with openai SDK whisper endpoint
        return {
            "text": "[Whisper transcription stub]",
            "confidence": 0.90,
            "language": language,
            "words": [],
        }

    async def stream_transcribe(
        self, audio_stream: AsyncGenerator[bytes, None], language: str = "en"
    ) -> AsyncGenerator[dict[str, Any], None]:
        # Whisper does not natively support streaming; buffer and transcribe
        buffer = bytearray()
        async for chunk in audio_stream:
            buffer.extend(chunk)

        result = await self.transcribe(bytes(buffer), language)
        yield {
            "text": result["text"],
            "is_final": True,
            "confidence": result["confidence"],
        }
