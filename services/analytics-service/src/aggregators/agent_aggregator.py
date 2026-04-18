from datetime import datetime
from typing import Optional

from common import get_logger
from ..models import AgentMetrics, AgentMetricsResponse

logger = get_logger("agent-aggregator")


class AgentAggregator:
    """Computes agent performance statistics from the database."""

    async def compute(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> AgentMetricsResponse:
        """Compute agent performance metrics for the given date range.

        TODO: implement actual DB queries.
        """
        logger.info("computing_agent_metrics", start=start_date, end=end_date)

        # Stub response
        return AgentMetricsResponse(
            agents=[],
            total_agents=0,
        )
