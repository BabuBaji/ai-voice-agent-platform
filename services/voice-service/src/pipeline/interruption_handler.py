import time

from ..config import settings


class InterruptionHandler:
    """Detects barge-in: when the user starts speaking while the agent is responding.

    When an interruption is detected, the TTS playback should be stopped
    and the pipeline should switch back to listening mode.
    """

    def __init__(self, threshold_ms: int | None = None):
        self.threshold_ms = threshold_ms or settings.interruption_threshold_ms
        self._agent_speaking = False
        self._speech_start_time: float | None = None

    def set_agent_speaking(self, speaking: bool):
        """Called when agent TTS starts or stops playing."""
        self._agent_speaking = speaking
        if not speaking:
            self._speech_start_time = None

    def check(self, is_user_speech: bool) -> bool:
        """Check if the user is interrupting the agent.

        Returns True if barge-in is detected.
        """
        if not self._agent_speaking:
            self._speech_start_time = None
            return False

        if is_user_speech:
            now = time.monotonic() * 1000
            if self._speech_start_time is None:
                self._speech_start_time = now
                return False

            elapsed = now - self._speech_start_time
            if elapsed >= self.threshold_ms:
                self._speech_start_time = None
                self._agent_speaking = False
                return True
        else:
            self._speech_start_time = None

        return False

    def reset(self):
        self._agent_speaking = False
        self._speech_start_time = None
