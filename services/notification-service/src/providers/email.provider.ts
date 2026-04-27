import sgMail from '@sendgrid/mail';
import nodemailer, { type Transporter } from 'nodemailer';
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

// Backend selection — checked once on first send and cached. Order:
//   1. SMTP — preferred when SMTP_HOST + USER + PASS are set (works with
//      Gmail App Passwords, Office365, Mailgun-SMTP, AWS-SES-SMTP, etc.)
//   2. SendGrid — used if SENDGRID_API_KEY is set
//   3. Dry-run — logs the email without sending. Lets dev signups complete
//      and the OTP is still visible in identity-service log.
type Backend = 'smtp' | 'sendgrid' | 'dryrun';

export class EmailProvider {
  private backend: Backend | null = null;
  private smtp: Transporter | null = null;

  private init(): Backend {
    if (this.backend) return this.backend;

    if (config.smtp.host && config.smtp.user && config.smtp.pass) {
      this.smtp = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      });
      this.backend = 'smtp';
      logger.info({ host: config.smtp.host, port: config.smtp.port, user: config.smtp.user },
        'SMTP email provider initialized');
      return 'smtp';
    }

    if (config.sendgrid.apiKey) {
      sgMail.setApiKey(config.sendgrid.apiKey);
      this.backend = 'sendgrid';
      logger.info('SendGrid email provider initialized');
      return 'sendgrid';
    }

    this.backend = 'dryrun';
    logger.warn('No email provider configured (set SMTP_HOST or SENDGRID_API_KEY) — running in dry-run mode');
    return 'dryrun';
  }

  async send(options: EmailOptions): Promise<{ messageId: string; status: string; backend: string }> {
    const backend = this.init();

    if (backend === 'dryrun') {
      logger.info({ to: options.to, subject: options.subject }, 'EMAIL (dry-run, no provider configured)');
      return { messageId: `dryrun-${Date.now()}`, status: 'dry_run', backend: 'dryrun' };
    }

    if (backend === 'smtp') {
      const fromEmail = options.from || config.smtp.fromEmail;
      const from = config.smtp.fromName ? `"${config.smtp.fromName}" <${fromEmail}>` : fromEmail;
      try {
        const info = await this.smtp!.sendMail({
          from,
          to: options.to,
          subject: options.subject,
          text: options.body,
          html: options.html || options.body.replace(/\n/g, '<br/>'),
        });
        logger.info({ to: options.to, subject: options.subject, messageId: info.messageId },
          'Email sent via SMTP');
        return { messageId: info.messageId, status: 'sent', backend: 'smtp' };
      } catch (err: any) {
        logger.error({ to: options.to, error: err.message }, 'SMTP send failed');
        throw new Error(`SMTP send failed: ${err.message}`);
      }
    }

    // SendGrid
    const from = options.from || config.sendgrid.fromEmail;
    try {
      const [response] = await sgMail.send({
        to: options.to, from, subject: options.subject,
        text: options.body, html: options.html || options.body,
      });
      const messageId = response.headers['x-message-id'] || `sg-${Date.now()}`;
      logger.info({ to: options.to, subject: options.subject, messageId },
        'Email sent via SendGrid');
      return { messageId: String(messageId), status: 'sent', backend: 'sendgrid' };
    } catch (err: any) {
      logger.error({ to: options.to, error: err.message }, 'SendGrid send failed');
      throw new Error(`Email send failed: ${err.message}`);
    }
  }

  async sendBulk(
    recipients: string[],
    subject: string,
    body: string,
    html?: string,
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
    return { count: sent, status: errors.length === 0 ? 'sent' : 'partial', errors };
  }

  // Diagnostic: returns which backend is currently active so /health or
  // an admin endpoint can surface it. No-op if already initialized.
  activeBackend(): Backend {
    return this.init();
  }
}

export const emailProvider = new EmailProvider();
