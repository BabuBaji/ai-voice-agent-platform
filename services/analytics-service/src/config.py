from common.config import Settings


class AnalyticsServiceSettings(Settings):
    service_name: str = "analytics-service"
    port: int = 8002

    # Metrics retention
    metrics_retention_days: int = 90

    # RabbitMQ queues
    call_events_queue: str = "analytics.call_events"
    lead_events_queue: str = "analytics.lead_events"


settings = AnalyticsServiceSettings()
