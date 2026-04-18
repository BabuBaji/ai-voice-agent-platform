from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from ..models import (
    KnowledgeBaseCreate,
    KnowledgeBaseResponse,
    KnowledgeBaseListResponse,
)

router = APIRouter()


@router.post("", response_model=KnowledgeBaseResponse)
async def create_knowledge_base(body: KnowledgeBaseCreate):
    """Create a new knowledge base."""
    now = datetime.now(timezone.utc)
    return KnowledgeBaseResponse(
        id=str(uuid4()),
        name=body.name,
        description=body.description,
        organization_id=body.organization_id,
        document_count=0,
        created_at=now,
        updated_at=now,
    )


@router.get("", response_model=KnowledgeBaseListResponse)
async def list_knowledge_bases(organization_id: str = ""):
    """List all knowledge bases."""
    # TODO: query database
    return KnowledgeBaseListResponse(knowledge_bases=[], total=0)


@router.get("/{kb_id}", response_model=KnowledgeBaseResponse)
async def get_knowledge_base(kb_id: str):
    """Get a knowledge base by ID."""
    # TODO: query database
    raise HTTPException(status_code=404, detail="Knowledge base not found")


@router.put("/{kb_id}", response_model=KnowledgeBaseResponse)
async def update_knowledge_base(kb_id: str, body: KnowledgeBaseCreate):
    """Update a knowledge base."""
    now = datetime.now(timezone.utc)
    return KnowledgeBaseResponse(
        id=kb_id,
        name=body.name,
        description=body.description,
        organization_id=body.organization_id,
        document_count=0,
        created_at=now,
        updated_at=now,
    )


@router.delete("/{kb_id}")
async def delete_knowledge_base(kb_id: str):
    """Delete a knowledge base and all its documents."""
    # TODO: cascade delete documents, chunks, embeddings
    return {"deleted": True, "id": kb_id}
