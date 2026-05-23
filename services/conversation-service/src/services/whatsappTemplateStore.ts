/**
 * whatsappTemplateStore — CRUD + Meta-Graph sync for the
 * `whatsapp_templates` table.
 *
 * Tenant isolation: every function takes tenantId as the first argument
 * and scopes the SQL by it. No cross-tenant reads are possible through
 * this module.
 *
 * Meta sync: pulls the tenant's WABA template catalogue via
 *   GET https://graph.facebook.com/{ver}/{WABA_ID}/message_templates
 * using the tenant's own access token (loaded via loadTenantWhatsAppConfig).
 * Falls back to env-default META_WA_* when the tenant has no integration
 * row — useful during platform bring-up where one shared WABA covers all
 * tenants. Once a tenant configures their own WABA, theirs takes priority.
 */
import { pool } from '../index';
import pino from 'pino';
import { loadTenantWhatsAppConfig } from './tenantWhatsappConfig';

const logger = pino({ name: 'whatsapp-templates' });

export interface WhatsAppTemplate {
  id: string;
  tenant_id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  meta_template_id: string | null;
  header_format: string | null;
  header_text: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: any[] | null;
  variable_count: number;
  variable_mapping: Record<string, string>;
  rejection_reason: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS = `
  id, tenant_id, name, language, category, status, meta_template_id,
  header_format, header_text, body_text, footer_text, buttons,
  variable_count, variable_mapping, rejection_reason, last_synced_at,
  created_at, updated_at
`;

/** List templates for a tenant. Newest first. */
export async function listTemplates(tenantId: string): Promise<WhatsAppTemplate[]> {
  const r = await pool.query(
    `SELECT ${SELECT_COLS} FROM whatsapp_templates
     WHERE tenant_id = $1 ORDER BY updated_at DESC`,
    [tenantId],
  );
  return r.rows as WhatsAppTemplate[];
}

/** Get a single template by id (tenant-scoped). */
export async function getTemplate(tenantId: string, id: string): Promise<WhatsAppTemplate | null> {
  const r = await pool.query(
    `SELECT ${SELECT_COLS} FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (r.rows[0] as WhatsAppTemplate) || null;
}

/** Get a template by name+language — used by the post-call automation
 *  in Phase E to resolve "brochure" or "callback_reminder" → template row. */
export async function getTemplateByName(
  tenantId: string, name: string, language = 'en_US',
): Promise<WhatsAppTemplate | null> {
  const r = await pool.query(
    `SELECT ${SELECT_COLS} FROM whatsapp_templates
     WHERE tenant_id = $1 AND name = $2 AND language = $3`,
    [tenantId, name, language],
  );
  return (r.rows[0] as WhatsAppTemplate) || null;
}

export interface UpsertTemplateInput {
  name: string;
  language?: string;
  category?: string | null;
  status?: string;
  meta_template_id?: string | null;
  header_format?: string | null;
  header_text?: string | null;
  body_text?: string | null;
  footer_text?: string | null;
  buttons?: any[] | null;
  variable_mapping?: Record<string, string>;
  rejection_reason?: string | null;
  raw_components?: any;
  mark_synced?: boolean;
}

/** Upsert by (tenant_id, name, language). Returns the post-write row.
 *  variable_count is derived from body_text. */
export async function upsertTemplate(
  tenantId: string, input: UpsertTemplateInput,
): Promise<WhatsAppTemplate> {
  const language = input.language || 'en_US';
  const variableCount = countVariables(input.body_text || '');
  const r = await pool.query(
    `INSERT INTO whatsapp_templates
       (tenant_id, name, language, category, status, meta_template_id,
        header_format, header_text, body_text, footer_text, buttons,
        variable_count, variable_mapping, rejection_reason, raw_components,
        last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
             $12, $13::jsonb, $14, $15::jsonb,
             CASE WHEN $16 THEN NOW() ELSE NULL END)
     ON CONFLICT (tenant_id, name, language) DO UPDATE
       SET category = EXCLUDED.category,
           status = EXCLUDED.status,
           meta_template_id = COALESCE(EXCLUDED.meta_template_id, whatsapp_templates.meta_template_id),
           header_format = EXCLUDED.header_format,
           header_text = EXCLUDED.header_text,
           body_text = EXCLUDED.body_text,
           footer_text = EXCLUDED.footer_text,
           buttons = EXCLUDED.buttons,
           variable_count = EXCLUDED.variable_count,
           -- preserve existing variable_mapping unless the caller passed a new one
           variable_mapping = CASE
             WHEN EXCLUDED.variable_mapping = '{}'::jsonb THEN whatsapp_templates.variable_mapping
             ELSE EXCLUDED.variable_mapping
           END,
           rejection_reason = EXCLUDED.rejection_reason,
           raw_components = EXCLUDED.raw_components,
           last_synced_at = CASE WHEN $16 THEN NOW() ELSE whatsapp_templates.last_synced_at END,
           updated_at = NOW()
     RETURNING ${SELECT_COLS}`,
    [
      tenantId,
      input.name,
      language,
      input.category || null,
      input.status || 'PENDING',
      input.meta_template_id || null,
      input.header_format || null,
      input.header_text || null,
      input.body_text || null,
      input.footer_text || null,
      JSON.stringify(input.buttons || []),
      variableCount,
      JSON.stringify(input.variable_mapping || {}),
      input.rejection_reason || null,
      JSON.stringify(input.raw_components || null),
      !!input.mark_synced,
    ],
  );
  return r.rows[0] as WhatsAppTemplate;
}

/** Update only the variable_mapping (the field the UI edits most often). */
export async function updateVariableMapping(
  tenantId: string, id: string, mapping: Record<string, string>,
): Promise<WhatsAppTemplate | null> {
  const r = await pool.query(
    `UPDATE whatsapp_templates
       SET variable_mapping = $3::jsonb, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${SELECT_COLS}`,
    [id, tenantId, JSON.stringify(mapping || {})],
  );
  return (r.rows[0] as WhatsAppTemplate) || null;
}

export async function deleteTemplate(tenantId: string, id: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Count {{N}} placeholders in a body string. Handles {{1}}, {{ 1 }}, {{name}}.
 *  We count UNIQUE positional indices for variable_count display. */
export function countVariables(body: string): number {
  if (!body) return 0;
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g) || [];
  const uniqIdx = new Set(matches.map((m) => m.replace(/[^0-9]/g, '')));
  return uniqIdx.size;
}

/**
 * Sync tenant templates from Meta Graph API.
 *
 * Resolves credentials in this order:
 *   1. Tenant's whatsapp integration row (provider=meta) — own WABA+token
 *   2. Env-default META_WA_ACCESS_TOKEN + META_WA_BUSINESS_ACCOUNT_ID
 *
 * Upserts each Meta template into whatsapp_templates with last_synced_at=NOW().
 * Returns {synced, errors}.
 */
export async function syncTemplatesFromMeta(tenantId: string): Promise<{
  synced: number; errors: string[]; using: 'tenant' | 'env_default' | 'none';
}> {
  const { token, wabaId, source } = await resolveMetaCreds(tenantId);
  if (!token || !wabaId) {
    return { synced: 0, errors: ['No Meta credentials available (set META_WA_BUSINESS_ACCOUNT_ID + META_WA_ACCESS_TOKEN or configure the tenant integration)'], using: 'none' };
  }
  const ver = process.env.META_WA_GRAPH_VERSION || 'v22.0';
  const url = `https://graph.facebook.com/${ver}/${wabaId}/message_templates?fields=name,language,category,status,components,id,rejected_reason&limit=200`;
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err: any) {
    return { synced: 0, errors: [`Network error: ${err?.message || 'unknown'}`], using: source };
  }
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error?.message || `HTTP ${resp.status}`;
    return { synced: 0, errors: [`Meta API error: ${msg}`], using: source };
  }
  const templates = json?.data || [];
  const errors: string[] = [];
  let synced = 0;
  for (const t of templates) {
    try {
      const parsed = parseMetaTemplate(t);
      await upsertTemplate(tenantId, { ...parsed, mark_synced: true });
      synced++;
    } catch (err: any) {
      errors.push(`${t?.name || 'unknown'}: ${err?.message || 'parse failed'}`);
    }
  }
  logger.info({ tenantId, synced, errorCount: errors.length, source }, 'Template sync complete');
  return { synced, errors, using: source };
}

