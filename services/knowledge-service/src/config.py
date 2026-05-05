from common.config import Settings


class KnowledgeServiceSettings(Settings):
    service_name: str = "knowledge-service"
    port: int = 8003

    # Chunking
    chunk_size_tokens: int = 500
    chunk_overlap_tokens: int = 50

    # Embedding — Gemini gemini-embedding-001 truncated to 768 dims so the
    # vectors fit pgvector's HNSW index (≤2000) and stay cosine-comparable.
    # OpenAI is the fallback when GOOGLE_AI_API_KEY is missing or 429s; if
    # both fail, ingestion records the document but skips embeddings (search
    # will simply return [] for that doc until re-indexed).
    embedding_model: str = "models/gemini-embedding-001"
    embedding_dimensions: int = 768
    embedding_provider: str = "gemini"  # "gemini" | "openai"

    # Vector search. Threshold is set low because Gemini-truncated cosine
    # scores cluster below the OpenAI default (the truncation reshapes the
    # similarity distribution). 0.3 keeps obvious off-topic chunks out
    # without filtering legitimately-related results.
    default_top_k: int = 5
    similarity_threshold: float = 0.3


settings = KnowledgeServiceSettings()
