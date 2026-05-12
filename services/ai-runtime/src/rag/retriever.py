import asyncio
import math
import os
from typing import Any, Optional

import google.generativeai as genai
from openai import AsyncOpenAI

from common import get_db_pool, get_logger
from ..config import settings

logger = get_logger("vector-retriever")


# Match knowledge-service: docs are embedded with gemini-embedding-001 at
# output_dimensionality=768 and stored as vector(768). Query embeddings must
# come from the same model + dim, or pgvector returns garbage scores (or 0
# chunks when the OpenAI fallback is quota-dead).
_EMBED_MODEL = "models/gemini-embedding-001"
_EMBED_DIM = 768


def _l2_normalize(vec: list[float]) -> list[float]:
    """gemini-embedding-001 returns un-normalized vectors when
    output_dimensionality < 3072; cosine similarity only behaves correctly
    on unit-length vectors, so we re-normalize here."""
    s = math.sqrt(sum(x * x for x in vec))
    if s == 0:
        return vec
    return [x / s for x in vec]


class VectorRetriever:
    """Retrieves relevant document chunks from pgvector using cosine similarity.

    Embedder strategy mirrors knowledge-service:
      1) Gemini gemini-embedding-001 (retrieval_query task) — primary
      2) OpenAI text-embedding-ada-002 padded/truncated to 768 — fallback
    If both fail we return [] so RAG silently degrades to "no chunks" without
    crashing the chat path.
    """

    def __init__(self):
        google_key = os.getenv("GOOGLE_AI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self._gemini_ready = False
        if google_key:
            try:
                genai.configure(api_key=google_key)
                self._gemini_ready = True
            except Exception as e:
                logger.warning("gemini_configure_failed", error=str(e))
        self._openai = AsyncOpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None

    async def _embed_gemini(self, text: str) -> Optional[list[float]]:
        def _call():
            return genai.embed_content(
                model=_EMBED_MODEL,
                content=text,
                task_type="retrieval_query",
                output_dimensionality=_EMBED_DIM,
            )
        try:
            resp = await asyncio.to_thread(_call)
            emb = resp.get("embedding") if isinstance(resp, dict) else getattr(resp, "embedding", None)
            return _l2_normalize(list(emb)) if emb else None
        except Exception as e:
            logger.warning("gemini_query_embed_failed_fallback", error=str(e))
            return None

    async def _embed_openai(self, text: str) -> Optional[list[float]]:
        if not self._openai:
            return None
        try:
            resp = await self._openai.embeddings.create(model="text-embedding-ada-002", input=text)
            v = list(resp.data[0].embedding)
            if len(v) > _EMBED_DIM:
                v = v[:_EMBED_DIM]
            elif len(v) < _EMBED_DIM:
                v = v + [0.0] * (_EMBED_DIM - len(v))
            return v
        except Exception as e:
            logger.warning("openai_query_embed_failed", error=str(e))
            return None

    async def _embed(self, text: str) -> list[float]:
        """Embed a query string, trying providers in order."""
        if self._gemini_ready:
            v = await self._embed_gemini(text)
            if v is not None:
                return v
        v = await self._embed_openai(text)
        if v is not None:
            return v
        raise RuntimeError("all embedding providers failed")

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
