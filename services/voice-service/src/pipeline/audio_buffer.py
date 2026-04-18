from ..config import settings


class AudioBuffer:
    """Buffers incoming audio chunks and signals when enough data is ready for processing."""

    def __init__(self, chunk_ms: int | None = None, sample_rate: int | None = None):
        self.chunk_ms = chunk_ms or settings.audio_chunk_ms
        self.sample_rate = sample_rate or settings.stt_sample_rate
        self._buffer = bytearray()
        # Minimum buffer size before processing (~500ms of 16-bit mono audio)
        self._min_bytes = int(self.sample_rate * 2 * 0.5)

    def add(self, data: bytes):
        """Append audio data to the buffer."""
        self._buffer.extend(data)

    def is_ready(self) -> bool:
        """Check if the buffer has enough data for processing."""
        return len(self._buffer) >= self._min_bytes

    def consume(self) -> bytes:
        """Return buffered audio and clear the buffer."""
        data = bytes(self._buffer)
        self._buffer.clear()
        return data

    def clear(self):
        """Discard all buffered audio."""
        self._buffer.clear()

    @property
    def size(self) -> int:
        return len(self._buffer)

    @property
    def duration_ms(self) -> float:
        """Estimated duration of buffered audio in milliseconds."""
        return (len(self._buffer) / (self.sample_rate * 2)) * 1000
