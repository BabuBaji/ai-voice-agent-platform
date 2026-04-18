import json
from datetime import datetime, date, timedelta
from typing import Optional

import asyncpg
from common import get_logger, get_db_pool
from ..models import CallMetrics

logger = get_logger("call-aggregator")


class CallAggregator:
    """Computes call statistics from the database using real SQL queries."""

    async def _get_pool(self) -> asyncpg.Pool:
        from ..config import settings
        return await get_db_pool(settings.database_url)

    async def compute(
        self,
        tenant_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> CallMetrics:
        """Compute call metrics from the call_metrics_daily table.

        Falls back to querying the conversations table directly if
        the daily aggregate table has no data.
        """
        logger.info("computing_call_metrics", start=str(start_date), end=str(end_date))
        pool = await self._get_pool()

        # Try aggregated table first
        metrics = await self._from_daily_table(pool, tenant_id, start_date, end_date)
        if metrics.total_calls > 0:
            return metrics

        # Fall back to raw conversations table
        return await self._from_conversations(pool, tenant_id, start_date, end_date)

    async def _from_daily_table(
        self,
        pool: asyncpg.Pool,
        tenant_id: Optional[str],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
    ) -> CallMetrics:
        """Query pre-aggregated call_metrics_daily table."""
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
                COALESCE(SUM(total_calls), 0) as total_calls,
                COALESCE(SUM(answered_calls), 0) as answered_calls,
                COALESCE(SUM(missed_calls), 0) as missed_calls,
                COALESCE(SUM(total_duration_seconds), 0) as total_duration,
                CASE WHEN SUM(total_calls) > 0
                     THEN SUM(total_duration_seconds)::float / SUM(total_calls)
                     ELSE 0
                END as avg_duration
            FROM call_metrics_daily
            {where}
        """

        try:
            row = await pool.fetchrow(query, *params)
        except Exception as e:
            logger.warning("call_metrics_daily_query_failed", error=str(e))
            return CallMetrics()

        if not row or row["total_calls"] == 0:
            return CallMetrics()

        # Aggregate outcomes from JSONB
        outcomes_query = f"""
            SELECT outcomes FROM call_metrics_daily {where}
        """
        try:
            rows = await pool.fetch(outcomes_query, *params)
            merged_outcomes: dict[str, int] = {}
            for r in rows:
                if r["outcomes"]:
                    data = r["outcomes"] if isinstance(r["outcomes"], dict) else json.loads(r["outcomes"])
                    for k, v in data.items():
                        merged_outcomes[k] = merged_outcomes.get(k, 0) + int(v)
        except Exception:
            merged_outcomes = {}

        return CallMetrics(
            total_calls=int(row["total_calls"]),
            completed_calls=int(row["answered_calls"]),
            failed_calls=int(row["missed_calls"]),
            average_duration_seconds=float(row["avg_duration"]),
            total_duration_seconds=float(row["total_duration"]),
            outcomes=merged_outcomes,
        )

    async def _from_conversations(
        self,
        pool: asyncpg.Pool,
        tenant_id: Optional[str],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
    ) -> CallMetrics:
        """Fall back to querying raw conversations table for metrics."""
        where_clauses = []
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

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        query = f"""
            SELECT
                COUNT(*) as total_calls,
                COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
                COUNT(*) FILTER (WHERE status IN ('FAILED', 'MISSED', 'NO_ANSWER')) as failed,
                COALESCE(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0), 0) as avg_duration,
                COALESCE(SUM(duration_seconds), 0) as total_duration
            FROM conversations
            {where}
        """

        try:
            row = await pool.fetchrow(query, *params)
        except Exception as e:
            logger.warning("conversations_query_failed", error=str(e))
            return CallMetrics()

        if not row:
            return CallMetrics()

        # Get outcome breakdown
        outcomes: dict[str, int] = {}
        try:
            outcome_query = f"""
                SELECT
                    COALESCE(outcome, status, 'UNKNOWN') as outcome,
                    COUNT(*) as cnt
                FROM conversations
                {where}
                GROUP BY COALESCE(outcome, status, 'UNKNOWN')
            """
            outcome_rows = await pool.fetch(outcome_query, *params)
            for r in outcome_rows:
                outcomes[r["outcome"]] = int(r["cnt"])
        except Exception:
            pass

        return CallMetrics(
            total_calls=int(row["total_calls"]),
            completed_calls=int(row["completed"]),
            failed_calls=int(row["failed"]),
            average_duration_seconds=float(row["avg_duration"]),
            total_duration_seconds=float(row["total_duration"]),
            outcomes=outcomes,
        )
