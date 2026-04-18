export enum AgentStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum LLMProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
}

export enum TTSProvider {
  ELEVENLABS = 'elevenlabs',
  GOOGLE = 'google',
  AZURE = 'azure',
}

export enum STTProvider {
  DEEPGRAM = 'deepgram',
  WHISPER = 'whisper',
}

export interface VoiceConfig {
  ttsProvider: TTSProvider;
  voiceId: string;
  speed: number;
  language: string;
  sttProvider: STTProvider;
}

export interface ToolConfig {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: AgentStatus;
  systemPrompt: string;
  llmProvider: LLMProvider;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  toolsConfig: ToolConfig[];
  knowledgeBaseIds: string[];
  greetingMessage?: string;
  voiceConfig: VoiceConfig;
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  systemPrompt: string;
  llmProvider?: LLMProvider;
  llmModel?: string;
  temperature?: number;
  maxTokens?: number;
  greetingMessage?: string;
  voiceConfig?: Partial<VoiceConfig>;
}
