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


@router.get("/sentiment")
async def get_sentiment(
    days: int = Query(30, ge=1, le=365),
    agent_id: str = Query(""),
    channel: str = Query(""),
    x_tenant_id: Optional[str] = Header(None),
):
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
        SELECT COALESCE(UPPER(sentiment), 'UNKNOWN') AS sentiment,
               COUNT(*)::int AS count
        FROM conversations
        {where}
        GROUP BY COALESCE(UPPER(sentiment), 'UNKNOWN')
        ORDER BY count DESC
        """,
        *params,
    )
    return [{"sentiment": r["sentiment"], "count": r["count"]} for r in rows]


@router.get("/hourly-distribution")
async def get_hourly_distribution(
    days: int = Query(30, ge=1, le=365),
    channel: str = Query(""),
    x_tenant_id: Optional[str] = Header(None),
):
    from common import get_db_pool
    from ..config import settings
    pool = await get_db_pool(settings.database_url)

    params: list = [days]
    where = "WHERE created_at >= NOW() - ($1::int || ' days')::interval"
    p = 2
    if x_tenant_id:
        where += f" AND tenant_id = ${p}"; params.append(x_tenant_id); p += 1
    if channel:
        where += f" AND UPPER(channel) = ${p}"; params.append(channel.upper()); p += 1

    rows = await pool.fetch(
        f"""
        SELECT EXTRACT(HOUR FROM created_at)::int AS hour,
               COUNT(*)::int AS calls,
               COALESCE(AVG(NULLIF(duration_seconds, 0)), 0)::float AS avg_duration
        FROM conversations
        {where}
        GROUP BY hour
        ORDER BY hour ASC
        """,
        *params,
    )
    result = [{"hour": h, "calls": 0, "avg_duration": 0.0} for h in range(24)]
    for r in rows:
        result[r["hour"]] = {"hour": r["hour"], "calls": r["calls"], "avg_duration": float(r["avg_duration"])}
    return result


@router.get("/duration-distribution")
async def get_duration_distribution(
    days: int = Query(30, ge=1, le=365),
    channel: str = Query(""),
    x_tenant_id: Optional[str] = Header(None),
):
    from common import get_db_pool
    from ..config import settings
    pool = await get_db_pool(settings.database_url)

    params: list = [days]
    where = "WHERE created_at >= NOW() - ($1::int || ' days')::interval AND duration_seconds IS NOT NULL AND duration_seconds > 0"
    p = 2
    if x_tenant_id:
        where += f" AND tenant_id = ${p}"; params.append(x_tenant_id); p += 1
    if channel:
        where += f" AND UPPER(channel) = ${p}"; params.append(channel.upper()); p += 1

    row = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*) FILTER (WHERE duration_seconds < 60)::int AS under_1m,
            COUNT(*) FILTER (WHERE duration_seconds >= 60 AND duration_seconds < 180)::int AS "1_3m",
            COUNT(*) FILTER (WHERE duration_seconds >= 180 AND duration_seconds < 300)::int AS "3_5m",
            COUNT(*) FILTER (WHERE duration_seconds >= 300 AND duration_seconds < 600)::int AS "5_10m",
            COUNT(*) FILTER (WHERE duration_seconds >= 600)::int AS over_10m
        FROM conversations
        {where}
        """,
        *params,
    )
    return [
        {"bucket": "<1 min", "count": row["under_1m"] if row else 0},
        {"bucket": "1-3 min", "count": row["1_3m"] if row else 0},
        {"bucket": "3-5 min", "count": row["3_5m"] if row else 0},
        {"bucket": "5-10 min", "count": row["5_10m"] if row else 0},
        {"bucket": "10+ min", "count": row["over_10m"] if row else 0},
    ]


@router.get("/performance")
async def get_performance(
    days: int = Query(30, ge=1, le=365),
    channel: str = Query(""),
    x_tenant_id: Optional[str] = Header(None),
):
    from common import get_db_pool
    from ..config import settings
    pool = await get_db_pool(settings.database_url)

    params: list = [days]
    where = "WHERE created_at >= NOW() - ($1::int || ' days')::interval"
    p = 2
    if x_tenant_id:
        where += f" AND tenant_id = ${p}"; params.append(x_tenant_id); p += 1
    if channel:
        where += f" AND UPPER(channel) = ${p}"; params.append(channel.upper()); p += 1

    row = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('COMPLETED','ENDED'))::int AS completed,
            COUNT(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive,
            COUNT(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative,
            COUNT(*) FILTER (WHERE sentiment = 'NEUTRAL')::int AS neutral,
            COUNT(*) FILTER (WHERE sentiment IS NOT NULL)::int AS scored,
            COALESCE(AVG(NULLIF(duration_seconds, 0)), 0)::float AS avg_duration,
            COALESCE(MAX(duration_seconds), 0)::int AS max_duration,
            COALESCE(MIN(NULLIF(duration_seconds, 0)), 0)::int AS min_duration,
            COUNT(DISTINCT agent_id)::int AS unique_agents,
            COUNT(DISTINCT date_trunc('day', created_at))::int AS active_days
        FROM conversations
        {where}
        """,
        *params,
    )
    total = row["total"] if row else 0
    completed = row["completed"] if row else 0
    positive = row["positive"] if row else 0
    scored = row["scored"] if row else 0
    active_days = row["active_days"] if row else 1

    return {
        "total_calls": total,
        "completed_calls": completed,
        "resolution_rate": round((completed / total) * 100, 1) if total > 0 else 0.0,
        "sentiment_score": round((positive / scored) * 100, 1) if scored > 0 else 0.0,
        "positive_count": positive,
        "negative_count": row["negative"] if row else 0,
        "neutral_count": row["neutral"] if row else 0,
        "avg_duration": float(row["avg_duration"]) if row else 0.0,
        "max_duration": row["max_duration"] if row else 0,
        "min_duration": row["min_duration"] if row else 0,
        "unique_agents": row["unique_agents"] if row else 0,
        "calls_per_day": round(total / max(active_days, 1), 1),
        "active_days": active_days,
    }
