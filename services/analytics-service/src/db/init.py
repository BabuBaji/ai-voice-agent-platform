import asyncpg
from common import get_logger

logger = get_logger("analytics-db-init")

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS call_metrics_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    date DATE NOT NULL,
    total_calls INTEGER DEFAULT 0,
    answered_calls INTEGER DEFAULT 0,
    missed_calls INTEGER DEFAULT 0,
    avg_duration_seconds INTEGER DEFAULT 0,
    total_duration_seconds INTEGER DEFAULT 0,
    outcomes JSONB DEFAULT '{}',
    UNIQUE(tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_call_metrics_tenant_date
    ON call_metrics_daily(tenant_id, date);

CREATE TABLE IF NOT EXISTS agent_metrics_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    date DATE NOT NULL,
    total_calls INTEGER DEFAULT 0,
    avg_duration_seconds INTEGER DEFAULT 0,
    satisfaction_score DECIMAL(3,2) DEFAULT 0,
    outcomes JSONB DEFAULT '{}',
    UNIQUE(tenant_id, agent_id, date)
);

CREATE INDEX IF NOT EXISTS idx_agent_metrics_tenant_date
    ON agent_metrics_daily(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent
    ON agent_metrics_daily(agent_id, date);
"""


async def init_analytics_tables(pool: asyncpg.Pool) -> None:
    """Create analytics tables if they don't exist."""
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
    logger.info("analytics_tables_initialized")
