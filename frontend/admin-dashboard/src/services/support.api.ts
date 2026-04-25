import api from './api';

export type ReportType =
  | 'BUG' | 'FEATURE_REQUEST' | 'PRODUCT_FEEDBACK' | 'CALL_QUALITY' | 'VOICE_ISSUE'
  | 'TRANSCRIPTION_ISSUE' | 'BILLING_ISSUE' | 'API_ISSUE' | 'INTEGRATION_ISSUE' | 'OTHER';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ProductArea =
  | 'AGENT_BUILDER' | 'WEB_CALL' | 'BULK_CALL' | 'PHONE_NUMBERS' | 'VOICE_SELECTION'
  | 'LANGUAGE_SELECTION' | 'CALL_RECORDING' | 'TRANSCRIPT' | 'AI_ANALYSIS'
  | 'CRM_INTEGRATION' | 'DASHBOARD' | 'BILLING' | 'API_WEBHOOKS' | 'OTHER';

export type ReportStatus =
  | 'SUBMITTED' | 'UNDER_REVIEW' | 'NEED_MORE_INFO' | 'IN_PROGRESS'
  | 'PLANNED' | 'FIXED' | 'RELEASED' | 'REJECTED' | 'DUPLICATE' | 'CLOSED';

export type ReportSubmitRequest = {
  name: string;
  email: string;
  phone?: string | null;
  company_name?: string | null;
  user_role?: string | null;
  report_type: ReportType;
  priority: Priority;
  product_area?: ProductArea | null;
  title: string;
  description: string;
  expected_behavior?: string | null;
  actual_behavior?: string | null;
  steps_to_reproduce?: string | null;
  affected_agent_id?: string | null;
  affected_call_id?: string | null;
  affected_campaign_id?: string | null;
  browser?: string | null;
  device?: string | null;
  os?: string | null;
  consent_contact?: boolean;
  consent_privacy?: boolean;
  recaptcha_token?: string;
  metadata?: Record<string, unknown>;
};

export type ReportSummary = {
  id: string;
  ticket_id: string;
  name?: string;
  email?: string;
  title: string;
  report_type: ReportType;
  priority: Priority;
  product_area: ProductArea | null;
  status: ReportStatus;
  assigned_to?: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportDetail = {
  report: ReportSummary & Record<string, any>;
  comments: Array<{ id: string; author_id?: string; author_type: 'user' | 'admin'; body: string; visibility: 'public' | 'internal'; created_at: string }>;
  internal_notes?: Array<{ id: string; author_id?: string; body: string; created_at: string }>;
  history: Array<{ from_status: string | null; to_status: string; changed_by?: string; reason?: string; created_at: string }>;
  attachments: Array<{ id: string; kind: string; filename: string; public_url: string; mime_type: string; size_bytes: number; created_at: string }>;
  ai_analysis: null | {
    summary?: string;
    detected_type?: string;
    suggested_priority?: string;
    product_area?: string;
    sentiment?: string;
    possible_duplicate?: boolean;
    duplicate_ticket_ids?: string[];
    suggested_assignee_team?: string;
    recommended_next_action?: string;
    draft_user_reply?: string;
  };
  duplicates?: Array<{ duplicate_of_ticket: string; confidence: number }>;
};

export type AdminReportList = {
  items: ReportSummary[];
  total: number;
  page: number;
  limit: number;
  stats: {
    open_count: number;
    critical_open: number;
    bugs_total: number;
    feature_requests_total: number;
    avg_resolution_hours: number | null;
  };
};

export const supportApi = {
  submit: async (payload: ReportSubmitRequest) => {
    const r = await api.post('/reports', payload);
    return r.data as { ticket_id: string; id: string; status: string; created_at: string; message: string };
  },
  submitPublic: async (payload: ReportSubmitRequest) => {
    const r = await api.post('/reports/public', payload);
    return r.data as { ticket_id: string; id: string; status: string; created_at: string; message: string };
  },
  my: async (page = 1, limit = 20) => {
    const r = await api.get(`/reports/my?page=${page}&limit=${limit}`);
    return r.data as { items: ReportSummary[]; page: number; limit: number };
  },
  get: async (ticketId: string) => {
    const r = await api.get(`/reports/${ticketId}`);
    return r.data as ReportDetail;
  },
  comment: async (ticketId: string, body: string) => {
    const r = await api.post(`/reports/${ticketId}/comments`, { body });
    return r.data as { ok: true };
  },
  uploadAttachment: async (ticketId: string, file: File, kind = 'file') => {
    const r = await api.post(
      `/reports/${ticketId}/attachments?kind=${encodeURIComponent(kind)}&filename=${encodeURIComponent(file.name)}`,
      await file.arrayBuffer(),
      { headers: { 'Content-Type': file.type || 'application/octet-stream' } }
    );
    return r.data as { id: string; url: string; size: number; mime: string };
  },

  // --- admin
  adminList: async (params: { status?: string; type?: string; priority?: string; product_area?: string; q?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '') as any).toString();
    const r = await api.get(`/admin/reports${qs ? `?${qs}` : ''}`);
    return r.data as AdminReportList;
  },
  adminGet: async (ticketId: string) => {
    const r = await api.get(`/admin/reports/${ticketId}`);
    return r.data as ReportDetail;
  },
  adminSetStatus: async (ticketId: string, status: ReportStatus, reason?: string) => {
    const r = await api.put(`/admin/reports/${ticketId}/status`, { status, reason });
    return r.data;
  },
  adminSetPriority: async (ticketId: string, priority: Priority) => {
    const r = await api.put(`/admin/reports/${ticketId}/priority`, { priority });
    return r.data;
  },
  adminAssign: async (ticketId: string, assigned_to: string | null) => {
    const r = await api.put(`/admin/reports/${ticketId}/assign`, { assigned_to });
    return r.data;
  },
  adminReply: async (ticketId: string, body: string) => {
    const r = await api.post(`/admin/reports/${ticketId}/reply`, { body });
    return r.data;
  },
  adminInternalNote: async (ticketId: string, body: string) => {
    const r = await api.post(`/admin/reports/${ticketId}/internal-notes`, { body });
    return r.data;
  },
  adminMarkDuplicate: async (ticketId: string, duplicate_of_ticket_id: string) => {
    const r = await api.post(`/admin/reports/${ticketId}/mark-duplicate`, { duplicate_of_ticket_id });
    return r.data;
  },
  adminConvertToRoadmap: async (ticketId: string, title?: string, description?: string) => {
    const r = await api.post(`/admin/reports/${ticketId}/convert-to-roadmap`, { title, description });
    return r.data;
  },
};

