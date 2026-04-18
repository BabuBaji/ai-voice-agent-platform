import Twilio from 'twilio';
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

export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  private client: Twilio.Twilio | null = null;

  private getClient(): Twilio.Twilio {
    if (!this.client) {
      if (!config.twilio.accountSid || !config.twilio.authToken) {
        throw new Error('Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
      }
      this.client = Twilio(config.twilio.accountSid, config.twilio.authToken);
    }
    return this.client;
  }

  async initiateCall(options: CallOptions): Promise<CallResult> {
    try {
      const client = this.getClient();
      const statusCallbackUrl = options.webhookUrl || `${config.publicBaseUrl}/webhooks/twilio/status`;

      const call = await client.calls.create({
        from: options.from,
        to: options.to,
        url: `${config.publicBaseUrl}/webhooks/twilio/voice`,
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });

      logger.info({ callSid: call.sid, to: options.to }, 'Twilio call initiated');

      return {
        providerCallId: call.sid,
        status: call.status || 'queued',
      };
    } catch (err: any) {
      logger.error({ err: err.message, to: options.to }, 'Failed to initiate Twilio call');
      throw err;
    }
  }

  async endCall(providerCallId: string): Promise<void> {
    try {
      const client = this.getClient();
      await client.calls(providerCallId).update({ status: 'completed' });
      logger.info({ callSid: providerCallId }, 'Twilio call ended');
    } catch (err: any) {
      logger.error({ err: err.message, callSid: providerCallId }, 'Failed to end Twilio call');
      throw err;
    }
  }

  async getCallStatus(providerCallId: string): Promise<{ status: string; duration?: number }> {
    try {
      const client = this.getClient();
      const call = await client.calls(providerCallId).fetch();
      return {
        status: call.status,
        duration: call.duration ? parseInt(call.duration) : undefined,
      };
    } catch (err: any) {
      logger.error({ err: err.message, callSid: providerCallId }, 'Failed to get Twilio call status');
      throw err;
    }
  }

  async transferCall(options: TransferOptions): Promise<void> {
    try {
      const client = this.getClient();

      // Update the call with new TwiML to dial the transfer number
      const twiml = options.transferType === 'warm'
        ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while we transfer you.</Say>
  <Dial>${options.transferTo}</Dial>
</Response>`
        : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>${options.transferTo}</Dial>
</Response>`;

      await client.calls(options.callId).update({ twiml });
      logger.info({ callSid: options.callId, transferTo: options.transferTo }, 'Twilio call transferred');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to transfer Twilio call');
      throw err;
    }
  }

  async provisionNumber(options: PhoneNumberProvisionOptions): Promise<ProvisionedNumber> {
    try {
      const client = this.getClient();

      // Search for available numbers
      const searchParams: any = {
        voiceEnabled: options.capabilities.includes('voice'),
        smsEnabled: options.capabilities.includes('sms'),
        limit: 1,
      };
      if (options.areaCode) {
        searchParams.areaCode = options.areaCode;
      }

      const availableNumbers = await client
        .availablePhoneNumbers(options.country)
        .local.list(searchParams);

      if (availableNumbers.length === 0) {
        throw new Error(`No available phone numbers found for country ${options.country}`);
      }

      const numberToBuy = availableNumbers[0];

      // Purchase the number
      const purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: numberToBuy.phoneNumber,
        voiceUrl: `${config.publicBaseUrl}/webhooks/twilio/voice`,
        statusCallback: `${config.publicBaseUrl}/webhooks/twilio/status`,
        voiceMethod: 'POST',
        statusCallbackMethod: 'POST',
      });

      logger.info({ sid: purchased.sid, number: purchased.phoneNumber }, 'Twilio number provisioned');

      return {
        providerNumberId: purchased.sid,
        number: purchased.phoneNumber,
        capabilities: options.capabilities,
      };
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to provision Twilio number');
      throw err;
    }
  }

  async releaseNumber(providerNumberId: string): Promise<void> {
    try {
      const client = this.getClient();
      await client.incomingPhoneNumbers(providerNumberId).remove();
      logger.info({ sid: providerNumberId }, 'Twilio number released');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to release Twilio number');
      throw err;
    }
  }

  async listAvailableNumbers(country: string, capabilities?: string[]): Promise<ProvisionedNumber[]> {
    try {
      const client = this.getClient();
      const searchParams: any = { limit: 20 };
      if (capabilities?.includes('voice')) searchParams.voiceEnabled = true;
      if (capabilities?.includes('sms')) searchParams.smsEnabled = true;

      const numbers = await client.availablePhoneNumbers(country).local.list(searchParams);

      return numbers.map((n) => ({
        providerNumberId: '',
        number: n.phoneNumber,
        capabilities: [
          ...(n.capabilities.voice ? ['voice'] : []),
          ...(n.capabilities.sms ? ['sms'] : []),
        ],
      }));
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to list available Twilio numbers');
      throw err;
    }
  }

  /**
   * Generate TwiML XML to connect a Twilio call to a Media Stream WebSocket.
   */
  generateTwiML(websocketUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrl}">
      <Parameter name="codec" value="audio/x-mulaw" />
    </Stream>
  </Connect>
</Response>`;
  }

  /**
   * Verify that a webhook request is genuinely from Twilio.
   */
  verifyWebhookSignature(url: string, params: Record<string, string>, signature: string): boolean {
    if (!config.twilio.authToken) return false;
    const twilio = require('twilio');
    return twilio.validateRequest(config.twilio.authToken, signature, url, params);
  }
}

export const twilioProvider = new TwilioProvider();
