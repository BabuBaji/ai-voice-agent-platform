"""Server-side STT + TTS for the in-browser web-call experience.

We deliberately keep this as plain HTTP per-turn (not WebRTC) because:
  - it's simpler and works everywhere (no STUN/TURN, no SDP signalling)
  - per-turn STT is what the LLM needs anyway (full utterance, not chunks)
  - browser MediaRecorder already gives us a good blob per turn

Endpoints:
  POST /stt — multipart audio file -> {text, language, duration}
  POST /tts — JSON {text, voice?, provider?} -> audio/mpeg bytes

Provider keys read from env:
  OPENAI_API_KEY     (used for both Whisper STT and OpenAI TTS)
  DEEPGRAM_API_KEY   (alternate STT)
  ELEVENLABS_API_KEY (alternate TTS, higher-quality)
"""
from __future__ import annotations

import os
from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from common import get_logger

router = APIRouter()
logger = get_logger("voice-api")

OPENAI_API_KEY = lambda: os.getenv("OPENAI_API_KEY") or ""
DEEPGRAM_API_KEY = lambda: os.getenv("DEEPGRAM_API_KEY") or ""
ELEVENLABS_API_KEY = lambda: os.getenv("ELEVENLABS_API_KEY") or ""


# ─── STT ─────────────────────────────────────────────────────────────────

@router.post("/stt")
async def transcribe(
    audio: UploadFile = File(...),
    provider: str = Form("openai"),
    language: Optional[str] = Form(None),
):
    """Transcribe a single utterance. Tries the requested provider, falls
    back to the other one on quota/auth errors so dev keeps working."""
    blob = await audio.read()
    if not blob:
        raise HTTPException(status_code=400, detail="Empty audio")

    mime = audio.content_type or "audio/webm"
    filename = audio.filename or "turn.webm"
    requested = (provider or "openai").lower()

    async def _openai() -> dict:
        key = OPENAI_API_KEY()
        if not key:
            raise RuntimeError("OPENAI_API_KEY not set")
        files = {"file": (filename, blob, mime)}
        data = {"model": "whisper-1", "response_format": "json"}
        if language:
            data["language"] = language
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {key}"},
                files=files, data=data,
            )
            if r.status_code != 200:
                raise RuntimeError(f"openai whisper {r.status_code}: {r.text[:200]}")
            j = r.json()
            return {"text": j.get("text", ""), "provider": "openai-whisper", "language": language or "auto"}

    async def _deepgram() -> dict:
        key = DEEPGRAM_API_KEY()
        if not key:
            raise RuntimeError("DEEPGRAM_API_KEY not set")
        params = {"model": "nova-2", "smart_format": "true"}
        if language:
            params["language"] = language
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                "https://api.deepgram.com/v1/listen",
                headers={"Authorization": f"Token {key}", "Content-Type": mime},
                params=params, content=blob,
            )
            if r.status_code != 200:
                raise RuntimeError(f"deepgram {r.status_code}: {r.text[:200]}")
            j = r.json()
            text = (
                j.get("results", {}).get("channels", [{}])[0]
                .get("alternatives", [{}])[0]
                .get("transcript", "")
            )
            return {"text": text, "provider": "deepgram-nova-2", "language": language or "auto"}

    primary, fallback = (_openai, _deepgram) if requested == "openai" else (_deepgram, _openai)
    try:
        return await primary()
    except Exception as e:
        logger.warn("stt_primary_failed", err=str(e), provider=requested)
        try:
            return await fallback()
        except Exception as e2:
            raise HTTPException(status_code=502, detail=f"STT failed: {str(e2)[:200]}")


# ─── TTS ─────────────────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str = Field(..., max_length=4000)
    provider: str = Field("openai", description="openai | elevenlabs")
    voice: Optional[str] = Field(None, description="provider-specific voice id")
    format: str = Field("mp3", description="mp3 | wav")


@router.post("/tts")
async def synthesize(req: TTSRequest):
    """Render text to audio. Returns the audio file bytes directly with the
    correct Content-Type so the browser can play it via `<audio>` or fetch+blob."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    requested = (req.provider or "openai").lower()

    async def _openai() -> bytes:
        key = OPENAI_API_KEY()
        if not key:
            raise RuntimeError("OPENAI_API_KEY not set")
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": "tts-1",
                    "voice": req.voice or "nova",
                    "input": text[:3900],
                    "response_format": req.format if req.format in ("mp3", "wav", "opus") else "mp3",
                    "speed": 1.0,
                },
            )
            if r.status_code != 200:
                raise RuntimeError(f"openai tts {r.status_code}: {r.text[:200]}")
            return r.content

    async def _elevenlabs() -> bytes:
        key = ELEVENLABS_API_KEY()
        if not key:
            raise RuntimeError("ELEVENLABS_API_KEY not set")
        voice_id = req.voice or "21m00Tcm4TlvDq8ikWAM"  # Rachel — public default
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": key, "Content-Type": "application/json"},
                json={
                    "text": text[:3900],
                    "model_id": "eleven_multilingual_v2",
                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.7},
                },
            )
            if r.status_code != 200:
                raise RuntimeError(f"elevenlabs {r.status_code}: {r.text[:200]}")
            return r.content

    primary, fallback = (_elevenlabs, _openai) if requested == "elevenlabs" else (_openai, _elevenlabs)
    try:
        audio = await primary()
    except Exception as e:
        logger.warn("tts_primary_failed", err=str(e), provider=requested)
        try:
            audio = await fallback()
        except Exception as e2:
            raise HTTPException(status_code=502, detail=f"TTS failed: {str(e2)[:200]}")

    media_type = "audio/mpeg" if req.format == "mp3" else f"audio/{req.format}"
    return Response(content=audio, media_type=media_type)
