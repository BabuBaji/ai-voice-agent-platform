/**
 * Brochure-delivery tracking layer.
 *
 * The single write-point + helpers for the lead_brochure_deliveries table. It
 * does NOT send anything itself — the existing send services
 * (communications.ts sendEmail/sendWhatsApp/sendSms) do that and return
 * `{ ok, log_id, error }`. This module records the OUTCOME of each attempt so
 * the Sent / Not-Sent / Pending queues, retry scheduling, and delivery-driven
 * follow-ups have a dedicated source of truth.
 *
 * Additive + best-effort: every function swallows its own errors and never
 * throws, so it can never break the send path it observes.
 */
import { Pool } from 'pg';
import { pool } from '../index';

// Read-only pool to crm_db for enriching brochure rows with lead profiles
// (name / mobile / college / marks / rank). Mirrors the followupScheduler
// pattern — leads live in a separate database from conversation_db.
const CRM_DB_URL = process.env.CRM_DB_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db';
let crmPool: Pool | null = null;
function getCrmPool(): Pool {
  if (!crmPool) crmPool = new Pool({ connectionString: CRM_DB_URL });
  return crmPool;
}

export interface LeadProfile {
  name: string | null;
  mobile: string | null;
  email: string | null;
  score: number | null;
  status: string | null;
  company: string | null;
  interested_university: string | null;
  interested_course: string | null;
  interested_branch: string | null;
  preferred_location: string | null;
  intermediate_marks: string | null;
  intermediate_percentage: string | null;
  eamcet_rank: string | null;
  jee_rank: string | null;
  city: string | null;
  parent_name: string | null;
  parent_mobile: string | null;
}

/** Batch-fetch lead profiles (from crm_db) for a set of lead ids. Returns a
 *  map keyed by lead_id. Best-effort — returns {} on any failure. */
