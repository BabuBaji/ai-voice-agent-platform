from common.config import Settings


class AnalyticsServiceSettings(Settings):
    service_name: str = "analytics-service"
    port: int = 8002
    database_url: str = "postgres://voiceagent:voiceagent_dev@localhost:5432/conversation_db"

    # Metrics retention
    metrics_retention_days: int = 90

    # RabbitMQ queues
    call_events_queue: str = "analytics.call_events"
    lead_events_queue: str = "analytics.lead_events"


settings = AnalyticsServiceSettings()
