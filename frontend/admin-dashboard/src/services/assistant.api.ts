import api from './api';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantChatResponse {
  reply: string;
  provider: string;
  mock: boolean;
  context_summary: {
    agents: number;
    wallet_balance: number | null;
    calls_today: number;
    failed_today: number;
  };
}

export const assistantApi = {
  chat: async (messages: AssistantMessage[]): Promise<AssistantChatResponse> => {
    const r = await api.post('/assistant/chat', { messages });
    return r.data;
  },
};
