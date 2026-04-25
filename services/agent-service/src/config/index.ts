export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/agent_db',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://voiceagent:voiceagent_dev@localhost:5672',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
};
