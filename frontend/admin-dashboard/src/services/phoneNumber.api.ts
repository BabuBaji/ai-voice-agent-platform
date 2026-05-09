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
  deployment_status?: 'draft' | 'testing' | 'deployed' | 'paused';
  last_verified_at?: string | null;
  deployed_at?: string | null;
  deployed_config_id?: string | null;
}

export interface VerificationTestResult {
  test: string;
  status: 'pass' | 'fail' | 'skip';
  log?: any;
  error?: string;
}

export interface VerificationRunSummary {
  run_id: string;
  aggregate: 'verified' | 'partial' | 'failed';
  results: VerificationTestResult[];
  summary: { total: number; passed: number; failed: number; skipped: number };
}

export interface RouteConfig {
  business_hours?: {
    enabled: boolean;
    timezone: string;
    days: Record<string, { open: string; close: string } | null>;
    after_hours_message?: string;
  };
  failover?: {
    enabled: boolean;
    failover_agent_id?: string | null;
    failover_number_id?: string | null;
    failover_provider?: 'plivo' | 'twilio' | 'exotel' | null;
  };
  ivr?: {
    enabled: boolean;
    greeting?: string;
    menu: { digit: string; label: string; action: 'route_to_agent' | 'transfer_to_number' | 'hangup'; agent_id?: string | null; transfer_to?: string | null }[];
    timeout_seconds: number;
  };
  geo?: {
    enabled: boolean;
    allowed_country_codes: string[];
    blocked_country_codes: string[];
  };
  spam_dnd?: {
    enabled: boolean;
    blocked_numbers: string[];
  };
}

export interface AuditEntry {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_email: string | null;
  before_state: any;
  after_state: any;
  metadata: any;
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

  /** Catalog of numbers available for purchase from a provider.
   * Returns the list along with optional flags indicating whether these are
   * real carrier numbers or fall-back synthetic sandbox numbers. */
  listAvailable: async (params: {
    provider?: 'plivo' | 'twilio' | 'exotel';
    country?: string;
    capabilities?: ('voice' | 'sms')[];
  } = {}): Promise<{ data: AvailableNumber[]; reason?: string; message?: string; sandbox?: boolean }> => {
    const qs = new URLSearchParams();
    qs.set('provider', params.provider || 'plivo');
    qs.set('country', params.country || 'US');
    if (params.capabilities?.length) qs.set('capabilities', params.capabilities.join(','));
    const r = await api.get(`/phone-numbers/available?${qs.toString()}`);
    return {
      data: r.data?.data ?? [],
      reason: r.data?.reason,
      message: r.data?.message,
      sandbox: r.data?.sandbox === true,
    };
  },

