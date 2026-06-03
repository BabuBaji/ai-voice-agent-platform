import { pool } from '../index';
import { Pool } from 'pg';
import { analyzeConversation, AnalysisResult } from './analyzer';
import { triggerWorkflow, mapStatusToEvent } from './whatsappWorkflowEngine';
import { updateFollowupFromCallEnd, cancelLeadAutomation } from './followupScheduler';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'post-call-processor' });

const PROCESSOR_VERSION = 'v1';

// Read-only pool to crm_db (leads live there, not in conversation_db). Mirrors
// the pattern in brochureDelivery.ts. Used only to resolve an EXISTING lead by
// phone when a visit-booking call wasn't lead-linked by the analyzer.
const CRM_DB_URL = process.env.CRM_DB_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db';
let crmPool: Pool | null = null;
function getCrmPool(): Pool {
  if (!crmPool) crmPool = new Pool({ connectionString: CRM_DB_URL });
  return crmPool;
}

/** Resolve an existing CRM lead id by phone number, matching on the last 10
 *  digits so "+919493324795" and "9493324795" unify. Returns the most recent
 *  matching lead, or null. Best-effort — never throws. */
async function resolveLeadIdByPhone(tenantId: string, phone: string | null | undefined): Promise<string | null> {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  try {
    const r = await getCrmPool().query(
      `SELECT id FROM leads
        WHERE tenant_id = $1
          AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = right($2, 10)
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, digits],
    );
    return r.rows[0]?.id || null;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'resolveLeadIdByPhone failed');
    return null;
  }
}

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
/** Bump a parsed visit date into the future when the model emitted a stale year
 *  (e.g. "2023-06-12" on a 2026 call). Keeps month/day/time; sets the year to
 *  the current year, and rolls to next year if that date already passed. */
function clampVisitToFuture(d: Date): Date {
  const now = new Date();
  if (d.getTime() >= now.getTime()) return d;
  const bumped = new Date(d);
  bumped.setFullYear(now.getFullYear());
  if (bumped.getTime() < now.getTime()) bumped.setFullYear(now.getFullYear() + 1);
  return bumped;
}

/** Additive Visit-Card creation for ANY lead-linked call (recall, brochure
 *  follow-up, bulk, inbound) that captured an appointment but did NOT come
 *  through the follow-up scheduler (no followup_task_id). The scheduler path is
 *  handled by handleFollowupCallAutomation; this covers the rest so a visit
 *  booked on any call appears in /followups. Best-effort, never throws. */
async function maybeCreateVisitForLinkedLead(
  conversationId: string, tenantId: string, analysis: AnalysisResult,
  callId: string | null, leadId: string,
): Promise<void> {
  try {
    const ke: any = analysis.key_entities || {};
    const callOutcome = String(analysis.call_outcome || (analysis as any).outcome || '').toLowerCase();
    const leadStatusUp = String((analysis as any).lead_status || '').toUpperCase();
    // Never create on a clear rejection / non-contact.
    if (callOutcome.includes('not interested')
      || ['NOT_INTERESTED', 'LOST', 'UNQUALIFIED', 'WRONG_NUMBER', 'NO_ANSWER'].includes(leadStatusUp)) return;
    const apptRaw = ke.appointment_time || (analysis as any).appointment_time || analysis.recommended_follow_up_time;
    const parsed = parseFollowUpTimeLocal(apptRaw);
    if (!parsed) return;
    const visitWhen = clampVisitToFuture(parsed);
    const y = visitWhen.getFullYear();
    const mo = String(visitWhen.getMonth() + 1).padStart(2, '0');
    const d = String(visitWhen.getDate()).padStart(2, '0');
    const hh = String(visitWhen.getHours()).padStart(2, '0');
    const mm = String(visitWhen.getMinutes()).padStart(2, '0');
    const rec = await pool.query(`SELECT recording_url FROM conversations WHERE id = $1 LIMIT 1`, [conversationId]);
    const recordingUrl = rec.rows[0]?.recording_url || null;
    const callSummary = (analysis as any).detailed_summary || (analysis as any).short_summary || null;
    // One open visit per lead. If one already exists, RESCHEDULE it to the
    // newly-confirmed date/time (a later call wins) instead of creating a
    // duplicate — but skip the write when nothing changed.
    const existing = await pool.query(
      `SELECT id, visit_date::text AS visit_date, visit_time::text AS visit_time
         FROM visit_schedules WHERE lead_id = $1 AND status IN ('SCHEDULED','CONFIRMED')
        ORDER BY created_at DESC LIMIT 1`,
      [leadId],
    );
    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      const unchanged = String(ex.visit_date) === `${y}-${mo}-${d}`
        && String(ex.visit_time || '').slice(0, 5) === `${hh}:${mm}`;
      if (unchanged) return;
      await pool.query(
        `UPDATE visit_schedules
            SET visit_date = $1, visit_time = $2, status = 'SCHEDULED',
                conversation_id = $3::uuid, confirmation_call_id = $4,
                recording_url = COALESCE($5, recording_url),
                call_summary = COALESCE($6, call_summary),
                reschedule_count = COALESCE(reschedule_count, 0) + 1,
                customer_confirmed = TRUE, updated_at = NOW()
          WHERE id = $7`,
        [`${y}-${mo}-${d}`, `${hh}:${mm}`, conversationId, callId, recordingUrl, callSummary, ex.id],
      );
      await updateLeadPipeline(tenantId, leadId, 'VISIT_SCHEDULED').catch(() => {});
      logger.info({ conv: conversationId, lead: leadId, visit_date: `${y}-${mo}-${d}`, rescheduled_from: `${ex.visit_date} ${ex.visit_time}`, visit_id: ex.id }, 'open visit rescheduled from newer lead-linked call');
      return;
    }
    await pool.query(
      `INSERT INTO visit_schedules
         (tenant_id, lead_id, followup_task_id, visit_date, visit_time, status, created_from, visitor_type, notes,
          conversation_id, confirmation_call_id, recording_url, call_summary)
       VALUES ($1, $2, NULL, $3, $4, 'SCHEDULED', 'AI_CALL', $5, $6, $7::uuid, $8, $9, $10)`,
      [tenantId, leadId, `${y}-${mo}-${d}`, `${hh}:${mm}`,
       ke.visitor_type || null, (analysis as any).short_summary?.slice(0, 300) || null,
       conversationId, callId, recordingUrl, callSummary],
    );
    await updateLeadPipeline(tenantId, leadId, 'VISIT_SCHEDULED').catch(() => {});
    logger.info({ conv: conversationId, lead: leadId, visit_date: `${y}-${mo}-${d}` }, 'visit auto-created from lead-linked call (no task)');
  } catch (err: any) {
    logger.warn({ conv: conversationId, err: err?.message }, 'maybeCreateVisitForLinkedLead failed');
  }
}

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
  let followupTaskId: string | null = null;
  let callDirection: string | null = null;
  let callerNumber: string | null = null;
  let calledNumber: string | null = null;
  try {
    const r = await pool.query(
      `SELECT
         c.analysis->>'crm_lead_id' AS lead_id,
         c.direction AS direction,
         ca.id::text AS call_id,
         ca.caller_number AS caller_number,
         ca.called_number AS called_number,
         ca.metadata->>'campaign_id' AS campaign_id,
         ca.metadata->>'followup_task_id' AS followup_task_id
       FROM conversations c
       LEFT JOIN calls ca ON ca.conversation_id = c.id
       WHERE c.id = $1 AND c.tenant_id = $2
       LIMIT 1`,
      [conversationId, tenantId],
    );
    crmLeadId = r.rows[0]?.lead_id || null;
    callId = r.rows[0]?.call_id || null;
    campaignId = r.rows[0]?.campaign_id || null;
    followupTaskId = r.rows[0]?.followup_task_id || null;
    callDirection = r.rows[0]?.direction || null;
    callerNumber = r.rows[0]?.caller_number || null;
    calledNumber = r.rows[0]?.called_number || null;
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

  // Post-brochure → visit → feedback automation. ONLY fires when this call was
  // a scheduled follow-up (the scheduler stamped metadata.followup_task_id) —
  // a no-op for normal inbound/outbound calls, so the existing flow is untouched.
  if (followupTaskId) {
    await handleFollowupCallAutomation(conversationId, tenantId, analysis!, followupTaskId, callId)
      .catch((err) => logger.warn({ conv: conversationId, err: err?.message }, 'follow-up automation hook failed'));
  } else {
    // Non-scheduler call (recall / brochure follow-up / bulk / inbound) that
    // still booked a visit for a known lead → create the Visit Card too. When
    // the analyzer didn't link a lead (strict gate on a NEW lead), fall back to
    // resolving the EXISTING lead by the contact's phone number.
    let visitLeadId = crmLeadId;
    if (!visitLeadId) {
      const dir = String(callDirection || '').toUpperCase();
      const contactPhone = dir === 'OUTBOUND' ? calledNumber : callerNumber;
      visitLeadId = await resolveLeadIdByPhone(tenantId, contactPhone);
      if (visitLeadId) logger.info({ conv: conversationId, lead: visitLeadId }, 'visit hook: resolved existing lead by phone (analyzer left it unlinked)');
    }
    if (visitLeadId) {
      await maybeCreateVisitForLinkedLead(conversationId, tenantId, analysis!, callId, visitLeadId)
        .catch((err) => logger.warn({ conv: conversationId, err: err?.message }, 'linked-lead visit hook failed'));
    }
  }

  // Fire the WhatsApp workflow for the resolved lead_status. Best-effort —
  // post-call success path does NOT depend on the WhatsApp send succeeding.
  // Idempotency in the engine prevents re-firing when re-analysis runs.
  void fireWorkflowFromAnalysis(conversationId, tenantId, analysis!, crmLeadId)
    .catch((err) => logger.warn({ conv: conversationId, err: err?.message }, 'post-call workflow trigger failed'));

  return {
    success: true,
    lead_status: analysis!.lead_status,
    lead_id: crmLeadId,
  };
}

/**
 * Gated entry point for the live call-end path (`POST /conversations/:id/analyze`,
 * which telephony-adapter calls on hang-up). Runs the follow-up automation ONLY
 * when the call carried a followup_task_id — a no-op for every normal call, so
 * the existing analyze flow is untouched. Best-effort, never throws.
 */
export async function runFollowupAutomation(
  conversationId: string, tenantId: string, analysis: AnalysisResult,
): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT ca.id::text AS call_id,
              ca.metadata->>'followup_task_id' AS followup_task_id,
              ca.caller_number AS caller_number,
              ca.called_number AS called_number,
              c.direction AS direction,
              c.analysis->>'crm_lead_id' AS lead_id
         FROM conversations c
         LEFT JOIN calls ca ON ca.conversation_id = c.id
        WHERE c.id = $1 AND c.tenant_id = $2
        LIMIT 1`,
      [conversationId, tenantId],
    );
    const followupTaskId = r.rows[0]?.followup_task_id || null;
    const callId = r.rows[0]?.call_id || null;
    let leadId = r.rows[0]?.lead_id || null;
    // Fallback: the analyzer's strict gate may decline to (re)link a NEW lead
    // even when the call is to an EXISTING lead. Resolve by the contact's phone
    // (the dialed number on outbound, the caller on inbound) so a visit booked
    // on such a call still produces a Visit Card in /followups.
    if (!followupTaskId && !leadId) {
      const dir = String(r.rows[0]?.direction || '').toUpperCase();
      const contactPhone = dir === 'OUTBOUND' ? r.rows[0]?.called_number : r.rows[0]?.caller_number;
      leadId = await resolveLeadIdByPhone(tenantId, contactPhone);
      if (leadId) logger.info({ conv: conversationId, lead: leadId }, 'visit hook: resolved existing lead by phone (analyzer left it unlinked)');
    }
    if (followupTaskId) {
      await handleFollowupCallAutomation(conversationId, tenantId, analysis, followupTaskId, callId);
    } else if (leadId) {
      // Non-scheduler call that booked a visit for a known lead → create the
      // Visit Card so it appears in /followups (recall / brochure / bulk / inbound).
      await maybeCreateVisitForLinkedLead(conversationId, tenantId, analysis, callId, leadId);
    }
  } catch (e: any) {
    logger.warn({ conv: conversationId, err: e?.message }, 'runFollowupAutomation failed');
  }
}

