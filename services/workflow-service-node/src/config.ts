export const config = {
  port: parseInt(process.env.PORT || process.env.WORKFLOW_PORT || '8082', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/workflow_db',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://voiceagent:voiceagent_dev@localhost:5672',
  notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  crmServiceUrl: process.env.CRM_SERVICE_URL || 'http://localhost:8081',
};
