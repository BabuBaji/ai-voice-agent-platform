import { config } from '../config';

/**
 * SMS notification provider using Twilio.
 * Stub implementation.
 */

export interface SmsOptions {
  to: string;
  body: string;
  from?: string;
}

export class SmsProvider {
  async send(options: SmsOptions): Promise<{ messageId: string; status: string }> {
    console.log('SmsProvider.send', {
      to: options.to,
      from: options.from || config.twilio.fromNumber,
    });

    // TODO: Use Twilio SDK
    // const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    // await client.messages.create({ ... });

    return {
      messageId: `sms-${Date.now()}`,
      status: 'sent',
    };
  }
}

export const smsProvider = new SmsProvider();
