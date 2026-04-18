from openai import AsyncOpenAI

from common import get_logger
from ..config import settings

logger = get_logger("embedder")

# OpenAI embedding API has a limit of ~8191 tokens per input text
# and batch sizes vary. We'll batch in groups of 100.
BATCH_SIZE = 100


class Embedder:
    """Generates vector embeddings using OpenAI text-embedding-ada-002."""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a list of text chunks.

        Handles batching for large numbers of texts.
        Returns a list of embedding vectors in the same order as input.
        """
        if not texts:
            return []

        logger.info("generating_embeddings", count=len(texts), model=self.model)

        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i:i + BATCH_SIZE]

            # Filter out empty strings and track indices
            non_empty = [(j, t) for j, t in enumerate(batch) if t.strip()]
            if not non_empty:
                all_embeddings.extend([[0.0] * settings.embedding_dimensions] * len(batch))
                continue

            indices, valid_texts = zip(*non_empty)

            response = await self.client.embeddings.create(
                model=self.model,
                input=list(valid_texts),
            )

            # Map embeddings back to original positions
            batch_embeddings: list[list[float]] = [[0.0] * settings.embedding_dimensions] * len(batch)
            for idx, item in zip(indices, response.data):
                batch_embeddings[idx] = item.embedding

            all_embeddings.extend(batch_embeddings)

        logger.info("embeddings_generated", count=len(all_embeddings))
        return all_embeddings

    async def embed_single(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        if not text.strip():
            return [0.0] * settings.embedding_dimensions

        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding
