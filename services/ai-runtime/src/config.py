from common.config import Settings


class AIRuntimeSettings(Settings):
    service_name: str = "ai-runtime"
    port: int = 8000

    # LLM defaults
    default_llm_provider: str = "openai"
    default_model: str = "gpt-4o"
    default_temperature: float = 0.7
    default_max_tokens: int = 4096

    # RAG defaults
    rag_top_k: int = 5
    rag_similarity_threshold: float = 0.7

    # Service URLs
    knowledge_service_url: str = "http://localhost:8003"
    crm_service_url: str = "http://localhost:8002"


settings = AIRuntimeSettings()
