import api from './api';

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  method: string | null;
  path: string | null;
  status_code: number | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const auditApi = {
  list: async (params?: {
    limit?: number;
    action?: string;
    resource_type?: string;
    since?: string;
  }): Promise<AuditLogEntry[]> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.action) qs.set('action', params.action);
    if (params?.resource_type) qs.set('resource_type', params.resource_type);
    if (params?.since) qs.set('since', params.since);
    const res = await api.get(`/audit-log${qs.toString() ? '?' + qs.toString() : ''}`);
    return res.data?.data ?? [];
  },
};
