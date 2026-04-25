import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { encryptJson, decryptJson, encryptionEnabled } from '../utils/encryption';

/**
 * Wrap a credentials JSONB row from the DB with on-demand decryption.
 * Returns plain object credentials regardless of whether the row was
 * stored encrypted (envelope) or as legacy plaintext.
 */
function decodeCreds(stored: unknown): Record<string, unknown> {
  const decoded = decryptJson(stored);
  return (decoded && typeof decoded === 'object' && !Array.isArray(decoded))
    ? (decoded as Record<string, unknown>)
    : {};
}

export interface CatalogField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
  credential?: boolean;
}

export interface CatalogEntry {
  provider: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  docs?: string;
  fields: CatalogField[];
}

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  {
    provider: 'twilio', name: 'Twilio',
    description: 'Voice calls, SMS, and phone number management',
    category: 'Telephony', icon: 'T', color: 'bg-red-500',
    docs: 'https://www.twilio.com/docs',
    fields: [
      { key: 'account_sid', label: 'Account SID', type: 'text', required: true, credential: true },
      { key: 'auth_token', label: 'Auth Token', type: 'password', required: true, credential: true },
      { key: 'from_number', label: 'From Number', type: 'text', placeholder: '+14155550100' },
    ],
  },
  {
    provider: 'exotel', name: 'Exotel',
    description: 'Cloud telephony for India and Southeast Asia',
    category: 'Telephony', icon: 'E', color: 'bg-blue-600',
    docs: 'https://developer.exotel.com',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
      { key: 'api_token', label: 'API Token', type: 'password', required: true, credential: true },
      { key: 'sid', label: 'Account SID', type: 'text', required: true },
      { key: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'api.exotel.com' },
    ],
  },
  {
    provider: 'openai', name: 'OpenAI',
    description: 'GPT-4o and GPT-4 Turbo language models',
    category: 'AI / LLM', icon: 'AI', color: 'bg-gray-900',
    docs: 'https://platform.openai.com/docs',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true, placeholder: 'sk-...' },
      { key: 'organization', label: 'Organization (optional)', type: 'text' },
    ],
  },
  {
    provider: 'anthropic', name: 'Anthropic',
    description: 'Claude language models for conversation',
    category: 'AI / LLM', icon: 'A', color: 'bg-amber-700',
    docs: 'https://docs.claude.com',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true, placeholder: 'sk-ant-...' },
    ],
  },
  {
    provider: 'google', name: 'Google',
    description: 'Gemini models and Google Cloud TTS',
    category: 'AI / LLM', icon: 'G', color: 'bg-blue-500',
    docs: 'https://ai.google.dev',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
    ],
  },
  {
    provider: 'elevenlabs', name: 'ElevenLabs',
    description: 'Ultra-realistic AI voice synthesis',
    category: 'Voice', icon: 'XI', color: 'bg-violet-600',
    docs: 'https://elevenlabs.io/docs',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
      { key: 'default_voice_id', label: 'Default Voice ID', type: 'text' },
    ],
  },
  {
    provider: 'deepgram', name: 'Deepgram',
    description: 'Real-time speech-to-text transcription',
    category: 'Voice', icon: 'DG', color: 'bg-emerald-600',
    docs: 'https://developers.deepgram.com',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
    ],
  },
  {
    provider: 'salesforce', name: 'Salesforce',
    description: 'CRM data sync and lead management',
    category: 'CRM', icon: 'SF', color: 'bg-sky-500',
    docs: 'https://developer.salesforce.com',
    fields: [
      { key: 'instance_url', label: 'Instance URL', type: 'url', required: true, placeholder: 'https://mycompany.my.salesforce.com' },
      { key: 'client_id', label: 'Consumer Key', type: 'text', required: true },
      { key: 'client_secret', label: 'Consumer Secret', type: 'password', required: true, credential: true },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password_token', label: 'Password + Security Token', type: 'password', required: true, credential: true },
    ],
  },
  {
    provider: 'hubspot', name: 'HubSpot',
    description: 'Marketing automation and CRM integration',
    category: 'CRM', icon: 'H', color: 'bg-orange-500',
    docs: 'https://developers.hubspot.com',
    fields: [
      { key: 'access_token', label: 'Private App Access Token', type: 'password', required: true, credential: true },
      { key: 'portal_id', label: 'Portal ID (optional)', type: 'text' },
    ],
  },
  {
    provider: 'sendgrid', name: 'SendGrid',
    description: 'Email delivery and marketing campaigns',
    category: 'Email', icon: 'SG', color: 'bg-blue-400',
    docs: 'https://docs.sendgrid.com',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
      { key: 'from_email', label: 'From Email', type: 'text', placeholder: 'noreply@example.com' },
      { key: 'from_name', label: 'From Name', type: 'text' },
    ],
  },
  {
    provider: 'slack', name: 'Slack',
    description: 'Real-time notifications and alerts',
    category: 'Productivity', icon: 'SL', color: 'bg-purple-600',
    docs: 'https://api.slack.com',
    fields: [
      { key: 'bot_token', label: 'Bot User OAuth Token', type: 'password', required: true, credential: true, placeholder: 'xoxb-...' },
      { key: 'default_channel', label: 'Default Channel', type: 'text', placeholder: '#alerts' },
    ],
  },
  {
    provider: 'zapier', name: 'Zapier',
    description: 'Connect with 5000+ apps via workflows',
    category: 'Automation', icon: 'Z', color: 'bg-orange-600',
    docs: 'https://zapier.com/developer',
    fields: [
      { key: 'webhook_url', label: 'Catch-hook Webhook URL', type: 'url', required: true, credential: true },
    ],
  },
  {
    provider: 'make', name: 'Make',
    description: 'Visual automation platform for workflows',
    category: 'Automation', icon: 'M', color: 'bg-indigo-600',
    docs: 'https://www.make.com/en/help',
    fields: [
      { key: 'webhook_url', label: 'Scenario Webhook URL', type: 'url', required: true, credential: true },
    ],
  },
  {
    provider: 'n8n', name: 'N8N',
    description: 'Self-hosted workflow automation',
    category: 'Automation', icon: 'N8', color: 'bg-pink-600',
    docs: 'https://docs.n8n.io',
    fields: [
      { key: 'base_url', label: 'N8N Base URL', type: 'url', required: true, placeholder: 'https://n8n.mycompany.com' },
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
    ],
  },
  {
    provider: 'cal_com', name: 'Cal.com',
    description: 'Open-source scheduling and booking',
    category: 'Calendar', icon: 'C', color: 'bg-gray-800',
    docs: 'https://cal.com/docs',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, credential: true },
      { key: 'event_type_id', label: 'Event Type ID', type: 'text' },
    ],
  },
  {
    provider: 'google_calendar', name: 'Google Calendar',
    description: 'Appointment booking and scheduling',
    category: 'Calendar', icon: 'GC', color: 'bg-green-600',
    docs: 'https://developers.google.com/calendar',
    fields: [
      { key: 'client_id', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'password', required: true, credential: true },
      { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: true, credential: true },
      { key: 'calendar_id', label: 'Calendar ID', type: 'text', placeholder: 'primary' },
    ],
  },
];

