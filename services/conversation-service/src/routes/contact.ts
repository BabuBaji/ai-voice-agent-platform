/**
 * Contact Us / Lead capture module.
 *
 * Two route groups:
 *   publicContactRouter → /api/v1/contact  (unauthenticated POST + public GET by ref)
 *   adminContactRouter  → /api/v1/admin/contact-requests  (OWNER/ADMIN)
 *
 * Reference IDs come from a DB sequence and render as CNT-000001.
 *
 * The lead qualifier mirrors the support-module triage:
 *   1. Call ai-runtime /chat/analyze with a sales system prompt
 *   2. If the response comes back in the LEGACY shape (no rich keys), back-fill
 *      with a deterministic heuristic so the admin UI always has something useful.
 *
 * Optional CRM hook: when CRM_SERVICE_URL is set and the service is reachable,
 * we fire a best-effort create-lead call and store the returned id on the
 * contact row. Failures are non-fatal — the lead stays in contact_requests.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';

export const publicContactRouter = Router();
export const adminContactRouter = Router();

// ------------------------------ helpers ------------------------------

function getUserId(req: Request): string | null {
  return (req.headers['x-user-id'] as string) || null;
}
function getRoles(req: Request): string[] {
  const raw = (req.headers['x-user-roles'] as string) || '';
  return raw.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
}
function isAdmin(req: Request): boolean {
  const roles = getRoles(req);
  return roles.includes('ADMIN') || roles.includes('OWNER');
}
function sanitize(text: string | null | undefined, max = 10000): string | null {
  if (text == null) return null;
  // Strip ASCII control chars only (0x00–0x1F, 0x7F). Keep spaces, newlines
  // (0x0A) are excluded from the range since we explicitly allow them back in
  // for multi-line messages by adding \r\n below.
  return String(text).replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').slice(0, max);
}

const INQUIRY_TYPES = [
  'SALES', 'DEMO', 'SUPPORT', 'PRICING', 'PARTNERSHIP',
  'AGENT_SETUP', 'BULK_CAMPAIGN', 'WEB_CALL', 'CRM_INTEGRATION', 'BILLING', 'OTHER',
] as const;

const COMPANY_SIZES = [
  'INDIVIDUAL', 'STARTUP', 'SMALL_BUSINESS', 'COLLEGE_INSTITUTE', 'MID_MARKET', 'ENTERPRISE',
] as const;

const CONTACT_METHODS = ['EMAIL', 'PHONE', 'WHATSAPP', 'GOOGLE_MEET'] as const;

const STATUSES = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'IN_PROGRESS', 'CLOSED', 'SPAM',
] as const;

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const refPattern = /^CNT-\d{6,}$/;

const submitSchema = z.object({
  full_name: z.string().trim().min(1).max(160),
  email: z.string().email().max(200),
  phone: z.string().trim().min(4).max(40),
  company_name: z.string().trim().max(200).optional().nullable(),
  website: z.string().trim().max(400).optional().nullable(),
  inquiry_type: z.enum(INQUIRY_TYPES),
  company_size: z.enum(COMPANY_SIZES).optional().nullable(),
  preferred_contact_method: z.enum(CONTACT_METHODS).default('EMAIL'),
  message: z.string().trim().min(10).max(5000),
  consent_given: z.boolean().default(true),
  recaptcha_token: z.string().optional(),
  source_url: z.string().trim().max(500).optional().nullable(),
  metadata: z.any().default({}),
});

// Per-IP rate limiter for the public submit route. One process = in-memory map
// is fine; move to Redis if we scale horizontally.
const publicBuckets = new Map<string, { count: number; windowStart: number }>();
const PUBLIC_RATE_LIMIT = 8;           // 8 contact submissions
const PUBLIC_RATE_WINDOW_MS = 15 * 60_000;

function publicRateLimit(req: Request, res: Response): boolean {
  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  let bucket = publicBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > PUBLIC_RATE_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
  }
  bucket.count += 1;
  publicBuckets.set(ip, bucket);
  if (bucket.count > PUBLIC_RATE_LIMIT) {
    res.status(429).json({ error: 'Too Many Requests', message: 'Too many contact submissions from this IP. Try again later.' });
    return false;
  }
  return true;
}

async function verifyRecaptcha(token: string | undefined): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return true; // disabled in dev until secret is set
  if (!token) return false;
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    if (!r.ok) return false;
    const data = await r.json() as any;
    return !!data.success && (data.score == null || data.score >= 0.3);
  } catch { return false; }
}

async function generateRefId(): Promise<string> {
  const r = await pool.query<{ n: number }>(`SELECT nextval('contact_ref_seq')::int AS n`);
  return `CNT-${String(r.rows[0].n).padStart(6, '0')}`;
}

async function logEvent(reqId: string, eventType: string, description: string, payload?: any, visibility: 'internal' | 'public' = 'internal', authorId?: string | null) {
  await pool.query(
    `INSERT INTO contact_request_events (contact_request_id, event_type, description, author_id, visibility, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
    [reqId, eventType.slice(0, 40), description, authorId || null, visibility, payload ? JSON.stringify(payload) : null]
  );
}

// ------------------------------ lead qualifier ------------------------------
//
// Same trust-but-verify pattern as the support triage: try the LLM, and if it
// returns the legacy shape, build a useful output deterministically so the
// admin dashboard isn't empty even when Gemini/OpenAI are both down.

async function qualifyLead(reqRow: any): Promise<void> {
  const aiUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';
  const desc = [
    `INQUIRY_TYPE: ${reqRow.inquiry_type}`,
    `COMPANY_SIZE: ${reqRow.company_size || 'unknown'}`,
    `COMPANY: ${reqRow.company_name || 'unknown'}`,
    `WEBSITE: ${reqRow.website || 'unknown'}`,
    `PREFERRED_CONTACT: ${reqRow.preferred_contact_method}`,
    `MESSAGE: ${reqRow.message}`,
  ].join('\n');

  const systemPrompt =
    'You qualify inbound sales leads for an AI Voice Agent SaaS. Given a ' +
    'contact submission, return strict JSON with keys: summary (1 sentence), ' +
    `inquiry_type (one of: ${INQUIRY_TYPES.join('|')}), urgency (LOW|MEDIUM|HIGH|CRITICAL), ` +
    'lead_score (integer 0-100; higher = hotter lead; weight by company size, message ' +
    'urgency, and explicit product interest), product_interest (array of short tags like ' +
    '["agent_setup","bulk_campaign"]), recommended_team (SALES|PARTNERSHIPS|SUPPORT|ENGINEERING|FOUNDERS), ' +
    'next_best_action (one short sentence for the assigned team), draft_reply (polite 2-4 sentence ' +
    'reply acknowledging the inquiry and setting expectations). JSON only.';

  let payload: any = null;
  try {
    const r = await fetch(`${aiUrl}/chat/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: desc, system_prompt: systemPrompt, language: 'en' }),
    });
    if (r.ok) payload = await r.json();
  } catch { /* non-fatal */ }

  const shape = payload && typeof payload === 'object' ? payload : {};
  const llmRich = Boolean(shape.lead_score || shape.recommended_team || shape.draft_reply);

  // Heuristic lead score when LLM didn't give us one
  const sizeWeight: Record<string, number> = {
    INDIVIDUAL: 20, STARTUP: 45, SMALL_BUSINESS: 55,
    COLLEGE_INSTITUTE: 50, MID_MARKET: 75, ENTERPRISE: 90,
  };
  const inquiryWeight: Record<string, number> = {
    SALES: 15, DEMO: 20, PRICING: 15, PARTNERSHIP: 10,
    AGENT_SETUP: 10, BULK_CAMPAIGN: 15, WEB_CALL: 10, CRM_INTEGRATION: 10,
    SUPPORT: -10, BILLING: -5, OTHER: 0,
  };
  const urgencyBoost = /(asap|urgent|today|tomorrow|this week|immediately|critical)/i.test(reqRow.message || '') ? 15 : 0;
  const heuristicScore = Math.max(0, Math.min(100,
    (sizeWeight[reqRow.company_size || ''] || 35) +
    (inquiryWeight[reqRow.inquiry_type || ''] || 0) +
    urgencyBoost +
    (reqRow.website ? 5 : 0)
  ));
  const leadScore = typeof shape.lead_score === 'number' ? Math.round(shape.lead_score) : heuristicScore;

  const urgency = typeof shape.urgency === 'string' ? shape.urgency.toUpperCase()
    : leadScore >= 80 ? 'HIGH'
    : leadScore >= 60 ? 'MEDIUM'
    : leadScore >= 30 ? 'LOW'
    : 'LOW';

  // Team routing by inquiry type — matches the spec's auto-route table
  const teamByInquiry: Record<string, string> = {
    SALES: 'SALES', DEMO: 'SALES', PRICING: 'SALES',
    PARTNERSHIP: 'PARTNERSHIPS',
    SUPPORT: 'SUPPORT', BILLING: 'SUPPORT',
    AGENT_SETUP: 'ENGINEERING', BULK_CAMPAIGN: 'ENGINEERING',
    WEB_CALL: 'ENGINEERING', CRM_INTEGRATION: 'ENGINEERING',
    OTHER: 'SALES',
  };
  const team = shape.recommended_team || teamByInquiry[reqRow.inquiry_type] || 'SALES';

  const productInterest = Array.isArray(shape.product_interest)
    ? shape.product_interest.slice(0, 8)
    : deriveInterestTags(reqRow);

  const summary = shape.summary
    || `${reqRow.inquiry_type.replace(/_/g, ' ')} inquiry from ${reqRow.company_name || reqRow.full_name}${reqRow.company_size ? ` (${reqRow.company_size.replace(/_/g,' ').toLowerCase()})` : ''}. Priority ${urgency}.`;

  const firstName = String(reqRow.full_name || 'there').split(/\s+/)[0];
  const draft = shape.draft_reply || draftReplyFor(reqRow, firstName, urgency);

  const nextAction = shape.next_best_action
    || (urgency === 'CRITICAL' ? `Call ${reqRow.phone} within the hour and offer a same-day demo.`
      : urgency === 'HIGH' ? 'Reach out within 4 business hours via the preferred channel, offer a demo slot.'
      : urgency === 'MEDIUM' ? 'Reply within 24h with relevant resources + a demo link.'
      : 'Add to nurture sequence; reply within 2 business days.');

  await pool.query(
    `UPDATE contact_requests
        SET ai_summary = $2,
            lead_score = $3,
            priority = $4,
            ai_payload = $5,
            updated_at = NOW()
      WHERE id = $1`,
    [
      reqRow.id,
      summary.slice(0, 500),
      leadScore,
      urgency,
      JSON.stringify({
        inquiry_type: shape.inquiry_type || reqRow.inquiry_type,
        urgency,
        lead_score: leadScore,
        product_interest: productInterest,
        recommended_team: team,
        next_best_action: nextAction,
        draft_reply: draft,
        summary,
        _llm_had_rich_shape: llmRich,
        _fallback_used: !llmRich,
        raw_llm: shape,
      }),
    ]
  );
  await logEvent(reqRow.id, 'qualified', `Lead scored ${leadScore} (${urgency}) — route to ${team}`, { leadScore, urgency, team }, 'internal');
}

