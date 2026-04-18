from typing import Any

from common import get_db_pool, get_logger
from ..config import settings

logger = get_logger("vector-store")


class VectorStore:
    """pgvector operations for storing and searching document embeddings."""

    async def _get_pool(self):
        return await get_db_pool(settings.database_url)

    async def insert_chunks(
        self,
        document_id: str,
        knowledge_base_id: str,
        chunks: list[dict],
        embeddings: list[list[float]],
    ):
        """Insert document chunks with their embeddings into pgvector."""
        pool = await self._get_pool()
        logger.info("inserting_chunks", document_id=document_id, count=len(chunks))

        async with pool.acquire() as conn:
            for chunk, embedding in zip(chunks, embeddings):
                await conn.execute(
                    """
                    INSERT INTO document_chunks
                        (document_id, knowledge_base_id, content, chunk_index, embedding, metadata)
                    VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
                    """,
                    document_id,
                    knowledge_base_id,
                    chunk["content"],
                    chunk["index"],
                    str(embedding),
                    "{}",
                )

    async def search(
        self,
        query_embedding: list[float],
        knowledge_base_ids: list[str],
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Search for similar chunks using cosine distance."""
        pool = await self._get_pool()

        kb_filter = ""
        args: list[Any] = [str(query_embedding), top_k]

        if knowledge_base_ids:
            placeholders = ", ".join(f"${i+3}" for i in range(len(knowledge_base_ids)))
            kb_filter = f"WHERE knowledge_base_id IN ({placeholders})"
            args.extend(knowledge_base_ids)

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT content, document_id, chunk_index,
                       1 - (embedding <=> $1::vector) AS score
                FROM document_chunks
                {kb_filter}
                ORDER BY embedding <=> $1::vector
                LIMIT $2
                """,
                *args,
            )

        return [
            {
                "content": row["content"],
                "source": row["document_id"],
                "score": float(row["score"]),
                "metadata": {"chunk_index": row["chunk_index"]},
            }
            for row in rows
        ]

    async def delete_by_document(self, document_id: str):
        """Delete all chunks for a document."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM document_chunks WHERE document_id = $1",
                document_id,
            )
