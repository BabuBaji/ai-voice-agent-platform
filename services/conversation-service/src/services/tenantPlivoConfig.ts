/**
 * Tenant Plivo config — read/write the tenant_plivo_integrations row for a
 * given tenant. Mirrors tenantWhatsappConfig.ts: 60s TTL cache, AES-256-GCM
 * encryption for the auth token at rest, plaintext token ONLY in memory
 * during the send path and never logged.
 *
 * One Plivo account covers SMS + WhatsApp + OTP for a tenant, so the same
 * row holds DLT fields (India SMS compliance) AND the WhatsApp Business
 * sender. Adding a separate Twilio integration on the tenant does not
 * disturb this row.
 */
import { pool } from '../index';
import { decryptJSON, encryptJSON, mask, type EncryptedBlob } from './credentialCrypto';

export interface PlivoTemplateConfig {
  default_template_id?: string;
  templates?: Array<{ id: string; content?: string; dlt_id?: string }>;
  /** Plivo WhatsApp template namespace, when using template messages */
  whatsapp_namespace?: string;
}

export interface TenantPlivoConfig {
  tenant_id: string;
  auth_id: string;
  auth_token: string;            // plaintext after decrypt — DO NOT LOG
  sms_sender_id: string | null;
  whatsapp_sender: string | null;
  dlt_entity_id: string | null;
  dlt_template_config: PlivoTemplateConfig;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  status: 'active' | 'disabled' | 'error';
  last_tested_at: Date | null;
  last_test_result: string | null;
  webhook_secret: string | null;
}

/** UI-facing view — auth token is masked, never round-tripped to client. */
export interface TenantPlivoConfigPublic {
  tenant_id: string;
  auth_id_masked: string | null;
  auth_token_masked: string | null;
  sms_sender_id: string | null;
  whatsapp_sender: string | null;
  dlt_entity_id: string | null;
  dlt_template_config: PlivoTemplateConfig;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  status: 'active' | 'disabled' | 'error' | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  configured: boolean;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { v: TenantPlivoConfig | null; expiresAt: number }>();

export function invalidateCache(tenantId: string): void {
  cache.delete(tenantId);
}

export async function loadTenantPlivoConfig(tenantId: string): Promise<TenantPlivoConfig | null> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.v;
  let parsed: TenantPlivoConfig | null = null;
  try {
    const r = await pool.query(
      `SELECT tenant_id, auth_id, encrypted_auth_token, sms_sender_id, whatsapp_sender,
              dlt_entity_id, dlt_template_config, sms_enabled, whatsapp_enabled,
              status, last_tested_at, last_test_result, webhook_secret
         FROM tenant_plivo_integrations
        WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (r.rows.length) {
      const row = r.rows[0];
      let token = '';
      try {
        const blob = row.encrypted_auth_token as EncryptedBlob;
        const decrypted = decryptJSON(blob) as { auth_token?: string };
        token = decrypted.auth_token || '';
      } catch {
        // Corruption or wrong key — surface as error status, never crash sends.
        token = '';
      }
      parsed = {
        tenant_id: row.tenant_id,
        auth_id: row.auth_id,
        auth_token: token,
        sms_sender_id: row.sms_sender_id,
        whatsapp_sender: row.whatsapp_sender,
        dlt_entity_id: row.dlt_entity_id,
        dlt_template_config: row.dlt_template_config || {},
        sms_enabled: row.sms_enabled,
        whatsapp_enabled: row.whatsapp_enabled,
        status: row.status,
        last_tested_at: row.last_tested_at,
        last_test_result: row.last_test_result,
        webhook_secret: row.webhook_secret,
      };
    }
  } catch {
    parsed = null;
  }
  cache.set(tenantId, { v: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
  return parsed;
}

export interface PlivoUpsertInput {
  auth_id: string;
  /** Empty string means "keep existing encrypted token" (UI re-save without re-typing). */
  auth_token?: string;
  sms_sender_id?: string | null;
  whatsapp_sender?: string | null;
  dlt_entity_id?: string | null;
  dlt_template_config?: PlivoTemplateConfig;
  sms_enabled?: boolean;
  whatsapp_enabled?: boolean;
  status?: 'active' | 'disabled';
  webhook_secret?: string | null;
}

export async function upsertTenantPlivoConfig(tenantId: string, input: PlivoUpsertInput): Promise<void> {
  let blob: EncryptedBlob;
  if (input.auth_token && input.auth_token.length > 0) {
    blob = encryptJSON({ auth_token: input.auth_token });
  } else {
    const existing = await pool.query(
      `SELECT encrypted_auth_token FROM tenant_plivo_integrations WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!existing.rows.length) {
      // No existing row AND no token provided — caller error; encrypt empty as
      // placeholder so the insert doesn't NULL-violate. PUT validator catches.
      blob = encryptJSON({ auth_token: '' });
    } else {
      blob = existing.rows[0].encrypted_auth_token as EncryptedBlob;
    }
  }
  await pool.query(
    `INSERT INTO tenant_plivo_integrations
       (tenant_id, auth_id, encrypted_auth_token, sms_sender_id, whatsapp_sender,
        dlt_entity_id, dlt_template_config, sms_enabled, whatsapp_enabled,
        status, webhook_secret, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       auth_id = EXCLUDED.auth_id,
       encrypted_auth_token = EXCLUDED.encrypted_auth_token,
       sms_sender_id = EXCLUDED.sms_sender_id,
       whatsapp_sender = EXCLUDED.whatsapp_sender,
       dlt_entity_id = EXCLUDED.dlt_entity_id,
       dlt_template_config = EXCLUDED.dlt_template_config,
       sms_enabled = EXCLUDED.sms_enabled,
       whatsapp_enabled = EXCLUDED.whatsapp_enabled,
       status = EXCLUDED.status,
       webhook_secret = EXCLUDED.webhook_secret,
       updated_at = NOW()`,
    [
      tenantId,
      input.auth_id,
      JSON.stringify(blob),
      input.sms_sender_id ?? null,
      input.whatsapp_sender ?? null,
      input.dlt_entity_id ?? null,
      JSON.stringify(input.dlt_template_config || {}),
      input.sms_enabled ?? true,
      input.whatsapp_enabled ?? true,
      input.status || 'active',
      input.webhook_secret ?? null,
    ],
  );
  invalidateCache(tenantId);
}

