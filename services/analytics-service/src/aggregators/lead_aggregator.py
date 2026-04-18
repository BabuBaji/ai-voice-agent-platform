from datetime import datetime
from typing import Optional

from common import get_logger
from ..models import LeadMetrics

logger = get_logger("lead-aggregator")


class LeadAggregator:
    """Computes lead conversion statistics from the database."""

    async def compute(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> LeadMetrics:
        """Compute lead metrics for the given date range.

        TODO: implement actual DB queries.
        """
        logger.info("computing_lead_metrics", start=start_date, end=end_date)

        # Stub response
        return LeadMetrics(
            total_leads=0,
            converted_leads=0,
            conversion_rate=0.0,
            average_conversion_time_hours=0.0,
            leads_by_source={},
        )
