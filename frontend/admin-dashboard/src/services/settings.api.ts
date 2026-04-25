import api from './api';

// All non-personal settings live inside tenants.settings JSONB. This wrapper
// reads/merges a single key so each Settings tab can save independently
// without stomping on the other tabs' data.

export interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  phone: string | null;
  timezone: string;
  preferred_language: string;
  status: string;
  email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  roles: string[];
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
  phone?: string | null;
  timezone?: string;
  preferredLanguage?: string;
}

export const profileApi = {
  getMe: async (): Promise<UserProfile> => {
    const res = await api.get('/users/me');
    return res.data;
  },
  updateMe: async (patch: UpdateProfileInput): Promise<UserProfile> => {
    const res = await api.put('/users/me', patch);
    return res.data;
  },
};

// Generic JSONB-backed settings — these live in tenants.settings.<key>.
export const settingsBag = {
  // Returns the value stored at tenants.settings[key] or undefined.
  get: async <T>(key: string): Promise<T | undefined> => {
    const res = await api.get('/tenants/me');
    return (res.data?.settings ?? {})[key] as T | undefined;
  },
  // Merges the provided value into tenants.settings[key] (replaces the whole key).
  set: async <T>(key: string, value: T): Promise<void> => {
    const cur = await api.get('/tenants/me');
    const settings = { ...(cur.data?.settings ?? {}), [key]: value };
    await api.put('/tenants/me', { settings });
  },
  // Update multiple keys at once.
  setMany: async (patch: Record<string, unknown>): Promise<void> => {
    const cur = await api.get('/tenants/me');
    const settings = { ...(cur.data?.settings ?? {}), ...patch };
    await api.put('/tenants/me', { settings });
  },
};
