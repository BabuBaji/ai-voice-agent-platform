export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/va_conversations',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  wsPort: parseInt(process.env.WS_PORT || '3013', 10),
  sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10),
};
