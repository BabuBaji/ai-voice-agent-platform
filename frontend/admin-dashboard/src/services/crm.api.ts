import api from './api';
import type { Lead, Contact, Deal } from '@/types';

export const crmApi = {
  // Leads
  listLeads: async (): Promise<Lead[]> => {
    const response = await api.get('/crm/leads');
    return response.data;
  },
  getLead: async (id: string): Promise<Lead> => {
    const response = await api.get(`/crm/leads/${id}`);
    return response.data;
  },
  createLead: async (data: Partial<Lead>): Promise<Lead> => {
    const response = await api.post('/crm/leads', data);
    return response.data;
  },
  updateLead: async (id: string, data: Partial<Lead>): Promise<Lead> => {
    const response = await api.put(`/crm/leads/${id}`, data);
    return response.data;
  },
  deleteLead: async (id: string): Promise<void> => {
    await api.delete(`/crm/leads/${id}`);
  },

  // Contacts
  listContacts: async (): Promise<Contact[]> => {
    const response = await api.get('/crm/contacts');
    return response.data;
  },
  createContact: async (data: Partial<Contact>): Promise<Contact> => {
    const response = await api.post('/crm/contacts', data);
    return response.data;
  },
  updateContact: async (id: string, data: Partial<Contact>): Promise<Contact> => {
    const response = await api.put(`/crm/contacts/${id}`, data);
    return response.data;
  },

  // Pipeline & Deals
  listDeals: async (): Promise<Deal[]> => {
    const response = await api.get('/crm/deals');
    return response.data;
  },
  createDeal: async (data: Partial<Deal>): Promise<Deal> => {
    const response = await api.post('/crm/deals', data);
    return response.data;
  },
  updateDeal: async (id: string, data: Partial<Deal>): Promise<Deal> => {
    const response = await api.put(`/crm/deals/${id}`, data);
    return response.data;
  },
  moveDeal: async (id: string, stage: string): Promise<Deal> => {
    const response = await api.patch(`/crm/deals/${id}/stage`, { stage });
    return response.data;
  },
};