export async function fetchLeadProfiles(
  tenantId: string, leadIds: Array<string | null | undefined>,
): Promise<Record<string, LeadProfile>> {
  const out: Record<string, LeadProfile> = {};
  const ids = Array.from(new Set(leadIds.filter((x): x is string => !!x)));
  if (ids.length === 0) return out;
  try {
    const r = await getCrmPool().query(
      `SELECT id, first_name, last_name, email, phone, score, status, company, custom_fields
         FROM leads WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    for (const row of r.rows) {
      const cf = row.custom_fields || {};
      out[row.id] = {
        name: [row.first_name, row.last_name].filter((x: string) => x && x !== '-').join(' ').trim() || null,
        mobile: row.phone || null,
        email: row.email || null,
        score: row.score ?? null,
        status: row.status || null,
        company: row.company || null,
        interested_university: cf.interested_university || null,
        interested_course: cf.interested_course || null,
        interested_branch: cf.interested_branch || null,
        preferred_location: cf.preferred_location || null,
        intermediate_marks: cf.intermediate_marks || null,
        intermediate_percentage: cf.intermediate_percentage || null,
        eamcet_rank: cf.eamcet_rank || null,
        jee_rank: cf.jee_rank || null,
        city: cf.city || null,
        parent_name: cf.parent_name || null,
        parent_mobile: cf.parent_mobile || null,
      };
    }
  } catch (e: any) {
    console.warn(`[brochure-delivery] lead profile fetch failed: ${e?.message}`);
  }
  return out;
}

export type BrochureSendStatus =
  | 'SEND_PENDING' | 'SENT' | 'DELIVERED' | 'OPENED' | 'READ' | 'FAILED'
  | 'BOUNCED' | 'INVALID_EMAIL' | 'INVALID_MOBILE' | 'PROVIDER_NOT_CONFIGURED'
  | 'BROCHURE_NOT_FOUND' | 'TEMPLATE_NOT_APPROVED' | 'SKIPPED_NOT_INTERESTED'
  | 'SKIPPED_DUPLICATE' | 'NEEDS_REVIEW';

/** Queue membership (used by the routes to split sent / not-sent / pending). */
export const SENT_STATUSES = ['SENT', 'DELIVERED', 'OPENED', 'READ'] as const;
export const NOT_SENT_STATUSES = [
  'FAILED', 'BOUNCED', 'INVALID_EMAIL', 'INVALID_MOBILE',
  'PROVIDER_NOT_CONFIGURED', 'BROCHURE_NOT_FOUND', 'TEMPLATE_NOT_APPROVED',
  'NEEDS_REVIEW',
] as const;
export const PENDING_STATUSES = ['SEND_PENDING'] as const;

interface SendResult {
  ok: boolean;
  log_id?: string | null;
  error?: string;
  provider?: string | null;
  provider_message_id?: string | null;
}

export interface RecordBrochureArgs {
  tenantId: string;
  leadId: string;
  conversationId?: string | null;
  callId?: string | null;
  campaignId?: string | null;
  channel: 'email' | 'whatsapp' | 'sms';
  recipientEmail?: string | null;
  recipientMobile?: string | null;
  brochureId?: string | null;
  brochureName?: string | null;
  brochureUrl?: string | null;       // hosted file URL OR plain link
  collegeName?: string | null;
  courseName?: string | null;
  branchName?: string | null;
  /** The result returned by communications.ts send*(). */
  result: SendResult;
  /** false when no specific brochure matched (sent the default URL). */
  brochureMatched?: boolean;
  /** Override the derived status — for SKIPPED_DUPLICATE / SKIPPED_NOT_INTERESTED. */
  forcedStatus?: BrochureSendStatus;
}

/**
 * Map a send result to the spec status enum. Best-effort string matching on
 * the error strings communications.ts emits (e.g. 'email_provider_not_configured',
 * 'whatsapp_not_supported_by_*', 'UNREACHABLE:', mapped Meta/Twilio errors).
 */
export function classifySendStatus(
  channel: string, result: SendResult,
): BrochureSendStatus {
  if (result.ok) return 'SENT';
  const e = String(result.error || '').toLowerCase();
  if (e.includes('provider_not_configured') || e.includes('not_supported_by')) return 'PROVIDER_NOT_CONFIGURED';
  if (e.includes('not_approved') || e.includes('re_engagement') || (e.includes('template') && e.includes('approve'))) return 'TEMPLATE_NOT_APPROVED';
  if (e.includes('bounce')) return 'BOUNCED';
  if (channel === 'email' && (e.includes('invalid') && e.includes('email'))) return 'INVALID_EMAIL';
  if ((channel === 'whatsapp' || channel === 'sms') &&
      (e.includes('unreachable') || (e.includes('invalid') && (e.includes('number') || e.includes('mobile') || e.includes('phone'))))) {
    return 'INVALID_MOBILE';
  }
  return 'FAILED';
}

/** Insert one delivery record. Returns the row id (or null on failure). */
export async function recordBrochureDelivery(args: RecordBrochureArgs): Promise<string | null> {
  try {
    const status: BrochureSendStatus = args.forcedStatus || classifySendStatus(args.channel, args.result);
    const sentAt = status === 'SENT' ? new Date() : null;
    const failureReason = args.result.ok ? null : (args.result.error || null);
    const r = await pool.query(
      `INSERT INTO lead_brochure_deliveries
         (tenant_id, lead_id, call_id, campaign_id, conversation_id,
          brochure_id, brochure_name, brochure_url, college_name, course_name, branch_name,
          channel, recipient_email, recipient_mobile,
          send_status, failure_reason, provider, provider_message_id, communication_log_id,
          sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        args.tenantId, args.leadId, args.callId || null, args.campaignId || null, args.conversationId || null,
        args.brochureId || null, args.brochureName || null, args.brochureUrl || null,
        args.collegeName || null, args.courseName || null, args.branchName || null,
        args.channel, args.recipientEmail || null, args.recipientMobile || null,
        status, failureReason, args.result.provider || null, args.result.provider_message_id || null, args.result.log_id || null,
        sentAt,
      ],
    );
    return r.rows[0]?.id || null;
  } catch (e: any) {
    console.warn(`[brochure-delivery] record failed (lead=${args.leadId}, channel=${args.channel}): ${e?.message}`);
    return null;
  }
}

/**
 * Duplicate guard: same lead + brochure + channel already delivered within the
 * last 24h. Used to record SKIPPED_DUPLICATE instead of re-sending. When
 * brochureId is null (ad-hoc link) we match on lead+channel only.
 */
export async function isDuplicateBrochure(
  tenantId: string, leadId: string, brochureId: string | null, channel: string,
): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM lead_brochure_deliveries
        WHERE tenant_id = $1 AND lead_id = $2 AND channel = $3
          AND ($4::uuid IS NULL OR brochure_id = $4::uuid)
          AND send_status IN ('SENT', 'DELIVERED', 'OPENED', 'READ')
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [tenantId, leadId, channel, brochureId],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}
