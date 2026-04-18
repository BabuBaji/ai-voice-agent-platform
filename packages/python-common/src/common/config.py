from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    service_name: str = "voice-agent"
    port: int = 8000
    log_level: str = "INFO"
    database_url: str = "postgres://voiceagent:voiceagent_dev@localhost:5432/voiceagent"
    redis_url: str = "redis://localhost:6379"
    rabbitmq_url: str = "amqp://voiceagent:voiceagent_dev@localhost:5672"
    jwt_secret: str = "change-me-in-production"

    # AI Providers
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_ai_api_key: str = ""

    # Voice Providers
    deepgram_api_key: str = ""
    elevenlabs_api_key: str = ""

    # S3
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "voiceagent"
    s3_secret_key: str = "voiceagent_dev"
    s3_bucket: str = "knowledge-docs"

    class Config:
        env_file = ".env"
        extra = "ignore"
