/**
 * Tenant WhatsApp config — read/write the tenant_whatsapp_integrations row
 * for a given tenant, with a small in-memory TTL cache so the hot send-path
 * doesn't hit Postgres for every brochure/recall message.
 *
 * Encryption: credentials live in `encrypted_credentials` JSONB; this module
 * is the only place plaintext credentials are exposed in process memory.
 * Logs never include plaintext — callers must not stringify the returned
 * `credentials` field into any output.
 */
import { pool } from '../index';
import { decryptJSON, encryptJSON, mask, type EncryptedBlob } from './credentialCrypto';

export type WhatsAppProvider = 'twilio' | 'meta' | 'gupshup' | 'wati' | 'interakt' | 'custom';
export type WhatsAppMode = 'sandbox' | 'production';

export interface TwilioWhatsAppCreds { account_sid: string; auth_token: string; }
export interface MetaWhatsAppCreds   { access_token: string; }
export interface GupshupCreds        { api_key: string; app_name?: string; }
export interface WatiCreds           { api_key: string; }
export interface InteraktCreds       { api_key: string; }
export type AnyCreds = TwilioWhatsAppCreds | MetaWhatsAppCreds | GupshupCreds | WatiCreds | InteraktCreds | Record<string, string>;

/** Full plaintext config — used only inside sendWhatsApp's tenant resolution path. */
export interface TenantWhatsAppConfig {
  tenant_id: string;
  provider: WhatsAppProvider;
  mode: WhatsAppMode;
  credentials: AnyCreds;          // plaintext after decrypt — DO NOT LOG
  sender_number: string | null;
  whatsapp_from: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  template_config: Record<string, any>;
  webhook_secret: string | null;
  status: 'active' | 'disabled' | 'error';
  last_tested_at: Date | null;
  last_test_result: string | null;
}

/** Public view — what the UI receives. Mirrors TenantWhatsAppConfig but
 *  with credentials replaced by masked strings. Tokens are never exposed. */
