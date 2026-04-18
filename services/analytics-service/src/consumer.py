from typing import Any

from common import EventBus, get_logger
from .config import settings

logger = get_logger("analytics-consumer")


async def handle_call_event(data: Any):
    """Handle incoming call events for real-time metric updates."""
    logger.info("call_event_received", event=data.get("event"), data=data.get("data"))
    # TODO: update in-memory metrics cache or write to DB


async def handle_lead_event(data: Any):
    """Handle incoming lead events for conversion tracking."""
    logger.info("lead_event_received", event=data.get("event"), data=data.get("data"))
    # TODO: update lead metrics


async def start_consumers(event_bus: EventBus):
    """Start RabbitMQ consumers for real-time analytics events."""
    await event_bus.on(
        queue_name=settings.call_events_queue,
        routing_key="call.*",
        handler=handle_call_event,
    )
    await event_bus.on(
        queue_name=settings.lead_events_queue,
        routing_key="lead.*",
        handler=handle_lead_event,
    )
    logger.info("consumers_started")
