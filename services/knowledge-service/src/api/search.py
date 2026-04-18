from fastapi import APIRouter

from common import get_logger
from ..models import SearchRequest, SearchResponse, SearchChunk
from ..processing.embedder import Embedder
from ..storage.vector_store import VectorStore
from ..config import settings

router = APIRouter()
logger = get_logger("search-api")

embedder = Embedder()
vector_store = VectorStore()


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """Vector similarity search across knowledge bases.

    1. Generates query embedding using OpenAI
    2. Searches pgvector for similar chunks
    3. Returns ranked results with similarity scores
    """
    logger.info(
        "search_request",
        query_length=len(request.query),
        kb_ids=request.knowledge_base_ids,
        top_k=request.top_k,
    )

    # Generate embedding for the query
    try:
        query_embedding = await embedder.embed_single(request.query)
    except Exception as e:
        logger.error("query_embedding_failed", error=str(e))
        return SearchResponse(chunks=[], query=request.query)

    # Search pgvector
    try:
        results = await vector_store.search(
            query_embedding=query_embedding,
            knowledge_base_ids=request.knowledge_base_ids,
            top_k=request.top_k,
            similarity_threshold=settings.similarity_threshold,
        )
    except Exception as e:
        logger.error("vector_search_failed", error=str(e))
        return SearchResponse(chunks=[], query=request.query)

    chunks = [
        SearchChunk(
            content=r["content"],
            source=r["source"],
            score=r["score"],
            metadata=r.get("metadata", {}),
        )
        for r in results
    ]

    logger.info("search_complete", result_count=len(chunks))
    return SearchResponse(chunks=chunks, query=request.query)
