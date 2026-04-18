from typing import AsyncGenerator

from common import get_logger
from ..config import settings
from .base import TTSProvider

logger = get_logger("elevenlabs-tts")


class ElevenLabsProvider(TTSProvider):
    """ElevenLabs streaming TTS implementation."""

    def __init__(self):
        self.api_key = settings.elevenlabs_api_key
        self.default_model = settings.tts_model

    async def synthesize(
        self, text: str, voice_id: str = "", model: str = ""
    ) -> AsyncGenerator[bytes, None]:
        """Stream synthesized audio from ElevenLabs API."""
        voice_id = voice_id or settings.default_tts_voice_id
        model = model or self.default_model

        # TODO: implement with elevenlabs SDK streaming
        logger.info("synthesize", text_length=len(text), voice_id=voice_id, model=model)

        # Stub: yield silence bytes
        yield b"\x00" * 4096
