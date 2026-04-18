import api from './api';
import type { Call } from '@/types';

export const callApi = {
  list: async (params?: { page?: number; limit?: number; search?: string }): Promise<{ data: Call[]; total: number }> => {
    const response = await api.get('/calls', { params });
    return response.data;
  },

  get: async (id: string): Promise<Call> => {
    const response = await api.get(`/calls/${id}`);
    return response.data;
  },

  initiate: async (data: { agentId: string; phoneNumber: string }): Promise<Call> => {
    const response = await api.post('/calls/initiate', data);
    return response.data;
  },

  getRecording: async (id: string): Promise<{ url: string }> => {
    const response = await api.get(`/calls/${id}/recording`);
    return response.data;
  },
};
