import type { Pool } from 'pg';

export type NumberAuditEvent =
  | 'assigned'
  | 'unassigned'
  | 'deployed'
  | 'redeployed'
  | 'paused'
  | 'resumed'
  | 'verify_passed'
  | 'verify_failed'
  | 'route_updated'
  | 'released';

export interface AuditActor {
  userId?: string | null;
  email?: string | null;
}

export async function recordNumberAudit(
  pool: Pool,
  params: {
    tenantId: string;
    numberId: string;
    eventType: NumberAuditEvent;
    actor?: AuditActor;
    before?: Record<string, any> | null;
    after?: Record<string, any> | null;
    metadata?: Record<string, any>;
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO number_audit_log
         (tenant_id, number_id, event_type, actor_user_id, actor_email, before_state, after_state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.tenantId,
        params.numberId,
        params.eventType,
        params.actor?.userId || null,
        params.actor?.email || null,
        params.before ? JSON.stringify(params.before) : null,
        params.after ? JSON.stringify(params.after) : null,
        JSON.stringify(params.metadata || {}),
      ],
    );
  } catch {
    // Audit logging must never break the primary flow.
  }
}
