/**
 * Fire-and-forget client for conversation-service's WhatsApp workflow engine.
 *
 * Every lead create / status-change posts to /api/v1/whatsapp/workflows/trigger
 * which decides whether to send a template, assign a counselor, and notify
 * the admin. We do NOT await the call — lead creation must not slow down or
 * fail because conversation-service is down or the Meta API is sluggish.
 *
 * Failures are logged (not thrown). The workflow_runs audit table on the
 * conversation-service side records both successes and failures, so the
 * operator can inspect what didn't fire.
 */

const CONVERSATION_SERVICE_URL =
  process.env.CONVERSATION_SERVICE_URL || 'http://localhost:3003';

export type WorkflowEvent =
  | 'lead_created'
  | 'interested'
  | 'no_answer'
  | 'callback_requested'
  | 'admission_confirmed'
  | 'payment_pending';

/** Map the `status` column + custom_fields to a workflow event. Returns
 *  null when the status doesn't correspond to anything actionable. */
export function mapStatusToEvent(status: string | null | undefined, customFields?: any): WorkflowEvent | null {
  // Extended status in custom_fields takes precedence — it's the richer
  // vocabulary set by the voice-agent post-call analyzer.
  const extended = (customFields?.extended_lead_status || '').toString().toUpperCase();
  if (extended === 'HOT_INTERESTED' || extended === 'INTERESTED') return 'interested';
  if (extended === 'NO_ANSWER') return 'no_answer';
  if (extended === 'CALLBACK_SCHEDULED' || extended === 'CALLBACK_REQUESTED') return 'callback_requested';
  if (extended === 'ADMISSION_CONFIRMED') return 'admission_confirmed';
  if (extended === 'PAYMENT_PENDING') return 'payment_pending';

  // Fall back to the lead.status column. QUALIFIED is the closest thing to
  // "interested" in the legacy vocabulary. Other values don't trigger.
  const s = (status || '').toUpperCase();
  if (s === 'QUALIFIED') return 'interested';
  if (s === 'ADMISSION_CONFIRMED') return 'admission_confirmed';
  if (s === 'PAYMENT_PENDING') return 'payment_pending';
  return null;
}

export interface FireWorkflowInput {
  tenant_id: string;
  workflow_event: WorkflowEvent;
  lead_id: string;
  phone?: string | null;
  context?: Record<string, any>;
  idempotency_key?: string;
}

/** Fire and forget. Returns void — caller should `void fireLeadWorkflow(...)`. */
export function fireLeadWorkflow(input: FireWorkflowInput): void {
  const url = `${CONVERSATION_SERVICE_URL}/api/v1/whatsapp/workflows/trigger`;
  const body = {
    workflow_event: input.workflow_event,
    lead_id: input.lead_id,
    phone: input.phone || null,
    context: input.context || {},
    idempotency_key: input.idempotency_key,
  };
  // Use AbortController with a 5s timeout — workflow_engine itself does the
  // heavy lifting async, the HTTP call only needs to reach it and get the
  // ack. A hung conversation-service must not pile up open connections.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': input.tenant_id,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (resp) => {
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn(`[wa-workflow] trigger HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      // Don't log AbortError loudly — it's the expected outcome on
      // conversation-service downtime, and we don't want noise in normal logs.
      if (err?.name !== 'AbortError') {
        console.warn(`[wa-workflow] trigger network error: ${err?.message || err}`);
      }
    });
}

/** Build a standard context object from a lead row. The workflow engine's
 *  template variable resolver uses dotted paths like `lead.name`, `lead.phone`. */
export function leadContext(lead: any): Record<string, any> {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  return {
    lead: {
      name: fullName,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      source: lead.source,
      status: lead.status,
      score: lead.score,
    },
    extras: {
      lead_id: lead.id,
    },
  };
}
