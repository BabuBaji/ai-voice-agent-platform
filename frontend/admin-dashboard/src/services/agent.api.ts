import api from './api';
import type { Agent } from '@/types';

export const agentApi = {
  list: async (): Promise<Agent[]> => {
    const response = await api.get('/agents');
    return response.data.data ?? response.data;
  },

  get: async (id: string): Promise<Agent> => {
    const response = await api.get(`/agents/${id}`);
    return response.data.data ?? response.data;
  },

  create: async (data: Partial<Agent>): Promise<Agent> => {
    const response = await api.post('/agents', data);
    return response.data.data ?? response.data;
  },

  update: async (id: string, data: Partial<Agent>): Promise<Agent> => {
    const response = await api.put(`/agents/${id}`, data);
    return response.data.data ?? response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/agents/${id}`);
  },

  publish: async (id: string): Promise<Agent> => {
    const response = await api.post(`/agents/${id}/publish`);
    return response.data.data ?? response.data;
  },

  clone: async (id: string): Promise<Agent> => {
    const response = await api.post(`/agents/${id}/clone`);
    return response.data.data ?? response.data;
  },

  test: async (
    id: string,
    message: string,
    history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Promise<{ reply: string }> => {
    const response = await api.post(`/agents/${id}/test`, { message, history });
    return response.data;
  },
};
