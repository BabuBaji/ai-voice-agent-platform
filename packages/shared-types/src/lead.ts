export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  CONVERTED = 'CONVERTED',
  LOST = 'LOST',
}

export enum LeadSource {
  INBOUND_CALL = 'INBOUND_CALL',
  OUTBOUND_CALL = 'OUTBOUND_CALL',
  WEB_CHAT = 'WEB_CHAT',
  WHATSAPP = 'WHATSAPP',
  WEB_FORM = 'WEB_FORM',
  MANUAL = 'MANUAL',
  IMPORT = 'IMPORT',
}

export enum DealStatus {
  OPEN = 'OPEN',
  WON = 'WON',
  LOST = 'LOST',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

export interface Lead {
  id: string;
  tenantId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  source: LeadSource;
  status: LeadStatus;
  score: number;
  assignedTo?: string;
  tags: string[];
  customFields: Record<string, unknown>;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  tenantId: string;
  leadId?: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  color: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  pipelineId: string;
  stageId: string;
  leadId?: string;
  contactId?: string;
  title: string;
  value?: number;
  currency: string;
  expectedCloseDate?: string;
  assignedTo?: string;
  status: DealStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  leadId?: string;
  dealId?: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  tenantId: string;
  leadId?: string;
  contactId?: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
  status: AppointmentStatus;
  bookedBy: 'MANUAL' | 'AI_AGENT';
  conversationId?: string;
  createdAt: string;
}
