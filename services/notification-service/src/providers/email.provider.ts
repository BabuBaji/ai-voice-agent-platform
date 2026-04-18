import sgMail from '@sendgrid/mail';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  html?: string;
  from?: string;
}

export class EmailProvider {
  private initialized = false;

  private init(): void {
    if (this.initialized) return;
    if (config.sendgrid.apiKey) {
      sgMail.setApiKey(config.sendgrid.apiKey);
      this.initialized = true;
      logger.info('SendGrid email provider initialized');
    }
  }

  async send(options: EmailOptions): Promise<{ messageId: string; status: string }> {
    this.init();

    const from = options.from || config.sendgrid.fromEmail;

    if (!config.sendgrid.apiKey) {
      // Fallback: log instead of sending when no API key is configured
      logger.info(
        { to: options.to, subject: options.subject, from },
        'EMAIL (dry-run, no SENDGRID_API_KEY configured)'
      );
      return {
        messageId: `email-dryrun-${Date.now()}`,
        status: 'dry_run',
      };
    }

    try {
      const [response] = await sgMail.send({
        to: options.to,
        from,
        subject: options.subject,
        text: options.body,
        html: options.html || options.body,
      });

      const messageId = response.headers['x-message-id'] || `sg-${Date.now()}`;
      logger.info({ to: options.to, subject: options.subject, messageId }, 'Email sent via SendGrid');

      return {
        messageId: String(messageId),
        status: 'sent',
      };
    } catch (err: any) {
      logger.error({ to: options.to, error: err.message }, 'SendGrid email send failed');
      throw new Error(`Email send failed: ${err.message}`);
    }
  }

  async sendBulk(
    recipients: string[],
    subject: string,
    body: string,
    html?: string
  ): Promise<{ count: number; status: string; errors: string[] }> {
    const errors: string[] = [];
    let sent = 0;

    for (const recipient of recipients) {
      try {
        await this.send({ to: recipient, subject, body, html });
        sent++;
      } catch (err: any) {
        errors.push(`${recipient}: ${err.message}`);
      }
    }

    return {
      count: sent,
      status: errors.length === 0 ? 'sent' : 'partial',
      errors,
    };
  }
}

export const emailProvider = new EmailProvider();