/**
 * Drives the brochure → visit → feedback chain off a completed FOLLOW-UP call.
 * Best-effort, never throws. Only invoked when the call carried a
 * followup_task_id, so it can't affect normal calls.
 *   1. Advance/complete the follow-up task (chains the next task per outcome).
 *   2. If the analyzer captured a visit date/time, auto-create a visit row.
 *   3. If this was the post-visit feedback call, store the feedback.
 */
async function handleFollowupCallAutomation(
  conversationId: string, tenantId: string, analysis: AnalysisResult,
  followupTaskId: string, callId: string | null,
): Promise<void> {
  const interestLevel = typeof analysis.interest_level === 'number' ? analysis.interest_level : 0;
  const callOutcome = String(analysis.call_outcome || (analysis as any).outcome || '').toLowerCase();

  // 1. Complete the task + chain the next one (existing engine logic).
  await updateFollowupFromCallEnd(pool, { followupTaskId, conversationId, callOutcome, interestLevel, analysis });

  const tr = await pool.query(`SELECT tenant_id, lead_id, type FROM followup_tasks WHERE id = $1`, [followupTaskId]);
  const task = tr.rows[0];
  if (!task) return;
  const isFeedbackCall = task.type === 'post_visit_feedback_call';

  const ke: any = analysis.key_entities || {};

  // 1b. Alternative-college pick: if the caller switched to a different college
  // during the visit-planning call, persist the new choice so the Visit Card +
  // future calls reflect it. Additive merge into crm custom_fields; never
  // overwrites with an empty value.
  const newCollege = String(ke.new_interested_college || (analysis as any).new_interested_college || '').trim();
  if (newCollege && !isFeedbackCall) {
    await updateLeadFields(task.tenant_id, task.lead_id, { interested_university: newCollege });
    logger.info({ conv: conversationId, lead: task.lead_id, newCollege }, 'AI follow-up: lead interested college updated');
  }

  // Rejected-now: the caller said not interested AND did NOT switch to a new
  // college. updateFollowupFromCallEnd already marked the lead NOT_INTERESTED +
  // cancelled automation — so we must NOT create a visit or overwrite the
  // pipeline stage below.
  const rejectedNow = !newCollege && (
    callOutcome.includes('not interested') || callOutcome.includes('not_interested')
    || ['NOT_INTERESTED', 'LOST', 'UNQUALIFIED'].includes(String((analysis as any).lead_status || '').toUpperCase())
  );

  // 2. AI-extracted visit → create a visit_schedules row (when a date/time was captured).
  const apptRaw = ke.appointment_time || (analysis as any).appointment_time || analysis.recommended_follow_up_time;
  const visitWhenRaw = parseFollowUpTimeLocal(apptRaw);
  const visitWhen = visitWhenRaw ? clampVisitToFuture(visitWhenRaw) : null;
  // Relaxed gate: on a visit-planning follow-up call (already gated by
  // followup_task_id, and excluded for feedback calls), create the Visit Card
  // whenever a parseable date/time was captured — the old keyword gate
  // ("visit"/"appointment" in call_outcome) dropped valid visits when the
  // analyzer's outcome label didn't contain those words. Skip on a reject.
  if (visitWhen && !isFeedbackCall && !rejectedNow) {
    const existing = await pool.query(
      `SELECT id FROM visit_schedules WHERE lead_id = $1 AND status IN ('SCHEDULED','CONFIRMED') LIMIT 1`,
      [task.lead_id],
    );
    if (existing.rows.length === 0) {
      const y = visitWhen.getFullYear();
      const mo = String(visitWhen.getMonth() + 1).padStart(2, '0');
      const d = String(visitWhen.getDate()).padStart(2, '0');
      const hh = String(visitWhen.getHours()).padStart(2, '0');
      const mm = String(visitWhen.getMinutes()).padStart(2, '0');
      // Link the originating call so the Visit Card carries the recording + full
      // summary. recording_url lives on the conversation row (written by the
      // telephony WS handler on stream stop); may be null if the WAV write lost
      // the race with analysis — that's fine, it stays null.
      const rec = await pool.query(
        `SELECT recording_url FROM conversations WHERE id = $1 LIMIT 1`, [conversationId],
      );
      const recordingUrl = rec.rows[0]?.recording_url || null;
      const callSummary = (analysis as any).detailed_summary || (analysis as any).short_summary || null;
      await pool.query(
        `INSERT INTO visit_schedules
           (tenant_id, lead_id, followup_task_id, visit_date, visit_time, status, created_from, visitor_type, notes,
            conversation_id, confirmation_call_id, recording_url, call_summary)
         VALUES ($1, $2, $3, $4, $5, 'SCHEDULED', 'AI_FOLLOW_UP_CALL', $6, $7, $8, $9::uuid, $10, $11)`,
        [task.tenant_id, task.lead_id, followupTaskId, `${y}-${mo}-${d}`, `${hh}:${mm}`,
         ke.visitor_type || null, (analysis as any).short_summary?.slice(0, 300) || null,
         conversationId, callId, recordingUrl, callSummary],
      );
      await updateLeadPipeline(task.tenant_id, task.lead_id, 'VISIT_SCHEDULED');
      logger.info({ conv: conversationId, lead: task.lead_id, visit_date: `${y}-${mo}-${d}` }, 'AI follow-up: visit auto-created');
    }
  }

  // 3. Post-visit feedback call → store feedback + handle the not-interested →
  //    alternative-college / reject flow.
  if (isFeedbackCall) {
    const visit = await pool.query(
      `SELECT id FROM visit_schedules WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`, [task.lead_id],
    );
    // The lead's CURRENT interested college becomes original_college / previous_college on a switch.
    let originalCollege: string | null = null;
    try {
      const lr = await fetch(`${config.crmServiceUrl}/leads/${task.lead_id}`, { headers: { 'x-tenant-id': task.tenant_id } });
      if (lr.ok) { const ld: any = await lr.json(); const cf = ld.custom_fields || {}; originalCollege = cf.interested_university || cf.interested_college || null; }
    } catch { /* best-effort */ }

    // Resilient not-interested detection — the Telugu (Sarvam-M) analyzer often
    // leaves the optional feedback fields empty, so fall back to coarse signals.
    const leadStatusUp = String((analysis as any).lead_status || '').toUpperCase();
    const objArr = Array.isArray(analysis.objections) ? analysis.objections : [];
    const notInterested = callOutcome.includes('not interested') || callOutcome.includes('not_interested')
      || /(not[_ ]?interested|reject)/i.test(String(ke.final_interest_status || ''))
      || ['NOT_INTERESTED', 'LOST', 'UNQUALIFIED'].includes(leadStatusUp)
      || (typeof analysis.interest_level === 'number' && analysis.interest_level < 35);
    const feedbackReason = String(ke.feedback_reason || '').trim()
      || (objArr.length ? String(objArr[0]).slice(0, 200) : null);
    const rejectionReason = String(ke.rejection_reason || '').trim() || (notInterested ? feedbackReason : null);
    const interestedInAlt = String(ke.interested_in_alternative || '').toLowerCase() === 'true' || !!newCollege;
    const suggested = Array.isArray(ke.suggested_colleges) ? ke.suggested_colleges : [];

    // Final outcome: explicit from analyzer, else derived.
    let finalStatus = String(ke.final_interest_status || '').toUpperCase();
    if (!finalStatus) finalStatus = newCollege ? 'ALTERNATIVE' : notInterested ? 'REJECTED' : 'INTERESTED';

    // Alternative visit date/time (from appointment_time) when switching colleges.
    let newVisitDate: string | null = null, newVisitTime: string | null = null;
    if (finalStatus === 'ALTERNATIVE' && visitWhen) {
      const y = visitWhen.getFullYear(); const mo = String(visitWhen.getMonth() + 1).padStart(2, '0'); const d = String(visitWhen.getDate()).padStart(2, '0');
      newVisitDate = `${y}-${mo}-${d}`; newVisitTime = `${String(visitWhen.getHours()).padStart(2, '0')}:${String(visitWhen.getMinutes()).padStart(2, '0')}`;
    }

    const rating = finalStatus === 'REJECTED' ? 'NEGATIVE' : (finalStatus !== 'REJECTED' && interestLevel >= 60) ? 'POSITIVE' : interestLevel >= 35 ? 'NEUTRAL' : 'NEGATIVE';
    const frec = await pool.query(`SELECT recording_url FROM conversations WHERE id = $1 LIMIT 1`, [conversationId]);
    const fRecordingUrl = frec.rows[0]?.recording_url || null;
    const rawProb = (analysis as any).conversion_probability;
    let admissionProb: number;
    if (typeof rawProb === 'number') admissionProb = rawProb <= 1 ? Math.round(rawProb * 100) : Math.round(rawProb);
    else admissionProb = Math.round(interestLevel);
    admissionProb = Math.max(0, Math.min(100, admissionProb));

    await pool.query(
      `INSERT INTO feedback_logs
         (tenant_id, lead_id, followup_task_id, call_id, visit_id, rating, rating_score,
          feedback_text, interest_after_visit, admission_readiness, objections, next_action, visited_status,
          conversation_id, recording_url, admission_probability,
          original_college, feedback_reason, interested_in_alternative, suggested_colleges,
          selected_new_college, new_visit_date, new_visit_time, final_interest_status, rejection_reason)
       VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::uuid,$15,$16,
               $17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25)`,
      [task.tenant_id, task.lead_id, followupTaskId, callId, visit.rows[0]?.id || null,
       rating, Math.max(1, Math.min(5, Math.round(interestLevel / 20))),
       (analysis as any).short_summary || null,
       finalStatus !== 'REJECTED' && interestLevel >= 60 ? 'high' : interestLevel >= 35 ? 'medium' : 'low',
       finalStatus === 'REJECTED' ? 'NOT_INTERESTED' : finalStatus === 'ALTERNATIVE' ? 'ALTERNATIVE' : interestLevel >= 80 ? 'READY' : 'NEEDS_FOLLOWUP',
       JSON.stringify(analysis.objections || []),
       finalStatus === 'REJECTED' ? 'CLOSED' : (analysis as any).next_best_action || null, 'VISITED',
       conversationId, fRecordingUrl, admissionProb,
       originalCollege, feedbackReason, interestedInAlt, JSON.stringify(suggested),
       newCollege || null, newVisitDate, newVisitTime, finalStatus, rejectionReason],
    );

    if (finalStatus === 'ALTERNATIVE' && newCollege) {
      // Switch the lead to the new college + create an alternative visit so the
      // normal visit→feedback chain continues for the new choice.
      await updateLeadFields(task.tenant_id, task.lead_id, {
        previous_college: originalCollege || undefined,
        interested_university: newCollege,
        college_changed: true,
        change_reason: feedbackReason || undefined,
      });
      await updateLeadPipeline(task.tenant_id, task.lead_id, 'ALTERNATIVE_COLLEGE_INTERESTED');
      if (newVisitDate) {
        const dup = await pool.query(`SELECT id FROM visit_schedules WHERE lead_id=$1 AND status IN ('SCHEDULED','CONFIRMED') LIMIT 1`, [task.lead_id]);
        if (dup.rows.length === 0) {
          await pool.query(
            `INSERT INTO visit_schedules
               (tenant_id, lead_id, followup_task_id, visit_date, visit_time, status, created_from, notes,
                conversation_id, confirmation_call_id, recording_url, call_summary)
             VALUES ($1,$2,$3,$4,$5,'SCHEDULED','ALTERNATIVE_VISIT',$6,$7::uuid,$8,$9,$10)`,
            [task.tenant_id, task.lead_id, followupTaskId, newVisitDate, newVisitTime,
             `Alternative visit to ${newCollege} (switched from ${originalCollege || 'previous college'})`.slice(0, 300),
             conversationId, callId, fRecordingUrl, (analysis as any).detailed_summary || (analysis as any).short_summary || null],
          );
          logger.info({ conv: conversationId, lead: task.lead_id, newCollege, newVisitDate }, 'post-visit feedback: alternative college + visit created');
        }
      }
    } else if (finalStatus === 'REJECTED') {
      // Global NOT_INTERESTED: record reason + stage AND cancel ALL pending
      // automation (covers the case where updateFollowupFromCallEnd's narrow
      // outcome-string check didn't fire but our resilient logic says rejected).
      await markLeadNotInterested(task.tenant_id, task.lead_id, 'FEEDBACK', rejectionReason || feedbackReason);
      logger.info({ conv: conversationId, lead: task.lead_id, rejectionReason }, 'post-visit feedback: lead NOT_INTERESTED — automation stopped');
    } else {
      // Interested (not alternative, not rejected). If the caller confirmed they
      // want to proceed with admission, mark ADMISSION_INTERESTED (additive
      // alias) and capture the expected joining date. Otherwise keep the
      // existing ADMISSION_READY / FEEDBACK_COLLECTED behaviour unchanged.
      const ai = String(ke.admission_interest || '').toLowerCase();
      const admissionYes = ai === 'true' || ai === 'yes' || interestLevel >= 75;
      const joiningDate = String(ke.expected_joining_date || '').trim();
      if (admissionYes) {
        await updateLeadFields(task.tenant_id, task.lead_id, {
          admission_interest: 'yes',
          expected_joining_date: joiningDate || undefined,
          extended_lead_status: 'ADMISSION_INTERESTED',
        });
        await updateLeadPipeline(task.tenant_id, task.lead_id, 'ADMISSION_INTERESTED');
        logger.info({ conv: conversationId, lead: task.lead_id, joiningDate }, 'post-visit feedback: ADMISSION_INTERESTED + joining date captured');
      } else {
        await updateLeadPipeline(task.tenant_id, task.lead_id, interestLevel >= 80 ? 'ADMISSION_READY' : 'FEEDBACK_COLLECTED');
      }
    }
    logger.info({ conv: conversationId, lead: task.lead_id, finalStatus }, 'post-visit feedback stored');
  } else if (!rejectedNow) {
    // Non-feedback follow-up that progressed normally. Don't overwrite a
    // NOT_INTERESTED stage that the reject path just set.
    await updateLeadPipeline(task.tenant_id, task.lead_id, 'BROCHURE_FOLLOWUP_COMPLETED');
  }
}

