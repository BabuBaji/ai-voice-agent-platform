import { create } from 'zustand';
import type { Call } from '@/types';

interface CallState {
  activeCalls: Call[];
  callHistory: Call[];
  setActiveCalls: (calls: Call[]) => void;
  setCallHistory: (calls: Call[]) => void;
  addActiveCall: (call: Call) => void;
  removeActiveCall: (callId: string) => void;
}

export const useCallStore = create<CallState>((set) => ({
  activeCalls: [],
  callHistory: [],
  setActiveCalls: (calls) => set({ activeCalls: calls }),
  setCallHistory: (calls) => set({ callHistory: calls }),
  addActiveCall: (call) =>
    set((state) => ({ activeCalls: [...state.activeCalls, call] })),
  removeActiveCall: (callId) =>
    set((state) => ({
      activeCalls: state.activeCalls.filter((c) => c.id !== callId),
    })),
}));
