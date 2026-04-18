import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentApi } from '@/services/agent.api';
import type { Agent } from '@/types';

export function useAgents() {
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: agentApi.list,
    placeholderData: [],
  });

  const agentQuery = (id: string) =>
    useQuery({
      queryKey: ['agents', id],
      queryFn: () => agentApi.get(id),
      enabled: !!id,
    });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Agent>) => agentApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agent> }) =>
      agentApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  return {
    agents: agentsQuery.data || [],
    isLoading: agentsQuery.isLoading,
    agentQuery,
    createAgent: createMutation.mutate,
    updateAgent: updateMutation.mutate,
    deleteAgent: deleteMutation.mutate,
  };
}
