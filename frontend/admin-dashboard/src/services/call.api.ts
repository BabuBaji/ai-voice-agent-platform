import api from './api';
import type { Call } from '@/types';

export interface CallListParams {
  page?: number;
  limit?: number;
  search?: string;
  outcome?: string;
}

export const callApi = {
  list: async (params?: CallListParams): Promise<{ data: Call[]; total: number }> => {
    const response = await api.get('/calls', { params });
    // Normalize: support both { data, total } and plain array responses
    if (Array.isArray(response.data)) {
      return { data: response.data, total: response.data.length };
    }
    return response.data;
  },

  get: async (id: string): Promise<Call> => {
    const response = await api.get(`/calls/${id}`);
    return response.data.data ?? response.data;
  },

  getConversation: async (id: string) => {
    const response = await api.get(`/conversations/${id}`);
    return response.data.data ?? response.data;
  },

  getMessages: async (conversationId: string) => {
    const response = await api.get(`/conversations/${conversationId}/messages`);
    return response.data.data ?? response.data;
  },

  initiate: async (data: {
    agentId: string;
    phoneNumber: string;
    from?: string;
    provider?: 'twilio' | 'exotel' | 'plivo';
  }): Promise<Call> => {
    const payload = {
      agent_id: data.agentId,
      to: data.phoneNumber,
      from: data.from, // optional — backend falls back to the agent's configured phone number
      provider: data.provider || 'plivo',
    };
    const response = await api.post('/calls/initiate', payload);
    return response.data.data ?? response.data;
  },

  getRecording: async (id: string): Promise<{ url: string }> => {
    const response = await api.get(`/calls/${id}/recording`);
    return response.data;
  },
};
