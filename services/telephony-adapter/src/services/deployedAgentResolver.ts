import type { Pool } from 'pg';

/**
 * Resolve the agent config that should drive a live call.
 *
 *  1. Look for an ACTIVE deployed_agent_configs snapshot for the given number.
 *     If present, return the snapshot — frozen at deploy time, so in-progress
 *     edits in Agent Builder never leak into a running deployment.
 *  2. Fall back to fetching the live agent from agent-service. This preserves
 *     the existing behaviour for numbers that haven't gone through the new
 *     deploy flow yet ("don't disturb existing code" guarantee).
 *
 * Both paths return the same shape (same fields the call loop reads:
 * system_prompt, voice_config, llm_provider, llm_model, greeting_message,
 * call_config, post_call_config, status, name).
 */
export async function resolveDeployedAgent(
  pool: Pool,
  opts: { agentId: string; tenantId: string; numberId?: string | null },
): Promise<any | null> {
  const snapshot = await loadActiveSnapshot(pool, opts);
  if (snapshot) return snapshot;
  return loadLiveAgent(opts.agentId, opts.tenantId);
}

/** Snapshot lookup. Prefers the snapshot pinned to this number_id; falls back
 *  to any active snapshot for this agent in this tenant (covers reassignment
 *  edge cases where the number row was rebound but the deploy snapshot still
 *  represents the desired live config). */
async function loadActiveSnapshot(
  pool: Pool,
  opts: { agentId: string; tenantId: string; numberId?: string | null },
): Promise<any | null> {
  try {
    if (opts.numberId) {
      const r = await pool.query(
        `SELECT snapshot FROM deployed_agent_configs
          WHERE tenant_id = $1 AND number_id = $2 AND agent_id = $3 AND is_active = TRUE
          ORDER BY deployed_at DESC LIMIT 1`,
        [opts.tenantId, opts.numberId, opts.agentId],
      );
      if (r.rows.length > 0) return shapeSnapshot(r.rows[0].snapshot);
    }
    const r2 = await pool.query(
      `SELECT snapshot FROM deployed_agent_configs
        WHERE tenant_id = $1 AND agent_id = $2 AND is_active = TRUE
        ORDER BY deployed_at DESC LIMIT 1`,
      [opts.tenantId, opts.agentId],
    );
    if (r2.rows.length > 0) return shapeSnapshot(r2.rows[0].snapshot);
    return null;
  } catch {
    return null;
  }
}

function shapeSnapshot(snap: any): any {
  if (!snap || typeof snap !== 'object') return null;
  // Flag so downstream code can know it came from a snapshot if it cares.
  return { ...snap, _source: 'deployed_snapshot', status: 'PUBLISHED' };
}

async function loadLiveAgent(agentId: string, tenantId: string): Promise<any | null> {
  try {
    const raw = process.env.AGENT_SERVICE_URL || 'http://localhost:3001/api/v1';
    const base = raw.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    const url = `${base}/api/v1/agents/${agentId}`;
    const resp = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return data?.data ?? data;
  } catch {
    return null;
  }
}

/**
 * Fetch the live agent from agent-service. Used by the deploy endpoint to
 * grab the current config before snapshotting it.
 */
export async function fetchLiveAgent(agentId: string, tenantId: string): Promise<any | null> {
  return loadLiveAgent(agentId, tenantId);
}

/**
 * Pick the fields we want frozen into a deployment. Whitelisted so we don't
 * accidentally snapshot transient internal fields, and so the snapshot stays
 * compact in JSONB.
 */
export function buildAgentSnapshot(agent: any): Record<string, any> {
  if (!agent) return {};
  return {
    id: agent.id,
    tenant_id: agent.tenant_id,
    name: agent.name,
    description: agent.description,
    direction: agent.direction,
    system_prompt: agent.system_prompt,
    greeting_message: agent.greeting_message,
    welcome_dynamic: agent.welcome_dynamic,
    welcome_interruptible: agent.welcome_interruptible,
    llm_provider: agent.llm_provider,
    llm_model: agent.llm_model,
    temperature: agent.temperature,
    max_tokens: agent.max_tokens,
    tools_config: agent.tools_config,
    knowledge_base_ids: agent.knowledge_base_ids,
    voice_config: agent.voice_config,
    stt_config: agent.stt_config,
    post_call_config: agent.post_call_config,
    integrations_config: agent.integrations_config,
    call_config: agent.call_config,
    metadata: agent.metadata,
  };
}
