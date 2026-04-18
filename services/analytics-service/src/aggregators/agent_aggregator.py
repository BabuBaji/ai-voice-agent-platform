from datetime import datetime
from typing import Optional

import asyncpg
from common import get_logger, get_db_pool
from ..models import AgentMetrics, AgentMetricsResponse

logger = get_logger("agent-aggregator")


class AgentAggregator:
    """Computes agent performance statistics from the database using real SQL queries."""

    async def _get_pool(self) -> asyncpg.Pool:
        from ..config import settings
        return await get_db_pool(settings.database_url)

    async def compute(
        self,
        tenant_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> AgentMetricsResponse:
        """Compute agent performance metrics.

        Tries agent_metrics_daily first, falls back to conversations table.
        """
        logger.info("computing_agent_metrics", start=str(start_date), end=str(end_date))
        pool = await self._get_pool()

        # Try pre-aggregated table first
        response = await self._from_daily_table(pool, tenant_id, start_date, end_date)
        if response.total_agents > 0:
            return response

        # Fall back to conversations
        return await self._from_conversations(pool, tenant_id, start_date, end_date)

    async def _from_daily_table(
        self,
        pool: asyncpg.Pool,
        tenant_id: Optional[str],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
    ) -> AgentMetricsResponse:
        where_clauses = []
        params = []
        idx = 1

        if tenant_id:
            where_clauses.append(f"tenant_id = ${idx}")
            params.append(tenant_id)
            idx += 1
        if start_date:
            where_clauses.append(f"date >= ${idx}")
            params.append(start_date.date() if isinstance(start_date, datetime) else start_date)
            idx += 1
        if end_date:
            where_clauses.append(f"date <= ${idx}")
            params.append(end_date.date() if isinstance(end_date, datetime) else end_date)
            idx += 1

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        query = f"""
            SELECT
                agent_id,
                SUM(total_calls) as total_calls,
                CASE WHEN SUM(total_calls) > 0
                     THEN SUM(avg_duration_seconds * total_calls)::float / SUM(total_calls)
                     ELSE 0
                END as avg_duration,
                AVG(satisfaction_score) as avg_satisfaction
            FROM agent_metrics_daily
            {where}
            GROUP BY agent_id
            ORDER BY SUM(total_calls) DESC
        """

        try:
            rows = await pool.fetch(query, *params)
        except Exception as e:
            logger.warning("agent_metrics_daily_query_failed", error=str(e))
            return AgentMetricsResponse(agents=[], total_agents=0)

        agents = []
        for row in rows:
            agents.append(AgentMetrics(
                agent_id=str(row["agent_id"]),
                agent_name="",
                total_calls=int(row["total_calls"]),
                average_duration_seconds=float(row["avg_duration"]),
                success_rate=0.0,
                average_sentiment_score=float(row["avg_satisfaction"] or 0),
            ))

        return AgentMetricsResponse(agents=agents, total_agents=len(agents))

    async def _from_conversations(
        self,
        pool: asyncpg.Pool,
        tenant_id: Optional[str],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
    ) -> AgentMetricsResponse:
        """Fall back to conversations table for per-agent metrics."""
        where_clauses = ["agent_id IS NOT NULL"]
        params = []
        idx = 1

        if tenant_id:
            where_clauses.append(f"tenant_id = ${idx}")
            params.append(tenant_id)
            idx += 1
        if start_date:
            where_clauses.append(f"created_at >= ${idx}")
            params.append(start_date)
            idx += 1
        if end_date:
            where_clauses.append(f"created_at <= ${idx}")
            params.append(end_date)
            idx += 1

        where = f"WHERE {' AND '.join(where_clauses)}"

        query = f"""
            SELECT
                agent_id,
                COUNT(*) as total_calls,
                COALESCE(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0), 0) as avg_duration,
                CASE WHEN COUNT(*) > 0
                     THEN COUNT(*) FILTER (WHERE status = 'COMPLETED')::float / COUNT(*)
                     ELSE 0
                END as success_rate,
                COALESCE(AVG(sentiment_score) FILTER (WHERE sentiment_score IS NOT NULL), 0) as avg_sentiment
            FROM conversations
            {where}
            GROUP BY agent_id
            ORDER BY COUNT(*) DESC
        """

        try:
            rows = await pool.fetch(query, *params)
        except Exception as e:
            logger.warning("conversations_agent_query_failed", error=str(e))
            return AgentMetricsResponse(agents=[], total_agents=0)

        agents = []
        for row in rows:
            agents.append(AgentMetrics(
                agent_id=str(row["agent_id"]),
                agent_name="",
                total_calls=int(row["total_calls"]),
                average_duration_seconds=float(row["avg_duration"]),
                success_rate=round(float(row["success_rate"]), 4),
                average_sentiment_score=round(float(row["avg_sentiment"]), 2),
            ))

        return AgentMetricsResponse(agents=agents, total_agents=len(agents))
