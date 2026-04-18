from openai import AsyncOpenAI

from common import get_logger
from ..config import settings

logger = get_logger("embedder")


class Embedder:
    """Generates vector embeddings using OpenAI text-embedding-ada-002."""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a list of text chunks.

        Returns a list of embedding vectors.
        """
        if not texts:
            return []

        logger.info("generating_embeddings", count=len(texts), model=self.model)

        response = await self.client.embeddings.create(
            model=self.model,
            input=texts,
        )

        embeddings = [item.embedding for item in response.data]
        logger.info("embeddings_generated", count=len(embeddings))
        return embeddings

    async def embed_single(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        result = await self.embed([text])
        return result[0] if result else []
