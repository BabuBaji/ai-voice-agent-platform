import { pool } from '../index';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

/**
 * GDPR / privacy helpers — PII redaction + retention sweeper.
 *
 * Per-tenant settings live in identity-service `tenants.settings`:
 *   { data_retention_days: number, pii_obfuscation: boolean }
 *
 * Since conversation-service runs against `conversation_db` and tenants live in
 * `identity_db`, we fetch settings via HTTP on demand and cache for 5 minutes.
 */

const SETTINGS_TTL_MS = 5 * 60 * 1000;
const settingsCache = new Map<string, { settings: any; expires: number }>();

async function fetchTenantSettings(tenantId: string): Promise<any> {
  const cached = settingsCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.settings;

  // identity-service /tenants/me requires auth, but for internal sweeper use we
  // query identity_db directly via the same pg pool (same Postgres instance).
  try {
    const r = await pool.query(
      `SELECT settings FROM identity_db.public.tenants WHERE id = $1`,
      [tenantId],
    );
    const settings = r.rows[0]?.settings || {};
    settingsCache.set(tenantId, { settings, expires: Date.now() + SETTINGS_TTL_MS });
    return settings;
  } catch {
    // Cross-database query — fallback: load via direct pg client to identity_db
    try {
      const { Pool } = require('pg');
      const idPool = new (Pool as any)({
        connectionString: (config.databaseUrl || '').replace(/\/[^/]+$/, '/identity_db'),
        max: 2,
      });
      const r = await idPool.query(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
      await idPool.end();
      const settings = r.rows[0]?.settings || {};
      settingsCache.set(tenantId, { settings, expires: Date.now() + SETTINGS_TTL_MS });
      return settings;
    } catch (err: any) {
      logger.warn({ err: err.message, tenantId }, 'failed to load tenant settings, using defaults');
      return {};
    }
  }
}

// ─── PII redaction ──────────────────────────────────────────────────────

const RX_EMAIL = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
// Phone: international or national, 7-15 digits with optional separators
const RX_PHONE = /(?:\+?\d{1,3}[ .\-]?)?(?:\(?\d{2,4}\)?[ .\-]?)?\d{3,4}[ .\-]?\d{3,4}\b/g;
// Credit card: 13-19 digits with separators
const RX_CARD = /\b(?:\d[ -]?){13,19}\b/g;

/**
 * Best-effort PII masking. Replaces email/phone/card with placeholder tokens.
 * Designed to be safe: false negatives are tolerable (regex can't catch every
 * format), false positives on the phone regex are minimised by requiring
 * minimum digit counts.
 */
export function redactPii(text: string): string {
  if (!text) return text;
  return text
    .replace(RX_EMAIL, '[redacted-email]')
    .replace(RX_CARD, (m) => (m.replace(/\D/g, '').length >= 13 ? '[redacted-card]' : m))
    .replace(RX_PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[redacted-phone]' : m));
}

export async function maybeRedactForTenant(tenantId: string, text: string): Promise<string> {
  const settings = await fetchTenantSettings(tenantId);
  return settings?.pii_obfuscation ? redactPii(text) : text;
}

// ─── Retention sweeper ──────────────────────────────────────────────────

/** Deletes conversations + messages + recording files older than each
 *  tenant's `data_retention_days` setting. Default 365d if unset, 0 = disabled. */
export async function runRetentionSweep(): Promise<{ tenants: number; conversations: number; files: number }> {
  let conversationsDeleted = 0;
  let filesDeleted = 0;

  // Group conversations by tenant so we apply per-tenant retention windows.
  const tenants = await pool.query(`SELECT DISTINCT tenant_id FROM conversations`);
  for (const row of tenants.rows) {
    const tenantId = row.tenant_id;
    const settings = await fetchTenantSettings(tenantId);
    const days = parseInt(settings?.data_retention_days ?? '365', 10);
    if (!days || days < 1) continue; // 0 / negative = no auto-deletion

    // Find expiring conversations
    const old = await pool.query(
      `SELECT id FROM conversations
       WHERE tenant_id = $1
         AND created_at < NOW() - ($2 || ' days')::interval`,
      [tenantId, String(days)],
    );

    for (const c of old.rows) {
      // Delete recording files from disk
      const dir = path.resolve(config.recordingsDir);
      for (const ext of ['webm', 'ogg', 'mp4', 'wav']) {
        const p = path.join(dir, `${c.id}.${ext}`);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); filesDeleted++; } catch { /* ignore */ }
        }
      }
      // Delete messages then conversation row (cascade-friendly)
      await pool.query(`DELETE FROM messages WHERE conversation_id = $1`, [c.id]);
      await pool.query(`DELETE FROM conversations WHERE id = $1`, [c.id]);
      conversationsDeleted++;
    }

    if (old.rows.length > 0) {
      logger.info(
        { tenantId, days, deleted: old.rows.length },
        'retention sweep deleted conversations',
      );
    }
  }

  return { tenants: tenants.rows.length, conversations: conversationsDeleted, files: filesDeleted };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startRetentionSweeper(intervalMs: number = 6 * 60 * 60 * 1000): void {
  if (sweepTimer) return;
  // Kick off one sweep ~30s after start so logs surface any setup issues early.
  setTimeout(() => {
    void runRetentionSweep().catch((err) =>
      logger.error({ err: err.message }, 'retention sweep failed'),
    );
  }, 30_000);
  sweepTimer = setInterval(() => {
    void runRetentionSweep().catch((err) =>
      logger.error({ err: err.message }, 'retention sweep failed'),
    );
  }, intervalMs);
  logger.info({ intervalHours: intervalMs / 3_600_000 }, 'retention sweeper scheduled');
}
