import api from './api';
import type { Lead, Contact, Deal } from '@/types';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ListParams {
  page?: number;
  limit?: number;
  status?: string;
  source?: string;
  search?: string;
}

// crm-service stores rows with snake_case columns (first_name, last_name,
// created_at, custom_fields...) while the UI's Lead type is camelCase with
// a single `name`. Map row → UI shape so the leads table actually renders
// for real DB rows instead of crashing on `item.name[0]`.
function rowToLead(row: any): Lead {
  const name = [row.first_name, row.last_name].filter((p) => p && p !== '-').join(' ').trim();
  const cf = row.custom_fields || {};
  const statusRaw = String(row.status || 'NEW').toLowerCase();
  // Backend status values: NEW | CONTACTED | QUALIFIED | UNQUALIFIED | CONVERTED | LOST.
  // UI status values: new | contacted | qualified | proposal | won | lost.
  const statusMap: Record<string, Lead['status']> = {
    new: 'new', contacted: 'contacted', qualified: 'qualified',
    converted: 'won', won: 'won', lost: 'lost', unqualified: 'lost', proposal: 'proposal',
  };
  return {
    id: row.id,
    name: name || `Caller ${String(row.phone || '').slice(-4)}`,
    email: row.email || '',
    phone: row.phone || '',
    company: row.company || '',
    status: statusMap[statusRaw] || 'new',
    source: row.source || 'inbound-call',
    score: typeof row.score === 'number' ? row.score : 0,
    value: typeof cf.value === 'number' ? cf.value : 0,
    assignedTo: row.assigned_to || undefined,
    notes: cf.notes || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
    // Pass through campaign-extracted custom fields so the View modal can
    // surface them without re-fetching analysis. We forward the whole cf
    // blob — the lead modal renders only what's present, so adding new
    // analyzer fields no longer requires editing this mapper.
    customFields: {
      ...cf,
      // Explicit defaults for the small set of fields the modal uses
      // unconditionally — ensures `'' || dash` renders cleanly.
      interested_university: cf.interested_university || '',
      product_interest: cf.product_interest || '',
      city: cf.city || '',
      budget: cf.budget || '',
      timeline: cf.timeline || '',
      appointment_time: cf.appointment_time || '',
      follow_up_reason: cf.follow_up_reason || '',
      recommended_follow_up_time: cf.recommended_follow_up_time || '',
      call_outcome: cf.call_outcome || '',
      conversation_id: cf.conversation_id || '',
    },
  } as Lead;
}

export const crmApi = {
  // Leads
  listLeads: async (params?: ListParams): Promise<PaginatedResponse<Lead>> => {
    const response = await api.get('/leads', { params });
    const body = response.data;
    // Backend returns { data: [...rows], pagination: { page, limit, total, totalPages } }.
    // Older callers may receive a plain array. Normalize both into the UI's
    // { data, total, page, limit } shape and map snake_case rows → Lead type.
    if (Array.isArray(body)) {
      return { data: body.map(rowToLead), total: body.length, page: 1, limit: body.length };
    }
    const rows = Array.isArray(body?.data) ? body.data : [];
    const pg = body?.pagination || {};
    return {
      data: rows.map(rowToLead),
      total: typeof pg.total === 'number' ? pg.total : (typeof body.total === 'number' ? body.total : rows.length),
      page: pg.page || body.page || 1,
      limit: pg.limit || body.limit || rows.length,
    };
  },
  getLead: async (id: string): Promise<Lead> => {
    const response = await api.get(`/leads/${id}`);
    const row = response.data.data ?? response.data;
    return rowToLead(row);
  },
  createLead: async (data: Partial<Lead> & { first_name?: string; last_name?: string }): Promise<Lead> => {
    // crm-service zod-validates {first_name, last_name} as required non-empty
    // strings. The UI carries a single `name` field, so split it here on
    // first space; everything else can be empty strings. POSTing without
    // splitting was the 400 the user was hitting.
    const payload: Record<string, any> = { ...data };
    if (!payload.first_name && payload.name) {
      const parts = String(payload.name).trim().split(/\s+/);
      payload.first_name = parts[0] || 'Unknown';
      payload.last_name = parts.slice(1).join(' ') || '-';
    }
    if (!payload.last_name) payload.last_name = '-';
    delete payload.name;
    const response = await api.post('/leads', payload);
    return rowToLead(response.data.data ?? response.data);
  },
  updateLead: async (id: string, data: Partial<Lead>): Promise<Lead> => {
    const response = await api.put(`/leads/${id}`, data);
    return response.data.data ?? response.data;
  },
  deleteLead: async (id: string): Promise<void> => {
    await api.delete(`/leads/${id}`);
  },

  // Contacts
  listContacts: async (params?: ListParams): Promise<PaginatedResponse<Contact>> => {
    const response = await api.get('/contacts', { params });
    if (Array.isArray(response.data)) {
      return { data: response.data, total: response.data.length, page: 1, limit: response.data.length };
    }
    return response.data;
  },
  createContact: async (data: Partial<Contact>): Promise<Contact> => {
    const response = await api.post('/contacts', data);
    return response.data.data ?? response.data;
  },
  updateContact: async (id: string, data: Partial<Contact>): Promise<Contact> => {
    const response = await api.put(`/contacts/${id}`, data);
    return response.data.data ?? response.data;
  },

  // Pipelines
  listPipelines: async () => {
    const response = await api.get('/pipelines');
    return response.data.data ?? response.data;
  },
  getPipelineBoard: async (id: string) => {
    const response = await api.get(`/pipelines/${id}/board`);
    return response.data.data ?? response.data;
  },

  // Deals
  listDeals: async (params?: ListParams): Promise<PaginatedResponse<Deal>> => {
    const response = await api.get('/deals', { params });
    if (Array.isArray(response.data)) {
      return { data: response.data, total: response.data.length, page: 1, limit: response.data.length };
    }
    return response.data;
  },
  createDeal: async (data: Partial<Deal>): Promise<Deal> => {
    const response = await api.post('/deals', data);
    return response.data.data ?? response.data;
  },
  updateDeal: async (id: string, data: Partial<Deal>): Promise<Deal> => {
    const response = await api.put(`/deals/${id}`, data);
    return response.data.data ?? response.data;
  },
  moveDeal: async (id: string, stageId: string): Promise<Deal> => {
    const response = await api.put(`/deals/${id}/move`, { stageId });
    return response.data.data ?? response.data;
  },

  // Tasks
  listTasks: async (params?: ListParams) => {
    const response = await api.get('/tasks', { params });
    if (Array.isArray(response.data)) {
      return { data: response.data, total: response.data.length, page: 1, limit: response.data.length };
    }
    return response.data;
  },
  createTask: async (data: Record<string, unknown>) => {
    const response = await api.post('/tasks', data);
    return response.data.data ?? response.data;
  },

  // Appointments
  listAppointments: async (params?: ListParams) => {
    const response = await api.get('/appointments', { params });
    if (Array.isArray(response.data)) {
      return { data: response.data, total: response.data.length, page: 1, limit: response.data.length };
    }
    return response.data;
  },
};
