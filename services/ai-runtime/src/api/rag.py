from fastapi import APIRouter

from ..models import RAGQueryRequest, RAGQueryResponse
from ..rag.pipeline import RAGPipeline

router = APIRouter()
rag_pipeline = RAGPipeline()


@router.post("/query", response_model=RAGQueryResponse)
async def rag_query(request: RAGQueryRequest):
    result = await rag_pipeline.query(
        query=request.query,
        knowledge_base_ids=request.knowledge_base_ids,
        top_k=request.top_k,
    )
    return result