function deriveInterestTags(r: any): string[] {
  const tags = new Set<string>();
  const text = `${r.inquiry_type || ''} ${r.message || ''}`.toLowerCase();
  if (/agent|setup|build/.test(text)) tags.add('agent_setup');
  if (/bulk|campaign|outbound/.test(text)) tags.add('bulk_campaign');
  if (/web|browser|widget/.test(text)) tags.add('web_call');
  if (/crm|salesforce|hubspot|zoho/.test(text)) tags.add('crm_integration');
  if (/multi|language|telugu|hindi|tamil|indic/.test(text)) tags.add('multilingual');
  if (/pricing|price|plan|quote/.test(text)) tags.add('pricing');
  if (/enterprise|contract|sla/.test(text)) tags.add('enterprise');
  return [...tags];
}

function draftReplyFor(r: any, firstName: string, urgency: string): string {
  const slot = urgency === 'CRITICAL' ? 'within the hour'
    : urgency === 'HIGH' ? 'within 4 business hours'
    : 'within 1 business day';
  const channel = r.preferred_contact_method === 'WHATSAPP' ? 'on WhatsApp'
    : r.preferred_contact_method === 'PHONE' ? 'by phone'
    : r.preferred_contact_method === 'GOOGLE_MEET' ? 'to schedule a Google Meet'
    : 'by email';
  const topic = r.inquiry_type === 'DEMO' ? 'walk you through a live demo'
    : r.inquiry_type === 'PRICING' ? 'share pricing and the right plan for your size'
    : r.inquiry_type === 'PARTNERSHIP' ? 'discuss partnership fit'
    : r.inquiry_type === 'CRM_INTEGRATION' ? 'scope the CRM integration'
    : r.inquiry_type === 'BULK_CAMPAIGN' ? 'map out the bulk-calling rollout'
    : 'follow up on your request';
  return `Hi ${firstName}, thanks for reaching out — your request (${r.reference_id}) landed with our team and we'll be in touch ${slot} ${channel} to ${topic}. If anything changes on your end, just reply to this email.`;
}

