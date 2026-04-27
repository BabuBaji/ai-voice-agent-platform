export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://voiceagent:voiceagent_dev@localhost:5672',

  databaseUrl: process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/notification_db',

  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY || '',
    fromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
  },

  // Plain SMTP (Gmail, Office365, Mailgun-SMTP, AWS-SES-SMTP, any provider).
  // If SMTP_HOST + SMTP_USER + SMTP_PASS are set, the email provider prefers
  // SMTP over SendGrid. Gmail-specific note: use an App Password, not your
  // account password (https://myaccount.google.com/apppasswords).
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',         // true for 465, false for STARTTLS on 587
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com',
    fromName: process.env.SMTP_FROM_NAME || 'VoiceAgent AI',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
  },

  whatsapp: {
    apiUrl: process.env.WHATSAPP_API_URL || '',
    apiToken: process.env.WHATSAPP_API_TOKEN || '',
  },

  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  },
};
