from common import get_logger

logger = get_logger("chunker")


class RecursiveChunker:
    """Splits documents into overlapping chunks of approximately target_tokens size.

    Uses a recursive splitting strategy: tries paragraph breaks first,
    then sentence breaks, then word breaks.
    """

    def __init__(self, target_tokens: int = 500, overlap_tokens: int = 50):
        self.target_tokens = target_tokens
        self.overlap_tokens = overlap_tokens
        self._separators = ["\n\n", "\n", ". ", " "]

    def chunk(self, text: str) -> list[dict]:
        """Split text into chunks.

        Returns list of {"content": str, "index": int, "token_count": int}
        """
        if not text.strip():
            return []

        chunks = self._recursive_split(text, self._separators)

        result = []
        for i, chunk_text in enumerate(chunks):
            result.append({
                "content": chunk_text.strip(),
                "index": i,
                "token_count": self._estimate_tokens(chunk_text),
            })

        logger.info("chunked_document", total_chunks=len(result))
        return result

    def _recursive_split(self, text: str, separators: list[str]) -> list[str]:
        """Recursively split text using hierarchical separators."""
        if self._estimate_tokens(text) <= self.target_tokens:
            return [text] if text.strip() else []

        if not separators:
            # Last resort: hard split by approximate character count
            chars_per_token = 4
            size = self.target_tokens * chars_per_token
            return [text[i:i + size] for i in range(0, len(text), size - self.overlap_tokens * chars_per_token)]

        sep = separators[0]
        parts = text.split(sep)

        chunks = []
        current = ""

        for part in parts:
            candidate = current + sep + part if current else part
            if self._estimate_tokens(candidate) > self.target_tokens and current:
                chunks.append(current)
                # Include overlap from end of previous chunk
                overlap_text = current[-self.overlap_tokens * 4:] if len(current) > self.overlap_tokens * 4 else ""
                current = overlap_text + part if overlap_text else part
            else:
                current = candidate

        if current.strip():
            chunks.append(current)

        # If splitting didn't help, try next separator
        final_chunks = []
        for chunk in chunks:
            if self._estimate_tokens(chunk) > self.target_tokens * 1.5:
                final_chunks.extend(self._recursive_split(chunk, separators[1:]))
            else:
                final_chunks.append(chunk)

        return final_chunks

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """Rough token estimate: ~4 chars per token for English."""
        return len(text) // 4
