from datetime import datetime
from typing import Optional

import asyncpg
from common import get_logger, get_db_pool
from ..models import LeadMetrics

logger = get_logger("lead-aggregator")


class LeadAggregator:
    """Computes lead conversion statistics from the CRM database using real SQL queries."""

    async def _get_pool(self) -> asyncpg.Pool:
        from ..config import settings
        return await get_db_pool(settings.database_url)

    async def compute(
        self,
        tenant_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> LeadMetrics:
        """Compute lead metrics from the leads table."""
        logger.info("computing_lead_metrics", start=str(start_date), end=str(end_date))
        pool = await self._get_pool()

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

        # Main metrics query
        query = f"""
            SELECT
                COUNT(*) as total_leads,
                COUNT(*) FILTER (WHERE status IN ('CONVERTED', 'WON', 'CUSTOMER')) as converted_leads,
                CASE WHEN COUNT(*) > 0
                     THEN COUNT(*) FILTER (WHERE status IN ('CONVERTED', 'WON', 'CUSTOMER'))::float / COUNT(*)
                     ELSE 0
                END as conversion_rate
            FROM leads
            {where}
        """

        try:
            row = await pool.fetchrow(query, *params)
        except Exception as e:
            logger.warning("leads_query_failed", error=str(e))
            return LeadMetrics()

        if not row:
            return LeadMetrics()

        # Average conversion time (time between creation and status change to converted)
        avg_conversion_hours = 0.0
        try:
            conv_query = f"""
                SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_hours
                FROM leads
                {where}
                {"AND" if where_clauses else "WHERE"} status IN ('CONVERTED', 'WON', 'CUSTOMER')
                AND updated_at IS NOT NULL
            """
            conv_row = await pool.fetchrow(conv_query, *params)
            if conv_row and conv_row["avg_hours"]:
                avg_conversion_hours = float(conv_row["avg_hours"])
        except Exception as e:
            logger.debug("conversion_time_query_failed", error=str(e))

        # Leads by source
        leads_by_source: dict[str, int] = {}
        try:
            source_query = f"""
                SELECT COALESCE(source, 'UNKNOWN') as source, COUNT(*) as cnt
                FROM leads
                {where}
                GROUP BY COALESCE(source, 'UNKNOWN')
                ORDER BY cnt DESC
            """
            source_rows = await pool.fetch(source_query, *params)
            for r in source_rows:
                leads_by_source[r["source"]] = int(r["cnt"])
        except Exception as e:
            logger.debug("source_query_failed", error=str(e))

        return LeadMetrics(
            total_leads=int(row["total_leads"]),
            converted_leads=int(row["converted_leads"]),
            conversion_rate=round(float(row["conversion_rate"]), 4),
            average_conversion_time_hours=round(avg_conversion_hours, 2),
            leads_by_source=leads_by_source,
        )
