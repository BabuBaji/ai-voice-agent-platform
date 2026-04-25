from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query, Header

from ..models import CallMetrics, AgentMetricsResponse, LeadMetrics
from ..aggregators.call_aggregator import CallAggregator
from ..aggregators.agent_aggregator import AgentAggregator
from ..aggregators.lead_aggregator import LeadAggregator

router = APIRouter()

call_agg = CallAggregator()
agent_agg = AgentAggregator()
lead_agg = LeadAggregator()


@router.get("/calls", response_model=CallMetrics)
async def get_call_metrics(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """Get call metrics with optional date range filter."""
    return await call_agg.compute(
        tenant_id=x_tenant_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/agents", response_model=AgentMetricsResponse)
async def get_agent_metrics(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """Get agent performance metrics."""
    return await agent_agg.compute(
        tenant_id=x_tenant_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/leads", response_model=LeadMetrics)
async def get_lead_metrics(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """Get lead conversion metrics."""
    return await lead_agg.compute(
        tenant_id=x_tenant_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/calls-timeseries")
async def get_calls_timeseries(
    days: int = Query(30, ge=1, le=365),
    agent_id: str = Query(""),
    channel: str = Query(""),
    x_tenant_id: Optional[str] = Header(None),
):
    """Day-by-day call volume + avg duration. Supports filtering by
    tenant (header), agent, and channel (e.g. `PHONE` vs `WEB`)."""
    from common import get_db_pool
    from ..config import settings
    pool = await get_db_pool(settings.database_url)

    params: list = [days]
    where = "WHERE created_at >= NOW() - ($1::int || ' days')::interval"
    p = 2
    if x_tenant_id:
        where += f" AND tenant_id = ${p}"; params.append(x_tenant_id); p += 1
    if agent_id:
        where += f" AND agent_id = ${p}"; params.append(agent_id); p += 1
    if channel:
        where += f" AND UPPER(channel) = ${p}"; params.append(channel.upper()); p += 1

    rows = await pool.fetch(
        f"""
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*)::int AS calls,
               COALESCE(AVG(NULLIF(duration_seconds, 0)), 0)::float AS avg_duration
        FROM conversations
        {where}
        GROUP BY day
        ORDER BY day ASC
        """,
        *params,
    )
    return [
        {"date": r["day"].isoformat(), "calls": r["calls"], "avg_duration": float(r["avg_duration"])}
        for r in rows
    ]


@router.get("/summary")
async def get_summary(
    days: int = Query(30, ge=1, le=365),
    agent_id: str = Query(""),
    channel: str = Query(""),
    x_tenant_id: Optional[str] = Header(None),
):
    """Compact KPI summary for the Analytics header cards. Supports tenant
    (header), agent, and channel filters."""
    from common import get_db_pool
    from ..config import settings
    pool = await get_db_pool(settings.database_url)

    params: list = [days]
    where = "WHERE created_at >= NOW() - ($1::int || ' days')::interval"
    p = 2
    if x_tenant_id:
        where += f" AND tenant_id = ${p}"; params.append(x_tenant_id); p += 1
    if agent_id:
        where += f" AND agent_id = ${p}"; params.append(agent_id); p += 1
    if channel:
        where += f" AND UPPER(channel) = ${p}"; params.append(channel.upper()); p += 1

    row = await pool.fetchrow(
        f"""
        SELECT COUNT(*)::int AS total_calls,
               COALESCE(AVG(NULLIF(duration_seconds, 0)), 0)::float AS avg_duration,
               COALESCE(SUM(duration_seconds), 0)::bigint AS total_duration_seconds,
               COUNT(*) FILTER (WHERE status IN ('COMPLETED','ENDED'))::int AS completed_calls,
               COUNT(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive_sentiment,
               COUNT(*) FILTER (WHERE sentiment IS NOT NULL)::int AS scored_sentiment
        FROM conversations
        {where}
        """,
        *params,
    )
    total = int(row["total_calls"]) if row else 0
    completed = int(row["completed_calls"]) if row else 0
    resolution_rate = round((completed / total) * 100, 1) if total > 0 else 0.0
    avg_duration = float(row["avg_duration"]) if row else 0.0
    total_duration_min = (int(row["total_duration_seconds"]) if row else 0) / 60.0

    # Rough cost estimate: $0.0135/min Plivo + LLM/STT proxy — use a default 0.12/min as shown cost/call
    cost_per_call = round((total_duration_min * 0.12) / total, 3) if total > 0 else 0.0

    return {
        "total_calls": total,
        "completed_calls": completed,
        "avg_duration_seconds": avg_duration,
        "total_duration_minutes": total_duration_min,
        "resolution_rate_pct": resolution_rate,
        "cost_per_call": cost_per_call,
        "days": days,
    }


@router.get("/outcomes")
async def get_outcomes(
    days: int = Query(30, ge=1, le=365),
    x_tenant_id: Optional[str] = Header(None),
):
    """Distribution of call outcomes for the pie chart."""
    from common import get_db_pool
    from ..config import settings
    pool = await get_db_pool(settings.database_url)

    params: list = [days]
    where = "WHERE created_at >= NOW() - ($1::int || ' days')::interval"
    if x_tenant_id:
        where += " AND tenant_id = $2"
        params.append(x_tenant_id)

    rows = await pool.fetch(
        f"""
        SELECT COALESCE(outcome, status, 'UNKNOWN') AS outcome,
               COUNT(*)::int AS count
        FROM conversations
        {where}
        GROUP BY COALESCE(outcome, status, 'UNKNOWN')
        ORDER BY count DESC
        """,
        *params,
    )
    return [{"outcome": r["outcome"], "count": r["count"]} for r in rows]