/** Parse Meta's template JSON shape into our UpsertTemplateInput. */
function parseMetaTemplate(t: any): UpsertTemplateInput {
  const components = Array.isArray(t.components) ? t.components : [];
  const header = components.find((c: any) => c.type === 'HEADER');
  const body = components.find((c: any) => c.type === 'BODY');
  const footer = components.find((c: any) => c.type === 'FOOTER');
  const buttonsComp = components.find((c: any) => c.type === 'BUTTONS');
  return {
    name: t.name,
    language: t.language || 'en_US',
    category: t.category || null,
    status: t.status || 'PENDING',
    meta_template_id: t.id || null,
    header_format: header?.format || null,
    header_text: header?.format === 'TEXT' ? header?.text : null,
    body_text: body?.text || null,
    footer_text: footer?.text || null,
    buttons: buttonsComp?.buttons || [],
    rejection_reason: t.rejected_reason || null,
    raw_components: components,
  };
}

/** Resolve {token, wabaId} for a tenant — tenant integration > env default. */
async function resolveMetaCreds(tenantId: string): Promise<{
  token: string | null; wabaId: string | null; source: 'tenant' | 'env_default' | 'none';
}> {
  try {
    const cfg = await loadTenantWhatsAppConfig(tenantId);
    if (cfg && cfg.status === 'active' && cfg.provider === 'meta' && cfg.business_account_id) {
      // loadTenantWhatsAppConfig already returns credentials decrypted.
      const token = (cfg.credentials as any)?.access_token || (cfg.credentials as any)?.token || null;
      if (token) {
        return { token, wabaId: cfg.business_account_id, source: 'tenant' };
      }
    }
  } catch (err: any) {
    logger.warn({ tenantId, err: err?.message }, 'tenant Meta cred resolve failed — falling back to env');
  }
  const envToken = process.env.META_WA_ACCESS_TOKEN || null;
  const envWaba = process.env.META_WA_BUSINESS_ACCOUNT_ID || null;
  if (envToken && envWaba) return { token: envToken, wabaId: envWaba, source: 'env_default' };
  return { token: null, wabaId: null, source: 'none' };
}
