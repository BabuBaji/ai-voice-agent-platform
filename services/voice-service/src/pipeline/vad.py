import struct

from ..config import settings


class VoiceActivityDetector:
    """Voice Activity Detection - detects whether audio contains speech.

    Stub implementation using simple energy threshold.
    TODO: replace with WebRTC VAD or Silero VAD model.
    """

    def __init__(self, threshold: float | None = None):
        self.threshold = threshold or settings.vad_threshold
        self._speech_frames = 0
        self._silence_frames = 0

    def detect(self, audio_chunk: bytes) -> bool:
        """Returns True if the audio chunk likely contains speech."""
        if len(audio_chunk) < 2:
            return False

        # Simple RMS energy detection (16-bit PCM assumed)
        try:
            samples = struct.unpack(f"<{len(audio_chunk) // 2}h", audio_chunk)
            rms = (sum(s * s for s in samples) / len(samples)) ** 0.5
            normalized = rms / 32768.0
        except struct.error:
            return False

        is_speech = normalized > self.threshold

        if is_speech:
            self._speech_frames += 1
            self._silence_frames = 0
        else:
            self._silence_frames += 1
            if self._silence_frames > 15:  # ~300ms at 20ms chunks
                self._speech_frames = 0

        return is_speech

    def reset(self):
        self._speech_frames = 0
        self._silence_frames = 0
