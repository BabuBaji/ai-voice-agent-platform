export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://voiceagent:voiceagent_dev@localhost:5432/identity_db',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    accessExpiration: process.env.JWT_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
} as const;
