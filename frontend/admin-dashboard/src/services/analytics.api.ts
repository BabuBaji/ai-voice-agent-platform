import api from './api';

export interface AnalyticsSummary {
  total_calls: number;
  completed_calls: number;
  avg_duration_seconds: number;
  total_duration_minutes: number;
  resolution_rate_pct: number;
  cost_per_call: number;
  days: number;
}

export interface TimeseriesPoint {
  date: string;
  calls: number;
  avg_duration: number;
}

export interface OutcomePoint {
  outcome: string;
  count: number;
}

export interface AgentRow {
  agent_id: string;
  agent_name: string;
  total_calls: number;
  success_rate: number;
  average_duration_seconds: number;
}

export interface AnalyticsFilter {
  days?: number;
  agent_id?: string;
  channel?: 'PHONE' | 'WEB' | '';
}

function qs(f: AnalyticsFilter): string {
  const q = new URLSearchParams();
  q.set('days', String(f.days ?? 30));
  if (f.agent_id) q.set('agent_id', f.agent_id);
  if (f.channel) q.set('channel', f.channel);
  return q.toString();
}

export const analyticsApi = {
  summary: async (f: AnalyticsFilter = {}): Promise<AnalyticsSummary> => {
    const res = await api.get(`/analytics/metrics/summary?${qs(f)}`);
    return res.data;
  },
  timeseries: async (f: AnalyticsFilter = {}): Promise<TimeseriesPoint[]> => {
    const res = await api.get(`/analytics/metrics/calls-timeseries?${qs(f)}`);
    return res.data;
  },
  outcomes: async (f: AnalyticsFilter = {}): Promise<OutcomePoint[]> => {
    const res = await api.get(`/analytics/metrics/outcomes?${qs(f)}`);
    return res.data;
  },
  agents: async (): Promise<AgentRow[]> => {
    const res = await api.get('/analytics/metrics/agents');
    return (res.data?.agents ?? []) as AgentRow[];
  },
};
