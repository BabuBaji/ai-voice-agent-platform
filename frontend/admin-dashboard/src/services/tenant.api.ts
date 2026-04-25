import api from './api';

export interface TenantSettings {
  data_retention_days?: number;
  pii_obfuscation?: boolean;
  [key: string]: unknown;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: TenantSettings;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const tenantApi = {
  getMe: async (): Promise<Tenant> => {
    const res = await api.get('/tenants/me');
    return res.data;
  },

  updateMe: async (patch: { name?: string; settings?: TenantSettings }): Promise<Tenant> => {
    const res = await api.put('/tenants/me', patch);
    return res.data;
  },
};
