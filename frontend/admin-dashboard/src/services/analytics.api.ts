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

export interface SentimentPoint {
  sentiment: string;
  count: number;
}

export interface HourlyPoint {
  hour: number;
  calls: number;
  avg_duration: number;
}

export interface DurationBucket {
  bucket: string;
  count: number;
}

export interface PerformanceData {
  total_calls: number;
  completed_calls: number;
  resolution_rate: number;
  sentiment_score: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  avg_duration: number;
  max_duration: number;
  min_duration: number;
  unique_agents: number;
  calls_per_day: number;
  active_days: number;
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
  sentiment: async (f: AnalyticsFilter = {}): Promise<SentimentPoint[]> => {
    const res = await api.get(`/analytics/metrics/sentiment?${qs(f)}`);
    return res.data;
  },
  hourlyDistribution: async (f: AnalyticsFilter = {}): Promise<HourlyPoint[]> => {
    const res = await api.get(`/analytics/metrics/hourly-distribution?${qs(f)}`);
    return res.data;
  },
  durationDistribution: async (f: AnalyticsFilter = {}): Promise<DurationBucket[]> => {
    const res = await api.get(`/analytics/metrics/duration-distribution?${qs(f)}`);
    return res.data;
  },
  performance: async (f: AnalyticsFilter = {}): Promise<PerformanceData> => {
    const res = await api.get(`/analytics/metrics/performance?${qs(f)}`);
    return res.data;
  },
};
