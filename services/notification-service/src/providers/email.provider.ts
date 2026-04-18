import { config } from '../config';

/**
 * Email notification provider using SendGrid.
 * Stub implementation.
 */

export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  html?: string;
  from?: string;
}

export class EmailProvider {
  // TODO: Initialize SendGrid client
  // private client = sgMail;

  async send(options: EmailOptions): Promise<{ messageId: string; status: string }> {
    console.log('EmailProvider.send', {
      to: options.to,
      subject: options.subject,
      from: options.from || config.sendgrid.fromEmail,
    });

    // TODO: Use SendGrid SDK
    // this.client.setApiKey(config.sendgrid.apiKey);
    // await this.client.send({ ... });

    return {
      messageId: `email-${Date.now()}`,
      status: 'sent',
    };
  }

  async sendBulk(recipients: string[], subject: string, body: string): Promise<{ count: number; status: string }> {
    console.log('EmailProvider.sendBulk', { recipients: recipients.length, subject });
    return { count: recipients.length, status: 'queued' };
  }
}

export const emailProvider = new EmailProvider();
