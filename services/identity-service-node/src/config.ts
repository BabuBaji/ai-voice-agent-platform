export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://voiceagent:voiceagent_dev@localhost:5432/identity_db',
  // Read-only cross-DB pools used by the super-admin module to aggregate data
  // across the platform without spinning up a separate microservice.
  agentDbUrl:
    process.env.AGENT_DB_URL ||
    'postgresql://voiceagent:voiceagent_dev@localhost:5432/agent_db',
  conversationDbUrl:
    process.env.CONVERSATION_DB_URL ||
    'postgresql://voiceagent:voiceagent_dev@localhost:5432/conversation_db',
  workflowDbUrl:
    process.env.WORKFLOW_DB_URL ||
    'postgresql://voiceagent:voiceagent_dev@localhost:5432/workflow_db',
  knowledgeDbUrl:
    process.env.KNOWLEDGE_DB_URL ||
    'postgresql://voiceagent:voiceagent_dev@localhost:5432/knowledge_db',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    accessExpiration: process.env.JWT_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
} as const;
