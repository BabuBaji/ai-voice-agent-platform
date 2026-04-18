from abc import ABC, abstractmethod
from typing import AsyncGenerator


class TTSProvider(ABC):
    """Abstract base class for text-to-speech providers."""

    @abstractmethod
    async def synthesize(
        self, text: str, voice_id: str, model: str = ""
    ) -> AsyncGenerator[bytes, None]:
        """Synthesize speech from text.

        Yields audio chunks as bytes (streaming).
        """
        ...