async function maybePushToCRM(req: any): Promise<string | null> {
  const crmUrl = process.env.CRM_SERVICE_URL;
  if (!crmUrl || !req.tenant_id) {
    // No CRM target or no tenant context — skip (public landing page posts don't carry a tenant)
    return null;
  }
  try {
    const r = await fetch(`${crmUrl.replace(/\/$/, '')}/api/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': req.tenant_id,
      },
      body: JSON.stringify({
        first_name: String(req.full_name || '').split(/\s+/)[0],
        last_name: String(req.full_name || '').split(/\s+/).slice(1).join(' ') || null,
        email: req.email,
        phone: req.phone,
        company: req.company_name,
        source: 'contact_form',
        lead_score: req.lead_score,
        metadata: { contact_reference_id: req.reference_id, inquiry_type: req.inquiry_type },
      }),
    });
    if (!r.ok) return null;
    const data = await r.json() as any;
    return data.id || null;
  } catch { return null; }
}

// ------------------------------ PUBLIC SUBMIT ------------------------------

publicContactRouter.post('/', async (req: Request, res: Response) => {
  try {
    if (!publicRateLimit(req, res)) return;

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation', message: parsed.error.message });
      return;
    }
    const body = parsed.data;
    const ok = await verifyRecaptcha(body.recaptcha_token);
    if (!ok) {
      res.status(400).json({ error: 'reCAPTCHA', message: 'reCAPTCHA verification failed' });
      return;
    }

    const referenceId = await generateRefId();
    const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim() || null;
    const ua = (req.headers['user-agent'] as string || '').slice(0, 400);

    const row = await pool.query(
      `INSERT INTO contact_requests (
         reference_id, full_name, email, phone, company_name, website,
         inquiry_type, company_size, preferred_contact_method, message, consent_given,
         source_url, ip_address, user_agent, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        referenceId,
        sanitize(body.full_name, 160), body.email, body.phone,
        body.company_name || null, body.website || null,
        body.inquiry_type, body.company_size || null, body.preferred_contact_method,
        sanitize(body.message, 5000), body.consent_given,
        body.source_url || null, ip, ua, body.metadata || {},
      ]
    );
    const rec = row.rows[0];

    await logEvent(rec.id, 'submitted', `Contact request submitted from ${ip || 'unknown IP'}`, { source_url: body.source_url }, 'internal');

    // Fire-and-forget lead qualifier + optional CRM hook
    qualifyLead(rec)
      .then(async () => {
        const fresh = await pool.query(`SELECT * FROM contact_requests WHERE id=$1`, [rec.id]);
        const crmId = await maybePushToCRM(fresh.rows[0]);
        if (crmId) {
          await pool.query(`UPDATE contact_requests SET crm_lead_id=$2, updated_at=NOW() WHERE id=$1`, [rec.id, crmId]);
          await logEvent(rec.id, 'crm_lead_created', `Created CRM lead ${crmId}`, { crmId }, 'internal');
        }
      })
      .catch(() => { /* already logged */ });

    res.status(201).json({
      reference_id: rec.reference_id,
      status: rec.status,
      created_at: rec.created_at,
      message: `Thank you for contacting us. Your request has been submitted successfully. Our team will contact you soon. Reference ID: #${rec.reference_id}`,
    });
  } catch (err: any) {
    // Never expose internal errors to public callers
    res.status(500).json({ error: 'Submit Failed', message: 'Could not submit contact request. Please try again later.' });
  }
});