/** Best-effort additive merge of arbitrary fields into crm custom_fields.
 *  Skips empty values so we never clobber existing data. */
async function updateLeadFields(tenantId: string, leadId: string, fields: Record<string, any>): Promise<void> {
  try {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && !v.trim()) continue;
      clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return;
    const res = await fetch(`${config.crmServiceUrl}/leads/${leadId}`, { headers: { 'x-tenant-id': tenantId } });
    if (!res.ok) return;
    const lead: any = await res.json();
    const merged = { ...(lead.custom_fields || {}), ...clean };
    await fetch(`${config.crmServiceUrl}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ custom_fields: merged }),
    });
  } catch { /* best-effort */ }
}

/**
 * Global NOT_INTERESTED writer: record rejection reason + stage on the lead and
 * STOP all automation (cancel queued follow-ups + open visits). Used at every
 * stage's terminal not-interested point so the funnel halts immediately.
 * stage ∈ BULK_CALL | FOLLOW_UP | VISIT_PLANNING | FEEDBACK.
 */
async function markLeadNotInterested(tenantId: string, leadId: string, stage: string, reason: string | null): Promise<void> {
  await updateLeadFields(tenantId, leadId, {
    pipeline_stage: 'NOT_INTERESTED',
    rejection_reason: (reason || 'not interested').slice(0, 200),
    rejection_stage: stage,
    rejection_at: new Date().toISOString(),
    automation_status: 'STOPPED',
  });
  await cancelLeadAutomation(pool, tenantId, leadId);
}

/** Best-effort lead pipeline-stage write into crm custom_fields (merge). */
async function updateLeadPipeline(tenantId: string, leadId: string, stage: string): Promise<void> {
  try {
    const res = await fetch(`${config.crmServiceUrl}/leads/${leadId}`, { headers: { 'x-tenant-id': tenantId } });
    if (!res.ok) return;
    const lead: any = await res.json();
    const merged = { ...(lead.custom_fields || {}), pipeline_stage: stage };
    await fetch(`${config.crmServiceUrl}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ custom_fields: merged }),
    });
  } catch { /* best-effort */ }
}

