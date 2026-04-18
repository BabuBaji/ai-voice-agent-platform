import tiktoken

from common import get_logger

logger = get_logger("chunker")


class RecursiveChunker:
    """Splits documents into overlapping chunks of approximately target_tokens size.

    Uses tiktoken for accurate token counting and a recursive splitting strategy:
    tries paragraph breaks first, then sentence breaks, then word breaks.
    """

    def __init__(self, target_tokens: int = 500, overlap_tokens: int = 50):
        self.target_tokens = target_tokens
        self.overlap_tokens = overlap_tokens
        self._separators = ["\n\n", "\n", ". ", "; ", ", ", " "]
        try:
            self._encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self._encoding = tiktoken.get_encoding("gpt2")

    def _count_tokens(self, text: str) -> int:
        """Count tokens using tiktoken for accurate measurement."""
        return len(self._encoding.encode(text))

    def _decode_tokens(self, tokens: list[int]) -> str:
        """Decode token IDs back to text."""
        return self._encoding.decode(tokens)

    def chunk(self, text: str) -> list[dict]:
        """Split text into chunks.

        Returns list of {"content": str, "index": int, "token_count": int}
        """
        if not text.strip():
            return []

        chunks = self._recursive_split(text, self._separators)

        result = []
        for i, chunk_text in enumerate(chunks):
            cleaned = chunk_text.strip()
            if cleaned:
                result.append({
                    "content": cleaned,
                    "index": i,
                    "token_count": self._count_tokens(cleaned),
                })

        logger.info("chunked_document", total_chunks=len(result))
        return result

    def _recursive_split(self, text: str, separators: list[str]) -> list[str]:
        """Recursively split text using hierarchical separators."""
        token_count = self._count_tokens(text)
        if token_count <= self.target_tokens:
            return [text] if text.strip() else []

        if not separators:
            # Last resort: hard split by token count
            return self._hard_split(text)

        sep = separators[0]
        parts = text.split(sep)

        if len(parts) <= 1:
            # This separator doesn't split the text; try the next one
            return self._recursive_split(text, separators[1:])

        chunks: list[str] = []
        current = ""

        for part in parts:
            candidate = current + sep + part if current else part
            if self._count_tokens(candidate) > self.target_tokens and current:
                chunks.append(current)
                # Create overlap from end of previous chunk
                overlap = self._get_overlap_text(current)
                current = overlap + part if overlap else part
            else:
                current = candidate

        if current.strip():
            chunks.append(current)

        # If any chunk is still too large, recurse with the next separator
        final_chunks: list[str] = []
        for chunk in chunks:
            if self._count_tokens(chunk) > self.target_tokens * 1.5:
                final_chunks.extend(self._recursive_split(chunk, separators[1:]))
            else:
                final_chunks.append(chunk)

        return final_chunks

    def _get_overlap_text(self, text: str) -> str:
        """Extract the last overlap_tokens worth of text."""
        tokens = self._encoding.encode(text)
        if len(tokens) <= self.overlap_tokens:
            return text
        overlap_tokens = tokens[-self.overlap_tokens:]
        return self._decode_tokens(overlap_tokens)

    def _hard_split(self, text: str) -> list[str]:
        """Split text into chunks of exactly target_tokens with overlap."""
        tokens = self._encoding.encode(text)
        chunks: list[str] = []
        step = self.target_tokens - self.overlap_tokens
        if step <= 0:
            step = self.target_tokens

        i = 0
        while i < len(tokens):
            chunk_tokens = tokens[i:i + self.target_tokens]
            chunk_text = self._decode_tokens(chunk_tokens)
            if chunk_text.strip():
                chunks.append(chunk_text)
            i += step

        return chunks
