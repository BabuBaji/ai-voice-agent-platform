import api from './api';

export interface PhoneNumberRecord {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  phone_number: string;
  provider: string;
  provider_sid: string | null;
  capabilities: { voice: boolean; sms: boolean };
  is_active: boolean;
  created_at: string;
}

export const phoneNumberApi = {
  list: async (): Promise<PhoneNumberRecord[]> => {
    const response = await api.get('/phone-numbers');
    return response.data.data ?? response.data;
  },

  assign: async (id: string, agentId: string | null): Promise<PhoneNumberRecord> => {
    const response = await api.put(`/phone-numbers/${id}`, { agent_id: agentId });
    return response.data.data ?? response.data;
  },

  setActive: async (id: string, isActive: boolean): Promise<PhoneNumberRecord> => {
    const response = await api.put(`/phone-numbers/${id}`, { is_active: isActive });
    return response.data.data ?? response.data;
  },

  release: async (id: string): Promise<void> => {
    await api.delete(`/phone-numbers/${id}`);
  },

  /** Catalog of numbers available for purchase from a provider. */
  listAvailable: async (params: {
    provider?: 'plivo' | 'twilio' | 'exotel';
    country?: string;
    capabilities?: ('voice' | 'sms')[];
  } = {}): Promise<AvailableNumber[]> => {
    const qs = new URLSearchParams();
    qs.set('provider', params.provider || 'plivo');
    qs.set('country', params.country || 'US');
    if (params.capabilities?.length) qs.set('capabilities', params.capabilities.join(','));
    const r = await api.get(`/phone-numbers/available?${qs.toString()}`);
    return r.data?.data ?? [];
  },

  /** Buy a specific number from the provider's catalog. */
  buy: async (params: {
    provider?: 'plivo' | 'twilio' | 'exotel';
    number: string;
    capabilities?: ('voice' | 'sms')[];
  }): Promise<PhoneNumberRecord> => {
    const r = await api.post('/phone-numbers/buy', {
      provider: params.provider || 'plivo',
      number: params.number,
      capabilities: params.capabilities || ['voice'],
    });
    return r.data;
  },
};

export interface AvailableNumber {
  providerNumberId: string;
  number: string;
  capabilities: string[];
  monthlyRate?: number;
  region?: string;
  country?: string;
}
