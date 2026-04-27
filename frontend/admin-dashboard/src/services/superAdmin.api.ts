import api from './api';

// API client for the super-admin module. All endpoints are mounted at
// /super-admin/* on identity-service (port 8080) — same axios instance as
// the rest of the dashboard, so the auth interceptor automatically attaches
// the platform-admin JWT.

export interface DashboardSummary {
  tenants: { total: number; active: number; new_today: number; new_month: number };
  calls: { today: number; minutes_today: number; this_month: number; minutes_month: number; failed_today: number };
  agents: { total: number; active: number };
  revenue: { total_wallet_balance_inr: number; wallet_count: number };
  system_health: Record<string, string>;
}

export interface DashboardTimeseries {
  days: Array<{ day: string; calls: number; minutes: number }>;
}

export interface TenantListRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  wallet_balance: number;
  user_count: string | number;
  last_login_at: string | null;
  owner_email: string | null;
}

export interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    settings: Record<string, unknown>;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  wallet: {
    id: string;
    balance: number;
    currency: string;
    low_balance_threshold: number;
    created_at: string;
    updated_at: string;
  } | null;
  recent_transactions: Array<{
    id: string;
    amount: number;
    type: 'credit' | 'debit';
    reason: string;
    balance_after: number;
    created_at: string;
  }>;
  calls: { total: number; total_minutes: number; last_call_at: string | null };
  agents: { total: number; active: number };
  users: Array<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    last_login_at: string | null;
    created_at: string;
    roles: string[];
  }>;
}

export interface CallRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  agent_id: string | null;
  channel: string;
  status: string;
  caller_number: string | null;
  called_number: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  outcome: string | null;
  sentiment: string | null;
}

export interface AgentRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  name: string;
  status: string;
  direction: string;
  llm_provider: string | null;
  llm_model: string | null;
  cost_per_min: number | null;
  total_calls: number;
  created_at: string;
}

export interface BillingOverview {
  totals: { total_balance: number; wallet_count: string | number; low_count: string | number };
  top_wallets: Array<{ tenant_id: string; tenant_name: string | null; balance: number; currency: string }>;
  recent_transactions: Array<{
    id: string; tenant_id: string; tenant_name: string | null;
    amount: number; type: 'credit' | 'debit'; reason: string;
    balance_after: number; created_at: string;
  }>;
  plan_distribution: Array<{ plan: string; count: number }>;
}

