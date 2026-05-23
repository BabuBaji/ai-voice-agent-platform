/**
 * WhatsApp template management REST endpoints.
 *
 *   GET    /api/v1/whatsapp/templates              — list tenant templates
 *   GET    /api/v1/whatsapp/templates/:id          — single template
 *   POST   /api/v1/whatsapp/templates              — create local row
 *   PATCH  /api/v1/whatsapp/templates/:id          — update variable_mapping etc.
 *   DELETE /api/v1/whatsapp/templates/:id          — delete row
 *   POST   /api/v1/whatsapp/templates/sync         — pull from Meta Graph API
 *   POST   /api/v1/whatsapp/templates/:id/test     — send a test using sample vars
 *
 * Tenant isolation via x-tenant-id header on every endpoint.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listTemplates, getTemplate, upsertTemplate, updateVariableMapping,
  deleteTemplate, syncTemplatesFromMeta, type WhatsAppTemplate,
} from '../services/whatsappTemplateStore';
import { resolveTemplateVariables } from '../services/templateVariables';
import { sendWhatsApp } from '../services/communications';

export const whatsappTemplatesRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  language: z.string().min(2).max(20).default('en_US'),
  category: z.string().max(40).optional().nullable(),
  status: z.string().max(20).optional(),
  header_format: z.string().max(20).optional().nullable(),
  header_text: z.string().optional().nullable(),
  body_text: z.string().optional().nullable(),
  footer_text: z.string().optional().nullable(),
  buttons: z.array(z.any()).optional().nullable(),
  variable_mapping: z.record(z.string()).optional(),
});

const patchSchema = z.object({
  variable_mapping: z.record(z.string()).optional(),
  body_text: z.string().optional().nullable(),
  category: z.string().max(40).optional().nullable(),
  status: z.string().max(20).optional(),
});

whatsappTemplatesRouter.get('/templates', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const rows = await listTemplates(tenantId);
    res.json({ templates: rows, count: rows.length });
  } catch (err) { next(err); }
});

whatsappTemplatesRouter.get('/templates/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const row = await getTemplate(tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not Found' });
    res.json(row);
  } catch (err) { next(err); }
});

whatsappTemplatesRouter.post('/templates', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = createSchema.parse(req.body);
    const row = await upsertTemplate(tenantId, data);
    res.status(201).json(row);
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});

whatsappTemplatesRouter.patch('/templates/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = patchSchema.parse(req.body);
    // The store has a dedicated fast path for mapping-only updates so we
    // don't have to round-trip the whole template body. Otherwise upsert
    // by name+lang carries the patch.
    if (Object.keys(data).length === 1 && data.variable_mapping) {
      const updated = await updateVariableMapping(tenantId, req.params.id, data.variable_mapping);
      if (!updated) return res.status(404).json({ error: 'Not Found' });
      return res.json(updated);
    }
    const existing = await getTemplate(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not Found' });
    const updated = await upsertTemplate(tenantId, {
      name: existing.name,
      language: existing.language,
      category: data.category ?? existing.category,
      status: data.status ?? existing.status,
      header_format: existing.header_format,
      header_text: existing.header_text,
      body_text: data.body_text ?? existing.body_text,
      footer_text: existing.footer_text,
      buttons: existing.buttons || [],
      variable_mapping: data.variable_mapping ?? existing.variable_mapping,
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});

whatsappTemplatesRouter.delete('/templates/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const ok = await deleteTemplate(tenantId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not Found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

whatsappTemplatesRouter.post('/templates/sync', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const result = await syncTemplatesFromMeta(tenantId);
    res.json(result);
  } catch (err) { next(err); }
});

const testSchema = z.object({
  recipient: z.string().min(7),
  // Optional ad-hoc context fields for variable resolution. Common keys:
  // lead.name, brochure_url, callback_at — match whatever the template's
  // variable_mapping references.
  context: z.record(z.any()).optional(),
});

whatsappTemplatesRouter.post('/templates/:id/test', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = testSchema.parse(req.body);
    const tpl = await getTemplate(tenantId, req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Not Found' });
    const { params, missing } = resolveTemplateVariables(tpl, data.context || {});
    if (missing.length > 0) {
      // Allow the send anyway — Meta will reject if the template strictly
      // requires the variable, and we surface that error back. But flag the
      // gaps so the UI can warn before clicking Send.
      // (No early return — caller decided to test as-is.)
    }
    const result = await sendWhatsApp({
      tenant_id: tenantId,
      recipient: data.recipient,
      message: tpl.body_text || '',
      template_id: tpl.name,
      template_language: tpl.language,
      template_params: params,
    });
    res.json({
      ok: result.ok,
      log_id: result.log_id,
      error: result.error || null,
      missing_variables: missing,
      resolved_params: params,
    });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Validation Error', issues: err.issues });
    next(err);
  }
});