const upsertSchema = z.object({
  config: z.record(z.string(), z.any()).default({}),
  credentials: z.record(z.string(), z.any()).default({}),
  enabled: z.boolean().default(true),
});

function redactCredentials(creds: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds || {})) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v.length <= 8 ? '••••••••' : `••••${v.slice(-4)}`;
    }
  }
  return out;
}

export function integrationRouter(): Router {
  const router = Router();
  router.use(authMiddleware);

  // GET /integrations — catalog merged with per-tenant connection state
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const result = await pool.query(
        `SELECT provider, enabled, config, test_status, test_message, last_tested_at, connected_at, updated_at,
                credentials
         FROM integrations WHERE tenant_id = $1`,
        [tenantId],
      );
      const rows: Record<string, any> = {};
      for (const r of result.rows) {
        rows[r.provider] = r;
      }

      const data = INTEGRATION_CATALOG.map((entry) => {
        const row = rows[entry.provider];
        return {
          ...entry,
          connected: Boolean(row && row.enabled),
          enabled: row?.enabled ?? false,
          config: row?.config ?? {},
          credentials_preview: row ? redactCredentials(decodeCreds(row.credentials)) : {},
          test_status: row?.test_status ?? null,
          test_message: row?.test_message ?? null,
          last_tested_at: row?.last_tested_at ?? null,
          connected_at: row?.connected_at ?? null,
          updated_at: row?.updated_at ?? null,
        };
      });

      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  // GET /integrations/:provider
  router.get('/:provider', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const { provider } = req.params;

      const entry = INTEGRATION_CATALOG.find((e) => e.provider === provider);
      if (!entry) {
        res.status(404).json({ error: 'Unknown integration provider' });
        return;
      }

      const result = await pool.query(
        `SELECT provider, enabled, config, credentials, test_status, test_message, last_tested_at, connected_at, updated_at
         FROM integrations WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );
      const row = result.rows[0] || null;

      res.json({
        ...entry,
        connected: Boolean(row && row.enabled),
        enabled: row?.enabled ?? false,
        config: row?.config ?? {},
        credentials_preview: row ? redactCredentials(decodeCreds(row.credentials)) : {},
        test_status: row?.test_status ?? null,
        test_message: row?.test_message ?? null,
        last_tested_at: row?.last_tested_at ?? null,
        connected_at: row?.connected_at ?? null,
        updated_at: row?.updated_at ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  // PUT /integrations/:provider — upsert credentials & config
  router.put('/:provider', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const { provider } = req.params;

      const entry = INTEGRATION_CATALOG.find((e) => e.provider === provider);
      if (!entry) {
        res.status(404).json({ error: 'Unknown integration provider' });
        return;
      }

      const parsed = upsertSchema.parse(req.body);

      // Validate required fields are present
      const missing: string[] = [];
      for (const f of entry.fields) {
        if (!f.required) continue;
        const src = f.credential ? parsed.credentials : parsed.config;
        const v = src?.[f.key];
        if (!v || (typeof v === 'string' && !v.trim())) missing.push(f.label);
      }
      if (missing.length > 0) {
        res.status(400).json({ error: 'Validation Error', message: `Missing required fields: ${missing.join(', ')}` });
        return;
      }

      // If a credential field is blank but already exists in DB, keep the existing value
      const existing = await pool.query(
        `SELECT credentials FROM integrations WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );
      if (existing.rows.length > 0) {
        const existingCreds = decodeCreds(existing.rows[0].credentials);
        for (const f of entry.fields) {
          if (!f.credential) continue;
          const v = parsed.credentials?.[f.key];
          if ((!v || (typeof v === 'string' && !v.trim())) && existingCreds[f.key]) {
            parsed.credentials[f.key] = existingCreds[f.key] as any;
          }
        }
      }

      // Encrypt-at-rest before persisting (no-op when INTEGRATION_ENCRYPTION_KEY unset)
      const credsToStore = encryptJson(parsed.credentials);

      await pool.query(
        `INSERT INTO integrations (tenant_id, provider, enabled, config, credentials, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (tenant_id, provider) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             config = EXCLUDED.config,
             credentials = EXCLUDED.credentials,
             updated_at = now()`,
        [
          tenantId,
          provider,
          parsed.enabled,
          JSON.stringify(parsed.config),
          JSON.stringify(credsToStore),
        ],
      );

      res.json({ provider, connected: parsed.enabled, message: 'Integration saved' });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation Error', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // DELETE /integrations/:provider
  router.delete('/:provider', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const { provider } = req.params;
      await pool.query(
        `DELETE FROM integrations WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );
      res.json({ provider, connected: false, message: 'Disconnected' });
    } catch (err) {
      next(err);
    }
  });

  // POST /integrations/:provider/test — basic sanity check (full adapter tests are Phase 2)
  router.post('/:provider/test', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const { provider } = req.params;

      const entry = INTEGRATION_CATALOG.find((e) => e.provider === provider);
      if (!entry) {
        res.status(404).json({ error: 'Unknown integration provider' });
        return;
      }

      const result = await pool.query(
        `SELECT credentials FROM integrations WHERE tenant_id = $1 AND provider = $2`,
        [tenantId, provider],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Integration not connected' });
        return;
      }
      const creds = decodeCreds(result.rows[0].credentials);

      const missing: string[] = [];
      for (const f of entry.fields) {
        if (!f.required || !f.credential) continue;
        if (!creds[f.key] || (typeof creds[f.key] === 'string' && !creds[f.key].trim())) {
          missing.push(f.label);
        }
      }

      const status = missing.length === 0 ? 'ok' : 'error';
      const message = missing.length === 0
        ? 'Credentials saved (full connection test not implemented in this MVP)'
        : `Missing: ${missing.join(', ')}`;

      await pool.query(
        `UPDATE integrations SET test_status = $1, test_message = $2, last_tested_at = now()
         WHERE tenant_id = $3 AND provider = $4`,
        [status, message, tenantId, provider],
      );

      res.json({ status, message, tested_at: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
