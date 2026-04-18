from typing import Any

from openai import AsyncOpenAI

from common import get_db_pool, get_logger
from ..config import settings

logger = get_logger("vector-retriever")


class VectorRetriever:
    """Retrieves relevant document chunks from pgvector using cosine similarity."""

    def __init__(self):
        self._embed_client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def _embed(self, text: str) -> list[float]:
        """Generate embedding for a query string."""
        response = await self._embed_client.embeddings.create(
            model="text-embedding-ada-002",
            input=text,
        )
        return response.data[0].embedding

    async def search(
        self,
        query: str,
        knowledge_base_ids: list[str],
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Search for similar chunks using pgvector cosine similarity.

        1. Generate embedding for the query
        2. Search pgvector using cosine distance operator (<=>)
        3. Return ranked results with similarity scores
        """
        logger.info(
            "vector_search",
            query_length=len(query),
            kb_ids=knowledge_base_ids,
            top_k=top_k,
        )

        # Generate query embedding
        try:
            embedding = await self._embed(query)
        except Exception as e:
            logger.error("embedding_failed", error=str(e))
            return []

        # Search pgvector
        try:
            pool = await get_db_pool(settings.database_url)

            if knowledge_base_ids:
                rows = await pool.fetch(
                    """
                    SELECT content, document_id, chunk_index, metadata,
                           1 - (embedding <=> $1::vector) AS similarity
                    FROM document_chunks
                    WHERE knowledge_base_id = ANY($2)
                    ORDER BY embedding <=> $1::vector
                    LIMIT $3
                    """,
                    str(embedding),
                    knowledge_base_ids,
                    top_k,
                )
            else:
                rows = await pool.fetch(
                    """
                    SELECT content, document_id, chunk_index, metadata,
                           1 - (embedding <=> $1::vector) AS similarity
                    FROM document_chunks
                    ORDER BY embedding <=> $1::vector
                    LIMIT $2
                    """,
                    str(embedding),
                    top_k,
                )

            results = []
            for row in rows:
                score = float(row["similarity"])
                if score >= settings.rag_similarity_threshold:
                    results.append({
                        "content": row["content"],
                        "source": row["document_id"],
                        "score": score,
                        "metadata": {
                            "chunk_index": row["chunk_index"],
                        },
                    })

            logger.info("vector_search_complete", result_count=len(results))
            return results

        except Exception as e:
            logger.error("vector_search_failed", error=str(e))
            return []
