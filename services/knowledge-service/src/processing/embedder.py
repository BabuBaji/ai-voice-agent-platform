"""Embedding generation with Gemini primary, OpenAI fallback.

Why two providers: the OpenAI account on this deployment is quota-exhausted
(text-embedding-ada-002 returns 429), so making OpenAI the only path silently
breaks ingestion + RAG search. We try Gemini first (the platform already has
GOOGLE_AI_API_KEY configured for chat) and fall through to OpenAI only when
Gemini fails (no key, transient error). If both fail, embeddings come back as
zero-vectors — the document still ingests so the user sees it in the UI, but
RAG won't match anything until the next re-index when a working provider is
available.
"""
from __future__ import annotations

import asyncio
import math
import os
from typing import Optional

import google.generativeai as genai
from openai import AsyncOpenAI

from common import get_logger
from ..config import settings


def _l2_normalize(vec: list[float]) -> list[float]:
    """Gemini's gemini-embedding-001 returns un-normalized vectors when
    output_dimensionality < 3072. Cosine similarity (pgvector <=>) only
    behaves correctly on unit-length vectors, so we re-normalize here.
    Returns the input unchanged for zero/empty vectors."""
    s = math.sqrt(sum(x * x for x in vec))
    if s == 0:
        return vec
    return [x / s for x in vec]

logger = get_logger("embedder")

# Batch size limits — Gemini's embed_content takes one input at a time, so
# we use to_thread for parallelism. OpenAI accepts batches of 100. We cap at
# 32 concurrent Gemini calls to avoid bursting the free-tier rate limit.
GEMINI_BATCH = 32
OPENAI_BATCH = 100


class Embedder:
    """Multi-provider embedding generator. Gemini primary, OpenAI fallback."""

    def __init__(self):
        self.dim = settings.embedding_dimensions
        self.model = settings.embedding_model
        self.provider = settings.embedding_provider

        # Gemini setup (lazy: only configure if key is present)
        google_key = os.getenv("GOOGLE_AI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self._gemini_ready = False
        if google_key:
            try:
                genai.configure(api_key=google_key)
                self._gemini_ready = True
            except Exception as e:
                logger.warning("gemini_configure_failed", error=str(e))

        # OpenAI fallback client
        self._openai = AsyncOpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None

    # ---- public ------------------------------------------------------------

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of texts. Order-preserving. Returns zero-vectors for
        any input that failed (so the caller can still persist the chunk)."""
        if not texts:
            return []
        logger.info("generating_embeddings", count=len(texts), model=self.model, provider=self.provider)

        if self._gemini_ready:
            try:
                return await self._embed_gemini_batch(texts, task_type="retrieval_document")
            except Exception as e:
                logger.warning("gemini_embed_failed_fallback_to_openai", error=str(e))

        if self._openai:
            try:
                return await self._embed_openai_batch(texts)
            except Exception as e:
                logger.warning("openai_embed_failed", error=str(e))

        logger.error("all_embedding_providers_failed_returning_zeros", count=len(texts))
        return [[0.0] * self.dim for _ in texts]

    async def embed_single(self, text: str) -> list[float]:
        """Embed a single query. Used at search time."""
        if not text.strip():
            return [0.0] * self.dim

        if self._gemini_ready:
            try:
                vec = await self._embed_gemini_one(text, task_type="retrieval_query")
                if vec is not None:
                    return vec
            except Exception as e:
                logger.warning("gemini_query_embed_failed_fallback", error=str(e))

        if self._openai:
            try:
                resp = await self._openai.embeddings.create(model="text-embedding-ada-002", input=text)
                return resp.data[0].embedding
            except Exception as e:
                logger.warning("openai_query_embed_failed", error=str(e))

        return [0.0] * self.dim

    # ---- providers ---------------------------------------------------------

    async def _embed_gemini_one(self, text: str, task_type: str) -> Optional[list[float]]:
        """Single Gemini call wrapped in to_thread (the SDK is sync)."""
        def _call():
            return genai.embed_content(
                model=self.model,
                content=text,
                task_type=task_type,
                output_dimensionality=self.dim,
            )
        resp = await asyncio.to_thread(_call)
        emb = resp.get("embedding") if isinstance(resp, dict) else getattr(resp, "embedding", None)
        if not emb:
            return None
        return _l2_normalize(list(emb))

    async def _embed_gemini_batch(self, texts: list[str], task_type: str) -> list[list[float]]:
        """Run a batch of Gemini embeddings with bounded concurrency."""
        sem = asyncio.Semaphore(GEMINI_BATCH)

        async def _one(i: int, t: str) -> tuple[int, list[float]]:
            if not t.strip():
                return i, [0.0] * self.dim
            async with sem:
                vec = await self._embed_gemini_one(t, task_type)
                return i, (vec or [0.0] * self.dim)

        results = await asyncio.gather(*[_one(i, t) for i, t in enumerate(texts)])
        results.sort(key=lambda x: x[0])
        return [v for _, v in results]

    async def _embed_openai_batch(self, texts: list[str]) -> list[list[float]]:
        """OpenAI fallback. text-embedding-ada-002 is 1536-dim; if we're
        configured for a different dim, pad/truncate so the column accepts it."""
        all_emb: list[list[float]] = []
        for i in range(0, len(texts), OPENAI_BATCH):
            batch = texts[i:i + OPENAI_BATCH]
            non_empty = [(j, t) for j, t in enumerate(batch) if t.strip()]
            if not non_empty:
                all_emb.extend([[0.0] * self.dim] * len(batch))
                continue
            indices, valid = zip(*non_empty)
            resp = await self._openai.embeddings.create(model="text-embedding-ada-002", input=list(valid))
            slot: list[list[float]] = [[0.0] * self.dim] * len(batch)
            for idx, item in zip(indices, resp.data):
                v = list(item.embedding)
                if len(v) > self.dim:
                    v = v[: self.dim]
                elif len(v) < self.dim:
                    v = v + [0.0] * (self.dim - len(v))
                slot[idx] = v
            all_emb.extend(slot)
        return all_emb