// Public GET by reference ID — read-only status lookup so a submitter can
// check progress without signing in.
publicContactRouter.get('/:reference_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference_id } = req.params;
    if (!refPattern.test(reference_id)) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    const r = await pool.query(
      `SELECT reference_id, status, priority, inquiry_type, created_at, updated_at, first_response_at
         FROM contact_requests WHERE reference_id = $1`,
      [reference_id]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ------------------------------ ADMIN ROUTES ------------------------------

function adminGuard(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Forbidden', message: 'Admin role required' });
    return;
  }
  next();
}
adminContactRouter.use(adminGuard);

adminContactRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const { status, inquiry_type, priority, q, format } = req.query as Record<string, string>;

    const where: string[] = [];
    const params: any[] = [];
    if (status) { params.push(status.toUpperCase()); where.push(`status = $${params.length}`); }
    if (inquiry_type) { params.push(inquiry_type.toUpperCase()); where.push(`inquiry_type = $${params.length}`); }
    if (priority) { params.push(priority.toUpperCase()); where.push(`priority = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      where.push(`(reference_id ILIKE $${idx} OR email ILIKE $${idx} OR full_name ILIKE $${idx} OR company_name ILIKE $${idx})`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    if (format === 'csv') {
      const all = await pool.query(
        `SELECT reference_id, full_name, email, phone, company_name, company_size,
                inquiry_type, status, priority, lead_score, ai_summary, created_at
           FROM contact_requests ${clause}
           ORDER BY created_at DESC LIMIT 5000`,
        params
      );
      const esc = (v: any) => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const header = 'reference_id,full_name,email,phone,company_name,company_size,inquiry_type,status,priority,lead_score,ai_summary,created_at';
      const rows = all.rows.map((r: any) =>
        [r.reference_id, r.full_name, r.email, r.phone, r.company_name, r.company_size, r.inquiry_type, r.status, r.priority, r.lead_score, r.ai_summary, r.created_at].map(esc).join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="contact-requests.csv"');
      res.send([header, ...rows].join('\n'));
      return;
    }

    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT id, reference_id, full_name, email, phone, company_name, company_size,
              inquiry_type, status, priority, lead_score, assigned_to, created_at, updated_at
         FROM contact_requests ${clause}
         ORDER BY
           CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
           created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countParams = params.slice(0, -2);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM contact_requests ${clause}`,
      countParams
    );

    const stats = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'NEW')::int AS new_count,
        COUNT(*) FILTER (WHERE status IN ('CONTACTED','QUALIFIED','DEMO_SCHEDULED','IN_PROGRESS'))::int AS in_flight,
        COUNT(*) FILTER (WHERE priority IN ('CRITICAL','HIGH'))::int AS hot_leads,
        AVG(lead_score)::float AS avg_lead_score
        FROM contact_requests
    `);

    res.json({ items: rows.rows, total: count.rows[0]?.n ?? 0, page, limit, stats: stats.rows[0] });
  } catch (err) { next(err); }
});

adminContactRouter.get('/:reference_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference_id } = req.params;
    const r = await pool.query(`SELECT * FROM contact_requests WHERE reference_id = $1`, [reference_id]);
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    const events = await pool.query(
      `SELECT * FROM contact_request_events WHERE contact_request_id = $1 ORDER BY created_at ASC`,
      [r.rows[0].id]
    );
    res.json({ request: r.rows[0], events: events.rows });
  } catch (err) { next(err); }
});

adminContactRouter.put('/:reference_id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference_id } = req.params;
    const status = String(req.body?.status || '').toUpperCase();
    if (!(STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: 'Bad Request', message: `status must be one of: ${STATUSES.join(', ')}` });
      return;
    }
    const r = await pool.query(
      `UPDATE contact_requests
          SET status = $2::text,
              updated_at = NOW(),
              first_response_at = COALESCE(first_response_at, CASE WHEN $2::text <> 'NEW' THEN NOW() ELSE NULL END),
              closed_at = CASE WHEN $2::text IN ('CLOSED','SPAM') THEN NOW() ELSE closed_at END
        WHERE reference_id = $1 RETURNING id`,
      [reference_id, status]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    await logEvent(r.rows[0].id, 'status_changed', `Status → ${status}`, { status }, 'internal', getUserId(req));
    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

adminContactRouter.put('/:reference_id/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference_id } = req.params;
    const assignee = req.body?.assigned_to || null;
    const r = await pool.query(
      `UPDATE contact_requests SET assigned_to = $2, updated_at = NOW() WHERE reference_id = $1 RETURNING id`,
      [reference_id, assignee]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    await logEvent(r.rows[0].id, 'assigned', `Assigned to ${assignee || 'unassigned'}`, { assignee }, 'internal', getUserId(req));
    res.json({ ok: true, assigned_to: assignee });
  } catch (err) { next(err); }
});

adminContactRouter.post('/:reference_id/reply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference_id } = req.params;
    const body = sanitize(req.body?.body, 5000);
    const channel = (req.body?.channel || 'EMAIL').toUpperCase();
    if (!body) { res.status(400).json({ error: 'Bad Request', message: 'body required' }); return; }
    const r = await pool.query(`SELECT id FROM contact_requests WHERE reference_id = $1`, [reference_id]);
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    // Note: we don't actually dispatch the email here — we record the intent so
    // ops has a trail. A follow-up notification-service hook would send it.
    await logEvent(r.rows[0].id, 'replied', `Reply logged (${channel})`, { body, channel }, 'public', getUserId(req));
    await pool.query(
      `UPDATE contact_requests
          SET first_response_at = COALESCE(first_response_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [r.rows[0].id]
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});
