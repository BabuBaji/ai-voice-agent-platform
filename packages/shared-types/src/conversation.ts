export enum Channel {
  PHONE = 'PHONE',
  WEB_CHAT = 'WEB_CHAT',
  WHATSAPP = 'WHATSAPP',
}

export enum ConversationStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  SYSTEM = 'SYSTEM',
  TOOL = 'TOOL',
}

export enum Sentiment {
  POSITIVE = 'POSITIVE',
  NEUTRAL = 'NEUTRAL',
  NEGATIVE = 'NEGATIVE',
}

export interface Conversation {
  id: string;
  tenantId: string;
  agentId: string;
  channel: Channel;
  status: ConversationStatus;
  callerNumber?: string;
  calledNumber?: string;
  leadId?: string;
  callSid?: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  summary?: string;
  sentiment?: Sentiment;
  outcome?: string;
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  audioUrl?: string;
  toolCalls?: ToolCallData[];
  toolResult?: Record<string, unknown>;
  tokensUsed?: number;
  latencyMs?: number;
  createdAt: string;
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  agentId: string;
  conversationId?: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ChatResponse {
  conversationId: string;
  message: Message;
  toolCalls?: ToolCallData[];
}
