from fastapi import APIRouter

from ..models import SearchRequest, SearchResponse

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """Vector similarity search across knowledge bases."""
    # TODO: embed query, search pgvector
    return SearchResponse(chunks=[], query=request.query)
