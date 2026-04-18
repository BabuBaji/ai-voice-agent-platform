from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from common import get_db_pool, get_logger
from ..models import (
    KnowledgeBaseCreate,
    KnowledgeBaseResponse,
    KnowledgeBaseListResponse,
)
from ..config import settings

router = APIRouter()
logger = get_logger("knowledge-bases-api")


@router.post("", response_model=KnowledgeBaseResponse)
async def create_knowledge_base(body: KnowledgeBaseCreate):
    """Create a new knowledge base."""
    pool = await get_db_pool(settings.database_url)
    now = datetime.now(timezone.utc)

    row = await pool.fetchrow(
        """
        INSERT INTO knowledge_bases (name, description, organization_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, description, organization_id, document_count, created_at, updated_at
        """,
        body.name,
        body.description,
        body.organization_id,
        now,
        now,
    )

    logger.info("knowledge_base_created", kb_id=str(row["id"]), name=body.name)

    return KnowledgeBaseResponse(
        id=str(row["id"]),
        name=row["name"],
        description=row["description"],
        organization_id=row["organization_id"],
        document_count=row["document_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=KnowledgeBaseListResponse)
async def list_knowledge_bases(organization_id: str = ""):
    """List all knowledge bases, optionally filtered by organization."""
    pool = await get_db_pool(settings.database_url)

    if organization_id:
        rows = await pool.fetch(
            """
            SELECT id, name, description, organization_id, document_count, created_at, updated_at
            FROM knowledge_bases
            WHERE organization_id = $1
            ORDER BY created_at DESC
            """,
            organization_id,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, name, description, organization_id, document_count, created_at, updated_at
            FROM knowledge_bases
            ORDER BY created_at DESC
            """
        )

    knowledge_bases = [
        KnowledgeBaseResponse(
            id=str(row["id"]),
            name=row["name"],
            description=row["description"],
            organization_id=row["organization_id"],
            document_count=row["document_count"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]

    return KnowledgeBaseListResponse(knowledge_bases=knowledge_bases, total=len(knowledge_bases))


@router.get("/{kb_id}", response_model=KnowledgeBaseResponse)
async def get_knowledge_base(kb_id: str):
    """Get a knowledge base by ID."""
    pool = await get_db_pool(settings.database_url)
    row = await pool.fetchrow(
        """
        SELECT id, name, description, organization_id, document_count, created_at, updated_at
        FROM knowledge_bases
        WHERE id = $1
        """,
        kb_id,
    )

    if not row:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    return KnowledgeBaseResponse(
        id=str(row["id"]),
        name=row["name"],
        description=row["description"],
        organization_id=row["organization_id"],
        document_count=row["document_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.put("/{kb_id}", response_model=KnowledgeBaseResponse)
async def update_knowledge_base(kb_id: str, body: KnowledgeBaseCreate):
    """Update a knowledge base."""
    pool = await get_db_pool(settings.database_url)
    now = datetime.now(timezone.utc)

    row = await pool.fetchrow(
        """
        UPDATE knowledge_bases
        SET name = $1, description = $2, organization_id = $3, updated_at = $4
        WHERE id = $5
        RETURNING id, name, description, organization_id, document_count, created_at, updated_at
        """,
        body.name,
        body.description,
        body.organization_id,
        now,
        kb_id,
    )

    if not row:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    return KnowledgeBaseResponse(
        id=str(row["id"]),
        name=row["name"],
        description=row["description"],
        organization_id=row["organization_id"],
        document_count=row["document_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.delete("/{kb_id}")
async def delete_knowledge_base(kb_id: str):
    """Delete a knowledge base and all its documents and chunks."""
    pool = await get_db_pool(settings.database_url)

    # Check it exists
    row = await pool.fetchrow("SELECT id FROM knowledge_bases WHERE id = $1", kb_id)
    if not row:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Delete chunks
            await conn.execute(
                "DELETE FROM document_chunks WHERE knowledge_base_id = $1", str(kb_id)
            )
            # Delete documents
            await conn.execute(
                "DELETE FROM documents WHERE knowledge_base_id = $1", str(kb_id)
            )
            # Delete knowledge base
            await conn.execute(
                "DELETE FROM knowledge_bases WHERE id = $1", kb_id
            )

    logger.info("knowledge_base_deleted", kb_id=str(kb_id))
    return {"deleted": True, "id": str(kb_id)}
