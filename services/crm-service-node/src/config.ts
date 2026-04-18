export const config = {
  port: parseInt(process.env.PORT || process.env.CRM_PORT || '8081', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db',
  logLevel: process.env.LOG_LEVEL || 'info',
};
