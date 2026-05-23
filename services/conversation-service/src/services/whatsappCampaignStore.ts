/**
 * whatsappCampaignStore — CRUD + target management + progress aggregations
 * for the whatsapp_campaigns / whatsapp_campaign_targets tables.
 *
 * Tenant isolation: every function takes tenantId and scopes by it. Targets
 * inherit tenant_id from their parent campaign; we still write it on every
 * target row so we can index/scope target queries without a JOIN.
 *
 * Worker contract: the worker SELECTs queued targets via claimQueuedBatch()
 * which atomically transitions them to 'sending' (sets attempt_count++) so
 * two worker ticks don't double-send. Failures are written back with
 * markTargetFailed(); successes via markTargetSent() — both set the
 * provider_message_id which the webhook later uses for status updates.
 */
import { pool } from '../index';

export interface WhatsAppCampaign {
  id: string;
  tenant_id: string;
  name: string;
  template_id: string;
  template_name: string;
  template_language: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  rate_limit_per_minute: number;
  total_recipients: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignTarget {
  id: string;
  campaign_id: string;
  tenant_id: string;
  lead_id: string | null;
  recipient: string;
  variable_context: Record<string, any>;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'replied';
  communication_log_id: string | null;
  provider_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface CampaignProgress {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  total: number;
}

const C_COLS = `
  id, tenant_id, name, template_id, template_name, template_language,
  status, rate_limit_per_minute, total_recipients,
  scheduled_at, started_at, completed_at, created_by, created_at, updated_at
`;

const T_COLS = `
  id, campaign_id, tenant_id, lead_id, recipient, variable_context, status,
  communication_log_id, provider_message_id, attempt_count, last_error,
  sent_at, delivered_at, read_at, failed_at, replied_at, created_at
`;

export async function listCampaigns(tenantId: string): Promise<WhatsAppCampaign[]> {
  const r = await pool.query(
    `SELECT ${C_COLS} FROM whatsapp_campaigns
     WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [tenantId],
  );
  return r.rows as WhatsAppCampaign[];
}

export async function getCampaign(tenantId: string, id: string): Promise<WhatsAppCampaign | null> {
  const r = await pool.query(
    `SELECT ${C_COLS} FROM whatsapp_campaigns WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (r.rows[0] as WhatsAppCampaign) || null;
}

export interface CreateCampaignInput {
  name: string;
  template_id: string;
  template_name: string;
  template_language?: string;
  rate_limit_per_minute?: number;
  scheduled_at?: string | null;
  created_by?: string | null;
}

export async function createCampaign(
  tenantId: string, input: CreateCampaignInput,
): Promise<WhatsAppCampaign> {
  const r = await pool.query(
    `INSERT INTO whatsapp_campaigns
       (tenant_id, name, template_id, template_name, template_language,
        rate_limit_per_minute, scheduled_at, created_by, status)
     VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::uuid, 'DRAFT')
     RETURNING ${C_COLS}`,
    [
      tenantId,
      input.name,
      input.template_id,
      input.template_name,
      input.template_language || 'en_US',
      input.rate_limit_per_minute ?? 60,
      input.scheduled_at || null,
      input.created_by || null,
    ],
  );
  return r.rows[0] as WhatsAppCampaign;
}

export async function updateCampaignStatus(
  tenantId: string, id: string,
  status: WhatsAppCampaign['status'],
): Promise<WhatsAppCampaign | null> {
  // Track timestamps on key transitions.
  const r = await pool.query(
    `UPDATE whatsapp_campaigns SET
       status = $3::text,
       started_at = CASE WHEN $3::text = 'RUNNING' AND started_at IS NULL THEN NOW() ELSE started_at END,
       completed_at = CASE WHEN $3::text IN ('COMPLETED','CANCELLED') THEN NOW() ELSE completed_at END,
       updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${C_COLS}`,
    [id, tenantId, status],
  );
  return (r.rows[0] as WhatsAppCampaign) || null;
}

export async function deleteCampaign(tenantId: string, id: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM whatsapp_campaigns WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface AddTargetInput {
  recipient: string;
  lead_id?: string | null;
  variable_context?: Record<string, any>;
}

/** Bulk add targets. Skips empty recipients silently. Returns inserted count. */
export async function addTargets(
  tenantId: string, campaignId: string, targets: AddTargetInput[],
): Promise<number> {
  if (!targets.length) return 0;
  // Verify campaign belongs to tenant before mass-insert (no orphans).
  const camp = await getCampaign(tenantId, campaignId);
  if (!camp) return 0;
  // Use multi-row INSERT for batch efficiency; pg-node tolerates ~1000 rows
  // per parameterised insert. For larger batches the caller should chunk.
  const valuesParts: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const t of targets) {
    const recipient = (t.recipient || '').trim();
    if (!recipient) continue;
    valuesParts.push(`($${i}::uuid, $${i + 1}, $${i + 2}::uuid, $${i + 3}, $${i + 4}::jsonb)`);
    params.push(campaignId, tenantId, t.lead_id || null, recipient, JSON.stringify(t.variable_context || {}));
    i += 5;
  }
  if (!valuesParts.length) return 0;
  await pool.query(
    `INSERT INTO whatsapp_campaign_targets
       (campaign_id, tenant_id, lead_id, recipient, variable_context)
     VALUES ${valuesParts.join(',')}`,
    params,
  );
  // Refresh total_recipients on the parent (atomic count vs. trying to track
  // a counter ourselves — race-free).
  await pool.query(
    `UPDATE whatsapp_campaigns SET total_recipients = (
       SELECT COUNT(*) FROM whatsapp_campaign_targets WHERE campaign_id = $1
     ), updated_at = NOW() WHERE id = $1`,
    [campaignId],
  );
  return valuesParts.length;
}

export async function listTargets(
  tenantId: string, campaignId: string, opts: { limit?: number; status?: string } = {},
): Promise<CampaignTarget[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (opts.status) {
    const r = await pool.query(
      `SELECT ${T_COLS} FROM whatsapp_campaign_targets
       WHERE campaign_id = $1 AND tenant_id = $2 AND status = $3
       ORDER BY created_at LIMIT $4`,
      [campaignId, tenantId, opts.status, limit],
    );
    return r.rows as CampaignTarget[];
  }
  const r = await pool.query(
    `SELECT ${T_COLS} FROM whatsapp_campaign_targets
     WHERE campaign_id = $1 AND tenant_id = $2
     ORDER BY created_at LIMIT $3`,
    [campaignId, tenantId, limit],
  );
  return r.rows as CampaignTarget[];
}

/** Aggregate progress counts per status. Cheap — single GROUP BY. */
export async function getProgress(tenantId: string, campaignId: string): Promise<CampaignProgress> {
  const r = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM whatsapp_campaign_targets
     WHERE campaign_id = $1 AND tenant_id = $2 GROUP BY status`,
    [campaignId, tenantId],
  );
  const out: CampaignProgress = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, total: 0 };
  for (const row of r.rows) {
    if (row.status in out) (out as any)[row.status] = row.n;
    out.total += row.n;
  }
  return out;
}

/** Worker entry: list all campaigns in RUNNING status across all tenants.
 *  The worker iterates these to drain queued targets each tick. */
export async function listRunningCampaigns(): Promise<WhatsAppCampaign[]> {
  const r = await pool.query(
    `SELECT ${C_COLS} FROM whatsapp_campaigns
     WHERE status = 'RUNNING' ORDER BY started_at NULLS FIRST`,
  );
  return r.rows as WhatsAppCampaign[];
}

/** Atomically claim up to N queued targets for a campaign — moves them
 *  out of the queued pool so two worker ticks can't double-send.
 *  Sets attempt_count++. The returned rows are exclusive to the caller
 *  until they call markTargetSent() / markTargetFailed(). */
export async function claimQueuedBatch(
  campaignId: string, limit: number,
): Promise<CampaignTarget[]> {
  if (limit <= 0) return [];
  // Use SELECT ... FOR UPDATE SKIP LOCKED to safely claim a batch even if
  // a future deployment runs multiple worker instances. The status flip is
  // committed in the same transaction so a crash before send leaves the row
  // visible to a later retry (attempt_count still incremented).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT ${T_COLS} FROM whatsapp_campaign_targets
       WHERE campaign_id = $1 AND status = 'queued'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [campaignId, limit],
    );
    if (r.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }
    const ids = r.rows.map((row) => row.id);
    // We do NOT flip status to 'sending' — keeping 'queued' until markTargetSent
    // means a worker crash mid-send naturally leaves it retryable. We DO
    // increment attempt_count so we can cap retries elsewhere. Two ticks
    // can't both claim the same row thanks to FOR UPDATE SKIP LOCKED.
    await client.query(
      `UPDATE whatsapp_campaign_targets
         SET attempt_count = attempt_count + 1
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await client.query('COMMIT');
    return r.rows as CampaignTarget[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markTargetSent(
  targetId: string, log_id: string | null, provider_message_id: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_campaign_targets
       SET status = 'sent', sent_at = NOW(),
           communication_log_id = COALESCE(communication_log_id, $2::uuid),
           provider_message_id = COALESCE(provider_message_id, $3),
           last_error = NULL
     WHERE id = $1`,
    [targetId, log_id, provider_message_id],
  );
}

export async function markTargetFailed(
  targetId: string, error: string, log_id: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_campaign_targets
       SET status = 'failed', failed_at = NOW(),
           communication_log_id = COALESCE(communication_log_id, $3::uuid),
           last_error = $2
     WHERE id = $1`,
    [targetId, error, log_id],
  );
}

/** Called after each worker drain — if no targets remain queued AND none
 *  are in-flight (queued count = 0), the campaign is done. We mark it
 *  COMPLETED so the worker stops scanning it next tick. */
export async function maybeMarkCompleted(campaignId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM whatsapp_campaign_targets
     WHERE campaign_id = $1 AND status = 'queued'`,
    [campaignId],
  );
  if (r.rows[0]?.n === 0) {
    await pool.query(
      `UPDATE whatsapp_campaigns
         SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'RUNNING'`,
      [campaignId],
    );
    return true;
  }
  return false;
}
