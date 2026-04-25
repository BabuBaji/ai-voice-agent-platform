import asyncio
import mimetypes
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Response

from common import get_db_pool, get_logger
from ..models import DocumentResponse, DocumentListResponse, DocumentStatus
from ..processing.pipeline import ProcessingPipeline
from ..storage.s3_client import S3Client
from ..config import settings

router = APIRouter()
logger = get_logger("documents-api")
pipeline = ProcessingPipeline()


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    knowledge_base_id: str = Form(...),
):
    """Upload a document for processing and indexing.

    1. Reads the uploaded file
    2. Creates a document record in the database
    3. Triggers async processing (parse -> chunk -> embed -> store)
    4. Returns immediately with document status 'pending'
    """
    content = await file.read()
    filename = file.filename or "unknown"
    document_id = str(uuid4())
    now = datetime.now(timezone.utc)

    logger.info(
        "document_upload",
        document_id=document_id,
        filename=filename,
        size=len(content),
        knowledge_base_id=knowledge_base_id,
    )

    # Create document record in database
    try:
        pool = await get_db_pool(settings.database_url)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO documents (id, filename, knowledge_base_id, status, chunk_count, file_size, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                document_id,
                filename,
                knowledge_base_id,
                "pending",
                0,
                len(content),
                now,
                now,
            )
    except Exception as e:
        logger.error("document_db_insert_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to create document record: {str(e)}")

    # Trigger async processing in background
    asyncio.create_task(
        pipeline.process_document(
            document_id=document_id,
            filename=filename,
            content=content,
            knowledge_base_id=knowledge_base_id,
        )
    )

    return DocumentResponse(
        id=document_id,
        filename=filename,
        knowledge_base_id=knowledge_base_id,
        status=DocumentStatus.pending,
        chunk_count=0,
        file_size=len(content),
        created_at=now,
        updated_at=now,
    )


@router.get("", response_model=DocumentListResponse)
async def list_documents(knowledge_base_id: str = ""):
    """List all documents, optionally filtered by knowledge base."""
    pool = await get_db_pool(settings.database_url)

    if knowledge_base_id:
        rows = await pool.fetch(
            """
            SELECT id, filename, knowledge_base_id, status, chunk_count, file_size, created_at, updated_at
            FROM documents
            WHERE knowledge_base_id = $1
            ORDER BY created_at DESC
            """,
            knowledge_base_id,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, filename, knowledge_base_id, status, chunk_count, file_size, created_at, updated_at
            FROM documents
            ORDER BY created_at DESC
            """
        )

    documents = [
        DocumentResponse(
            id=str(row["id"]),
            filename=row["filename"],
            knowledge_base_id=row["knowledge_base_id"],
            status=DocumentStatus(row["status"]),
            chunk_count=row["chunk_count"],
            file_size=row["file_size"] or 0,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]

    return DocumentListResponse(documents=documents, total=len(documents))


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str):
    """Get document status and metadata."""
    pool = await get_db_pool(settings.database_url)
    row = await pool.fetchrow(
        """
        SELECT id, filename, knowledge_base_id, status, chunk_count, file_size, created_at, updated_at
        FROM documents
        WHERE id = $1
        """,
        document_id,
    )

    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    return DocumentResponse(
        id=str(row["id"]),
        filename=row["filename"],
        knowledge_base_id=row["knowledge_base_id"],
        status=DocumentStatus(row["status"]),
        chunk_count=row["chunk_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/{document_id}/raw")
async def get_document_raw(document_id: str):
    """Stream the raw uploaded file back to the browser. Used by the
    knowledge-base UI when the user clicks a document to view it inline
    (PDF in iframe, plain text inline, image as <img>, others as download)."""
    pool = await get_db_pool(settings.database_url)
    row = await pool.fetchrow(
        "SELECT id, filename, knowledge_base_id FROM documents WHERE id = $1",
        document_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    s3_key = f"documents/{row['knowledge_base_id']}/{document_id}/{row['filename']}"
    try:
        s3 = S3Client()
        body = await s3.download(s3_key)
    except Exception as e:
        logger.warning("document_raw_fetch_failed", document_id=document_id, error=str(e))
        raise HTTPException(status_code=404, detail="File not found in storage (may have been deleted or is still processing)")

    content_type, _ = mimetypes.guess_type(row["filename"])
    if not content_type:
        content_type = "application/octet-stream"

    return Response(
        content=body,
        media_type=content_type,
        headers={
            # `inline` so PDFs/images render in the browser; the user can still right-click → save
            "Content-Disposition": f'inline; filename="{row["filename"]}"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """Delete a document and its chunks/embeddings."""
    pool = await get_db_pool(settings.database_url)

    # Check document exists
    row = await pool.fetchrow("SELECT id, knowledge_base_id, filename FROM documents WHERE id = $1", document_id)
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete chunks from vector store
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM document_chunks WHERE document_id = $1", document_id)
        await conn.execute("DELETE FROM documents WHERE id = $1", document_id)

    # Delete from S3 (best effort)
    try:
        from ..storage.s3_client import S3Client
        s3 = S3Client()
        s3_key = f"documents/{row['knowledge_base_id']}/{document_id}/{row['filename']}"
        await s3.delete(s3_key)
    except Exception as e:
        logger.warning("s3_delete_failed", document_id=document_id, error=str(e))

    logger.info("document_deleted", document_id=document_id)
    return {"deleted": True, "id": document_id}
