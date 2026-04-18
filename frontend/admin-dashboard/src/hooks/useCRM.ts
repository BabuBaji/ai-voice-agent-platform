import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '@/services/crm.api';
import type { Lead, Contact, Deal } from '@/types';

export function useLeads(params?: { page?: number; limit?: number; status?: string; source?: string; search?: string }) {
  const queryClient = useQueryClient();

  const leadsQuery = useQuery({
    queryKey: ['leads', params],
    queryFn: () => crmApi.listLeads(params),
    placeholderData: { data: [], total: 0, page: 1, limit: 20 },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Lead>) => crmApi.createLead(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Lead> }) =>
      crmApi.updateLead(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.deleteLead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  return {
    leads: leadsQuery.data?.data || [],
    total: leadsQuery.data?.total || 0,
    isLoading: leadsQuery.isLoading,
    isError: leadsQuery.isError,
    error: leadsQuery.error,
    createLead: createMutation.mutate,
    updateLead: updateMutation.mutate,
    deleteLead: deleteMutation.mutate,
  };
}

export function useContacts(params?: { page?: number; limit?: number; search?: string }) {
  const queryClient = useQueryClient();

  const contactsQuery = useQuery({
    queryKey: ['contacts', params],
    queryFn: () => crmApi.listContacts(params),
    placeholderData: { data: [], total: 0, page: 1, limit: 20 },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Contact>) => crmApi.createContact(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });

  return {
    contacts: contactsQuery.data?.data || [],
    total: contactsQuery.data?.total || 0,
    isLoading: contactsQuery.isLoading,
    createContact: createMutation.mutate,
  };
}

export function useDeals(params?: { page?: number; limit?: number }) {
  const queryClient = useQueryClient();

  const dealsQuery = useQuery({
    queryKey: ['deals', params],
    queryFn: () => crmApi.listDeals(params),
    placeholderData: { data: [], total: 0, page: 1, limit: 20 },
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      crmApi.moveDeal(id, stageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals'] }),
  });

  return {
    deals: dealsQuery.data?.data || [],
    total: dealsQuery.data?.total || 0,
    isLoading: dealsQuery.isLoading,
    moveDeal: moveMutation.mutate,
  };
}
