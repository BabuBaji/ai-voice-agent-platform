import json
from datetime import date, datetime, timezone
from typing import Any

import asyncpg
from common import EventBus, get_logger
from .config import settings

logger = get_logger("analytics-consumer")

_pool: asyncpg.Pool | None = None


async def handle_call_event(data: Any):
    """Handle incoming call.ended events and update daily metrics tables."""
    global _pool
    if not _pool:
        logger.warning("no_db_pool_for_consumer")
        return

    event_data = data.get("data", data)
    tenant_id = event_data.get("tenantId") or event_data.get("tenant_id")
    if not tenant_id:
        logger.warning("call_event_missing_tenant_id")
        return

    logger.info("call_event_received", tenant_id=tenant_id, event=data.get("event"))

    today = date.today()
    duration = int(event_data.get("duration_seconds", 0) or event_data.get("durationSeconds", 0) or 0)
    status = event_data.get("status", "COMPLETED")
    outcome = event_data.get("outcome", status)
    agent_id = event_data.get("agent_id") or event_data.get("agentId")

    answered = 1 if status in ("COMPLETED", "ANSWERED") else 0
    missed = 1 if status in ("MISSED", "NO_ANSWER", "FAILED") else 0

    try:
        # Upsert into call_metrics_daily
        await _pool.execute(
            """
            INSERT INTO call_metrics_daily (tenant_id, date, total_calls, answered_calls, missed_calls,
                                            avg_duration_seconds, total_duration_seconds, outcomes)
            VALUES ($1, $2, 1, $3, $4, $5, $5, $6)
            ON CONFLICT (tenant_id, date) DO UPDATE SET
                total_calls = call_metrics_daily.total_calls + 1,
                answered_calls = call_metrics_daily.answered_calls + $3,
                missed_calls = call_metrics_daily.missed_calls + $4,
                total_duration_seconds = call_metrics_daily.total_duration_seconds + $5,
                avg_duration_seconds = (call_metrics_daily.total_duration_seconds + $5)
                    / (call_metrics_daily.total_calls + 1),
                outcomes = call_metrics_daily.outcomes || $6
            """,
            tenant_id,
            today,
            answered,
            missed,
            duration,
            json.dumps({outcome: 1}),
        )
        logger.info("call_metrics_daily_updated", tenant_id=tenant_id, date=str(today))
    except Exception as e:
        logger.error("call_metrics_daily_update_failed", error=str(e))

    # Update agent metrics if agent_id is present
    if agent_id:
        try:
            satisfaction = float(event_data.get("satisfaction_score", 0) or event_data.get("sentimentScore", 0) or 0)
            await _pool.execute(
                """
                INSERT INTO agent_metrics_daily (tenant_id, agent_id, date, total_calls,
                                                  avg_duration_seconds, satisfaction_score, outcomes)
                VALUES ($1, $2, $3, 1, $4, $5, $6)
                ON CONFLICT (tenant_id, agent_id, date) DO UPDATE SET
                    total_calls = agent_metrics_daily.total_calls + 1,
                    avg_duration_seconds = (agent_metrics_daily.avg_duration_seconds * agent_metrics_daily.total_calls + $4)
                        / (agent_metrics_daily.total_calls + 1),
                    satisfaction_score = CASE
                        WHEN $5 > 0 THEN (agent_metrics_daily.satisfaction_score + $5) / 2
                        ELSE agent_metrics_daily.satisfaction_score
                    END,
                    outcomes = agent_metrics_daily.outcomes || $6
                """,
                tenant_id,
                agent_id,
                today,
                duration,
                satisfaction,
                json.dumps({outcome: 1}),
            )
            logger.info("agent_metrics_daily_updated", agent_id=agent_id)
        except Exception as e:
            logger.error("agent_metrics_daily_update_failed", error=str(e))


async def handle_lead_event(data: Any):
    """Handle incoming lead events for conversion tracking.

    Lead metrics are queried directly from the leads table, so no
    separate aggregation table is needed. This handler logs the event
    for observability.
    """
    event_data = data.get("data", data)
    tenant_id = event_data.get("tenantId") or event_data.get("tenant_id")
    logger.info(
        "lead_event_received",
        tenant_id=tenant_id,
        event=data.get("event"),
        lead_id=event_data.get("leadId") or event_data.get("lead_id"),
    )


async def start_consumers(event_bus: EventBus, pool: asyncpg.Pool):
    """Start RabbitMQ consumers for real-time analytics events."""
    global _pool
    _pool = pool

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
