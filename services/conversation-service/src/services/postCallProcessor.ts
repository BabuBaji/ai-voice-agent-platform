import { pool } from '../index';
import { analyzeConversation, AnalysisResult } from './analyzer';
import pino from 'pino';

const logger = pino({ name: 'post-call-processor' });

const PROCESSOR_VERSION = 'v1';

/**
 * Post-call lead processor.
 *
 * Orchestrates the admissions-module post-call automation:
 *   1. Run the AI analyzer (extracts entities, derives lead_status, merges
 *      the in-call slot store, creates the CRM lead via createLeadFromAnalysis).
 *   2. Write an audit row to `post_call_lead_analysis` recording the
 *      extracted JSON, confidence, missing fields, and (if created) the
 *      CRM lead id — one row per processor run, so re-analyze keeps a
 *      history rather than overwriting.
 *   3. Schedule follow_up_tasks based on the extended lead_status:
 *        HOT_INTERESTED  → urgent counselor callback within 30 min
 *        INTERESTED      → same-day call follow-up
 *        FOLLOW_UP_REQUIRED → tomorrow follow-up
 *        CALLBACK_SCHEDULED → at caller's requested time
 *        COUNSELOR_MEETING_REQUIRED → counselor meeting task
 *        NOT_INTERESTED / WRONG_NUMBER / NO_ANSWER → no task
 *
 * IDEMPOTENT — safe to call multiple times. The CRM lead path already
 * dedupes on conversations.analysis.crm_lead_id. The audit row is
 * always inserted (a re-analyze leaves a fresh history row).
 *
 * NON-BLOCKING — errors are logged and an audit row is still written
 * with the failure reason so the team can spot calls that didn't make
 * it through. Never throws to the caller.
 */
export async function processCallEnd(
  conversationId: string,
  tenantId: string,
): Promise<{ success: boolean; lead_status?: string; lead_id?: string | null; reason?: string }> {
  let analysis: AnalysisResult | null = null;
  let failureReason: string | null = null;

  try {
    analysis = await analyzeConversation(conversationId, tenantId);
  } catch (err: any) {
    failureReason = String(err?.message || err);
    logger.warn({ conv: conversationId, err: failureReason }, 'post-call processor: analyzer threw');
  }

  // Look up the CRM lead id that createLeadFromAnalysis (called inside
  // analyzeConversation's fire-and-forget) wrote to the conversation. May
  // legitimately be null when the analyzer skipped lead creation (caller
  // not interested, incomplete contact info, etc.).
  let crmLeadId: string | null = null;
  let callId: string | null = null;
  let campaignId: string | null = null;
  try {
    const r = await pool.query(
      `SELECT
         c.analysis->>'crm_lead_id' AS lead_id,
         ca.id::text AS call_id,
         ca.metadata->>'campaign_id' AS campaign_id
       FROM conversations c
       LEFT JOIN calls ca ON ca.conversation_id = c.id
       WHERE c.id = $1 AND c.tenant_id = $2
       LIMIT 1`,
      [conversationId, tenantId],
    );
    crmLeadId = r.rows[0]?.lead_id || null;
    callId = r.rows[0]?.call_id || null;
    campaignId = r.rows[0]?.campaign_id || null;
  } catch { /* non-fatal — audit row just won't have these refs */ }

  // Audit row — always written, even on failure, so the dashboard surfaces
  // failed runs as POST_CALL_PROCESSING_FAILED.
  try {
    await pool.query(
      `INSERT INTO post_call_lead_analysis
         (tenant_id, conversation_id, call_id, campaign_id, lead_id,
          lead_status, interest_level, confidence_score,
          analysis_json, missing_fields, review_reasons, processor_version)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid,
               $6, $7, $8, $9::jsonb, $10, $11, $12)`,
      [
        tenantId,
        conversationId,
        callId,
        campaignId,
        crmLeadId,
        analysis?.lead_status || (failureReason ? 'POST_CALL_PROCESSING_FAILED' : null),
        // Map analyzer interest_level integer to enum string for filtering.
        analysis ? interestLevelToBucket(analysis.interest_level || 0) : null,
        analysis?.confidence_score || null,
        JSON.stringify(analysis || { error: failureReason }),
        analysis?.missing_fields || null,
        // Review reasons come from custom_fields in createLeadFromAnalysis;
        // re-derive here so the audit row carries them independently.
        deriveReviewReasonsForAudit(analysis),
        PROCESSOR_VERSION,
      ],
    );
  } catch (auditErr: any) {
    logger.warn({ conv: conversationId, err: auditErr?.message }, 'post-call processor: failed to insert audit row');
  }

  if (failureReason) {
    return { success: false, reason: failureReason };
  }

  // Schedule follow-up task(s) based on extended lead_status.
  await scheduleFollowUpTasks(conversationId, tenantId, analysis!, crmLeadId);

  return {
    success: true,
    lead_status: analysis!.lead_status,
    lead_id: crmLeadId,
  };
}

