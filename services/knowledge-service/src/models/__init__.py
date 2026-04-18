from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class DocumentStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class DocumentResponse(BaseModel):
    id: str
    filename: str
    knowledge_base_id: str
    status: DocumentStatus
    chunk_count: int = 0
    created_at: datetime
    updated_at: datetime


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int


class SearchRequest(BaseModel):
    query: str
    knowledge_base_ids: list[str] = Field(default_factory=list)
    top_k: int = 5


class SearchChunk(BaseModel):
    content: str
    source: str
    score: float
    metadata: dict = Field(default_factory=dict)


class SearchResponse(BaseModel):
    chunks: list[SearchChunk]
    query: str


class KnowledgeBaseCreate(BaseModel):
    name: str
    description: str = ""
    organization_id: str


class KnowledgeBaseResponse(BaseModel):
    id: str
    name: str
    description: str
    organization_id: str
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseListResponse(BaseModel):
    knowledge_bases: list[KnowledgeBaseResponse]
    total: int
