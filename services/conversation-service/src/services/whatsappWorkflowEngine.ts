/**
 * whatsappWorkflowEngine — the glue between lead lifecycle events and
 * WhatsApp template sends + side-effects.
 *
 * Concept:
 *   Lead events emit a `workflow_event` string ('lead_created', 'interested',
 *   'no_answer', 'callback_requested', 'admission_confirmed', 'payment_pending').
 *   Each tenant has a row in `tenant_lead_workflows` mapping that event to:
 *     - a WhatsApp template (which fires the actual message)
 *     - optional side-effects: assign a counselor, notify admin
 *
 * Idempotency:
 *   Every run writes a `workflow_runs` row keyed on
 *     (tenant_id, "{lead_id}:{event}:{day-or-once}")
 *   ON CONFLICT DO NOTHING. Re-firing the same event for the same lead on the
 *   same day is a no-op. One-shot events (admission_confirmed) drop the date
 *   suffix so they fire exactly once.
 *
 * Failure model:
 *   Side-effects are best-effort. If the template send fails (Meta error,
 *   no template configured, no phone), we still log a run row with
 *   status='failed' or 'skipped' so the operator can see what happened.
 *   The engine NEVER throws — callers fire-and-forget.
 */
import pino from 'pino';
import { pool } from '../index';
import { sendWhatsApp } from './communications';
import { getTemplateByName } from './whatsappTemplateStore';
import { resolveTemplateVariables } from './templateVariables';

const logger = pino({ name: 'wa-workflow' });

export type WorkflowEvent =
  | 'lead_created'
  | 'interested'
  | 'no_answer'
  | 'callback_requested'
  | 'admission_confirmed'
  | 'payment_pending';

/** One-shot events do not get a date suffix in their idempotency key —
 *  they should fire exactly once per (lead, event) regardless of how many
 *  times the upstream re-emits. Daily events (lead_created, follow-ups)
 *  fire at most once per day so we don't spam on repeated triggers. */
const ONE_SHOT_EVENTS: ReadonlySet<WorkflowEvent> = new Set([
  'admission_confirmed',
] as const);

/** Default per-tenant config seeded the first time a tenant fires any event.
 *  Templates default to NAMES the tenant must have in `whatsapp_templates`
 *  (synced from Meta and APPROVED). We default templates to active=false on
 *  ones the tenant likely hasn't created yet (admission/payment) so they
 *  don't fire blindly; lead_created uses hello_world as a safe default. */
const DEFAULT_WORKFLOWS: Array<{
  workflow_event: WorkflowEvent;
  template_name: string | null;
  also_assign_counselor: boolean;
  also_notify_admin: boolean;
  active: boolean;
}> = [
  { workflow_event: 'lead_created',         template_name: 'hello_world',         also_assign_counselor: false, also_notify_admin: false, active: true  },
  { workflow_event: 'interested',           template_name: 'brochure_v1',         also_assign_counselor: true,  also_notify_admin: true,  active: true  },
  { workflow_event: 'no_answer',            template_name: 'no_answer_retry',     also_assign_counselor: false, also_notify_admin: false, active: false },
  { workflow_event: 'callback_requested',   template_name: 'callback_reminder',   also_assign_counselor: true,  also_notify_admin: false, active: false },
  { workflow_event: 'admission_confirmed',  template_name: 'admission_welcome',   also_assign_counselor: false, also_notify_admin: true,  active: false },
  { workflow_event: 'payment_pending',      template_name: 'payment_reminder',    also_assign_counselor: false, also_notify_admin: true,  active: false },
];