/**
 * Map numeric interest_level → coarse bucket for the audit row's
 * interest_level enum column. Keeps the dashboard's bucket filter consistent
 * even when the LLM emits slightly different numbers across re-analyses.
 */
function interestLevelToBucket(n: number): 'hot' | 'warm' | 'cold' | 'not_interested' {
  if (n >= 75) return 'hot';
  if (n >= 50) return 'warm';
  if (n >= 25) return 'cold';
  return 'not_interested';
}

/** Re-derive review reasons from analysis fields — mirrors the same logic
 *  in createLeadFromAnalysis but pure, so the audit row doesn't depend on
 *  CRM POST having actually succeeded. */
function deriveReviewReasonsForAudit(a: AnalysisResult | null): string[] | null {
  if (!a) return null;
  const ke = a.key_entities || {};
  const reasons: string[] = [];
  const email = String(ke.email || '').trim();
  if (email && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) reasons.push('email_format_invalid');
  const mobile = String(ke.alt_phone || '').replace(/[^\d]/g, '');
  if (mobile && !(mobile.length === 10 && /^[6-9]/.test(mobile))) reasons.push('mobile_format_invalid');
  const name = String(ke.customer_name || '').trim();
  if (name && name.length < 2) reasons.push('name_too_short');
  if (typeof a.interest_level === 'number' && a.interest_level < 35) reasons.push('low_interest_signal');
  if (String(a.conversion_probability || '').toUpperCase() === 'LOW') reasons.push('low_conversion_probability');
  if (Array.isArray(a.missing_fields) && a.missing_fields.length > 0) reasons.push(...a.missing_fields.map((f) => `missing_${f}`));
  return reasons.length > 0 ? reasons : null;
}

/**
 * Determine and persist follow-up tasks based on the extended lead status.
 * Idempotent — refuses to create a duplicate task of the same type for the
 * same conversation. Counselor assignment is round-robin (best-effort) and
 * leaves assigned_to null if no counselors are configured.
 */
