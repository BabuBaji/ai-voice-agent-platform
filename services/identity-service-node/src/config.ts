export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/identity',
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    accessExpiration: process.env.JWT_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
} as const;
