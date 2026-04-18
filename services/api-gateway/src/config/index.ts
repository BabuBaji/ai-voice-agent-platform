export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',

  // Downstream service URLs
  services: {
    identity: process.env.IDENTITY_SERVICE_URL || 'http://localhost:8080',
    agent: process.env.AGENT_SERVICE_URL || 'http://localhost:3001',
    telephony: process.env.TELEPHONY_SERVICE_URL || 'http://localhost:3002',
    conversation: process.env.CONVERSATION_SERVICE_URL || 'http://localhost:3003',
    crm: process.env.CRM_SERVICE_URL || 'http://localhost:8081',
    knowledge: process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:8003',
    workflow: process.env.WORKFLOW_SERVICE_URL || 'http://localhost:8082',
    analytics: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:8002',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
    aiRuntime: process.env.AI_RUNTIME_SERVICE_URL || 'http://localhost:8000',
  },

  rateLimit: {
    points: parseInt(process.env.RATE_LIMIT_POINTS || '100', 10),
    duration: parseInt(process.env.RATE_LIMIT_DURATION || '60', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
};
