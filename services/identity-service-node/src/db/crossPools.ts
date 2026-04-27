import { Pool } from 'pg';
import { config } from '../config';

// Read-only pools the super-admin module uses to aggregate data from sibling
// services' databases without spinning up a separate microservice. Kept in a
// dedicated module so the rest of identity-service is unaffected if these
// pools fail to connect (e.g. agent-service DB is down) — only super-admin
// queries throw, the tenant-facing surface keeps working.

let _agentPool: Pool | null = null;
let _conversationPool: Pool | null = null;
let _workflowPool: Pool | null = null;
let _knowledgePool: Pool | null = null;

export function agentPool(): Pool {
  if (!_agentPool) _agentPool = new Pool({ connectionString: config.agentDbUrl, max: 4 });
  return _agentPool;
}

export function conversationPool(): Pool {
  if (!_conversationPool) _conversationPool = new Pool({ connectionString: config.conversationDbUrl, max: 4 });
  return _conversationPool;
}

export function workflowPool(): Pool {
  if (!_workflowPool) _workflowPool = new Pool({ connectionString: config.workflowDbUrl, max: 2 });
  return _workflowPool;
}

export function knowledgePool(): Pool {
  if (!_knowledgePool) _knowledgePool = new Pool({ connectionString: config.knowledgeDbUrl, max: 2 });
  return _knowledgePool;
}

export async function closeCrossPools(): Promise<void> {
  if (_agentPool) await _agentPool.end();
  if (_conversationPool) await _conversationPool.end();
  if (_workflowPool) await _workflowPool.end();
  if (_knowledgePool) await _knowledgePool.end();
  _agentPool = null;
  _conversationPool = null;
  _workflowPool = null;
  _knowledgePool = null;
}
