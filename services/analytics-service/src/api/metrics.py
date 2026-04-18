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