  /** Unified catalog across all configured carriers. Each row carries its own
   * `provider` field so the buy step knows which carrier API to call. */
  listAvailableAll: async (params: {
    country?: string;
    capabilities?: ('voice' | 'sms')[];
  } = {}): Promise<{ data: AvailableNumber[]; message?: string; sandbox?: boolean }> => {
    const qs = new URLSearchParams();
    qs.set('country', params.country || 'US');
    if (params.capabilities?.length) qs.set('capabilities', params.capabilities.join(','));
    const r = await api.get(`/phone-numbers/available-all?${qs.toString()}`);
    return {
      data: r.data?.data ?? [],
      message: r.data?.message,
      sandbox: r.data?.sandbox === true,
    };
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

  /** Look up the existing KYC submission for this tenant+provider, or null. */
  getKyc: async (provider: 'plivo' | 'twilio' | 'exotel' = 'plivo'): Promise<KycRecord | null> => {
    const r = await api.get(`/phone-numbers/kyc?provider=${provider}`);
    return r.data?.data ?? null;
  },

  // ── 6-step KYC wizard endpoints (Reserve → Register → OTP → PAN → Aadhaar → GST → Complete) ──
  wizard: {
    reserve: async (params: { provider?: 'plivo' | 'twilio' | 'exotel'; number: string; capabilities?: ('voice' | 'sms')[]; monthly_rate?: number; is_sandbox?: boolean }) => {
      const r = await api.post('/phone-numbers/kyc-wizard/reserve', {
        provider: params.provider || 'plivo',
        number: params.number,
        capabilities: params.capabilities || ['voice'],
        monthly_rate: params.monthly_rate,
        is_sandbox: params.is_sandbox === true,
      });
      return r.data as { data: KycSession; reused?: boolean };
    },
    get: async (id: string) => {
      const r = await api.get(`/phone-numbers/kyc-wizard/${id}`);
      return r.data?.data as KycSession;
    },
    register: async (id: string, body: { full_name: string; email: string; mobile: string }) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/register`, body);
      return r.data as { data: KycSession; otp_sent: any; dev_otp?: { email: string; mobile: string } };
    },
    resendOtp: async (id: string, channel: 'email' | 'mobile' | 'all' = 'all') => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/resend-otp`, { channel });
      return r.data as { ok: boolean; expires_at: string; dev_otp?: any };
    },
    verifyOtp: async (id: string, body: { email_otp: string; mobile_otp: string }) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/verify-otp`, body);
      return r.data?.data as KycSession;
    },
    pan: async (id: string, body: { pan: string; name_on_pan: string }) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/pan`, body);
      return r.data?.data as KycSession;
    },
    aadhaarInit: async (id: string, aadhaar: string) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/aadhaar/init`, { aadhaar });
      return r.data as { ok: boolean; mobile_hint?: string; expires_at: string; dev_otp?: string };
    },
    aadhaarVerify: async (id: string, otp: string) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/aadhaar/verify`, { otp });
      return r.data?.data as KycSession;
    },
    gstin: async (id: string, body: { gstin?: string; skip?: boolean }) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/gstin`, body);
      return r.data?.data as KycSession;
    },
    complete: async (id: string) => {
      const r = await api.post(`/phone-numbers/kyc-wizard/${id}/complete`, {});
      return r.data as { data: PhoneNumberRecord; session: KycSession; already_completed?: boolean };
    },
    cancel: async (id: string) => {
      await api.delete(`/phone-numbers/kyc-wizard/${id}`);
    },
    balanceCheck: async (id: string): Promise<{
      ok: boolean;
      balance: number | null;
      required: number;
      sufficient: boolean;
      reason?: string;
      account_type?: string;
      auto_recharge?: boolean;
    }> => {
      const r = await api.get(`/phone-numbers/kyc-wizard/${id}/balance-check`);
      return r.data;
    },
  },

  /** KYC-gated buy: validates KYC, registers a Plivo End User, then rents the number. */
  buyWithKyc: async (params: {
    provider?: 'plivo' | 'twilio' | 'exotel';
    number: string;
    capabilities?: ('voice' | 'sms')[];
    kyc: KycPayload;
  }): Promise<PhoneNumberRecord & { kyc?: { id: string; status: string; provider_end_user_id: string } }> => {
    const r = await api.post('/phone-numbers/buy-with-kyc', {
      provider: params.provider || 'plivo',
      number: params.number,
      capabilities: params.capabilities || ['voice'],
      kyc: params.kyc,
    });
    return r.data;
  },

  /** Import a number the tenant already owns at the carrier (Plivo/Twilio/Exotel).
   * Required for Exotel since they don't expose a number-catalog API. */
  importExisting: async (params: {
    provider: 'plivo' | 'twilio' | 'exotel';
    phone_number: string;
    provider_sid?: string;
    capabilities?: ('voice' | 'sms')[];
    twilio_account_sid?: string;
    twilio_auth_token?: string;
    exotel_api_key?: string;
    exotel_api_token?: string;
    exotel_subdomain?: string;
    exotel_account_sid?: string;
    sip_uri?: string;
    sip_username?: string;
    sip_password?: string;
  }): Promise<PhoneNumberRecord> => {
    const r = await api.post('/phone-numbers/import', {
      provider: params.provider,
      phone_number: params.phone_number,
      provider_sid: params.provider_sid,
      capabilities: params.capabilities || ['voice'],
      twilio_account_sid: params.twilio_account_sid,
      twilio_auth_token: params.twilio_auth_token,
      exotel_api_key: params.exotel_api_key,
      exotel_api_token: params.exotel_api_token,
      exotel_subdomain: params.exotel_subdomain,
      exotel_account_sid: params.exotel_account_sid,
      sip_uri: params.sip_uri,
      sip_username: params.sip_username,
      sip_password: params.sip_password,
    });
    return r.data;
  },

  // ── Lifecycle: verify → assign → deploy → route → audit ──
  verify: async (id: string): Promise<VerificationRunSummary> => {
    const r = await api.post(`/phone-numbers/${id}/verify`);
    return r.data;
  },

  listVerifications: async (id: string): Promise<any[]> => {
    const r = await api.get(`/phone-numbers/${id}/verifications`);
    return r.data?.data ?? [];
  },

  startInboundProbe: async (id: string): Promise<{ probe_id: string; expires_at: string; message: string }> => {
    const r = await api.post(`/phone-numbers/${id}/verify-inbound/start`);
    return r.data;
  },

  checkInboundProbe: async (id: string, probe_id: string): Promise<{ status: 'pending' | 'pass' | 'fail'; log?: any; error?: string; expired?: boolean }> => {
    const r = await api.get(`/phone-numbers/${id}/verify-inbound/check`, { params: { probe_id } });
    return r.data;
  },

  assignAgent: async (id: string, agent_id: string, opts?: { bypass_verification?: boolean }): Promise<PhoneNumberRecord> => {
    const r = await api.post(`/phone-numbers/${id}/assign-agent`, {
      agent_id,
      bypass_verification: opts?.bypass_verification === true,
    });
    return r.data?.data ?? r.data;
  },

  deploy: async (id: string, opts?: { agent_id?: string; bypass_verification?: boolean }): Promise<{
    ok: boolean;
    number_id: string;
    agent_id: string;
    deployment_status: string;
    deployed_config_id: string;
    version: number;
  }> => {
    const r = await api.post(`/phone-numbers/${id}/deploy`, {
      agent_id: opts?.agent_id,
      bypass_verification: opts?.bypass_verification === true,
    });
    return r.data;
  },

  pause: async (id: string): Promise<{ ok: boolean; deployment_status: string }> => {
    const r = await api.post(`/phone-numbers/${id}/pause`);
    return r.data;
  },

  resume: async (id: string): Promise<{ ok: boolean; deployment_status: string }> => {
    const r = await api.post(`/phone-numbers/${id}/resume`);
    return r.data;
  },

  getRoute: async (id: string): Promise<RouteConfig> => {
    const r = await api.get(`/phone-numbers/${id}/route`);
    return (r.data?.data?.route_config ?? {}) as RouteConfig;
  },

  putRoute: async (id: string, config: RouteConfig): Promise<RouteConfig> => {
    const r = await api.put(`/phone-numbers/${id}/route`, config);
    return r.data?.data?.route_config ?? config;
  },

  getAudit: async (id: string): Promise<AuditEntry[]> => {
    const r = await api.get(`/phone-numbers/${id}/audit`);
    return r.data?.data ?? [];
  },

  getDeploymentHistory: async (id: string): Promise<any[]> => {
    const r = await api.get(`/phone-numbers/${id}/deployment`);
    return r.data?.data ?? [];
  },
};

export interface AvailableNumber {
  providerNumberId: string;
  number: string;
  capabilities: string[];
  monthlyRate?: number;
  region?: string;
  country?: string;
  /** Which carrier this row came from (plivo / twilio / exotel / sandbox).
   * Set when the row comes from the unified /available-all endpoint so the
   * buy step knows which carrier API to call. */
  provider?: 'plivo' | 'twilio' | 'exotel' | 'sandbox';
  /** True when the catalog entry came from the synthetic sandbox fallback,
   * not the real carrier. Sandbox numbers buy instantly with no carrier call
   * and only work for in-app testing — not real PSTN calls. */
  synthetic?: boolean;
}

export interface KycPayload {
  business_name: string;
  owner_name: string;
  owner_email?: string;
  owner_phone?: string;
  pan?: string;
  aadhaar?: string;
  gstin?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  use_case: string;
}

export type KycStep = 'register' | 'otp' | 'pan' | 'aadhaar' | 'gstin' | 'complete';

export interface KycSession {
  id: string;
  provider: string;
  number: string;
  capabilities: string[];
  monthly_rate: number | null;
  is_sandbox: boolean;
  current_step: KycStep;
  full_name: string | null;
  email: string | null;
  mobile: string | null;
  email_verified: boolean;
  mobile_verified: boolean;
  pan: string | null;
  pan_holder_name: string | null;
  pan_verified: boolean;
  aadhaar_last4: string | null;
  aadhaar_verified: boolean;
  gstin: string | null;
  gstin_verified: boolean;
  gstin_skipped: boolean;
  purchased_phone_id: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  expires_at: string;
  created_at: string;
}

export interface KycRecord {
  id: string;
  status: 'pending' | 'verified' | 'rejected';
  business_name: string;
  owner_name: string;
  owner_email: string | null;
  owner_phone: string | null;
  pan: string | null;
  aadhaar_last4: string | null;
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  use_case: string;
  provider_end_user_id: string | null;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
}
