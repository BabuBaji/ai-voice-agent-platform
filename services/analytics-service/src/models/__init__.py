from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class DateRangeParams(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class CallMetrics(BaseModel):
    total_calls: int = 0
    completed_calls: int = 0
    failed_calls: int = 0
    average_duration_seconds: float = 0.0
    total_duration_seconds: float = 0.0
    outcomes: dict[str, int] = Field(default_factory=dict)


class AgentMetrics(BaseModel):
    agent_id: str
    agent_name: str = ""
    total_calls: int = 0
    average_duration_seconds: float = 0.0
    success_rate: float = 0.0
    average_sentiment_score: float = 0.0


class AgentMetricsResponse(BaseModel):
    agents: list[AgentMetrics]
    total_agents: int = 0


class LeadMetrics(BaseModel):
    total_leads: int = 0
    converted_leads: int = 0
    conversion_rate: float = 0.0
    average_conversion_time_hours: float = 0.0
    leads_by_source: dict[str, int] = Field(default_factory=dict)


class DashboardData(BaseModel):
    calls: CallMetrics
    leads: LeadMetrics
    top_agents: list[AgentMetrics] = Field(default_factory=list)
    answer_rate: float = 0.0
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