export interface AuditRow {
  id: string;
  admin_user_id: string;
  admin_email: string;
  action: string;
  module: string;
  target_tenant_id: string | null;
  target_tenant_name: string | null;
  target_resource_type: string | null;
  target_resource_id: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export interface IntegrationsResp {
  providers: Array<{ key: string; name: string; category: string; configured: boolean }>;
  tenant_installs: Array<{
    provider: string; install_count: number; enabled_count: number;
    healthy_count: number; error_count: number;
  }>;
}

export interface ImpersonateResp {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  impersonating: { tenantId: string; userId: string; email: string; roles: string[] };
}

interface Paged<T> { total: number; data: T[] }

export const superAdminApi = {
  dashboard: () => api.get<DashboardSummary>('/super-admin/dashboard').then((r) => r.data),
  timeseries: () => api.get<DashboardTimeseries>('/super-admin/dashboard/timeseries').then((r) => r.data),

  tenants: (params: { page?: number; limit?: number; search?: string; plan?: string; status?: string } = {}) =>
    api.get<Paged<TenantListRow>>('/super-admin/tenants', { params }).then((r) => r.data),
  tenantDetail: (id: string) =>
    api.get<TenantDetail>(`/super-admin/tenants/${id}`).then((r) => r.data),
  setTenantStatus: (id: string, active: boolean, reason?: string) =>
    api.put(`/super-admin/tenants/${id}/status`, { active, reason }).then((r) => r.data),
  impersonate: (id: string) =>
    api.post<ImpersonateResp>(`/super-admin/tenants/${id}/impersonate`).then((r) => r.data),
  tenantWallet: (id: string) =>
    api.get(`/super-admin/tenants/${id}/wallet`).then((r) => r.data),

  calls: (params: { page?: number; limit?: number; tenant_id?: string; status?: string; channel?: string; since?: string } = {}) =>
    api.get<Paged<CallRow>>('/super-admin/calls', { params }).then((r) => r.data),
  callDetail: (id: string) =>
    api.get(`/super-admin/calls/${id}`).then((r) => r.data),

  agents: (params: { page?: number; limit?: number; tenant_id?: string; status?: string; search?: string } = {}) =>
    api.get<Paged<AgentRow>>('/super-admin/agents', { params }).then((r) => r.data),

  billing: () => api.get<BillingOverview>('/super-admin/billing').then((r) => r.data),
  walletAdjust: (payload: { tenant_id: string; amount: number; type: 'credit' | 'debit'; reason: string }) =>
    api.post('/super-admin/wallet/adjust', payload).then((r) => r.data),

  auditLogs: (params: { page?: number; limit?: number; module?: string; admin?: string; target_tenant_id?: string } = {}) =>
    api.get<Paged<AuditRow>>('/super-admin/audit-logs', { params }).then((r) => r.data),

  integrations: () => api.get<IntegrationsResp>('/super-admin/integrations').then((r) => r.data),

  // ── A-to-Z tenant intelligence (Phase 1.5) ─────────────────────────────
  tenantTimeseries: (id: string) =>
    api.get<{
      calls: Array<{ day: string; count: number; minutes: number }>;
      signups: Array<{ day: string; count: number }>;
      transactions: Array<{ day: string; credit: number; debit: number; count: number }>;
    }>(`/super-admin/tenants/${id}/timeseries`).then((r) => r.data),

  tenantUsers: (id: string, params: { page?: number; limit?: number } = {}) =>
    api.get<Paged<any>>(`/super-admin/tenants/${id}/users`, { params }).then((r) => r.data),

  tenantCalls: (id: string, params: { page?: number; limit?: number } = {}) =>
    api.get<Paged<any>>(`/super-admin/tenants/${id}/calls`, { params }).then((r) => r.data),

  tenantAgents: (id: string, params: { page?: number; limit?: number } = {}) =>
    api.get<Paged<any>>(`/super-admin/tenants/${id}/agents`, { params }).then((r) => r.data),

  tenantResources: (id: string) =>
    api.get<{
      workflows: any[];
      knowledge_bases: any[];
      phone_numbers: any[];
      integrations: any[];
      api_keys: any[];
      subscriptions: any[];
    }>(`/super-admin/tenants/${id}/resources`).then((r) => r.data),

  tenantAudit: (id: string, params: { page?: number; limit?: number } = {}) =>
    api.get<Paged<any>>(`/super-admin/tenants/${id}/audit`, { params }).then((r) => r.data),

  tenantBillingHistory: (id: string, params: { page?: number; limit?: number } = {}) =>
    api.get<{
      wallet: any | null;
      transactions: { total: number; data: any[] };
      subscriptions: any[];
      invoices: any[];
    }>(`/super-admin/tenants/${id}/billing-history`, { params }).then((r) => r.data),

  tenantActivity: (id: string, limit = 100) =>
    api.get<{
      events: Array<{ ts: string; kind: string; summary: string; meta: Record<string, unknown> }>;
    }>(`/super-admin/tenants/${id}/activity`, { params: { limit } }).then((r) => r.data),

  userActivity: (userId: string) =>
    api.get<{
      user: any;
      login_history: Array<{ created_at: string; expires_at: string; revoked: boolean }>;
      audit_trail: any[];
      agents_owned: any[];
      stats: { calls_handled: number; agents_owned: number };
      recent_calls_via_agents: any[];
    }>(`/super-admin/users/${userId}/activity`).then((r) => r.data),

  callsStats: () =>
    api.get<{
      today: { count: number; minutes: number };
      yesterday: { count: number };
      last7days: { count: number };
      by_status: Array<{ status: string; n: number }>;
      by_channel: Array<{ channel: string; n: number }>;
      top_tenants_7d: Array<{ tenant_id: string; n: number }>;
    }>('/super-admin/stats/calls').then((r) => r.data),

  tenantsStats: () =>
    api.get<{
      active: number; suspended: number; new_today: number; new_week: number;
      plan_distribution: Array<{ plan: string; n: number }>;
      wallet: { total: number; avg: number; count: number };
    }>('/super-admin/stats/tenants').then((r) => r.data),

  agentsStats: () =>
    api.get<{
      by_status: Array<{ status: string; n: number }>;
      by_provider: Array<{ llm_provider: string; n: number }>;
      top_tenants: Array<{ tenant_id: string; n: number }>;
      cost_per_min: { avg: number | null; min: number | null; max: number | null };
      top_agents_7d: Array<{ agent_id: string; n: number }>;
    }>('/super-admin/stats/agents').then((r) => r.data),

  globalActivityFeed: (params: { hours?: number; limit?: number } = {}) =>
    api.get<{
      events: Array<{
        ts: string; kind: string;
        tenant_id: string | null; tenant_name: string | null;
        summary: string; meta: Record<string, unknown>;
      }>;
      since_hours: number;
    }>('/super-admin/activity-feed', { params }).then((r) => r.data),

  // ── Advanced features (F1–F13) ─────────────────────────────────────────
  search: (q: string) =>
    api.get<{ results: Array<{ kind: string; id: string; label: string; sub: string; href: string }> }>(
      '/super-admin/search', { params: { q } },
    ).then((r) => r.data),

  failedCallsGrouped: (since?: string) =>
    api.get<{
      total_failed: number;
      by_tenant: Array<{ tenant_id: string; tenant_name: string | null; n: number }>;
      by_outcome: Array<{ outcome: string; n: number }>;
      by_agent: Array<{ agent_id: string; n: number }>;
      sample: any[];
    }>('/super-admin/calls-failed/grouped', { params: { since } }).then((r) => r.data),

  healthScores: () =>
    api.get<{
      data: Array<{
        tenant_id: string; tenant_name: string;
        score: number; flag: 'red' | 'yellow' | 'green';
        reasons: string[];
        balance: number; calls_7d: number; failed_7d: number;
        failure_rate_pct: number; days_since_login: number;
      }>;
    }>('/super-admin/health-scores').then((r) => r.data),

  // SSE endpoint URL — caller wires up EventSource directly.
  eventStreamUrl: () => '/api/v1/super-admin/events/stream',

  alerts: (open = true) =>
    api.get<{ data: any[] }>('/super-admin/alerts', { params: { open } }).then((r) => r.data),
  ackAlert: (id: string) =>
    api.post(`/super-admin/alerts/${id}/ack`).then((r) => r.data),
  runAnomalyChecks: () =>
    api.post('/super-admin/alerts/run-checks').then((r) => r.data),

  savedViews: () =>
    api.get<{ data: any[] }>('/super-admin/saved-views').then((r) => r.data),
  createSavedView: (payload: { name: string; path: string; query?: string; pinned?: boolean }) =>
    api.post('/super-admin/saved-views', payload).then((r) => r.data),
  deleteSavedView: (id: string) =>
    api.delete(`/super-admin/saved-views/${id}`).then((r) => r.data),

  webhooks: () =>
    api.get<{ data: any[] }>('/super-admin/webhooks').then((r) => r.data),
  createWebhook: (p: { name: string; url: string; events: string[]; secret?: string; enabled?: boolean }) =>
    api.post('/super-admin/webhooks', p).then((r) => r.data),
  deleteWebhook: (id: string) =>
    api.delete(`/super-admin/webhooks/${id}`).then((r) => r.data),
  testWebhook: (id: string) =>
    api.post(`/super-admin/webhooks/${id}/test`).then((r) => r.data),

  setup2fa: () =>
    api.post<{ secret: string; otpauth_url: string; qr_url: string }>('/super-admin/2fa/setup').then((r) => r.data),
  verify2fa: (token: string) =>
    api.post('/super-admin/2fa/verify', { token }).then((r) => r.data),
  disable2fa: () =>
    api.post('/super-admin/2fa/disable').then((r) => r.data),

  changePlan: (tenantId: string, plan: string, reason?: string) =>
    api.put(`/super-admin/tenants/${tenantId}/plan`, { plan, reason }).then((r) => r.data),

  broadcasts: () =>
    api.get<{ data: any[] }>('/super-admin/broadcasts').then((r) => r.data),
  createBroadcast: (p: { message: string; severity?: 'info' | 'warning' | 'critical'; expires_at?: string }) =>
    api.post('/super-admin/broadcasts', p).then((r) => r.data),
  deleteBroadcast: (id: string) =>
    api.delete(`/super-admin/broadcasts/${id}`).then((r) => r.data),
  activeBroadcasts: () =>
    api.get<{ data: any[] }>('/broadcasts/active').then((r) => r.data),

  subscriptions: (params: { plan?: string; status?: string } = {}) =>
    api.get<{
      data: Array<{
        id: string | null; tenant_id: string; tenant_name: string; tenant_slug: string;
        tenant_active: boolean; plan_id: string; plan_name: string;
        price: number; currency: string; billing_cycle: string; status: string;
        auto_renew: boolean; current_period_start: string; next_renewal_date: string;
        cancel_at_period_end: boolean; canceled_at: string | null;
        wallet_balance: number; owner_email: string | null; last_login_at: string | null;
        created_at: string; updated_at: string;
      }>;
      plan_distribution: Array<{ plan_id: string; plan_name: string; tenant_count: number; mrr_contribution: number }>;
      totals: { paid_count: number; free_count: number; canceled_count: number; mrr: number; arr: number };
      upcoming_renewals: Array<{ tenant_id: string; tenant_name: string; plan_name: string; price: number; next_renewal_date: string }>;
      newest_paid_subscriptions: Array<{ tenant_id: string; tenant_name: string; plan_name: string; price: number; created_at: string }>;
      recent_plan_changes: Array<{ tenant_id: string; tenant_name: string; plan_id: string; plan_name: string; price: number; updated_at: string }>;
    }>('/super-admin/subscriptions', { params }).then((r) => r.data),

  costAnalysis: () =>
    api.get<{
      window_days: number;
      data: Array<{
        tenant_id: string; tenant_name: string | null;
        calls: number; minutes: number;
        cost_inr: number; revenue_inr: number; margin_inr: number; margin_pct: number | null;
      }>;
    }>('/super-admin/cost-analysis').then((r) => r.data),
};

// ── F2: CSV export utility (used by every list page) ──────────────────────
export function downloadCsv<T extends Record<string, any>>(
  filename: string,
  rows: T[],
  cols: Array<{ key: keyof T | string; label: string; render?: (r: T) => any }>,
): void {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(c.render ? c.render(r) : (r as any)[c.key])).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