async function scheduleFollowUpTasks(
  conversationId: string,
  tenantId: string,
  analysis: AnalysisResult,
  leadId: string | null,
): Promise<void> {
  const status = analysis.lead_status;
  if (!status || status === 'NOT_INTERESTED' || status === 'WRONG_NUMBER' || status === 'NO_ANSWER') {
    return;
  }

  // Pick scheduled time + type + priority per status.
  const now = new Date();
  const followTimeRaw = analysis.recommended_follow_up_time || analysis.key_entities?.appointment_time || '';
  const followTime = parseFollowUpTimeLocal(followTimeRaw);
  let scheduledAt: Date;
  let taskType: 'call' | 'whatsapp' | 'email' | 'counselor_meeting' | 'campus_visit';
  let priority: 'urgent' | 'high' | 'normal' | 'low';

  switch (status) {
    case 'HOT_INTERESTED':
      scheduledAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min
      taskType = 'call';
      priority = 'urgent';
      break;
    case 'INTERESTED':
      // Same-day; if it's already past 6pm local, push to tomorrow 10am.
      scheduledAt = followTime || (() => {
        const d = new Date(now);
        if (d.getHours() >= 18) { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
        else d.setHours(d.getHours() + 2, 0, 0, 0);
        return d;
      })();
      taskType = 'call';
      priority = 'high';
      break;
    case 'CALLBACK_SCHEDULED':
      scheduledAt = followTime || (() => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();
      taskType = 'call';
      priority = 'high';
      break;
    case 'COUNSELOR_MEETING_REQUIRED':
      scheduledAt = followTime || (() => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return d; })();
      taskType = 'counselor_meeting';
      priority = 'high';
      break;
    case 'FOLLOW_UP_REQUIRED':
    default:
      scheduledAt = followTime || (() => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();
      taskType = 'call';
      priority = 'normal';
  }

  // Counselor assignment — round-robin across available counselors matching
  // language preference (best-effort). If no counselors configured, leave
  // assigned_to null so it shows up in the unassigned queue.
  const assignedTo = await pickAvailableCounselor(tenantId, analysis);

  // Idempotency: skip if an open task of the same type already exists for
  // this conversation (re-analyzing a call shouldn't spawn duplicate tasks).
  try {
    const existing = await pool.query(
      `SELECT id FROM follow_up_tasks
       WHERE conversation_id = $1 AND tenant_id = $2 AND task_type = $3
         AND status IN ('pending', 'in_progress')
       LIMIT 1`,
      [conversationId, tenantId, taskType],
    );
    if (existing.rows.length > 0) {
      logger.info({ conv: conversationId, taskType }, 'post-call processor: follow-up task already exists, skipping');
      return;
    }
  } catch { /* non-fatal — proceed to insert */ }

  try {
    await pool.query(
      `INSERT INTO follow_up_tasks
         (tenant_id, lead_id, conversation_id, assigned_to, task_type,
          scheduled_at, priority, status, notes)
       VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7, 'pending', $8)`,
      [
        tenantId,
        leadId,
        conversationId,
        assignedTo,
        taskType,
        scheduledAt.toISOString(),
        priority,
        analysis.follow_up_reason || analysis.next_best_action || analysis.short_summary || '',
      ],
    );
    logger.info(
      { conv: conversationId, leadId, taskType, priority, scheduledAt: scheduledAt.toISOString(), assignedTo },
      'post-call processor: follow-up task scheduled',
    );
  } catch (err: any) {
    logger.warn({ conv: conversationId, err: err?.message }, 'post-call processor: follow-up task insert failed');
  }
}

/** Parse natural-language follow-up time strings. Local copy of the
 *  analyzer's helper to avoid importing it (kept independent). */
function parseFollowUpTimeLocal(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().toLowerCase();
  const isoTry = new Date(raw);
  if (!isNaN(isoTry.getTime()) && /\d{4}-\d{2}-\d{2}/.test(raw)) return isoTry;
  const now = new Date();
  const m1 = s.match(/(?:within|in)\s+(\d+)\s*(h|hr|hours?|m|min|minutes?|d|days?)/);
  if (m1) {
    const n = parseInt(m1[1], 10);
    const unit = m1[2][0];
    const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
    return new Date(now.getTime() + ms);
  }
  if (s.includes('tomorrow')) {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    if (s.includes('afternoon')) d.setHours(15, 0, 0, 0);
    else if (s.includes('evening')) d.setHours(18, 0, 0, 0);
    return d;
  }
  if (s.includes('next week')) {
    const d = new Date(now); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0);
    return d;
  }
  return null;
}

/**
 * Round-robin counselor pick. Prefers counselors whose `languages` includes
 * the call's language, then within that pool picks the one least recently
 * assigned (`last_assigned_at` ASC NULLS FIRST). Updates last_assigned_at
 * so subsequent assignments rotate.
 *
 * Returns null when no counselors are configured for the tenant — that's
 * fine, the task lands in the unassigned queue for manual triage.
 */
async function pickAvailableCounselor(
  tenantId: string,
  analysis: AnalysisResult,
): Promise<string | null> {
  // Pull the call's language hint from the analyzer's per-speaker block
  // if available, else don't filter by language.
  const language: string | null = null;  // future: thread session.language through

  try {
    const where = `tenant_id = $1 AND availability_status = 'available'`;
    const params: any[] = [tenantId];
    let langClause = '';
    if (language) {
      langClause = ` AND $2 = ANY(languages)`;
      params.push(language);
    }
    const r = await pool.query(
      `SELECT id FROM counselors
       WHERE ${where}${langClause}
       ORDER BY last_assigned_at ASC NULLS FIRST, active_task_count ASC
       LIMIT 1`,
      params,
    );
    const id = r.rows[0]?.id || null;
    if (id) {
      // Mark as just-assigned so round-robin rotates next time. Best-effort.
      void pool.query(
        `UPDATE counselors
         SET last_assigned_at = NOW(), active_task_count = active_task_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
    }
    return id;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'pickAvailableCounselor: query failed');
    return null;
  }
}
