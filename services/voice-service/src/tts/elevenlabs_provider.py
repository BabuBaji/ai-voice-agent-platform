from typing import AsyncGenerator

import httpx

from common import get_logger
from ..config import settings
from .base import TTSProvider

logger = get_logger("elevenlabs-tts")

ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1"


class ElevenLabsProvider(TTSProvider):
    """ElevenLabs streaming TTS implementation using the REST streaming API."""

    def __init__(self):
        self.api_key = settings.elevenlabs_api_key
        self.default_model = settings.tts_model

    async def synthesize(
        self, text: str, voice_id: str = "", model: str = ""
    ) -> AsyncGenerator[bytes, None]:
        """Stream synthesized audio from ElevenLabs streaming API.

        Uses the text-to-speech streaming endpoint which returns audio chunks
        as they are generated, allowing low-latency playback.
        """
        voice_id = voice_id or settings.default_tts_voice_id
        model = model or self.default_model

        logger.info("synthesize_start", text_length=len(text), voice_id=voice_id, model=model)

        url = f"{ELEVENLABS_API_URL}/text-to-speech/{voice_id}/stream"

        payload = {
            "text": text,
            "model_id": model,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "style": 0.0,
                "use_speaker_boost": True,
            },
        }

        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }

        params = {
            "output_format": "mp3_44100_128",
            "optimize_streaming_latency": "3",
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    url,
                    json=payload,
                    headers=headers,
                    params=params,
                ) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        logger.error(
                            "elevenlabs_error",
                            status=response.status_code,
                            body=error_body.decode()[:200],
                        )
                        return

                    total_bytes = 0
                    async for chunk in response.aiter_bytes(chunk_size=4096):
                        if chunk:
                            total_bytes += len(chunk)
                            yield chunk

            logger.info("synthesize_complete", total_bytes=total_bytes, voice_id=voice_id)

        except httpx.ConnectError as e:
            logger.error("elevenlabs_connect_error", error=str(e))
        except httpx.TimeoutException as e:
            logger.error("elevenlabs_timeout", error=str(e))
        except Exception as e:
            logger.error("elevenlabs_error", error=str(e))
