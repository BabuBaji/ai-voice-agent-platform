import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '@/services/crm.api';
import type { Lead, Contact, Deal } from '@/types';

export function useLeads() {
  const queryClient = useQueryClient();

  const leadsQuery = useQuery({
    queryKey: ['leads'],
    queryFn: crmApi.listLeads,
    placeholderData: [],
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

  return {
    leads: leadsQuery.data || [],
    isLoading: leadsQuery.isLoading,
    createLead: createMutation.mutate,
    updateLead: updateMutation.mutate,
  };
}

export function useContacts() {
  const queryClient = useQueryClient();

  const contactsQuery = useQuery({
    queryKey: ['contacts'],
    queryFn: crmApi.listContacts,
    placeholderData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Contact>) => crmApi.createContact(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });

  return {
    contacts: contactsQuery.data || [],
    isLoading: contactsQuery.isLoading,
    createContact: createMutation.mutate,
  };
}

export function useDeals() {
  const queryClient = useQueryClient();

  const dealsQuery = useQuery({
    queryKey: ['deals'],
    queryFn: crmApi.listDeals,
    placeholderData: [],
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      crmApi.moveDeal(id, stage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals'] }),
  });

  return {
    deals: dealsQuery.data || [],
    isLoading: dealsQuery.isLoading,
    moveDeal: moveMutation.mutate,
  };
}