export const REPORT_TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request' },
  { value: 'PRODUCT_FEEDBACK', label: 'Product Feedback' },
  { value: 'CALL_QUALITY', label: 'Call Quality Issue' },
  { value: 'VOICE_ISSUE', label: 'Voice Issue' },
  { value: 'TRANSCRIPTION_ISSUE', label: 'Transcription Issue' },
  { value: 'BILLING_ISSUE', label: 'Billing Issue' },
  { value: 'API_ISSUE', label: 'API Issue' },
  { value: 'INTEGRATION_ISSUE', label: 'Integration Issue' },
  { value: 'OTHER', label: 'Other' },
];

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export const PRODUCT_AREA_OPTIONS: { value: ProductArea; label: string }[] = [
  { value: 'AGENT_BUILDER', label: 'Agent Builder' },
  { value: 'WEB_CALL', label: 'Web Call' },
  { value: 'BULK_CALL', label: 'Bulk Call' },
  { value: 'PHONE_NUMBERS', label: 'Phone Numbers' },
  { value: 'VOICE_SELECTION', label: 'Voice Selection' },
  { value: 'LANGUAGE_SELECTION', label: 'Language Selection' },
  { value: 'CALL_RECORDING', label: 'Call Recording' },
  { value: 'TRANSCRIPT', label: 'Transcript' },
  { value: 'AI_ANALYSIS', label: 'AI Analysis' },
  { value: 'CRM_INTEGRATION', label: 'CRM Integration' },
  { value: 'DASHBOARD', label: 'Dashboard' },
  { value: 'BILLING', label: 'Billing' },
  { value: 'API_WEBHOOKS', label: 'API / Webhooks' },
  { value: 'OTHER', label: 'Other' },
];

export const STATUS_LABELS: Record<ReportStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  NEED_MORE_INFO: 'Need More Info',
  IN_PROGRESS: 'In Progress',
  PLANNED: 'Planned',
  FIXED: 'Fixed',
  RELEASED: 'Released',
  REJECTED: 'Rejected',
  DUPLICATE: 'Duplicate',
  CLOSED: 'Closed',
};

export const STATUS_COLORS: Record<ReportStatus, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-700',
  UNDER_REVIEW: 'bg-indigo-100 text-indigo-700',
  NEED_MORE_INFO: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-cyan-100 text-cyan-700',
  PLANNED: 'bg-purple-100 text-purple-700',
  FIXED: 'bg-green-100 text-green-700',
  RELEASED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  DUPLICATE: 'bg-gray-100 text-gray-700',
  CLOSED: 'bg-gray-200 text-gray-800',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
};
