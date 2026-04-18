from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query, Header

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
    x_tenant_id: Optional[str] = Header(None),
):
    """Get combined dashboard metrics for the overview page."""
    calls = await call_agg.compute(
        tenant_id=x_tenant_id, start_date=start_date, end_date=end_date
    )
    leads = await lead_agg.compute(
        tenant_id=x_tenant_id, start_date=start_date, end_date=end_date
    )
    agents_response = await agent_agg.compute(
        tenant_id=x_tenant_id, start_date=start_date, end_date=end_date
    )

    # Top 5 agents by success rate
    top_agents = sorted(
        agents_response.agents, key=lambda a: a.success_rate, reverse=True
    )[:5]

    # Compute answer rate
    answer_rate = 0.0
    if calls.total_calls > 0:
        answer_rate = round(calls.completed_calls / calls.total_calls, 4)

    return DashboardData(
        calls=calls,
        leads=leads,
        top_agents=top_agents,
        answer_rate=answer_rate,
        period_start=start_date,
        period_end=end_date,
    )
