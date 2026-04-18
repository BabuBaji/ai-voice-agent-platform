from common.config import Settings


class KnowledgeServiceSettings(Settings):
    service_name: str = "knowledge-service"
    port: int = 8003

    # Chunking
    chunk_size_tokens: int = 500
    chunk_overlap_tokens: int = 50

    # Embedding
    embedding_model: str = "text-embedding-ada-002"
    embedding_dimensions: int = 1536

    # Vector search
    default_top_k: int = 5
    similarity_threshold: float = 0.7


settings = KnowledgeServiceSettings()
