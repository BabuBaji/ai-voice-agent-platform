import api from './api';

export interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  last_used_at: string | null;
  created_at: string;
}

export interface CreatedApiKey extends ApiKey {
  key: string; // plaintext — returned once at create time
}

export const apiKeyApi = {
  list: async (): Promise<ApiKey[]> => {
    const res = await api.get('/api-keys');
    return res.data.data ?? res.data;
  },

  create: async (name: string): Promise<CreatedApiKey> => {
    const res = await api.post('/api-keys', { name });
    return res.data.data ?? res.data;
  },

  revoke: async (id: string): Promise<void> => {
    await api.delete(`/api-keys/${id}`);
  },
};
