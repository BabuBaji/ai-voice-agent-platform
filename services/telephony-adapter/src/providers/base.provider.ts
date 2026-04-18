/**
 * Base telephony provider interface.
 * All telephony providers (Twilio, Exotel, etc.) must implement this interface.
 */

export interface CallOptions {
  from: string;
  to: string;
  agentId: string;
  tenantId: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CallResult {
  providerCallId: string;
  status: string;
}

export interface TransferOptions {
  callId: string;
  transferTo: string;
  transferType: 'warm' | 'cold';
}

export interface PhoneNumberProvisionOptions {
  country: string;
  capabilities: ('voice' | 'sms')[];
  areaCode?: string;
}

export interface ProvisionedNumber {
  providerNumberId: string;
  number: string;
  capabilities: string[];
}

export interface TelephonyProvider {
  readonly name: string;

  initiateCall(options: CallOptions): Promise<CallResult>;
  endCall(providerCallId: string): Promise<void>;
  getCallStatus(providerCallId: string): Promise<{ status: string; duration?: number }>;
  transferCall(options: TransferOptions): Promise<void>;

  provisionNumber(options: PhoneNumberProvisionOptions): Promise<ProvisionedNumber>;
  releaseNumber(providerNumberId: string): Promise<void>;
  listAvailableNumbers(country: string, capabilities?: string[]): Promise<ProvisionedNumber[]>;
}
