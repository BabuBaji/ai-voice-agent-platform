export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'agent';
  avatar?: string;
  tenantId: string;
  // True for platform-level (super-admin) users. Drives the /super-admin/*
  // route gate and the post-login redirect target.
  isPlatformAdmin?: boolean;
  // Set while a super-admin is impersonating a tenant. Holds enough state to
  // restore the platform session via the "Return to admin" button.
  impersonating?: {
    originalAccessToken: string;
    originalRefreshToken: string;
    originalUser: Omit<User, 'impersonating'>;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'draft';
  greeting: string;
  systemPrompt: string;
  voiceProvider: string;
  voiceId: string;
  voiceSpeed: number;
  language: string;
  tools: string[];
  knowledgeBases: string[];
  totalCalls: number;
  avgDuration: number;
  successRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface Call {
  id: string;
  caller: string;
  callerPhone: string;
  agentId: string;
  agentName: string;
  duration: number;
  outcome: 'completed' | 'transferred' | 'voicemail' | 'dropped' | 'no-answer';
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
  recordingUrl?: string;
  transcript: TranscriptMessage[];
  leadId?: string;
  createdAt: string;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost';
  source: 'inbound-call' | 'website' | 'referral' | 'outbound' | 'campaign';
  score: number;
  value: number;
  assignedTo?: string;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  lastContactedAt?: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  stage: string;
  leadId: string;
  leadName: string;
  probability: number;
  expectedCloseDate: string;
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  deals: Deal[];
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  status: 'ready' | 'processing' | 'error';
  documents: KBDocument[];
  createdAt: string;
}

export interface KBDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'processed' | 'processing' | 'failed';
  uploadedAt: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  trigger: string;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  lastRun?: string;
  runCount: number;
  createdAt: string;
}

export interface WorkflowCondition {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than';
  value: string;
}

export interface WorkflowAction {
  type: 'send_email' | 'create_lead' | 'assign_agent' | 'webhook' | 'update_field';
  config: Record<string, string>;
}

export interface PhoneNumber {
  id: string;
  number: string;
  provider: 'twilio' | 'exotel' | 'vonage';
  agentId?: string;
  agentName?: string;
  status: 'active' | 'inactive';
  country: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'agent';
  status: 'active' | 'invited' | 'disabled';
  lastActive?: string;
  joinedAt: string;
}

export interface Integration {
  id: string;
  name: string;
  provider: string;
  icon: string;
  description: string;
  connected: boolean;
  category: 'telephony' | 'crm' | 'email' | 'analytics' | 'storage';
}

export interface BillingPlan {
  name: string;
  price: number;
  interval: 'monthly' | 'yearly';
  features: string[];
  limits: {
    calls: number;
    agents: number;
    knowledgeBases: number;
    teamMembers: number;
  };
}

export interface UsageMetrics {
  callsUsed: number;
  callsLimit: number;
  agentsUsed: number;
  agentsLimit: number;
  storageUsed: number;
  storageLimit: number;
  minutesUsed: number;
  minutesLimit: number;
}
