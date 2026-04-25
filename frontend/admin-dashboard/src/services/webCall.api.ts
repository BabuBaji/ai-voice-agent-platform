import api from './api';

export type WebCallStartRequest = {
  agent_id: string;
  primary_language?: string;
  auto_detect_language?: boolean;
  mixed_language_allowed?: boolean;
  voice_provider?: 'azure' | 'openai' | 'sarvam';
  voice_name?: string;
  voice_gender?: 'female' | 'male';
  voice_accent?: string;
  voice_speed?: number;
  voice_tone?: string;
  recording_enabled?: boolean;
  transcript_enabled?: boolean;
  metadata?: Record<string, unknown>;
};

export type WebCallSession = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  agent_id: string;
  conversation_id: string | null;
  status: 'PENDING' | 'ACTIVE' | 'ENDED' | 'FAILED';
  primary_language: string;
  auto_detect_language: boolean;
  mixed_language_allowed: boolean;
  voice_provider: string | null;
  voice_name: string | null;
  voice_gender: string | null;
  voice_accent: string | null;
  voice_speed: number;
  voice_tone: string | null;
  recording_enabled: boolean;
  transcript_enabled: boolean;
  recording_url: string | null;
  transcript_status: string;
  analysis_status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WebCallTranscriptItem = {
  speaker: 'user' | 'agent';
  time: string;
  text: string;
  language: string | null;
  confidence: number | null;
};

export type WebCallAnalysis = {
  summary: string;
  detailed_summary: string;
  customerIntent: string;
  sentiment: string;
  interestLevel: string;
  leadScore: string;
  objections: string[];
  extractedFields: Record<string, unknown>;
  nextBestAction: string;
  followUpRequired: boolean;
  recommendedCallbackTime: string;
  agentPerformanceScore: string;
};

export const webCallApi = {
  async start(payload: WebCallStartRequest): Promise<WebCallSession> {
    const r = await api.post('/web-calls/start', payload);
    return r.data;
  },
  async end(id: string, body?: { end_reason?: string; duration_seconds?: number }): Promise<WebCallSession> {
    const r = await api.post(`/web-calls/${id}/end`, body || {});
    return r.data;
  },
  async get(id: string): Promise<WebCallSession> {
    const r = await api.get(`/web-calls/${id}`);
    return r.data;
  },
  async getTranscript(id: string): Promise<WebCallTranscriptItem[]> {
    const r = await api.get(`/web-calls/${id}/transcript`);
    return r.data;
  },
  async getAnalysis(id: string): Promise<WebCallAnalysis | { status: string; message: string }> {
    const r = await api.get(`/web-calls/${id}/analysis`, { validateStatus: (s) => s < 500 });
    return r.data;
  },
  async runAnalysis(id: string): Promise<WebCallAnalysis> {
    const r = await api.post(`/web-calls/${id}/analyze`);
    return r.data;
  },
  recordingUrl(id: string, kind: 'mixed' | 'user' | 'agent' = 'mixed'): string {
    // Public-ish: no Authorization header needed, served straight by conversation-service via gateway.
    const base = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
    return `${base}/web-calls/${id}/recording?kind=${kind}`;
  },
};