async function fireWorkflowFromAnalysis(
  conversationId: string, tenantId: string, analysis: AnalysisResult, leadId: string | null,
): Promise<void> {
  const event = mapStatusToEvent(analysis.lead_status);
  if (!event) return;
  // Look up the caller phone — it lives on conversations.caller_number.
  // Without a phone the engine can't send, but we still trigger so the
  // side-effects (counselor assignment, admin notify) can run.
  const r = await pool.query(
    `SELECT caller_number FROM conversations WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId],
  );
  const phone: string | null = r.rows[0]?.caller_number || null;
  // Compose template context from the analyzer output. The variable
  // resolver reads dotted paths like lead.name, brochure_url.
  const context: Record<string, any> = {
    lead: {
      name: (analysis as any)?.key_entities?.full_name
        || (analysis as any)?.full_name
        || '',
      phone,
      email: (analysis as any)?.key_entities?.email || null,
    },
    conversation: { id: conversationId, summary: (analysis as any)?.short_summary || '' },
    brochure_url: process.env.BROCHURE_DEFAULT_URL || (analysis as any)?.brochure_url || '',
    callback_at: (analysis as any)?.callback_at || '',
  };
  await triggerWorkflow({
    tenant_id: tenantId,
    workflow_event: event,
    lead_id: leadId || undefined,
    phone: phone || undefined,
    context,
  });
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
    // Bulk/cold call: an explicit NOT_INTERESTED at this first stage halts the
    // funnel — record reason + stage and cancel any prior queued automation.
    // (WRONG_NUMBER/NO_ANSWER are not rejections — leave them be.)
    if (status === 'NOT_INTERESTED' && leadId) {
      const ke: any = analysis.key_entities || {};
      const reason = String(ke.rejection_reason || (Array.isArray(analysis.objections) && analysis.objections[0]) || (analysis as any).short_summary || 'not interested');
      await markLeadNotInterested(tenantId, leadId, 'BULK_CALL', reason).catch(() => {});
    }
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

  // Absolute dates: "2nd June 2026", "June 2 2026", "2 June", "02/06/2026".
  // Strip ordinal suffixes (2nd → 2) and optional weekday words first.
  const cleaned = s.replace(/(\d{1,2})(st|nd|rd|th)/g, '$1').replace(/[,]/g, ' ').trim();
  const months: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
    may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
    september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
  };
  const monthAlt = Object.keys(months).join('|');
  // Optional trailing time like "5 pm" / "17:00" / "10:30 am".
  const timeMatch = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || cleaned.match(/\b(\d{1,2}):(\d{2})\b/);
  let hour = 10, minute = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ap = timeMatch[3];
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
  }
  // "<day> <month> [year]" or "<month> <day> [year]".
  let day: number | null = null, mon: number | null = null, year = now.getFullYear();
  let m = cleaned.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthAlt})(?:\\s+(\\d{4}))?`, 'i'));
  if (m) { day = parseInt(m[1], 10); mon = months[m[2].toLowerCase()]; if (m[3]) year = parseInt(m[3], 10); }
  if (mon === null) {
    m = cleaned.match(new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2})(?:\\s+(\\d{4}))?`, 'i'));
    if (m) { mon = months[m[1].toLowerCase()]; day = parseInt(m[2], 10); if (m[3]) year = parseInt(m[3], 10); }
  }
  if (mon === null) {
    // Numeric day-first (Indian): dd/mm/yyyy or dd-mm-yyyy.
    m = cleaned.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (m) { day = parseInt(m[1], 10); mon = parseInt(m[2], 10) - 1; year = parseInt(m[3].length === 2 ? `20${m[3]}` : m[3], 10); }
  }
  if (mon !== null && day !== null && day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
    const d = new Date(year, mon, day, hour, minute, 0, 0);
    if (!isNaN(d.getTime())) return d;
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
