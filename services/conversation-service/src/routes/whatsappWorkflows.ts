/**
 * WhatsApp workflow REST endpoints.
 *
 *   GET  /api/v1/whatsapp/workflows                     — list tenant config
 *   PUT  /api/v1/whatsapp/workflows/:event              — patch one event row
 *   POST /api/v1/whatsapp/workflows/trigger             — manually fire a workflow
 *                                                          (also used internally by crm-service-node
 *                                                           and the post-call processor)
 *   GET  /api/v1/whatsapp/workflows/runs                — recent workflow_runs audit
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  listWorkflows, updateWorkflow, triggerWorkflow, type WorkflowEvent,
} from '../services/whatsappWorkflowEngine';
import { pool } from '../index';

export const whatsappWorkflowsRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

whatsappWorkflowsRouter.get('/workflows', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const rows = await listWorkflows(tenantId);
    res.json({ workflows: rows, count: rows.length });
  } catch (err) { next(err); }
});

const patchSchema = z.object({
  template_name: z.string().max(120).optional().nullable(),
  template_language: z.string().max(20).optional(),
  also_assign_counselor: z.boolean().optional(),
  also_notify_admin: z.boolean().optional(),
  active: z.boolean().optional(),
});

whatsappWorkflowsRouter.put('/workflows/:event', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = patchSchema.parse(req.body);
    const updated = await updateWorkflow(tenantId, req.params.event, data);
    if (!updated) return res.status(404).json({ error: 'Not Found' });
    res.json(updated);
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});

const KNOWN_EVENTS: WorkflowEvent[] = [
  'lead_created', 'interested', 'no_answer', 'callback_requested',
  'admission_confirmed', 'payment_pending',
];

const triggerSchema = z.object({
  workflow_event: z.enum(KNOWN_EVENTS as [WorkflowEvent, ...WorkflowEvent[]]),
  lead_id: z.string().uuid().optional().nullable(),
  phone: z.string().optional().nullable(),
  context: z.record(z.any()).optional(),
  idempotency_key: z.string().optional(),
});

whatsappWorkflowsRouter.post('/workflows/trigger', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = triggerSchema.parse(req.body);
    const result = await triggerWorkflow({
      tenant_id: tenantId,
      workflow_event: data.workflow_event,
      lead_id: data.lead_id || undefined,
      phone: data.phone || undefined,
      context: data.context || {},
      idempotency_key: data.idempotency_key,
    });
    res.json(result);
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});

whatsappWorkflowsRouter.get('/workflows/runs', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const event = req.query.event as string | undefined;
    let r;
    if (event) {
      r = await pool.query(
        `SELECT id, lead_id, workflow_event, template_name, communication_log_id,
                counselor_assigned, admin_notified, status, skip_reason,
                last_error, created_at
         FROM workflow_runs
         WHERE tenant_id = $1 AND workflow_event = $2
         ORDER BY created_at DESC LIMIT $3`,
        [tenantId, event, limit],
      );
    } else {
      r = await pool.query(
        `SELECT id, lead_id, workflow_event, template_name, communication_log_id,
                counselor_assigned, admin_notified, status, skip_reason,
                last_error, created_at
         FROM workflow_runs
         WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [tenantId, limit],
      );
    }
    res.json({ runs: r.rows, count: r.rows.length });
  } catch (err) { next(err); }
});
