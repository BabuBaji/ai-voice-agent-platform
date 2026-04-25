import api from './api';

export interface IntegrationField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
  credential?: boolean;
}

export interface Integration {
  provider: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  docs?: string;
  fields: IntegrationField[];
  connected: boolean;
  enabled: boolean;
  config: Record<string, string>;
  credentials_preview: Record<string, string>;
  test_status: 'ok' | 'error' | null;
  test_message: string | null;
  last_tested_at: string | null;
  connected_at: string | null;
  updated_at: string | null;
}

export const integrationApi = {
  list: async (): Promise<Integration[]> => {
    const res = await api.get('/integrations');
    return res.data.data ?? res.data;
  },

  get: async (provider: string): Promise<Integration> => {
    const res = await api.get(`/integrations/${provider}`);
    return res.data.data ?? res.data;
  },

  save: async (
    provider: string,
    data: { config: Record<string, string>; credentials: Record<string, string>; enabled?: boolean }
  ): Promise<{ provider: string; connected: boolean; message: string }> => {
    const res = await api.put(`/integrations/${provider}`, {
      config: data.config || {},
      credentials: data.credentials || {},
      enabled: data.enabled ?? true,
    });
    return res.data;
  },

  disconnect: async (provider: string): Promise<void> => {
    await api.delete(`/integrations/${provider}`);
  },

  test: async (provider: string): Promise<{ status: 'ok' | 'error'; message: string; tested_at: string }> => {
    const res = await api.post(`/integrations/${provider}/test`);
    return res.data;
  },
};
