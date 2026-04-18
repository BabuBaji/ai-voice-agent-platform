import axios, { AxiosInstance } from 'axios';
import {
  TelephonyProvider,
  CallOptions,
  CallResult,
  TransferOptions,
  PhoneNumberProvisionOptions,
  ProvisionedNumber,
} from './base.provider';
import { config } from '../config';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export class ExotelProvider implements TelephonyProvider {
  readonly name = 'exotel';
  private client: AxiosInstance | null = null;

  private getClient(): AxiosInstance {
    if (!this.client) {
      if (!config.exotel.apiKey || !config.exotel.apiToken || !config.exotel.subdomain || !config.exotel.accountSid) {
        throw new Error('Exotel credentials not configured. Set EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_SUBDOMAIN, EXOTEL_ACCOUNT_SID.');
      }
      this.client = axios.create({
        baseURL: `https://${config.exotel.subdomain}/v1/Accounts/${config.exotel.accountSid}`,
        auth: {
          username: config.exotel.apiKey,
          password: config.exotel.apiToken,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    }
    return this.client;
  }

  async initiateCall(options: CallOptions): Promise<CallResult> {
    try {
      const client = this.getClient();
      const statusCallbackUrl = options.webhookUrl || `${config.publicBaseUrl}/webhooks/exotel/status`;

      const params = new URLSearchParams();
      params.append('From', options.from);
      params.append('To', options.to);
      params.append('CallerId', options.from);
      params.append('StatusCallback', statusCallbackUrl);

      const response = await client.post('/Calls/connect.json', params.toString());
      const callData = response.data?.Call;

      logger.info({ callSid: callData?.Sid, to: options.to }, 'Exotel call initiated');

      return {
        providerCallId: callData?.Sid || `exotel-${Date.now()}`,
        status: callData?.Status || 'queued',
      };
    } catch (err: any) {
      logger.error({ err: err.message, to: options.to }, 'Failed to initiate Exotel call');
      throw err;
    }
  }

  async endCall(providerCallId: string): Promise<void> {
    try {
      const client = this.getClient();

      const params = new URLSearchParams();
      params.append('Status', 'completed');

      await client.post(`/Calls/${providerCallId}.json`, params.toString());
      logger.info({ callSid: providerCallId }, 'Exotel call ended');
    } catch (err: any) {
      logger.error({ err: err.message, callSid: providerCallId }, 'Failed to end Exotel call');
      throw err;
    }
  }

  async getCallStatus(providerCallId: string): Promise<{ status: string; duration?: number }> {
    try {
      const client = this.getClient();
      const response = await client.get(`/Calls/${providerCallId}.json`);
      const callData = response.data?.Call;

      return {
        status: callData?.Status || 'unknown',
        duration: callData?.Duration ? parseInt(callData.Duration) : undefined,
      };
    } catch (err: any) {
      logger.error({ err: err.message, callSid: providerCallId }, 'Failed to get Exotel call status');
      throw err;
    }
  }

  async transferCall(options: TransferOptions): Promise<void> {
    try {
      const client = this.getClient();

      // Exotel transfer via connect API
      const params = new URLSearchParams();
      params.append('From', options.callId);
      params.append('To', options.transferTo);

      await client.post('/Calls/connect.json', params.toString());
      logger.info({ callSid: options.callId, transferTo: options.transferTo }, 'Exotel call transferred');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to transfer Exotel call');
      throw err;
    }
  }

  async provisionNumber(options: PhoneNumberProvisionOptions): Promise<ProvisionedNumber> {
    // Exotel numbers are provisioned through their dashboard/support
    // This is a placeholder that returns an informative error
    logger.warn('Exotel number provisioning is not available via API');
    throw new Error('Exotel numbers must be provisioned through the Exotel dashboard. Contact Exotel support to add numbers to your account.');
  }

  async releaseNumber(providerNumberId: string): Promise<void> {
    // Exotel numbers are released through their dashboard/support
    logger.warn({ providerNumberId }, 'Exotel number release is not available via API');
    throw new Error('Exotel numbers must be released through the Exotel dashboard.');
  }

  async listAvailableNumbers(country: string, capabilities?: string[]): Promise<ProvisionedNumber[]> {
    // Exotel does not have a public API for listing available numbers
    logger.warn('Exotel available number listing is not available via API');
    return [];
  }
}

export const exotelProvider = new ExotelProvider();
