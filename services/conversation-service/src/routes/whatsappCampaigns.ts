/**
 * WhatsApp bulk-campaign REST endpoints.
 *
 *   GET    /api/v1/whatsapp/campaigns                       — list campaigns
 *   POST   /api/v1/whatsapp/campaigns                       — create (DRAFT)
 *   GET    /api/v1/whatsapp/campaigns/:id                   — detail + progress
 *   DELETE /api/v1/whatsapp/campaigns/:id                   — drop (cascades targets)
 *   POST   /api/v1/whatsapp/campaigns/:id/targets           — bulk add recipients
 *   GET    /api/v1/whatsapp/campaigns/:id/targets           — list targets
 *   POST   /api/v1/whatsapp/campaigns/:id/start             — DRAFT|PAUSED → RUNNING
 *   POST   /api/v1/whatsapp/campaigns/:id/pause             — RUNNING → PAUSED
 *   POST   /api/v1/whatsapp/campaigns/:id/cancel            — any → CANCELLED
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  listCampaigns, getCampaign, createCampaign, deleteCampaign,
  updateCampaignStatus, addTargets, listTargets, getProgress,
} from '../services/whatsappCampaignStore';
import { getTemplate } from '../services/whatsappTemplateStore';

export const whatsappCampaignsRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

whatsappCampaignsRouter.get('/campaigns', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const rows = await listCampaigns(tenantId);
    res.json({ campaigns: rows, count: rows.length });
  } catch (err) { next(err); }
});

whatsappCampaignsRouter.get('/campaigns/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const camp = await getCampaign(tenantId, req.params.id);
    if (!camp) return res.status(404).json({ error: 'Not Found' });
    const progress = await getProgress(tenantId, req.params.id);
    res.json({ ...camp, progress });
  } catch (err) { next(err); }
});

const createSchema = z.object({
  name: z.string().min(1).max(180),
  template_id: z.string().uuid(),
  rate_limit_per_minute: z.number().int().min(1).max(600).optional(),
  scheduled_at: z.string().optional().nullable(),
});

whatsappCampaignsRouter.post('/campaigns', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = createSchema.parse(req.body);
    // Look up the template by id so we can denormalise name+language.
    // Also gives us a tenant-scope check on the template_id — caller
    // can't reference a template that belongs to another tenant.
    const tpl = await getTemplate(tenantId, data.template_id);
    if (!tpl) return res.status(400).json({ error: 'Bad Request', message: 'template_id not found for tenant' });
    const camp = await createCampaign(tenantId, {
      name: data.name,
      template_id: tpl.id,
      template_name: tpl.name,
      template_language: tpl.language,
      rate_limit_per_minute: data.rate_limit_per_minute,
      scheduled_at: data.scheduled_at || null,
    });
    res.status(201).json(camp);
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});

whatsappCampaignsRouter.delete('/campaigns/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const ok = await deleteCampaign(tenantId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not Found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

const addTargetsSchema = z.object({
  targets: z.array(z.object({
    recipient: z.string().min(7),
    lead_id: z.string().uuid().optional().nullable(),
    variable_context: z.record(z.any()).optional(),
  })).min(1).max(10000),
});

whatsappCampaignsRouter.post('/campaigns/:id/targets', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = addTargetsSchema.parse(req.body);
    const inserted = await addTargets(tenantId, req.params.id, data.targets);
    if (inserted === 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'No valid targets (or campaign not found)' });
    }
    res.status(201).json({ inserted });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});

whatsappCampaignsRouter.get('/campaigns/:id/targets', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    const status = req.query.status as string | undefined;
    const rows = await listTargets(tenantId, req.params.id, { limit, status });
    res.json({ targets: rows, count: rows.length });
  } catch (err) { next(err); }
});

whatsappCampaignsRouter.post('/campaigns/:id/start', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const camp = await getCampaign(tenantId, req.params.id);
    if (!camp) return res.status(404).json({ error: 'Not Found' });
    if (!['DRAFT', 'PAUSED'].includes(camp.status)) {
      return res.status(409).json({ error: 'Conflict', message: `Cannot start campaign in status '${camp.status}'` });
    }
    const updated = await updateCampaignStatus(tenantId, req.params.id, 'RUNNING');
    res.json(updated);
  } catch (err) { next(err); }
});

whatsappCampaignsRouter.post('/campaigns/:id/pause', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const camp = await getCampaign(tenantId, req.params.id);
    if (!camp) return res.status(404).json({ error: 'Not Found' });
    if (camp.status !== 'RUNNING') {
      return res.status(409).json({ error: 'Conflict', message: `Only RUNNING campaigns can be paused (current: ${camp.status})` });
    }
    const updated = await updateCampaignStatus(tenantId, req.params.id, 'PAUSED');
    res.json(updated);
  } catch (err) { next(err); }
});

whatsappCampaignsRouter.post('/campaigns/:id/cancel', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const updated = await updateCampaignStatus(tenantId, req.params.id, 'CANCELLED');
    if (!updated) return res.status(404).json({ error: 'Not Found' });
    res.json(updated);
  } catch (err) { next(err); }
});
