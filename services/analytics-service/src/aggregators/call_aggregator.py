from datetime import datetime
from typing import Optional

from common import get_logger
from ..models import CallMetrics

logger = get_logger("call-aggregator")


class CallAggregator:
    """Computes call statistics from the database."""

    async def compute(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> CallMetrics:
        """Compute call metrics for the given date range.

        TODO: implement actual DB queries.
        """
        logger.info("computing_call_metrics", start=start_date, end=end_date)

        # Stub response
        return CallMetrics(
            total_calls=0,
            completed_calls=0,
            failed_calls=0,
            average_duration_seconds=0.0,
            total_duration_seconds=0.0,
            outcomes={},
        )
