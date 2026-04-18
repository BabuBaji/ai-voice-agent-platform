export enum CallDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum CallStatus {
  RINGING = 'RINGING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  NO_ANSWER = 'NO_ANSWER',
  BUSY = 'BUSY',
}

export enum CallOutcome {
  BOOKED_APPOINTMENT = 'BOOKED_APPOINTMENT',
  QUALIFIED_LEAD = 'QUALIFIED_LEAD',
  TRANSFERRED_TO_HUMAN = 'TRANSFERRED_TO_HUMAN',
  INFORMATION_PROVIDED = 'INFORMATION_PROVIDED',
  VOICEMAIL = 'VOICEMAIL',
  HUNG_UP = 'HUNG_UP',
  CALLBACK_REQUESTED = 'CALLBACK_REQUESTED',
  NOT_INTERESTED = 'NOT_INTERESTED',
  UNKNOWN = 'UNKNOWN',
}

export enum TelephonyProvider {
  TWILIO = 'twilio',
  EXOTEL = 'exotel',
}

export interface Call {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  direction: CallDirection;
  status: CallStatus;
  outcome?: CallOutcome;
  callerNumber: string;
  calledNumber: string;
  provider: TelephonyProvider;
  providerCallSid: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  metadata: Record<string, unknown>;
}

export interface InitiateCallRequest {
  agentId: string;
  toNumber: string;
  fromNumber: string;
}

export interface PhoneNumber {
  id: string;
  tenantId: string;
  agentId?: string;
  phoneNumber: string;
  provider: TelephonyProvider;
  providerSid: string;
  isActive: boolean;
  createdAt: string;
}
