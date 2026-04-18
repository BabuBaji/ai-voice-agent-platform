import { create } from 'zustand';
import type { Agent } from '@/types';

interface AgentState {
  agents: Agent[];
  selectedAgent: Agent | null;
  filters: {
    status: string;
    search: string;
  };
  setAgents: (agents: Agent[]) => void;
  setSelectedAgent: (agent: Agent | null) => void;
  setFilters: (filters: Partial<AgentState['filters']>) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedAgent: null,
  filters: {
    status: 'all',
    search: '',
  },
  setAgents: (agents) => set({ agents }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),
}));
