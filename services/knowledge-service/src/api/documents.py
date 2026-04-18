from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from ..models import DocumentResponse, DocumentListResponse, DocumentStatus

router = APIRouter()


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    knowledge_base_id: str = Form(...),
):
    """Upload a document for processing and indexing."""
    # TODO: save to S3, enqueue processing pipeline
    now = datetime.now(timezone.utc)
    return DocumentResponse(
        id=str(uuid4()),
        filename=file.filename or "unknown",
        knowledge_base_id=knowledge_base_id,
        status=DocumentStatus.pending,
        chunk_count=0,
        created_at=now,
        updated_at=now,
    )


@router.get("", response_model=DocumentListResponse)
async def list_documents(knowledge_base_id: str = ""):
    """List all documents, optionally filtered by knowledge base."""
    # TODO: query database
    return DocumentListResponse(documents=[], total=0)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str):
    """Get document status and metadata."""
    # TODO: query database
    raise HTTPException(status_code=404, detail="Document not found")


@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """Delete a document and its chunks/embeddings."""
    # TODO: delete from DB, S3, and vector store
    return {"deleted": True, "id": document_id}
