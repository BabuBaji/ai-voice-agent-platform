from pathlib import Path

from pydantic_settings import BaseSettings

# Walk up from this file to find the monorepo root .env (packages/python-common/src/common/config.py → .env is 4 levels up).
# Falls back to a local .env next to the service if the root one isn't found.
def _find_env_file() -> str:
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        candidate = parent / ".env"
        if candidate.exists():
            return str(candidate)
    return ".env"


_ENV_FILE = _find_env_file()


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
        env_file = _ENV_FILE
        extra = "ignore"
