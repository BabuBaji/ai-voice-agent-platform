import httpx
from fastapi import APIRouter

from common import get_logger
from ..models import RAGQueryRequest, RAGQueryResponse, RAGChunk
from ..config import settings

router = APIRouter()
logger = get_logger("rag-api")


@router.post("/query", response_model=RAGQueryResponse)
async def rag_query(request: RAGQueryRequest):
    """Query the knowledge service for relevant document chunks.

    Calls the knowledge-service HTTP API to get relevant chunks
    and returns formatted context.
    """
    logger.info(
        "rag_query",
        query_length=len(request.query),
        kb_ids=request.knowledge_base_ids,
        top_k=request.top_k,
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.knowledge_service_url}/search",
                json={
                    "query": request.query,
                    "knowledge_base_ids": request.knowledge_base_ids,
                    "top_k": request.top_k,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        chunks = [
            RAGChunk(
                content=c["content"],
                source=c.get("source", "unknown"),
                score=c.get("score", 0.0),
                metadata=c.get("metadata", {}),
            )
            for c in data.get("chunks", [])
        ]

        logger.info("rag_query_complete", chunk_count=len(chunks))
        return RAGQueryResponse(chunks=chunks, query=request.query)

    except httpx.HTTPError as e:
        logger.error("rag_query_failed", error=str(e))
        return RAGQueryResponse(chunks=[], query=request.query)
