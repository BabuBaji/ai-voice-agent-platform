import os

import httpx
from fastapi import APIRouter, Response
from fastapi.responses import Response as FastResponse

from common import get_logger
from ..models import SynthesizeRequest
from ..tts.elevenlabs_provider import ElevenLabsProvider
from ..config import settings

router = APIRouter()
logger = get_logger("synthesize-api")

tts_provider = ElevenLabsProvider()


# ─────────────────────────────────────────────────────────────────────────
# Voice-id mapping (same table the telephony-adapter uses for Plivo TTS).
# Lets the user pick "rachel" / "arjun" / "nova" in Agent Builder while we
# pick the equivalent-sounding Aura voice when ElevenLabs is unavailable.
# Aura voices: https://developers.deepgram.com/docs/tts-models
# ─────────────────────────────────────────────────────────────────────────
DEEPGRAM_VOICE_MAP = {
    # Female, conversational
    "rachel": "aura-asteria-en", "bella": "aura-luna-en",
    "nova": "aura-asteria-en", "shimmer": "aura-luna-en",
    "asteria": "aura-asteria-en", "luna": "aura-luna-en",
    "stella": "aura-stella-en", "hera": "aura-hera-en",
    "athena": "aura-athena-en",
    # Male, conversational
    "adam": "aura-orion-en", "josh": "aura-arcas-en",
    "onyx": "aura-zeus-en", "echo": "aura-orion-en",
    "fable": "aura-orpheus-en", "orion": "aura-orion-en",
    "arcas": "aura-arcas-en", "perseus": "aura-perseus-en",
    "angus": "aura-angus-en", "orpheus": "aura-orpheus-en",
    "helios": "aura-helios-en", "zeus": "aura-zeus-en",
    "alloy": "aura-orion-en",
    # Indic-leaning custom names → fall back to a warm female English voice.
    # Aura is English-only; the telephony path uses Sarvam for Indic TTS,
    # but the browser web-call doesn't carry a Sarvam binary path yet, so
    # we serve passable English audio rather than silent failure.
    "arjun": "aura-arcas-en", "anushka": "aura-luna-en", "kabir": "aura-orion-en",
}


async def _try_deepgram(text: str, voice_id: str) -> bytes | None:
    """Deepgram Aura → MP3 bytes. Returns None on any failure."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        return None
    model = DEEPGRAM_VOICE_MAP.get((voice_id or "").lower(), "aura-asteria-en")
    url = f"https://api.deepgram.com/v1/speak?model={model}&encoding=mp3"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                json={"text": (text or "")[:1900]},
                headers={"Authorization": f"Token {api_key}", "Content-Type": "application/json"},
            )
            if resp.status_code != 200:
                logger.warning("deepgram_tts_failed", status=resp.status_code, body=resp.text[:200])
                return None
            data = resp.content
            if len(data) < 300:
                return None
            return data
    except Exception as e:
        logger.warning("deepgram_tts_error", error=str(e))
        return None


async def _try_elevenlabs(text: str, voice_id: str, model: str) -> bytes | None:
    """ElevenLabs streaming TTS, fully buffered so we can detect silent failure."""
    chunks: list[bytes] = []
    async for c in tts_provider.synthesize(text=text, voice_id=voice_id, model=model):
        if c:
            chunks.append(c)
    if not chunks:
        return None
    body = b"".join(chunks)
    if len(body) < 300:
        return None
    return body


async def _try_openai(text: str, voice_id: str) -> bytes | None:
    """OpenAI TTS fallback. Returns None on any failure (incl. 429 quota)."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    voice_map = {"rachel": "nova", "bella": "shimmer", "adam": "onyx", "josh": "echo"}
    voice = voice_map.get((voice_id or "").lower(), "nova")
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/speech",
                json={"model": "tts-1", "voice": voice, "input": (text or "")[:3900], "response_format": "mp3"},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            if resp.status_code != 200:
                logger.warning("openai_tts_failed", status=resp.status_code, body=resp.text[:200])
                return None
            data = resp.content
            if len(data) < 300:
                return None
            return data
    except Exception as e:
        logger.warning("openai_tts_error", error=str(e))
        return None


@router.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """Text to speech with provider cascade.

    Order: ElevenLabs (best quality if configured & in plan) → Deepgram Aura
    (works on standard key, English-only) → OpenAI TTS (last resort).

    Returns a single buffered MP3 body (not streaming) so callers can detect
    and act on silent failure — the previous streaming path was returning
    HTTP 200 + 0 bytes when ElevenLabs returned 402/404, which the frontend
    couldn't distinguish from a legitimate empty response.
    """
    voice_id = request.voice_id or settings.default_tts_voice_id
    model = request.model or settings.tts_model

    logger.info("synthesize_request", text_length=len(request.text), voice_id=voice_id)

    # Cascade: ElevenLabs → Deepgram → OpenAI
    audio = await _try_elevenlabs(request.text, voice_id, model)
    used = "elevenlabs"
    if not audio:
        audio = await _try_deepgram(request.text, voice_id)
        used = "deepgram" if audio else used
    if not audio:
        audio = await _try_openai(request.text, voice_id)
        used = "openai" if audio else used

    if not audio:
        logger.error("synthesize_all_providers_failed", voice_id=voice_id)
        return FastResponse(
            content=b'{"error":"TTS providers all unavailable","detail":"ElevenLabs/Deepgram/OpenAI all failed for this request. Frontend should fall back to browser TTS."}',
            status_code=502,
            media_type="application/json",
        )

    logger.info("synthesize_complete", provider=used, total_bytes=len(audio), voice_id=voice_id)
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "inline; filename=speech.mp3",
            "X-TTS-Provider": used,
        },
    )