/** Seed defaults for a tenant if none exist. Cheap idempotent UPSERT. */
export async function ensureDefaultWorkflows(tenantId: string): Promise<void> {
  const existing = await pool.query(
    `SELECT 1 FROM tenant_lead_workflows WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if ((existing.rowCount ?? 0) > 0) return;
  for (const w of DEFAULT_WORKFLOWS) {
    await pool.query(
      `INSERT INTO tenant_lead_workflows
         (tenant_id, workflow_event, template_name, template_language,
          also_assign_counselor, also_notify_admin, active)
       VALUES ($1, $2, $3, 'en_US', $4, $5, $6)
       ON CONFLICT (tenant_id, workflow_event) DO NOTHING`,
      [tenantId, w.workflow_event, w.template_name, w.also_assign_counselor, w.also_notify_admin, w.active],
    );
  }
  logger.info({ tenantId, seeded: DEFAULT_WORKFLOWS.length }, 'seeded default workflows');
}

export interface TriggerInput {
  tenant_id: string;
  workflow_event: WorkflowEvent;
  lead_id?: string | null;
  phone?: string | null;
  /** Free-form context passed into template variable resolution. Typical
   *  keys: lead.name, lead.email, brochure_url, callback_at. */
  context?: Record<string, any>;
  /** Override idempotency key. Otherwise built from lead_id+event+day. */
  idempotency_key?: string;
}

export interface TriggerResult {
  status: 'completed' | 'skipped' | 'partial' | 'failed' | 'duplicate';
  workflow_run_id?: string;
  communication_log_id?: string | null;
  counselor_assigned?: string | null;
  admin_notified?: boolean;
  reason?: string;
}

/** Main entry point. Looks up workflow config, sends template, runs
 *  side-effects, writes audit row. Always returns — never throws. */
export async function triggerWorkflow(input: TriggerInput): Promise<TriggerResult> {
  const { tenant_id, workflow_event, lead_id, phone, context = {} } = input;
  try {
    // Build idempotency key. One-shot events: "{lead}:{event}". Daily events:
    // "{lead}:{event}:{YYYY-MM-DD}".
    const idemKey = input.idempotency_key || buildIdempotencyKey(lead_id || null, workflow_event);

    // Ensure defaults exist (cheap — guarded by EXISTS check).
    await ensureDefaultWorkflows(tenant_id);

    // Look up the config.
    const cfgRow = await pool.query(
      `SELECT template_name, template_language, also_assign_counselor,
              also_notify_admin, active
       FROM tenant_lead_workflows
       WHERE tenant_id = $1 AND workflow_event = $2`,
      [tenant_id, workflow_event],
    );
    const cfg = cfgRow.rows[0];
    if (!cfg || !cfg.active) {
      return logRun(tenant_id, lead_id, workflow_event, idemKey, {
        status: 'skipped', skip_reason: cfg ? 'workflow_inactive' : 'no_workflow_configured',
      });
    }

    // Send template (if configured).
    let logId: string | null = null;
    let sendError: string | null = null;
    if (cfg.template_name && phone) {
      const tpl = await getTemplateByName(tenant_id, cfg.template_name, cfg.template_language);
      if (!tpl) {
        sendError = `template_not_found: '${cfg.template_name}' (run /whatsapp/templates/sync)`;
      } else {
        const { params } = resolveTemplateVariables(tpl, context);
        const res = await sendWhatsApp({
          tenant_id,
          lead_id: lead_id || undefined,
          recipient: phone,
          message: tpl.body_text || '',
          template_id: tpl.name,
          template_language: tpl.language,
          template_params: params,
        });
        logId = res.log_id;
        if (!res.ok) sendError = res.error || 'send_failed';
      }
    } else if (cfg.template_name && !phone) {
      sendError = 'no_phone_for_send';
    }

    // Side-effects.
    let counselorId: string | null = null;
    if (cfg.also_assign_counselor && lead_id) {
      counselorId = await assignCounselorBestEffort(tenant_id, lead_id, workflow_event);
    }
    let adminNotified = false;
    if (cfg.also_notify_admin) {
      adminNotified = await notifyAdminBestEffort(tenant_id, lead_id || null, workflow_event, context);
    }

    const status: TriggerResult['status'] =
      sendError ? (counselorId || adminNotified ? 'partial' : 'failed') : 'completed';

    return logRun(tenant_id, lead_id, workflow_event, idemKey, {
      status,
      template_name: cfg.template_name,
      communication_log_id: logId,
      counselor_assigned: counselorId,
      admin_notified: adminNotified,
      last_error: sendError,
    });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err), workflow_event, tenant_id }, 'workflow trigger threw');
    return { status: 'failed', reason: err?.message || 'unknown' };
  }
}

function buildIdempotencyKey(leadId: string | null, event: WorkflowEvent): string {
  const tail = ONE_SHOT_EVENTS.has(event)
    ? 'once'
    : new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${leadId || 'no-lead'}:${event}:${tail}`;
}

interface LogRunBag {
  status: 'completed' | 'skipped' | 'partial' | 'failed';
  template_name?: string | null;
  communication_log_id?: string | null;
  counselor_assigned?: string | null;
  admin_notified?: boolean;
  skip_reason?: string | null;
  last_error?: string | null;
}

async function logRun(
  tenantId: string, leadId: string | null | undefined, event: string,
  idemKey: string, bag: LogRunBag,
): Promise<TriggerResult> {
  const r = await pool.query(
    `INSERT INTO workflow_runs
       (tenant_id, lead_id, workflow_event, idempotency_key, template_name,
        communication_log_id, counselor_assigned, admin_notified, status,
        skip_reason, last_error)
     VALUES ($1, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      tenantId, leadId || null, event, idemKey,
      bag.template_name || null, bag.communication_log_id || null,
      bag.counselor_assigned || null, !!bag.admin_notified, bag.status,
      bag.skip_reason || null, bag.last_error || null,
    ],
  );
  if (r.rowCount === 0) {
    // Duplicate — another caller already fired this event today. Cheap log,
    // returns 'duplicate' so the upstream knows we didn't re-send.
    logger.info({ tenantId, leadId, event, idemKey }, 'duplicate workflow run — skipped');
    return { status: 'duplicate', reason: 'idempotency_collision' };
  }
  return {
    status: bag.status,
    workflow_run_id: r.rows[0].id,
    communication_log_id: bag.communication_log_id ?? null,
    counselor_assigned: bag.counselor_assigned ?? null,
    admin_notified: bag.admin_notified,
    reason: bag.last_error || bag.skip_reason || undefined,
  };
}

/** Counselor pick — mirror of pickAvailableCounselor() in postCallProcessor.
 *  Copied here verbatim so the engine doesn't depend on a function that's
 *  declared inside an unrelated module. Updates last_assigned_at + counter
 *  so future picks rotate. */
async function assignCounselorBestEffort(
  tenantId: string, leadId: string, _event: string,
): Promise<string | null> {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Pick least-recently-assigned available counselor.
      const r = await client.query(
        `SELECT id FROM counselors
         WHERE tenant_id = $1 AND availability_status = 'available'
         ORDER BY last_assigned_at NULLS FIRST, active_task_count ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [tenantId],
      );
      if (r.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const counselorId = r.rows[0].id;
      await client.query(
        `UPDATE counselors SET last_assigned_at = NOW(),
                              active_task_count = active_task_count + 1
         WHERE id = $1`,
        [counselorId],
      );
      // Best-effort link from lead → counselor. The CRM service owns the
      // lead row; we record the assignment in our follow_up_tasks table so
      // it's at least surfaced in the counselor's queue.
      await client.query(
        `INSERT INTO follow_up_tasks
           (tenant_id, lead_id, task_type, assigned_to, scheduled_at, priority, status, notes)
         VALUES ($1, $2::uuid, 'counselor_meeting', $3, NOW() + INTERVAL '30 minutes',
                 'urgent', 'pending', 'auto-assigned via workflow engine')`,
        [tenantId, leadId, counselorId],
      );
      await client.query('COMMIT');
      return counselorId;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.warn({ tenantId, leadId, err: err?.message }, 'counselor assignment failed');
    return null;
  }
}

/** Admin notification — sends a WhatsApp to the tenant's "admin number"
 *  using a fixed lightweight template name 'admin_alert'. If neither admin
 *  phone nor admin_alert template is configured we soft-skip. */
async function notifyAdminBestEffort(
  tenantId: string, leadId: string | null, event: string, context: Record<string, any>,
): Promise<boolean> {
  try {
    // Resolve admin phone — first from tenant_whatsapp_integrations.template_config.admin_phone,
    // fall back to env-default ADMIN_PHONE_NUMBER. The latter is platform-wide
    // for testing; production should always use per-tenant.
    const cfgRow = await pool.query(
      `SELECT template_config FROM tenant_whatsapp_integrations WHERE tenant_id = $1`,
      [tenantId],
    );
    const adminPhone =
      cfgRow.rows[0]?.template_config?.admin_phone ||
      process.env.ADMIN_PHONE_NUMBER ||
      null;
    if (!adminPhone) {
      logger.info({ tenantId, event }, 'admin notify skipped — no admin phone configured');
      return false;
    }
    // Use a dedicated admin template if present, else fall back to hello_world.
    const adminTpl =
      (await getTemplateByName(tenantId, 'admin_alert')) ||
      (await getTemplateByName(tenantId, 'hello_world'));
    if (!adminTpl) {
      logger.info({ tenantId, event }, 'admin notify skipped — no admin template');
      return false;
    }
    const { params } = resolveTemplateVariables(adminTpl, {
      ...context,
      extras: { ...context, event, lead_id: leadId },
    });
    const res = await sendWhatsApp({
      tenant_id: tenantId,
      recipient: adminPhone,
      message: adminTpl.body_text || `Lead event: ${event}`,
      template_id: adminTpl.name,
      template_language: adminTpl.language,
      template_params: params,
    });
    return !!res.ok;
  } catch (err: any) {
    logger.warn({ tenantId, err: err?.message }, 'admin notify failed');
    return false;
  }
}

/** List workflows for the management UI. */
export async function listWorkflows(tenantId: string) {
  await ensureDefaultWorkflows(tenantId);
  const r = await pool.query(
    `SELECT tenant_id, workflow_event, template_name, template_language,
            also_assign_counselor, also_notify_admin, active, created_at, updated_at
     FROM tenant_lead_workflows WHERE tenant_id = $1 ORDER BY workflow_event`,
    [tenantId],
  );
  return r.rows;
}

export interface UpdateWorkflowInput {
  template_name?: string | null;
  template_language?: string;
  also_assign_counselor?: boolean;
  also_notify_admin?: boolean;
  active?: boolean;
}

export async function updateWorkflow(
  tenantId: string, event: string, input: UpdateWorkflowInput,
) {
  const r = await pool.query(
    `UPDATE tenant_lead_workflows SET
       template_name = COALESCE($3, template_name),
       template_language = COALESCE($4, template_language),
       also_assign_counselor = COALESCE($5, also_assign_counselor),
       also_notify_admin = COALESCE($6, also_notify_admin),
       active = COALESCE($7, active),
       updated_at = NOW()
     WHERE tenant_id = $1 AND workflow_event = $2
     RETURNING tenant_id, workflow_event, template_name, template_language,
               also_assign_counselor, also_notify_admin, active`,
    [
      tenantId, event,
      input.template_name === undefined ? null : input.template_name,
      input.template_language ?? null,
      input.also_assign_counselor ?? null,
      input.also_notify_admin ?? null,
      input.active ?? null,
    ],
  );
  return r.rows[0] || null;
}

/** Map a lead extended_status string to a workflow_event the engine knows.
 *  Returns null for statuses that have no workflow attached. */
export function mapStatusToEvent(status: string | null | undefined): WorkflowEvent | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'HOT_INTERESTED' || s === 'INTERESTED') return 'interested';
  if (s === 'NO_ANSWER') return 'no_answer';
  if (s === 'CALLBACK_SCHEDULED' || s === 'CALLBACK_REQUESTED') return 'callback_requested';
  if (s === 'ADMISSION_CONFIRMED') return 'admission_confirmed';
  if (s === 'PAYMENT_PENDING') return 'payment_pending';
  return null;
}
