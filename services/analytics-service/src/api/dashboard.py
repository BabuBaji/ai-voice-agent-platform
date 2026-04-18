from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query

from ..models import DashboardData
from ..aggregators.call_aggregator import CallAggregator
from ..aggregators.agent_aggregator import AgentAggregator
from ..aggregators.lead_aggregator import LeadAggregator

router = APIRouter()

call_agg = CallAggregator()
agent_agg = AgentAggregator()
lead_agg = LeadAggregator()


@router.get("/dashboard", response_model=DashboardData)
async def get_dashboard(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
):
    """Get aggregated dashboard data."""
    calls = await call_agg.compute(start_date=start_date, end_date=end_date)
    leads = await lead_agg.compute(start_date=start_date, end_date=end_date)
    agents_response = await agent_agg.compute(start_date=start_date, end_date=end_date)

    # Top 5 agents by success rate
    top_agents = sorted(agents_response.agents, key=lambda a: a.success_rate, reverse=True)[:5]

    return DashboardData(
        calls=calls,
        leads=leads,
        top_agents=top_agents,
        period_start=start_date,
        period_end=end_date,
    )
