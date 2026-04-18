export enum TenantPlan {
  FREE = 'FREE',
  STARTER = 'STARTER',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  settings: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  maxAgents: number;
  maxPhoneNumbers: number;
  maxMonthlyMinutes: number;
  allowedLLMProviders: string[];
  customBranding: boolean;
}
