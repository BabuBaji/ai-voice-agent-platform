"""Speech provider abstraction for the Web Call module.

Primary provider: Azure Speech (when AZURE_SPEECH_KEY set)
  - STT: continuous recognition with language auto-detect (en-IN + te-IN + more)
  - TTS: neural voices per language (te-IN-ShrutiNeural, en-IN-NeerjaNeural, ...)

Fallbacks (already wired in this repo):
  - Deepgram streaming STT (nova-2) for en-* languages
  - Sarvam STT (saarika:v2.5) for Indic languages (te, hi, ta, kn, ml, mr, bn, gu, pa, or, as, ur)
  - OpenAI TTS (tts-1, voice="nova") for English
  - Sarvam TTS (bulbul:v2, voice="anushka") for Indic languages

Each provider is implemented as a stateless helper. The WS endpoint picks
one per-call based on the session's primary_language and key availability.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import struct
from typing import AsyncIterator, Optional
from urllib.parse import urlencode

import httpx


# ---------------------------------------------------------------------------
# Provider selection
# ---------------------------------------------------------------------------

INDIC_LANGS = {"te", "hi", "ta", "kn", "ml", "mr", "bn", "gu", "pa", "or", "as", "ur", "ne", "kok"}


def _base_lang(lang: str) -> str:
    return (lang or "").split("-")[0].lower()


def pick_stt_provider(primary_language: str, auto_detect: bool) -> str:
    """Return one of: 'azure' | 'deepgram' | 'sarvam'."""
    if os.getenv("AZURE_SPEECH_KEY") and os.getenv("AZURE_SPEECH_REGION"):
        return "azure"
    base = _base_lang(primary_language)
    if base in INDIC_LANGS and base != "en" and os.getenv("SARVAM_API_KEY"):
        return "sarvam"
    if os.getenv("DEEPGRAM_API_KEY"):
        return "deepgram"
    # Last resort — Sarvam supports en-IN too
    if os.getenv("SARVAM_API_KEY"):
        return "sarvam"
    return "none"


def pick_tts_provider(primary_language: str, preferred: Optional[str] = None) -> str:
    """Return one of: 'azure' | 'sarvam' | 'openai' | 'none'.

    Honours a client-specified `preferred` provider when the required key exists,
    otherwise falls back by language.
    """
    if preferred:
        preferred = preferred.lower()
        if preferred == "azure" and os.getenv("AZURE_SPEECH_KEY") and os.getenv("AZURE_SPEECH_REGION"):
            return "azure"
        if preferred == "sarvam" and os.getenv("SARVAM_API_KEY"):
            return "sarvam"
        if preferred == "openai" and os.getenv("OPENAI_API_KEY"):
            return "openai"
    if os.getenv("AZURE_SPEECH_KEY") and os.getenv("AZURE_SPEECH_REGION"):
        return "azure"
    base = _base_lang(primary_language)
    if base in INDIC_LANGS and base != "en" and os.getenv("SARVAM_API_KEY"):
        return "sarvam"
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("SARVAM_API_KEY"):
        return "sarvam"
    return "none"


# ---------------------------------------------------------------------------
# Default voice selection
# ---------------------------------------------------------------------------

AZURE_VOICES = {
    "en-IN": {"female": "en-IN-NeerjaNeural", "male": "en-IN-PrabhatNeural"},
    "te-IN": {"female": "te-IN-ShrutiNeural", "male": "te-IN-MohanNeural"},
    "hi-IN": {"female": "hi-IN-SwaraNeural", "male": "hi-IN-MadhurNeural"},
    "ta-IN": {"female": "ta-IN-PallaviNeural", "male": "ta-IN-ValluvarNeural"},
    "kn-IN": {"female": "kn-IN-SapnaNeural", "male": "kn-IN-GaganNeural"},
    "ml-IN": {"female": "ml-IN-SobhanaNeural", "male": "ml-IN-MidhunNeural"},
    "mr-IN": {"female": "mr-IN-AarohiNeural", "male": "mr-IN-ManoharNeural"},
    "bn-IN": {"female": "bn-IN-TanishaaNeural", "male": "bn-IN-BashkarNeural"},
}


def default_voice(provider: str, lang: str, gender: Optional[str] = None) -> str:
    g = (gender or "female").lower()
    if provider == "azure":
        voices = AZURE_VOICES.get(lang) or AZURE_VOICES.get(f"{_base_lang(lang)}-IN") or AZURE_VOICES["en-IN"]
        return voices.get(g, voices["female"])
    if provider == "sarvam":
        return "anushka"  # female Indic voice on bulbul:v2
    if provider == "openai":
        # OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
        return "nova" if g == "female" else "onyx"
    return ""


# ---------------------------------------------------------------------------
# TTS — synthesise one reply into a bytes stream
# ---------------------------------------------------------------------------

async def synthesize_tts(
    *,
    provider: str,
    text: str,
    language: str,
    voice: Optional[str] = None,
    speed: float = 1.0,
) -> AsyncIterator[bytes]:
    """Yield audio bytes for the reply. Returned format depends on provider:
      - azure : mp3 (audio-24khz-48kbitrate-mono-mp3)
      - sarvam: wav (PCM 22.05kHz, returned as a single yield)
      - openai: mp3
    """
    text = (text or "").strip()
    if not text:
        return

    if provider == "azure":
        async for chunk in _azure_tts(text=text, language=language, voice=voice, speed=speed):
            yield chunk
        return

    if provider == "sarvam":
        wav = await _sarvam_tts(text=text, language=language, voice=voice, speed=speed)
        if wav:
            yield wav
        return

    if provider == "openai":
        async for chunk in _openai_tts(text=text, voice=voice, speed=speed):
            yield chunk
        return

    return


async def _openai_tts(
    *, text: str, voice: Optional[str], speed: float
) -> AsyncIterator[bytes]:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return
    v = voice or "nova"
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": "tts-1",
                "voice": v,
                "input": text[:3900],
                "response_format": "mp3",
                "speed": max(0.25, min(4.0, speed)),
            },
        ) as resp:
            if resp.status_code != 200:
                return
            async for chunk in resp.aiter_bytes(chunk_size=4096):
                if chunk:
                    yield chunk


async def _azure_tts(
    *, text: str, language: str, voice: Optional[str], speed: float
) -> AsyncIterator[bytes]:
    key = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION")
    if not key or not region:
        return

    v = voice or default_voice("azure", language, "female")
    rate_pct = int(round((max(0.5, min(2.0, speed)) - 1.0) * 100))
    rate_attr = f"{rate_pct:+d}%"

    # SSML with prosody for speed control. Escape XML entities in text.
    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    ssml = (
        f'<speak version="1.0" xml:lang="{language}" xmlns="http://www.w3.org/2001/10/synthesis">'
        f'<voice name="{v}">'
        f'<prosody rate="{rate_attr}">{safe}</prosody>'
        f"</voice></speak>"
    ).encode("utf-8")

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers={
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                "User-Agent": "ai-voice-agent-webcall",
            },
            content=ssml,
        ) as resp:
            if resp.status_code != 200:
                return
            async for chunk in resp.aiter_bytes(chunk_size=4096):
                if chunk:
                    yield chunk


async def _sarvam_tts(
    *, text: str, language: str, voice: Optional[str], speed: float
) -> Optional[bytes]:
    """Sarvam bulbul:v2 returns base64 WAV audio. We join + decode to a single
    WAV blob suitable for <audio>.src via MediaSource or a Blob URL."""
    key = os.getenv("SARVAM_API_KEY")
    if not key:
        return None
    base = _base_lang(language)
    lang_code = language if "-" in language else f"{base}-IN"
    # Sarvam expects these specific codes
    SARVAM_LANGS = {"hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN",
                    "ta-IN", "te-IN", "en-IN", "gu-IN"}
    if lang_code not in SARVAM_LANGS:
        lang_code = "en-IN"
    v = voice or "anushka"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": key, "Content-Type": "application/json"},
                json={
                    "inputs": [text[:1500]],
                    "target_language_code": lang_code,
                    "speaker": v,
                    "model": "bulbul:v2",
                    "speech_sample_rate": 22050,
                    "enable_preprocessing": True,
                    "pace": max(0.5, min(2.0, speed)),
                },
            )
            if r.status_code != 200:
                return None
            data = r.json()
            import base64
            audios = data.get("audios") or []
            if not audios:
                return None
            # First entry is already a complete WAV (header + PCM16)
            return base64.b64decode(audios[0])
        except Exception:
            return None


# ---------------------------------------------------------------------------
# STT — streaming bridge
# ---------------------------------------------------------------------------

class SttBridge:
    """Abstract streaming STT. The WS endpoint pushes user audio bytes via
    `push_audio()` and reads partials/finals via `results()` (async iterator)."""

    async def start(self) -> None: ...
    async def push_audio(self, chunk: bytes) -> None: ...
    async def close(self) -> None: ...
    async def results(self) -> AsyncIterator[dict]: ...  # yields {type:'partial'|'final', text, language?, confidence?}


class DeepgramBridge(SttBridge):
    def __init__(self, language: str = "en-IN", auto_detect: bool = False, mixed: bool = False):
        self._ws = None
        self._queue: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self._language = language
        self._auto_detect = auto_detect
        self._mixed = mixed

    async def start(self) -> None:
        import websockets as wslib

        qs_dict = {
            "model": "nova-2",
            "interim_results": "true",
            "smart_format": "true",
            "vad_events": "true",
            "endpointing": "300",
        }
        if self._auto_detect:
            qs_dict["detect_language"] = "true"
        else:
            qs_dict["language"] = self._language
        url = f"wss://api.deepgram.com/v1/listen?{urlencode(qs_dict)}"
        headers = {"Authorization": f"Token {os.getenv('DEEPGRAM_API_KEY', '')}"}
        self._ws = await wslib.connect(url, additional_headers=headers, max_size=10_000_000)
        asyncio.create_task(self._reader())

    async def _reader(self):
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                if data.get("type") != "Results":
                    continue
                alt = data.get("channel", {}).get("alternatives", [{}])[0]
                text = (alt.get("transcript") or "").strip()
                if not text:
                    continue
                lang = alt.get("language") or self._language
                conf = alt.get("confidence")
                kind = "final" if data.get("is_final") else "partial"
                await self._queue.put({
                    "type": kind,
                    "text": text,
                    "language": lang,
                    "confidence": conf,
                })
        finally:
            await self._queue.put({"type": "eof"})

    async def push_audio(self, chunk: bytes) -> None:
        if self._ws and not self._closed:
            await self._ws.send(chunk)

    async def close(self) -> None:
        self._closed = True
        try:
            if self._ws:
                await self._ws.send(json.dumps({"type": "CloseStream"}))
        except Exception:
            pass
        try:
            if self._ws:
                await self._ws.close()
        except Exception:
            pass

    async def results(self) -> AsyncIterator[dict]:
        while True:
            item = await self._queue.get()
            if item.get("type") == "eof":
                return
            yield item


class SarvamBatchBridge(SttBridge):
    """Sarvam STT is batch-only. We accumulate audio in-memory until we see ~1.5s
    of silence (detected client-side via the user_stopped_speaking event) or
    hit a 20s cap, then flush the buffer to /speech-to-text and emit one 'final'.
    Partials aren't available.

    The WS endpoint calls flush_utterance() when the client sends
    user_stopped_speaking; we use that signal directly.
    """

    def __init__(self, language: str = "te-IN", auto_detect: bool = False):
        self._buf = bytearray()
        self._queue: asyncio.Queue = asyncio.Queue()
        self._language = language if "-" in language else f"{language}-IN"
        self._auto_detect = auto_detect
        self._utter_id = 0

    async def start(self) -> None:
        pass

    async def push_audio(self, chunk: bytes) -> None:
        # Cap in-memory buffer at ~30s of raw 16kHz mono PCM (~960KB)
        if len(self._buf) < 2_500_000:
            self._buf.extend(chunk)

    async def flush_utterance(self, mime: str = "audio/webm") -> None:
        if len(self._buf) < 2048:
            return
        audio = bytes(self._buf)
        self._buf.clear()
        self._utter_id += 1
        asyncio.create_task(self._transcribe(audio, mime, self._utter_id))

    async def _transcribe(self, audio: bytes, mime: str, utter_id: int) -> None:
        key = os.getenv("SARVAM_API_KEY")
        if not key:
            await self._queue.put({"type": "final", "text": "", "language": self._language, "confidence": 0})
            return
        lang = "unknown" if self._auto_detect else self._language
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                files = {
                    "file": (f"utter-{utter_id}.webm", audio, mime),
                }
                data = {
                    "model": "saarika:v2.5",
                    "language_code": lang,
                }
                r = await client.post(
                    "https://api.sarvam.ai/speech-to-text",
                    headers={"api-subscription-key": key},
                    files=files,
                    data=data,
                )
                if r.status_code == 200:
                    resp = r.json()
                    text = (resp.get("transcript") or "").strip()
                    detected = resp.get("language_code") or self._language
                    if text:
                        await self._queue.put({
                            "type": "final",
                            "text": text,
                            "language": detected,
                            "confidence": None,
                        })
        except Exception:
            pass

    async def close(self) -> None:
        await self._queue.put({"type": "eof"})

    async def results(self) -> AsyncIterator[dict]:
        while True:
            item = await self._queue.get()
            if item.get("type") == "eof":
                return
            yield item


class AzureStreamingBridge(SttBridge):
    """Azure Speech streaming STT via REST-based short-audio endpoint.

    True continuous recognition uses Azure's WebSocket protocol which requires
    the Speech SDK. To keep the runtime dep-light we run a utterance-batched
    approach (same as Sarvam): accumulate audio until user_stopped_speaking,
    then POST to the short-audio REST API with language auto-detect.

    Auto-detect: pass Content-Type application/ssml+xml ...no, language is a
    query param. We set `language` or use `detailed` with
    https://speech.microsoft.com/speechtotext/v3.2 — but the stream endpoint
    is per-language. For auto-detect with en+te we POST the same audio to both
    and pick the higher-confidence result.
    """

    def __init__(self, language: str = "en-IN", auto_detect: bool = False, mixed: bool = False):
        self._buf = bytearray()
        self._queue: asyncio.Queue = asyncio.Queue()
        self._language = language if "-" in language else f"{language}-IN"
        self._auto_detect = auto_detect
        self._mixed = mixed
        self._utter_id = 0

    async def start(self) -> None:
        pass

    async def push_audio(self, chunk: bytes) -> None:
        if len(self._buf) < 5_000_000:
            self._buf.extend(chunk)

    async def flush_utterance(self, mime: str = "audio/webm") -> None:
        if len(self._buf) < 2048:
            return
        audio = bytes(self._buf)
        self._buf.clear()
        self._utter_id += 1
        asyncio.create_task(self._transcribe(audio, mime, self._utter_id))

    async def _transcribe(self, audio: bytes, mime: str, utter_id: int) -> None:
        key = os.getenv("AZURE_SPEECH_KEY")
        region = os.getenv("AZURE_SPEECH_REGION")
        if not key or not region:
            return

        # Candidate languages (en-IN + te-IN when auto-detect; else just the primary)
        langs = [self._language]
        if self._auto_detect:
            langs = sorted({self._language, "en-IN", "te-IN"})
        elif self._mixed and self._language != "en-IN":
            langs = [self._language, "en-IN"]

        async def one(lang: str):
            url = f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language={lang}&format=detailed"
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    r = await client.post(
                        url,
                        headers={
                            "Ocp-Apim-Subscription-Key": key,
                            "Content-Type": mime or "audio/webm; codecs=opus",
                            "Accept": "application/json",
                        },
                        content=audio,
                    )
                    if r.status_code != 200:
                        return None
                    data = r.json()
                    if data.get("RecognitionStatus") != "Success":
                        return None
                    n_best = data.get("NBest") or []
                    if not n_best:
                        return None
                    top = n_best[0]
                    return {
                        "type": "final",
                        "text": (top.get("Display") or "").strip(),
                        "language": lang,
                        "confidence": top.get("Confidence"),
                    }
            except Exception:
                return None

        results = await asyncio.gather(*[one(l) for l in langs])
        best = None
        for r in results:
            if r and r.get("text"):
                if best is None or (r.get("confidence") or 0) > (best.get("confidence") or 0):
                    best = r
        if best:
            await self._queue.put(best)

    async def close(self) -> None:
        await self._queue.put({"type": "eof"})

    async def results(self) -> AsyncIterator[dict]:
        while True:
            item = await self._queue.get()
            if item.get("type") == "eof":
                return
            yield item


def make_stt_bridge(primary_language: str, auto_detect: bool, mixed: bool) -> SttBridge:
    provider = pick_stt_provider(primary_language, auto_detect)
    if provider == "azure":
        return AzureStreamingBridge(primary_language, auto_detect, mixed)
    if provider == "sarvam":
        return SarvamBatchBridge(primary_language, auto_detect)
    if provider == "deepgram":
        return DeepgramBridge(primary_language, auto_detect, mixed)
    return DeepgramBridge(primary_language, auto_detect, mixed)  # best-effort