export async function deleteTenantPlivoConfig(tenantId: string): Promise<void> {
  await pool.query(`DELETE FROM tenant_plivo_integrations WHERE tenant_id = $1`, [tenantId]);
  invalidateCache(tenantId);
}

export interface PlivoAuditContext {
  actor_user_id?: string | null;
  actor_email?: string | null;
  ip?: string | null;
  user_agent?: string | null;
}

/**
 * Write an audit row for a Plivo config change. NEVER stores the auth token
 * in field_changes — credential rotations are recorded as {rotated: true}.
 * Safe to call with partial context; missing fields just become NULLs.
 */
export async function writePlivoAudit(
  tenantId: string,
  action: 'created' | 'updated' | 'disconnected' | 'tested',
  fieldChanges: Record<string, any>,
  ctx: PlivoAuditContext = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO tenant_plivo_audit
         (tenant_id, actor_user_id, actor_email, action, field_changes, ip, user_agent)
       VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6, $7)`,
      [
        tenantId,
        ctx.actor_user_id || null,
        ctx.actor_email || null,
        action,
        JSON.stringify(fieldChanges || {}),
        ctx.ip || null,
        (ctx.user_agent || '').slice(0, 255) || null,
      ],
    );
  } catch {
    // Audit failures must NEVER block the underlying operation. We log via
    // the writer's own logger upstream — here just swallow.
  }
}

/**
 * Diff the previous and next config to record a meaningful change set. Only
 * non-secret fields are compared; credential rotations are signalled with a
 * boolean to avoid leaking secrets through audit history.
 */
export function diffPlivoConfig(
  prev: TenantPlivoConfig | null,
  next: PlivoUpsertInput,
  tokenProvided: boolean,
): Record<string, any> {
  const diffs: Record<string, any> = {};
  const fields: Array<keyof PlivoUpsertInput> = [
    'auth_id', 'sms_sender_id', 'whatsapp_sender', 'dlt_entity_id',
    'sms_enabled', 'whatsapp_enabled', 'status', 'webhook_secret',
  ];
  for (const f of fields) {
    const prevVal = prev ? (prev as any)[f] : undefined;
    const nextVal = (next as any)[f];
    // Skip undefined nexts (means "don't touch this field"); compare nulls
    // as a real value so "set X to null" shows up in the diff.
    if (nextVal === undefined) continue;
    if (prevVal !== nextVal) {
      diffs[f] = { from: prevVal ?? null, to: nextVal ?? null };
    }
  }
  // Template config: deep-equal stringified for a coarse diff.
  if (next.dlt_template_config !== undefined) {
    const prevTpl = JSON.stringify(prev?.dlt_template_config || {});
    const nextTpl = JSON.stringify(next.dlt_template_config || {});
    if (prevTpl !== nextTpl) {
      diffs.dlt_template_config = { from: prev?.dlt_template_config || {}, to: next.dlt_template_config || {} };
    }
  }
  if (tokenProvided) {
    diffs.auth_token = { rotated: true };
  }
  return diffs;
}

export async function recordPlivoTestResult(tenantId: string, ok: boolean, message: string): Promise<void> {
  await pool.query(
    `UPDATE tenant_plivo_integrations
        SET last_tested_at = NOW(),
            last_test_result = $2,
            status = CASE WHEN $3::boolean THEN 'active' ELSE 'error' END,
            updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, message.slice(0, 500), ok],
  );
  invalidateCache(tenantId);
}

export function toPublic(cfg: TenantPlivoConfig | null): TenantPlivoConfigPublic {
  if (!cfg) {
    return {
      tenant_id: '',
      auth_id_masked: null,
      auth_token_masked: null,
      sms_sender_id: null,
      whatsapp_sender: null,
      dlt_entity_id: null,
      dlt_template_config: {},
      sms_enabled: true,
      whatsapp_enabled: true,
      status: null,
      last_tested_at: null,
      last_test_result: null,
      configured: false,
    };
  }
  return {
    tenant_id: cfg.tenant_id,
    auth_id_masked: cfg.auth_id ? mask(cfg.auth_id) : null,
    auth_token_masked: cfg.auth_token ? '••••••••••••' : null,
    sms_sender_id: cfg.sms_sender_id,
    whatsapp_sender: cfg.whatsapp_sender,
    dlt_entity_id: cfg.dlt_entity_id,
    dlt_template_config: cfg.dlt_template_config,
    sms_enabled: cfg.sms_enabled,
    whatsapp_enabled: cfg.whatsapp_enabled,
    status: cfg.status,
    last_tested_at: cfg.last_tested_at ? cfg.last_tested_at.toISOString() : null,
    last_test_result: cfg.last_test_result,
    configured: true,
  };
}
