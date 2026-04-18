from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator


class STTProvider(ABC):
    """Abstract base class for speech-to-text providers."""

    @abstractmethod
    async def transcribe(self, audio: bytes, language: str = "en") -> dict[str, Any]:
        """Transcribe a complete audio buffer.

        Returns:
            {"text": str, "confidence": float, "language": str, "words": list}
        """
        ...

    @abstractmethod
    async def stream_transcribe(
        self, audio_stream: AsyncGenerator[bytes, None], language: str = "en"
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream transcription from an audio stream.

        Yields partial and final transcript dicts:
            {"text": str, "is_final": bool, "confidence": float}
        """
        ...
