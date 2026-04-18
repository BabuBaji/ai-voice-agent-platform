import asyncio
import json
from typing import Any

import httpx

from common import get_logger
from .audio_buffer import AudioBuffer
from .vad import VoiceActivityDetector
from .interruption_handler import InterruptionHandler
from ..stt.deepgram_provider import DeepgramProvider
from ..tts.elevenlabs_provider import ElevenLabsProvider
from ..config import settings

logger = get_logger("voice-pipeline")


class VoicePipeline:
    """Orchestrates the real-time STT -> AI Runtime -> TTS flow.

    Audio flows:
    1. Receive audio chunks from WebSocket client
    2. Feed to Deepgram STT for transcription
    3. On final transcript, call ai-runtime for LLM response
    4. Stream LLM response text to ElevenLabs TTS
    5. Return TTS audio chunks to client
    """

    def __init__(self, agent_id: str, conversation_id: str):
        self.agent_id = agent_id
        self.conversation_id = conversation_id
        self.audio_buffer = AudioBuffer()
        self.vad = VoiceActivityDetector()
        self.interruption_handler = InterruptionHandler()

        self.stt = DeepgramProvider()
        self.tts = ElevenLabsProvider()

        self._running = False
        self._audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._result_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._stt_task: asyncio.Task | None = None
        self._conversation_history: list[dict[str, str]] = []
        self._current_utterance = ""

    async def start(self):
        """Initialize the pipeline and start the STT listener."""
        logger.info("pipeline_start", agent_id=self.agent_id, conversation_id=self.conversation_id)
        self._running = True
        self._stt_task = asyncio.create_task(self._run_stt_loop())

    async def stop(self):
        """Tear down the pipeline."""
        self._running = False
        await self._audio_queue.put(None)
        if self._stt_task:
            self._stt_task.cancel()
            try:
                await self._stt_task
            except asyncio.CancelledError:
                pass
        logger.info("pipeline_stop", conversation_id=self.conversation_id)

    async def _audio_generator(self):
        """Yield audio chunks from the queue for the STT provider."""
        while self._running:
            chunk = await self._audio_queue.get()
            if chunk is None:
                break
            yield chunk

    async def _run_stt_loop(self):
        """Continuously stream audio to STT and process transcripts."""
        while self._running:
            try:
                async for transcript in self.stt.stream_transcribe(
                    self._audio_generator(),
                    language=settings.stt_language,
                ):
                    if not self._running:
                        break

                    text = transcript.get("text", "")
                    is_final = transcript.get("is_final", False)

                    if text:
                        await self._result_queue.put({
                            "type": "transcript",
                            "text": text,
                            "is_final": is_final,
                        })

                    if is_final and text.strip():
                        self._current_utterance = text.strip()
                        # Process through LLM and TTS
                        asyncio.create_task(self._process_utterance(self._current_utterance))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("stt_loop_error", error=str(e))
                if self._running:
                    await asyncio.sleep(1)

    async def _process_utterance(self, user_text: str):
        """Send transcript to ai-runtime and stream TTS audio back."""
        logger.info("processing_utterance", text=user_text[:100], conversation_id=self.conversation_id)

        # Add user message to history
        self._conversation_history.append({"role": "user", "content": user_text})

        # Call ai-runtime for LLM response
        try:
            llm_response_text = await self._call_ai_runtime(self._conversation_history)
        except Exception as e:
            logger.error("ai_runtime_error", error=str(e))
            llm_response_text = "I'm sorry, I encountered an error processing your request."

        if not llm_response_text:
            return

        # Add assistant response to history
        self._conversation_history.append({"role": "assistant", "content": llm_response_text})

        # Emit the response text
        await self._result_queue.put({
            "type": "event",
            "event": "response_text",
            "data": {"text": llm_response_text, "conversation_id": self.conversation_id},
        })

        # Generate TTS audio
        self.interruption_handler.set_agent_speaking(True)
        try:
            async for audio_chunk in self.tts.synthesize(
                text=llm_response_text,
                voice_id=settings.default_tts_voice_id,
            ):
                if not self._running:
                    break
                await self._result_queue.put({
                    "type": "audio",
                    "data": audio_chunk,
                })
        except Exception as e:
            logger.error("tts_error", error=str(e))
        finally:
            self.interruption_handler.set_agent_speaking(False)

        await self._result_queue.put({
            "type": "event",
            "event": "response_complete",
            "data": {"conversation_id": self.conversation_id},
        })

    async def _call_ai_runtime(self, messages: list[dict[str, str]]) -> str:
        """Call the ai-runtime chat completion endpoint and collect the full response."""
        payload = {
            "agent_id": self.agent_id,
            "conversation_id": self.conversation_id,
            "messages": messages,
            "context": {
                "agent_config": {},
                "knowledge_base_ids": [],
                "metadata": {"source": "voice"},
            },
        }

        full_text = ""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    f"{settings.ai_runtime_url}/chat/completions",
                    json=payload,
                    headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            data = json.loads(data_str)
                            if data.get("type") == "content":
                                full_text += data.get("content", "")
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            logger.error("ai_runtime_call_failed", error=str(e))
            raise

        return full_text

    async def process_audio_chunk(self, audio_data: bytes) -> list[dict[str, Any]]:
        """Process an incoming audio chunk through the pipeline.

        Feeds audio to the STT stream and collects any ready results.
        Returns a list of result events to send back to the client.
        """
        results: list[dict[str, Any]] = []

        # Feed audio to STT via queue
        await self._audio_queue.put(audio_data)

        # Check for voice activity
        is_speech = self.vad.detect(audio_data)

        # Check for barge-in interruption
        if self.interruption_handler.check(is_speech):
            results.append({
                "type": "event",
                "event": "interruption",
                "data": {"conversation_id": self.conversation_id},
            })

        # Drain any ready results from the result queue
        while not self._result_queue.empty():
            try:
                result = self._result_queue.get_nowait()
                results.append(result)
            except asyncio.QueueEmpty:
                break

        return results
