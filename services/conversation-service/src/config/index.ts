export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://voiceagent:voiceagent_dev@localhost:5672',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  wsPort: parseInt(process.env.WS_PORT || '3013', 10),
  sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10),
  aiRuntimeUrl: process.env.AI_RUNTIME_URL || 'http://localhost:8000',
  recordingsDir: process.env.RECORDINGS_DIR || 'data/recordings',
  // Where telephony-adapter writes phone-call WAVs. Filename is the Plivo callSid,
  // which we parse from `conversations.recording_url` basename. Lets us serve the
  // local file without depending on the public ngrok tunnel being up.
  telephonyRecordingsDir: process.env.TELEPHONY_RECORDINGS_DIR || '../telephony-adapter/logs/recordings',
  identityServiceUrl: process.env.IDENTITY_SERVICE_URL || 'http://localhost:8080',
  billingInternalToken: process.env.BILLING_INTERNAL_TOKEN || 'dev-billing-internal-token',
};
