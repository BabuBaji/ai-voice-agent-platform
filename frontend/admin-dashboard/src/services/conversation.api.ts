import api from './api';

export interface ConversationAnalysis {
  summary: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  interest_level: number;
  topics: string[];
  follow_ups: string[];
  key_points: string[];
  outcome: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  agent_id: string;
  channel: string;
  status: string;
  language?: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  recording_url?: string;
  summary?: string;
  sentiment?: string;
  outcome?: string;
  interest_level?: number;
  topics?: string[];
  follow_ups?: string[];
  key_points?: string[];
  analysis?: ConversationAnalysis;
  metadata?: Record<string, unknown>;
  message_count?: number;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface WhisperTranscript {
  text: string;
  language: string | null;
  duration: number | null;
  segments: WhisperSegment[];
  transcribed_at: string;
}

export interface TranslatedTranscript {
  target_language: string;
  target_name: string;
  translated_at: string;
  provider: string;
  cached?: boolean;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  audio_url?: string | null;
  latency_ms?: number;
  tokens_used?: number;
  created_at: string;
}

export const conversationApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    agent_id?: string;
    channel?: string;
    status?: string;
  }): Promise<{ data: Conversation[]; total: number; page: number; pageSize: number }> => {
    const res = await api.get('/conversations', { params });
    return res.data;
  },

  create: async (data: {
    agent_id: string;
    channel?: string;
    language?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation> => {
    const res = await api.post('/conversations', data);
    return res.data.data ?? res.data;
  },

  get: async (id: string): Promise<Conversation> => {
    const res = await api.get(`/conversations/${id}`);
    return res.data.data ?? res.data;
  },

  update: async (id: string, data: Partial<Conversation>): Promise<Conversation> => {
    const res = await api.put(`/conversations/${id}`, data);
    return res.data.data ?? res.data;
  },

  end: async (id: string, durationSeconds: number, metadata?: Record<string, unknown>) => {
    const res = await api.put(`/conversations/${id}`, {
      status: 'ENDED',
      ended_at: new Date().toISOString(),
      duration_seconds: Math.max(0, Math.floor(durationSeconds)),
      metadata,
    });
    return res.data.data ?? res.data;
  },

  appendMessage: async (
    conversationId: string,
    data: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      audio_url?: string;
      latency_ms?: number;
    }
  ): Promise<ConversationMessage> => {
    const res = await api.post(`/conversations/${conversationId}/messages`, data);
    return res.data.data ?? res.data;
  },

  getMessages: async (conversationId: string): Promise<ConversationMessage[]> => {
    const res = await api.get(`/conversations/${conversationId}/messages`);
    return res.data.data ?? res.data;
  },

  uploadRecording: async (conversationId: string, blob: Blob): Promise<{ recording_url: string }> => {
    const res = await api.post(`/conversations/${conversationId}/recording`, blob, {
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      transformRequest: (d) => d,
    });
    return res.data;
  },

  analyze: async (conversationId: string): Promise<ConversationAnalysis> => {
    const res = await api.post(`/conversations/${conversationId}/analyze`);
    return res.data.data ?? res.data;
  },

  transcribe: async (conversationId: string): Promise<WhisperTranscript> => {
    const res = await api.post(`/conversations/${conversationId}/transcribe`);
    return res.data;
  },

  translate: async (
    conversationId: string,
    targetLanguage: string,
    force = false,
  ): Promise<TranslatedTranscript> => {
    const res = await api.post(`/conversations/${conversationId}/translate`, {
      target_language: targetLanguage,
      force,
    });
    return res.data;
  },

  recordingUrl: (conversationId: string, accessToken: string | null): string => {
    const base = (import.meta.env.VITE_API_URL || '/api/v1') as string;
    const url = `${base}/conversations/${conversationId}/recording`;
    return accessToken ? `${url}?token=${encodeURIComponent(accessToken)}` : url;
  },
};
