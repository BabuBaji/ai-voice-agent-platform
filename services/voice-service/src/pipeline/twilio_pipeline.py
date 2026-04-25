"""Twilio Media Streams pipeline.

Wires together:
  Twilio (mulaw 8kHz base64 over WS)
    -> Deepgram live STT
    -> ai-runtime /chat/simple (with conversation history + agent system prompt)
    -> ElevenLabs TTS (ulaw_8000 output)
    -> Twilio (mulaw 8kHz base64 over WS)

Transcript is persisted to conversation-service turn-by-turn.
Raw user audio is buffered and uploaded as the call recording when the stream ends.
"""
from __future__ import annotations

import asyncio
import base64
import json
from typing import Any, AsyncGenerator, Optional

import httpx

from common import get_logger
from ..config import settings
from ..stt.deepgram_provider import DeepgramProvider
from ..tts.elevenlabs_provider import ElevenLabsProvider

logger = get_logger("twilio-pipeline")

# Where to reach conversation-service for persistence
CONVERSATION_SERVICE_URL = "http://localhost:3003"
# Where to reach agent-service to load agent config
AGENT_SERVICE_URL = "http://localhost:3001"


class TwilioPipeline:
    """One pipeline instance per active call.

    Lifecycle:
      - start(): fetch agent config, open Deepgram stream, begin listening
      - push_audio(base64_mulaw): feed a chunk received from Twilio
      - outbound events are yielded from the async iter (JSON messages)
      - close(): flush + upload recording + analyze
    """

    def __init__(
        self,
        call_sid: str,
        conversation_id: str,
        agent_id: str,
        tenant_id: str,
    ):
        self.call_sid = call_sid
        self.conversation_id = conversation_id
        self.agent_id = agent_id
        self.tenant_id = tenant_id

        self.stt = DeepgramProvider()
        self.tts = ElevenLabsProvider()

        # Agent config (loaded in start())
        self.agent: dict[str, Any] = {}
        self.system_prompt = "You are a helpful AI voice assistant. Reply briefly and conversationally."
        self.llm_provider = "google"
        self.llm_model = "gemini-2.5-flash"
        self.language = "en"
        self.voice_id: Optional[str] = None
        self.greeting: Optional[str] = None

        # Per-call state
        self.history: list[dict[str, str]] = []
        self.user_audio_chunks: list[bytes] = []  # raw mulaw bytes for recording storage
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._outbound_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._stt_task: asyncio.Task | None = None
        self._stopped = False

    # --------- lifecycle ---------
    async def start(self) -> None:
        await self._load_agent()

        # Greet the caller (if a greeting exists) by emitting TTS right away.
        if self.greeting:
            self.history.append({"role": "assistant", "content": self.greeting})
            await self._persist_message("assistant", self.greeting)
            asyncio.create_task(self._emit_tts(self.greeting))

        # Start streaming STT in the background
        self._stt_task = asyncio.create_task(self._run_stt_loop())
        logger.info("pipeline_started", call_sid=self.call_sid, language=self.language)

    async def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        # Signal end-of-audio to STT
        try:
            await self._audio_queue.put(b"")
        except Exception:
            pass
        if self._stt_task and not self._stt_task.done():
            self._stt_task.cancel()
            try:
                await self._stt_task
            except (asyncio.CancelledError, Exception):
                pass
        await self._outbound_queue.put(None)
        # Persist recording + trigger analysis
        await self._upload_recording_and_analyze()
        logger.info("pipeline_stopped", call_sid=self.call_sid)

    # --------- inbound (Twilio → pipeline) ---------
    async def push_mulaw(self, b64_audio: str) -> None:
        """Called when Twilio sends a `media` event with base64 mulaw payload."""
        if self._stopped:
            return
        try:
            data = base64.b64decode(b64_audio)
        except Exception:
            return
        if not data:
            return
        self.user_audio_chunks.append(data)
        await self._audio_queue.put(data)

    # --------- outbound (pipeline → caller) ---------
    def __aiter__(self) -> "TwilioPipeline":
        return self

    async def __anext__(self) -> dict[str, Any]:
        item = await self._outbound_queue.get()
        if item is None:
            raise StopAsyncIteration
        return item

    # --------- internals ---------
    async def _load_agent(self) -> None:
        """Load the agent row from agent-service so we have the system prompt, llm config, voice."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{AGENT_SERVICE_URL}/agents/{self.agent_id}",
                    headers={"x-tenant-id": self.tenant_id},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    agent = data.get("data", data)
                    self.agent = agent
                    self.system_prompt = agent.get("system_prompt") or self.system_prompt
                    self.llm_provider = agent.get("llm_provider") or self.llm_provider
                    self.llm_model = agent.get("llm_model") or self.llm_model
                    vc = agent.get("voice_config") or {}
                    lang = vc.get("language") or "en"
                    # Convert BCP-47 to Deepgram code: "en-GB" → "en", "te-IN" → "te"
                    self.language = lang.split("-")[0].lower()
                    self.voice_id = vc.get("voice_id")
                    self.greeting = agent.get("greeting_message") or agent.get("greeting")
                else:
                    logger.warning("agent_load_failed", status=resp.status_code, agent_id=self.agent_id)
        except Exception as e:
            logger.warning("agent_load_error", error=str(e), agent_id=self.agent_id)

    async def _run_stt_loop(self) -> None:
        """Consume audio chunks from the queue, feed Deepgram, handle transcripts."""
        async def audio_gen() -> AsyncGenerator[bytes, None]:
            while True:
                chunk = await self._audio_queue.get()
                if not chunk:
                    return
                yield chunk

        # Use Deepgram mulaw-native params so we don't have to transcode.
        # Current DeepgramProvider.stream_transcribe hardcodes linear16 — we build a
        # lightweight inline call instead that uses mulaw + 8kHz.
        try:
            await self._stream_deepgram_mulaw(audio_gen())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("stt_loop_error", error=str(e), call_sid=self.call_sid)

    async def _stream_deepgram_mulaw(self, audio_stream: AsyncGenerator[bytes, None]) -> None:
        """Live STT with Deepgram configured for Twilio's mulaw 8kHz audio.

        Accumulates partial + final transcripts. On `speech_final`, sends to LLM.
        """
        import websockets

        ws_url = (
            "wss://api.deepgram.com/v1/listen"
            f"?model=nova-2&language={self.language}"
            "&encoding=mulaw&sample_rate=8000&channels=1"
            "&punctuate=true&interim_results=true"
            "&endpointing=400&vad_events=true"
        )
        extra_headers = {"Authorization": f"Token {settings.deepgram_api_key}"}

        current_utterance = ""

        try:
            async with websockets.connect(
                ws_url,
                additional_headers=extra_headers,
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                logger.info("deepgram_ws_open", call_sid=self.call_sid, language=self.language)

                async def sender():
                    try:
                        async for chunk in audio_stream:
                            if self._stopped:
                                break
                            await ws.send(chunk)
                        await ws.send(json.dumps({"type": "CloseStream"}))
                    except Exception as e:
                        logger.warning("deepgram_send_error", error=str(e))

                send_task = asyncio.create_task(sender())

                try:
                    async for message in ws:
                        if self._stopped:
                            break
                        if isinstance(message, bytes):
                            continue
                        try:
                            data = json.loads(message)
                        except json.JSONDecodeError:
                            continue

                        msg_type = data.get("type", "")
                        if msg_type == "Results":
                            alt = data.get("channel", {}).get("alternatives", [{}])[0]
                            text = (alt.get("transcript") or "").strip()
                            is_final = data.get("is_final", False)
                            speech_final = data.get("speech_final", False)

                            if text and is_final:
                                current_utterance = (current_utterance + " " + text).strip()

                            if current_utterance and (speech_final or msg_type == "UtteranceEnd"):
                                # A complete user turn
                                utterance = current_utterance
                                current_utterance = ""
                                asyncio.create_task(self._handle_user_utterance(utterance))
                        elif msg_type == "UtteranceEnd":
                            if current_utterance:
                                utterance = current_utterance
                                current_utterance = ""
                                asyncio.create_task(self._handle_user_utterance(utterance))
                finally:
                    if not send_task.done():
                        send_task.cancel()
                        try:
                            await send_task
                        except (asyncio.CancelledError, Exception):
                            pass
        except Exception as e:
            logger.error("deepgram_stream_error", error=str(e), call_sid=self.call_sid)

    async def _handle_user_utterance(self, text: str) -> None:
        """When Deepgram says the user finished a sentence — send to LLM, speak reply."""
        logger.info("user_utterance", call_sid=self.call_sid, text=text)

        # Emit transcript event back so clients can see it live
        await self._outbound_queue.put({
            "type": "event",
            "event": "user_transcript",
            "data": {"text": text},
        })

        self.history.append({"role": "user", "content": text})
        await self._persist_message("user", text)

        # Call LLM
        reply = await self._call_llm(text)
        if not reply:
            return

        self.history.append({"role": "assistant", "content": reply})
        await self._persist_message("assistant", reply)

        await self._outbound_queue.put({
            "type": "event",
            "event": "agent_reply",
            "data": {"text": reply},
        })

        # Synthesize and emit
        await self._emit_tts(reply)

    async def _call_llm(self, user_text: str) -> str:
        """Call ai-runtime /chat/simple with history."""
        try:
            messages = [m for m in self.history if m["role"] in ("user", "assistant")]
            # Drop the just-added user message from history (ai-runtime prepends system itself)
            # We pass the full conversation, ai-runtime will include system_prompt.
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{settings.ai_runtime_url}/chat/simple",
                    json={
                        "system_prompt": self.system_prompt,
                        "messages": messages,
                        "provider": self.llm_provider,
                        "model": self.llm_model,
                        "temperature": 0.7,
                        "max_tokens": 512,
                    },
                )
                if resp.status_code != 200:
                    logger.warning("llm_failed", status=resp.status_code, body=resp.text[:200])
                    return ""
                data = resp.json()
                return (data.get("reply") or "").strip()
        except Exception as e:
            logger.error("llm_error", error=str(e))
            return ""

    async def _emit_tts(self, text: str) -> None:
        """Synthesize via ElevenLabs (ulaw_8000) and push base64 chunks to outbound."""
        try:
            buffer = bytearray()
            async for chunk in self.tts.synthesize(
                text=text,
                voice_id=self.voice_id or "",
                output_format="ulaw_8000",
            ):
                buffer.extend(chunk)
                # Twilio expects 20ms frames at 8kHz mulaw = 160 bytes each.
                # Flush full frames as they're ready.
                while len(buffer) >= 160:
                    frame = bytes(buffer[:160])
                    del buffer[:160]
                    await self._outbound_queue.put({
                        "type": "audio_out",
                        "audio": base64.b64encode(frame).decode("ascii"),
                        "format": "mulaw",
                        "sampleRate": 8000,
                    })
            # Flush remainder
            if buffer:
                await self._outbound_queue.put({
                    "type": "audio_out",
                    "audio": base64.b64encode(bytes(buffer)).decode("ascii"),
                    "format": "mulaw",
                    "sampleRate": 8000,
                })
            await self._outbound_queue.put({
                "type": "event",
                "event": "tts_complete",
                "data": {},
            })
        except Exception as e:
            logger.error("tts_emit_error", error=str(e))

    async def _persist_message(self, role: str, content: str) -> None:
        if not self.conversation_id:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{CONVERSATION_SERVICE_URL}/api/v1/conversations/{self.conversation_id}/messages",
                    headers={"x-tenant-id": self.tenant_id},
                    json={"role": role, "content": content},
                )
        except Exception as e:
            logger.warning("persist_message_failed", error=str(e))

    async def _upload_recording_and_analyze(self) -> None:
        """Save the raw mulaw user-side audio as a WAV file and trigger analysis."""
        if not self.conversation_id:
            return
        try:
            if self.user_audio_chunks:
                wav_bytes = _mulaw_chunks_to_wav(self.user_audio_chunks)
                async with httpx.AsyncClient(timeout=30.0) as client:
                    await client.post(
                        f"{CONVERSATION_SERVICE_URL}/api/v1/conversations/{self.conversation_id}/recording",
                        headers={
                            "x-tenant-id": self.tenant_id,
                            "Content-Type": "audio/wav",
                        },
                        content=wav_bytes,
                    )
            # Mark conversation ended + analyze
            async with httpx.AsyncClient(timeout=30.0) as client:
                await client.put(
                    f"{CONVERSATION_SERVICE_URL}/api/v1/conversations/{self.conversation_id}",
                    headers={"x-tenant-id": self.tenant_id},
                    json={"status": "ENDED"},
                )
                await client.post(
                    f"{CONVERSATION_SERVICE_URL}/api/v1/conversations/{self.conversation_id}/analyze",
                    headers={"x-tenant-id": self.tenant_id},
                )
        except Exception as e:
            logger.warning("upload_recording_or_analyze_failed", error=str(e))


def _mulaw_chunks_to_wav(chunks: list[bytes]) -> bytes:
    """Wrap mulaw 8kHz mono bytes in a minimal WAV container (format code 7 = mulaw)."""
    import struct
    mulaw_data = b"".join(chunks)
    data_size = len(mulaw_data)
    # WAV header for mulaw (format code 7, 8-bit, 8000 Hz, mono)
    header = b"RIFF"
    header += struct.pack("<I", 36 + data_size)  # file size - 8
    header += b"WAVE"
    header += b"fmt "
    header += struct.pack("<I", 18)       # fmt chunk size (18 for non-PCM)
    header += struct.pack("<H", 7)        # format code mulaw
    header += struct.pack("<H", 1)        # channels
    header += struct.pack("<I", 8000)     # sample rate
    header += struct.pack("<I", 8000)     # byte rate (sample_rate * block_align)
    header += struct.pack("<H", 1)        # block align
    header += struct.pack("<H", 8)        # bits per sample
    header += struct.pack("<H", 0)        # extra params size
    header += b"data"
    header += struct.pack("<I", data_size)
    return header + mulaw_data
