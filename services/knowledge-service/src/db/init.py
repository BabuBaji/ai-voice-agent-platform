"""Database initialization for the knowledge service.

Creates all required tables and enables the pgvector extension.
"""

from common import get_logger

logger = get_logger("db-init")

INIT_SQL = """
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Knowledge bases table
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    organization_id VARCHAR(255) NOT NULL,
    document_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_org
    ON knowledge_bases(organization_id);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,
    filename VARCHAR(500) NOT NULL,
    knowledge_base_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    chunk_count INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    error_message TEXT DEFAULT '',
    s3_key VARCHAR(1000) DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_kb
    ON documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_documents_status
    ON documents(status);

-- Document chunks table with pgvector embedding column
CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL,
    knowledge_base_id VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    token_count INTEGER DEFAULT 0,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document
    ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_kb
    ON document_chunks(knowledge_base_id);

-- Create HNSW index for fast approximate nearest neighbor search
-- This significantly speeds up vector similarity queries
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
"""


async def initialize_database(pool) -> None:
    """Create all tables and indexes required by the knowledge service.

    Should be called during application startup.
    """
    logger.info("initializing_database")

    async with pool.acquire() as conn:
        await conn.execute(INIT_SQL)

    logger.info("database_initialized")
