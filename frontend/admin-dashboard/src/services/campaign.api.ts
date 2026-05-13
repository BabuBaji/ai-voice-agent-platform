import api from './api';

export interface Campaign {
  id: string;
  tenant_id: string;
  agent_id: string;
  name: string;
  description: string | null;
  from_number: string;
  provider: 'plivo' | 'twilio' | 'exotel';
  concurrency: number;
  max_attempts: number;
  retry_delay_seconds: number;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'WAITING' | 'FAILED';
  schedule_start_at: string | null;
  timezone: string;
  call_window_start: string | null;
  call_window_end: string | null;
  campaign_instruction: string | null;
  deployed_agent_config_id: string | null;
  last_run_at: string | null;
  total_targets: number;
  completed_targets: number;
  failed_targets: number;
  target_count?: number;
  completed_count?: number;
  failed_count?: number;
  pending_count?: number;
  in_progress_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignAnalytics {
  rollup: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    answered: number;
    no_answer: number;
    busy: number;
    dial_failed: number;
    cancelled: number;
    dnc: number;
    total_attempts: number;
  };
  answer_rate: number;
  conversion_rate: number;
  avg_duration_seconds: number | null;
  total_dials: number;
  throughput: Array<{ hour_utc: string; dials: number; completed: number }>;
  sentiment: Array<{ label: string; count: number }>;
  interest_level: Array<{ label: string; count: number }>;
  lead_score: {
    b_0_20: number;
    b_20_40: number;
    b_40_60: number;
    b_60_80: number;
    b_80_100: number;
    avg: number | null;
  } | null;
}

export interface CampaignTarget {
  id: string;
  campaign_id: string;
  phone_number: string;
  name: string | null;
  variables: Record<string, string>;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_after: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  outcome: string | null;
  provider_call_sid: string | null;
  conversation_id: string | null;
  last_error: string | null;
  created_at: string;
}

export const campaignApi = {
  list: async (): Promise<Campaign[]> => {
    const res = await api.get('/campaigns');
    return res.data?.data ?? res.data ?? [];
  },

  create: async (data: Partial<Campaign> & { agent_id: string; from_number: string; name: string }): Promise<Campaign> => {
    const res = await api.post('/campaigns', data);
    return res.data;
  },

  get: async (id: string): Promise<Campaign> => {
    const res = await api.get(`/campaigns/${id}`);
    return res.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/campaigns/${id}`);
  },

  update: async (id: string, patch: Partial<Pick<Campaign, 'concurrency' | 'max_attempts' | 'retry_delay_seconds' | 'timezone' | 'call_window_start' | 'call_window_end' | 'campaign_instruction' | 'schedule_start_at'>>): Promise<Campaign> => {
    const res = await api.patch(`/campaigns/${id}`, patch);
    return res.data;
  },

  analytics: async (id: string): Promise<CampaignAnalytics> => {
    const res = await api.get(`/campaigns/${id}/analytics`);
    return res.data;
  },

  start: async (id: string): Promise<Campaign> => {
    const res = await api.post(`/campaigns/${id}/start`);
    return res.data;
  },

  pause: async (id: string): Promise<Campaign> => {
    const res = await api.post(`/campaigns/${id}/pause`);
    return res.data;
  },

  listTargets: async (id: string): Promise<CampaignTarget[]> => {
    const res = await api.get(`/campaigns/${id}/targets`);
    return res.data?.data ?? res.data ?? [];
  },

  addTarget: async (id: string, target: { phone_number: string; name?: string; variables?: Record<string, string> }): Promise<{ added: number; skipped: number }> => {
    const res = await api.post(`/campaigns/${id}/targets`, target);
    return res.data;
  },

  uploadCsv: async (id: string, csvText: string): Promise<{ added: number; skipped: number }> => {
    const res = await api.post(`/campaigns/${id}/targets`, csvText, {
      headers: { 'Content-Type': 'text/csv' },
      transformRequest: (d) => d,
    });
    return res.data;
  },

  // Bulk action over campaign targets. action:
  //   - 'exclude_others' + target_ids → call only these (rest go EXCLUDED)
  //   - 'include_all'                 → reset; re-enables every EXCLUDED row
  //   - 'exclude' / 'include'         → toggle specific ids
  bulkTargetAction: async (
    id: string,
    action: 'exclude' | 'include' | 'exclude_others' | 'include_all',
    target_ids?: string[],
  ): Promise<{ updated: number; action: string }> => {
    const res = await api.post(`/campaigns/${id}/targets/bulk-action`, { action, target_ids });
    return res.data;
  },
};
