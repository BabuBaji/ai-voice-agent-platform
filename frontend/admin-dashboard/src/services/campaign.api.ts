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
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
  schedule_start_at: string | null;
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
};
