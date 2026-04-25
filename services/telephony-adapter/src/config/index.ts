export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/telephony_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://voiceagent:voiceagent_dev@localhost:5672',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',

  conversationServiceUrl: process.env.CONVERSATION_SERVICE_URL || 'http://localhost:3003',
  voiceServiceUrl: process.env.VOICE_SERVICE_URL || 'http://localhost:3005',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3002',

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    apiKeySid: process.env.TWILIO_API_KEY_SID || '',
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || '',
  },

  exotel: {
    apiKey: process.env.EXOTEL_API_KEY || '',
    apiToken: process.env.EXOTEL_API_TOKEN || '',
    subdomain: process.env.EXOTEL_SUBDOMAIN || '',
    accountSid: process.env.EXOTEL_ACCOUNT_SID || '',
  },

  plivo: {
    authId: process.env.PLIVO_AUTH_ID || '',
    authToken: process.env.PLIVO_AUTH_TOKEN || '',
    phoneNumber: process.env.PLIVO_PHONE_NUMBER || '',
  },

  mediaStreamWsPort: parseInt(process.env.MEDIA_STREAM_WS_PORT || '3012', 10),
};
