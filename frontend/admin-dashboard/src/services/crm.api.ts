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

export const crmApi = {
  // Leads
  listLeads: async (params?: ListParams): Promise<PaginatedResponse<Lead>> => {
    const response = await api.get('/leads', { params });
    // Normalize: support both { data, total } and plain array responses
    if (Array.isArray(response.data)) {
      return { data: response.data, total: response.data.length, page: 1, limit: response.data.length };
    }
    return response.data;
  },
  getLead: async (id: string): Promise<Lead> => {
    const response = await api.get(`/leads/${id}`);
    return response.data.data ?? response.data;
  },
  createLead: async (data: Partial<Lead>): Promise<Lead> => {
    const response = await api.post('/leads', data);
    return response.data.data ?? response.data;
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