export interface TenantWhatsAppConfigPublic {
  tenant_id: string;
  provider: WhatsAppProvider | null;
  mode: WhatsAppMode;
  // For UI display:
  account_sid_masked: string | null;
  auth_token_masked: string | null;
  api_key_masked: string | null;
  access_token_masked: string | null;
  sender_number: string | null;
  whatsapp_from: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  template_config: Record<string, any>;
  status: 'active' | 'disabled' | 'error' | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  configured: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Cache — 60s TTL. Send path is hot enough that a fresh DB read per message
// would add ~5ms; cache means one read per tenant per minute. Cache is
// invalidated on write so the UI's "Save" → "Test" round-trip uses fresh.
// ────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { v: TenantWhatsAppConfig | null; expiresAt: number }>();

export function invalidateCache(tenantId: string): void {
  cache.delete(tenantId);
}

export async function loadTenantWhatsAppConfig(tenantId: string): Promise<TenantWhatsAppConfig | null> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.v;
  let parsed: TenantWhatsAppConfig | null = null;
  try {
    const r = await pool.query(
      `SELECT tenant_id, provider, mode, encrypted_credentials, sender_number, whatsapp_from,
              phone_number_id, business_account_id, template_config, webhook_secret,
              status, last_tested_at, last_test_result
         FROM tenant_whatsapp_integrations
        WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (r.rows.length) {
      const row = r.rows[0];
      let creds: AnyCreds = {};
      try {
        creds = decryptJSON(row.encrypted_credentials as EncryptedBlob) as AnyCreds;
      } catch {
        // Corruption or wrong key — surface as error status, never crash sends.
        creds = {};
      }
      parsed = {
        tenant_id: row.tenant_id,
        provider: row.provider,
        mode: row.mode,
        credentials: creds,
        sender_number: row.sender_number,
        whatsapp_from: row.whatsapp_from,
        phone_number_id: row.phone_number_id,
        business_account_id: row.business_account_id,
        template_config: row.template_config || {},
        webhook_secret: row.webhook_secret,
        status: row.status,
        last_tested_at: row.last_tested_at,
        last_test_result: row.last_test_result,
      };
    }
  } catch {
    parsed = null;
  }
  cache.set(tenantId, { v: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
  return parsed;
}

export interface UpsertInput {
  provider: WhatsAppProvider;
  mode: WhatsAppMode;
  credentials: AnyCreds;
  sender_number?: string | null;
  whatsapp_from?: string | null;
  phone_number_id?: string | null;
  business_account_id?: string | null;
  template_config?: Record<string, any>;
  webhook_secret?: string | null;
  status?: 'active' | 'disabled';
}

export async function upsertTenantWhatsAppConfig(
  tenantId: string, input: UpsertInput,
): Promise<void> {
  // If credentials object is empty (user only updating non-credential fields),
  // we MUST keep the existing encrypted creds. Detect and re-encrypt
  // accordingly.
  let blob: EncryptedBlob;
  if (input.credentials && Object.keys(input.credentials).length > 0) {
    blob = encryptJSON(input.credentials);
  } else {
    const existing = await pool.query(
      `SELECT encrypted_credentials FROM tenant_whatsapp_integrations WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!existing.rows.length) {
      // No existing row AND no creds provided — encrypt an empty object as a
      // placeholder. The PUT validator should have caught this; just safe-default.
      blob = encryptJSON({});
    } else {
      blob = existing.rows[0].encrypted_credentials as EncryptedBlob;
    }
  }
  await pool.query(
    `INSERT INTO tenant_whatsapp_integrations
       (tenant_id, provider, mode, encrypted_credentials, sender_number, whatsapp_from,
        phone_number_id, business_account_id, template_config, webhook_secret, status, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10, $11, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       mode = EXCLUDED.mode,
       encrypted_credentials = EXCLUDED.encrypted_credentials,
       sender_number = EXCLUDED.sender_number,
       whatsapp_from = EXCLUDED.whatsapp_from,
       phone_number_id = EXCLUDED.phone_number_id,
       business_account_id = EXCLUDED.business_account_id,
       template_config = EXCLUDED.template_config,
       webhook_secret = EXCLUDED.webhook_secret,
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [
      tenantId, input.provider, input.mode, JSON.stringify(blob),
      input.sender_number ?? null, input.whatsapp_from ?? null,
      input.phone_number_id ?? null, input.business_account_id ?? null,
      JSON.stringify(input.template_config || {}),
      input.webhook_secret ?? null, input.status || 'active',
    ],
  );
  invalidateCache(tenantId);
}

export async function deleteTenantWhatsAppConfig(tenantId: string): Promise<void> {
  await pool.query(`DELETE FROM tenant_whatsapp_integrations WHERE tenant_id = $1`, [tenantId]);
  invalidateCache(tenantId);
}

export async function recordTestResult(
  tenantId: string, ok: boolean, message: string,
): Promise<void> {
  await pool.query(
    `UPDATE tenant_whatsapp_integrations
        SET last_tested_at = NOW(),
            last_test_result = $2,
            status = CASE WHEN $3::boolean THEN 'active' ELSE 'error' END,
            updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, message.slice(0, 500), ok],
  );
  invalidateCache(tenantId);
}

/** Build the masked public view for the UI. */
export function toPublic(cfg: TenantWhatsAppConfig | null): TenantWhatsAppConfigPublic {
  if (!cfg) {
    return {
      tenant_id: '',
      provider: null,
      mode: 'sandbox',
      account_sid_masked: null, auth_token_masked: null,
      api_key_masked: null, access_token_masked: null,
      sender_number: null, whatsapp_from: null,
      phone_number_id: null, business_account_id: null,
      template_config: {},
      status: null, last_tested_at: null, last_test_result: null,
      configured: false,
    };
  }
  const c = cfg.credentials as any;
  return {
    tenant_id: cfg.tenant_id,
    provider: cfg.provider,
    mode: cfg.mode,
    account_sid_masked:    c.account_sid    ? mask(c.account_sid)    : null,
    auth_token_masked:     c.auth_token     ? '••••••••••••'         : null,
    api_key_masked:        c.api_key        ? '••••••••••••'         : null,
    access_token_masked:   c.access_token   ? '••••••••••••'         : null,
    sender_number: cfg.sender_number,
    whatsapp_from: cfg.whatsapp_from,
    phone_number_id: cfg.phone_number_id,
    business_account_id: cfg.business_account_id,
    template_config: cfg.template_config,
    status: cfg.status,
    last_tested_at: cfg.last_tested_at ? cfg.last_tested_at.toISOString() : null,
    last_test_result: cfg.last_test_result,
    configured: true,
  };
}
