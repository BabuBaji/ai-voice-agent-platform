from typing import Any

from common import get_logger
from .audio_buffer import AudioBuffer
from .vad import VoiceActivityDetector
from .interruption_handler import InterruptionHandler

logger = get_logger("voice-pipeline")


class VoicePipeline:
    """Orchestrates the STT -> LLM -> TTS flow for a voice conversation."""

    def __init__(self, agent_id: str, conversation_id: str):
        self.agent_id = agent_id
        self.conversation_id = conversation_id
        self.audio_buffer = AudioBuffer()
        self.vad = VoiceActivityDetector()
        self.interruption_handler = InterruptionHandler()
        self._running = False

    async def start(self):
        """Initialize the pipeline and connect to providers."""
        logger.info("pipeline_start", agent_id=self.agent_id, conversation_id=self.conversation_id)
        self._running = True

    async def stop(self):
        """Tear down the pipeline."""
        self._running = False
        logger.info("pipeline_stop", conversation_id=self.conversation_id)

    async def process_audio_chunk(self, audio_data: bytes) -> list[dict[str, Any]]:
        """Process an incoming audio chunk through the pipeline.

        Returns a list of result events to send back to the client.
        Each event is one of:
            {"type": "transcript", "text": str, "is_final": bool}
            {"type": "audio", "data": bytes}
            {"type": "event", "event": str, "data": dict}
        """
        results: list[dict[str, Any]] = []

        # Buffer audio
        self.audio_buffer.add(audio_data)

        # Check for voice activity
        is_speech = self.vad.detect(audio_data)

        # Check for barge-in interruption
        if self.interruption_handler.check(is_speech):
            results.append({
                "type": "event",
                "event": "interruption",
                "data": {"conversation_id": self.conversation_id},
            })

        # TODO: feed audio to STT provider, get transcript
        # TODO: send transcript to AI runtime for LLM response
        # TODO: send LLM response text to TTS provider
        # TODO: stream TTS audio back

        # Stub: echo back a transcript event on speech detection
        if is_speech and self.audio_buffer.is_ready():
            results.append({
                "type": "transcript",
                "text": "[stub transcript]",
                "is_final": True,
            })
            self.audio_buffer.clear()

        return results
