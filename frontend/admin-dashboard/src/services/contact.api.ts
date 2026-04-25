import api from './api';

export type InquiryType =
  | 'SALES' | 'DEMO' | 'SUPPORT' | 'PRICING' | 'PARTNERSHIP'
  | 'AGENT_SETUP' | 'BULK_CAMPAIGN' | 'WEB_CALL' | 'CRM_INTEGRATION' | 'BILLING' | 'OTHER';

export type CompanySize =
  | 'INDIVIDUAL' | 'STARTUP' | 'SMALL_BUSINESS' | 'COLLEGE_INSTITUTE' | 'MID_MARKET' | 'ENTERPRISE';

export type ContactMethod = 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'GOOGLE_MEET';

export type ContactStatus =
  | 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DEMO_SCHEDULED' | 'IN_PROGRESS' | 'CLOSED' | 'SPAM';

export type ContactSubmitRequest = {
  full_name: string;
  email: string;
  phone: string;
  company_name?: string | null;
  website?: string | null;
  inquiry_type: InquiryType;
  company_size?: CompanySize | null;
  preferred_contact_method: ContactMethod;
  message: string;
  consent_given?: boolean;
  recaptcha_token?: string;
  source_url?: string | null;
};

export type ContactRequest = {
  id: string;
  reference_id: string;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  website: string | null;
  inquiry_type: InquiryType;
  company_size: CompanySize | null;
  preferred_contact_method: ContactMethod;
  message: string;
  status: ContactStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assigned_to: string | null;
  ai_summary: string | null;
  lead_score: number | null;
  ai_payload: null | {
    inquiry_type?: string;
    urgency?: string;
    lead_score?: number;
    product_interest?: string[];
    recommended_team?: string;
    next_best_action?: string;
    draft_reply?: string;
    summary?: string;
  };
  crm_lead_id: string | null;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
};

export type ContactEvent = {
  id: string;
  event_type: string;
  description: string | null;
  visibility: 'internal' | 'public';
  payload: any;
  created_at: string;
};

export type ContactListResponse = {
  items: ContactRequest[];
  total: number;
  page: number;
  limit: number;
  stats: { total: number; new_count: number; in_flight: number; hot_leads: number; avg_lead_score: number | null };
};

export const contactApi = {
  submitPublic: async (payload: ContactSubmitRequest) => {
    const r = await api.post('/contact', payload);
    return r.data as { reference_id: string; status: string; created_at: string; message: string };
  },
  publicStatus: async (ref: string) => {
    const r = await api.get(`/contact/${ref}`);
    return r.data;
  },
  adminList: async (params: { status?: string; inquiry_type?: string; priority?: string; q?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '') as any).toString();
    const r = await api.get(`/admin/contact-requests${qs ? `?${qs}` : ''}`);
    return r.data as ContactListResponse;
  },
  adminGet: async (ref: string) => {
    const r = await api.get(`/admin/contact-requests/${ref}`);
    return r.data as { request: ContactRequest; events: ContactEvent[] };
  },
  adminSetStatus: async (ref: string, status: ContactStatus) => {
    const r = await api.put(`/admin/contact-requests/${ref}/status`, { status });
    return r.data;
  },
  adminAssign: async (ref: string, assigned_to: string | null) => {
    const r = await api.put(`/admin/contact-requests/${ref}/assign`, { assigned_to });
    return r.data;
  },
  adminReply: async (ref: string, body: string, channel: ContactMethod = 'EMAIL') => {
    const r = await api.post(`/admin/contact-requests/${ref}/reply`, { body, channel });
    return r.data;
  },
  adminCsvUrl: () => {
    const base = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
    return `${base}/admin/contact-requests?format=csv`;
  },
};

export const INQUIRY_OPTIONS: { value: InquiryType; label: string }[] = [
  { value: 'SALES', label: 'Sales Inquiry' },
  { value: 'DEMO', label: 'Product Demo' },
  { value: 'SUPPORT', label: 'Technical Support' },
  { value: 'PRICING', label: 'Pricing Question' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'AGENT_SETUP', label: 'AI Voice Agent Setup' },
  { value: 'BULK_CAMPAIGN', label: 'Bulk Call Campaign' },
  { value: 'WEB_CALL', label: 'Web Call Setup' },
  { value: 'CRM_INTEGRATION', label: 'CRM Integration' },
  { value: 'BILLING', label: 'Billing' },
  { value: 'OTHER', label: 'Other' },
];

export const COMPANY_SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'STARTUP', label: 'Startup' },
  { value: 'SMALL_BUSINESS', label: 'Small Business' },
  { value: 'COLLEGE_INSTITUTE', label: 'College / Institute' },
  { value: 'MID_MARKET', label: 'Mid-market Company' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
];

export const CONTACT_METHOD_OPTIONS: { value: ContactMethod; label: string }[] = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'GOOGLE_MEET', label: 'Google Meet' },
];

export const STATUS_LABELS: Record<ContactStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  DEMO_SCHEDULED: 'Demo Scheduled',
  IN_PROGRESS: 'In Progress',
  CLOSED: 'Closed',
  SPAM: 'Spam',
};
export const STATUS_COLORS: Record<ContactStatus, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  CONTACTED: 'bg-indigo-100 text-indigo-700',
  QUALIFIED: 'bg-emerald-100 text-emerald-700',
  DEMO_SCHEDULED: 'bg-purple-100 text-purple-700',
  IN_PROGRESS: 'bg-cyan-100 text-cyan-700',
  CLOSED: 'bg-gray-200 text-gray-700',
  SPAM: 'bg-rose-100 text-rose-700',
};
export const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
};
