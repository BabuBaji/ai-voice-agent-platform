import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

export interface SmsOptions {
  to: string;
  body: string;
  from?: string;
}

export class SmsProvider {
  private client: any = null;

  private init(): void {
    if (this.client) return;
    if (config.twilio.accountSid && config.twilio.authToken) {
      try {
        // Dynamic import to avoid crash when twilio is not installed
        const Twilio = require('twilio');
        this.client = Twilio(config.twilio.accountSid, config.twilio.authToken);
        logger.info('Twilio SMS provider initialized');
      } catch (err: any) {
        logger.warn({ error: err.message }, 'Failed to initialize Twilio client');
      }
    }
  }

  async send(options: SmsOptions): Promise<{ messageId: string; status: string }> {
    this.init();

    const from = options.from || config.twilio.fromNumber;

    if (!this.client || !config.twilio.accountSid) {
      // Fallback: log instead of sending
      logger.info(
        { to: options.to, from, bodyLength: options.body.length },
        'SMS (dry-run, no TWILIO credentials configured)'
      );
      return {
        messageId: `sms-dryrun-${Date.now()}`,
        status: 'dry_run',
      };
    }

    try {
      const message = await this.client.messages.create({
        to: options.to,
        from,
        body: options.body,
      });

      logger.info({ to: options.to, sid: message.sid }, 'SMS sent via Twilio');

      return {
        messageId: message.sid,
        status: 'sent',
      };
    } catch (err: any) {
      logger.error({ to: options.to, error: err.message }, 'Twilio SMS send failed');
      throw new Error(`SMS send failed: ${err.message}`);
    }
  }
}

export const smsProvider = new SmsProvider();
