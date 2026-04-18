from typing import Any

from common import get_db_pool, get_logger
from ..config import settings

logger = get_logger("vector-store")


class VectorStore:
    """pgvector operations for storing and searching document embeddings.

    Uses asyncpg with the pgvector extension for cosine similarity search.
    """

    async def _get_pool(self):
        return await get_db_pool(settings.database_url)

    async def insert_chunks(
        self,
        document_id: str,
        knowledge_base_id: str,
        chunks: list[dict],
        embeddings: list[list[float]],
    ):
        """Insert document chunks with their embeddings into pgvector.

        Uses a transaction and batch insert for efficiency.
        """
        pool = await self._get_pool()
        logger.info("inserting_chunks", document_id=document_id, count=len(chunks))

        async with pool.acquire() as conn:
            async with conn.transaction():
                # Use prepared statement for batch efficiency
                stmt = await conn.prepare(
                    """
                    INSERT INTO document_chunks
                        (document_id, knowledge_base_id, content, chunk_index,
                         token_count, embedding, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)
                    """
                )

                for chunk, embedding in zip(chunks, embeddings):
                    await stmt.fetch(
                        document_id,
                        knowledge_base_id,
                        chunk["content"],
                        chunk["index"],
                        chunk.get("token_count", 0),
                        str(embedding),
                        "{}",
                    )

        logger.info("chunks_inserted", document_id=document_id, count=len(chunks))

    async def search(
        self,
        query_embedding: list[float],
        knowledge_base_ids: list[str],
        top_k: int = 5,
        similarity_threshold: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Search for similar chunks using cosine distance.

        Uses pgvector's <=> operator for cosine distance.
        Score = 1 - cosine_distance (higher is more similar).
        """
        pool = await self._get_pool()

        embedding_str = str(query_embedding)

        if knowledge_base_ids:
            rows = await pool.fetch(
                """
                SELECT
                    dc.content,
                    dc.document_id,
                    dc.chunk_index,
                    dc.knowledge_base_id,
                    d.filename AS source,
                    1 - (dc.embedding <=> $1::vector) AS score
                FROM document_chunks dc
                LEFT JOIN documents d ON dc.document_id = d.id::text
                WHERE dc.knowledge_base_id = ANY($2)
                ORDER BY dc.embedding <=> $1::vector
                LIMIT $3
                """,
                embedding_str,
                knowledge_base_ids,
                top_k,
            )
        else:
            rows = await pool.fetch(
                """
                SELECT
                    dc.content,
                    dc.document_id,
                    dc.chunk_index,
                    dc.knowledge_base_id,
                    d.filename AS source,
                    1 - (dc.embedding <=> $1::vector) AS score
                FROM document_chunks dc
                LEFT JOIN documents d ON dc.document_id = d.id::text
                ORDER BY dc.embedding <=> $1::vector
                LIMIT $2
                """,
                embedding_str,
                top_k,
            )

        results = []
        for row in rows:
            score = float(row["score"])
            if score >= similarity_threshold:
                results.append({
                    "content": row["content"],
                    "source": row.get("source") or row["document_id"],
                    "score": score,
                    "metadata": {
                        "chunk_index": row["chunk_index"],
                        "document_id": row["document_id"],
                        "knowledge_base_id": row["knowledge_base_id"],
                    },
                })

        logger.info("vector_search_complete", results=len(results), top_k=top_k)
        return results

    async def delete_by_document(self, document_id: str):
        """Delete all chunks for a document."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            count = await conn.execute(
                "DELETE FROM document_chunks WHERE document_id = $1",
                document_id,
            )
            logger.info("chunks_deleted", document_id=document_id, result=count)

    async def delete_by_knowledge_base(self, knowledge_base_id: str):
        """Delete all chunks for a knowledge base."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            count = await conn.execute(
                "DELETE FROM document_chunks WHERE knowledge_base_id = $1",
                knowledge_base_id,
            )
            logger.info("chunks_deleted_by_kb", knowledge_base_id=knowledge_base_id, result=count)
