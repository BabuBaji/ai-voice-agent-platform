/**
 * Auto-brochure orchestrator.
 *
 * Single entry point `maybeAutoSendBrochure` invoked from the post-call
 * analyzer once a CRM lead has been created. It is a SUPERSET of the legacy
 * inline brochure block that used to live in analyzer.ts:
 *   - still sends WhatsApp + SMS and enqueues the recall on success
 *   - ADDS automatic email
 *   - ADDS per-college/course/branch brochure selection (falls back to
 *     BROCHURE_DEFAULT_URL + an admin-review task when nothing matches)
 *   - ADDS per-tenant settings (tenants.settings.brochure_auto_send)
 *   - ADDS per-(lead,channel) duplicate prevention
 *   - ADDS lead.custom_fields tracking (brochure_sent / channels / time)
 *
 * SAFETY: never throws. Failures are logged and surface as an admin-review
 * follow-up task. It must never block the analyzer / lead-creation pipeline.
 * Honors the existing `AUTO_BROCHURE=off` kill-switch and
 * `BROCHURE_DEFAULT_URL` env default.
 */
import { pool } from '../index';
import { config } from '../config';
import { sendEmail, sendWhatsApp, sendSms } from './communications';
import { enqueueLeadRecall } from './recallScheduler';
import { getTenantSettings } from './privacy';
import { recordBrochureDelivery } from './brochureDelivery';

const AUTO_EMAIL_TEMPLATE_ID = 'AUTO_BROCHURE';
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Extended lead statuses for which we auto-send when only_interested is on. */
const INTERESTED_STATUSES = new Set([
  'HOT_INTERESTED', 'INTERESTED', 'COUNSELOR_MEETING_REQUIRED',
  'CALLBACK_SCHEDULED', 'BROCHURE_REQUESTED',
]);

interface BrochureAutoSettings {
  enabled: boolean;
  via_whatsapp: boolean;
  via_email: boolean;
  only_interested: boolean;
  prevent_duplicates: boolean;
}
const DEFAULTS: BrochureAutoSettings = {
  enabled: true, via_whatsapp: true, via_email: true,
  only_interested: true, prevent_duplicates: true,
};

export interface AutoBrochureArgs {
  tenantId: string;
  leadId: string;
  conversationId: string;
  agentId?: string | null;
  firstName: string;
  email?: string | null;
  /** E.164 phone, e.g. +919876543210 */
  phoneE164?: string | null;
  extendedStatus?: string | null;
  /** Explicit asks the analyzer extracted from the transcript. */
  brochureRequired?: boolean;
  counselorMeetingRequired?: boolean;
  callbackRequired?: boolean;
  /** Drives brochure selection. */
  college?: string | null;
  course?: string | null;
  branch?: string | null;
  /** Natural-language follow-up time hint, passed through to the recall queue. */
  recommendedFollowUpTime?: string | null;
}

async function loadSettings(tenantId: string): Promise<BrochureAutoSettings> {
  try {
    const s = await getTenantSettings(tenantId);
    const b = (s && s.brochure_auto_send) || {};
    return {
      enabled: b.enabled ?? DEFAULTS.enabled,
      via_whatsapp: b.via_whatsapp ?? DEFAULTS.via_whatsapp,
      via_email: b.via_email ?? DEFAULTS.via_email,
      only_interested: b.only_interested ?? DEFAULTS.only_interested,
      prevent_duplicates: b.prevent_duplicates ?? DEFAULTS.prevent_duplicates,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

interface SelectedBrochure { id: string | null; url: string; name: string; matched: boolean; }

/**
 * Pick the best brochure for this lead. Preference order: branch match →
 * course match → verified-status → most recent. Falls back to
 * BROCHURE_DEFAULT_URL (matched=false) when no college brochure exists, so we
 * never block the send — the caller raises an admin-review task instead.
 */
async function selectBrochure(
  tenantId: string, college?: string | null, course?: string | null, branch?: string | null,
): Promise<SelectedBrochure> {
  const fallbackUrl = process.env.BROCHURE_DEFAULT_URL || 'https://dce.edu.in/';
  const fallback: SelectedBrochure = { id: null, url: fallbackUrl, name: 'Brochure', matched: false };
  if (!college || !college.trim()) return fallback;
  try {
    const r = await pool.query(
      `SELECT id, college_name, course, branch, brochure_url, file_url, verified_status
         FROM college_brochures
        WHERE tenant_id = $1 AND college_name ILIKE $2
        ORDER BY
          (CASE WHEN $3::text IS NOT NULL AND branch ILIKE $3 THEN 0 ELSE 1 END),
          (CASE WHEN $4::text IS NOT NULL AND course ILIKE $4 THEN 0 ELSE 1 END),
          (CASE WHEN verified_status = 'verified' THEN 0 ELSE 1 END),
          created_at DESC
        LIMIT 1`,
      [tenantId, `%${college.trim()}%`, branch || null, course || null],
    );
    const row = r.rows[0];
    const url = row?.brochure_url || row?.file_url;
    if (row && url) {
      return { id: row.id, url, name: `${row.college_name} Brochure`, matched: true };
    }
  } catch (e: any) {
    console.warn(`[auto-brochure] brochure selection query failed: ${e?.message}`);
  }
  return fallback;
}

/** Extract a 'HH:MM' (24h) string from a natural-language follow-up time, or
 *  null. The recall queue column is VARCHAR(8) and expects this exact shape —
 *  passing a raw NL string would overflow. Mirrors the analyzer's helper. */
function toHHmm(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  let m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (m) {
    const h = Math.min(23, parseInt(m[1], 10));
    const mm = Math.min(59, parseInt(m[2], 10));
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  m = s.match(/(\d{1,2})\s*(am|pm)/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[2] === 'pm' && h < 12) h += 12;
    if (m[2] === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

/** Channels already auto-sent for this lead, read from custom_fields so dedup
 *  is reliable regardless of provider-specific log semantics. */
function sentChannelsFor(customFields: any): Set<string> {
  const arr = customFields?.brochure_sent_channels;
  return new Set(Array.isArray(arr) ? arr.map((c: any) => String(c).toLowerCase()) : []);
}

async function fetchLead(tenantId: string, leadId: string): Promise<any | null> {
  try {
    const res = await fetch(`${config.crmServiceUrl}/leads/${leadId}`, {
      headers: { 'x-tenant-id': tenantId },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e: any) {
    console.warn(`[auto-brochure] fetchLead failed: ${e?.message}`);
    return null;
  }
}

/** Read-merge-write the lead's custom_fields (PUT replaces the column wholesale,
 *  so we must merge). Only touches brochure_* keys — never the canonical status
 *  or extended_lead_status, so the CRM workflow trigger does not re-fire. */
async function updateLeadBrochureState(
  tenantId: string, leadId: string, currentCustom: any, patch: Record<string, any>,
): Promise<void> {
  try {
    const merged = { ...(currentCustom || {}), ...patch };
    await fetch(`${config.crmServiceUrl}/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ custom_fields: merged }),
    });
  } catch (e: any) {
    console.warn(`[auto-brochure] lead update failed (lead=${leadId}): ${e?.message}`);
  }
}

/** Raise a follow-up task for human attention (no counselor assigned). Reuses
 *  the existing follow_up_tasks table — additive, no schema change. */
async function createAdminReviewTask(
  tenantId: string, leadId: string, conversationId: string, reason: string, note: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO follow_up_tasks
         (tenant_id, lead_id, conversation_id, assigned_to, task_type,
          scheduled_at, priority, status, notes)
       VALUES ($1, $2::uuid, $3::uuid, NULL, 'call', NOW(), 'high', 'pending', $4)`,
      [tenantId, leadId, conversationId, `${reason}: ${note}`],
    );
    console.info(`[auto-brochure] admin-review task created (lead=${leadId}, reason=${reason})`);
  } catch (e: any) {
    console.warn(`[auto-brochure] failed to create admin-review task: ${e?.message}`);
  }
}

/**
 * Entry point. Best-effort, never throws.
 */
export async function maybeAutoSendBrochure(args: AutoBrochureArgs): Promise<void> {
  const {
    tenantId, leadId, conversationId, agentId, firstName, email, phoneE164,
    extendedStatus, brochureRequired, counselorMeetingRequired, callbackRequired,
    college, course, branch, recommendedFollowUpTime,
  } = args;

  try {
    // 0. Global kill-switch (unchanged from legacy behavior).
    if ((process.env.AUTO_BROCHURE || 'on').toLowerCase() === 'off') {
      console.info(`[auto-brochure] disabled via AUTO_BROCHURE=off (lead=${leadId})`);
      return;
    }

    // 1. Per-tenant settings.
    const settings = await loadSettings(tenantId);
    if (!settings.enabled) {
      console.info(`[auto-brochure] disabled in tenant settings (lead=${leadId})`);
      return;
    }

    // 2. Interest gate. The analyzer already only calls us for interested
    //    callers, but honor the explicit toggle + the extracted asks.
    const statusUpper = String(extendedStatus || '').toUpperCase();
    const interested =
      INTERESTED_STATUSES.has(statusUpper) ||
      !!brochureRequired || !!counselorMeetingRequired || !!callbackRequired;
    if (settings.only_interested && !interested) {
      console.info(`[auto-brochure] SKIPPED — not interested (lead=${leadId}, status=${statusUpper})`);
      return;
    }

    // 3. Brochure selection.
    const brochure = await selectBrochure(tenantId, college, course, branch);
    const attachments = [{ name: brochure.name, url: brochure.url }];

    // 4. Read lead for dedup + the merge base.
    const lead = await fetchLead(tenantId, leadId);
    const currentCustom = lead?.custom_fields || {};
    const already = settings.prevent_duplicates ? sentChannelsFor(currentCustom) : new Set<string>();

    const validEmail = !!email && EMAIL_RE.test(String(email).trim());
    const validPhone = !!phoneE164 && /^\+?\d{8,15}$/.test(String(phoneE164).replace(/[^\d+]/g, ''));

    // 5. Decide which channels to send on.
    const wantEmail = settings.via_email && validEmail && !already.has('email');
    const wantWhatsApp = settings.via_whatsapp && validPhone && !already.has('whatsapp');
    // SMS preserves the legacy behavior — sent alongside WhatsApp messaging.
    const wantSms = settings.via_whatsapp && validPhone && !already.has('sms');

    if (!wantEmail && !wantWhatsApp && !wantSms) {
      console.info(`[auto-brochure] nothing to send (lead=${leadId}, email=${validEmail}, phone=${validPhone}, dedup-skipped)`);
      return;
    }

    // 6. Build channel payloads (spec sections 5 & 6).
    const emailSubject = `BTech Admission Details and Brochure${college ? ` - ${college}` : ''}`;
    const emailBody =
      `Hello ${firstName},\n\n` +
      `Thank you for your interest${course ? ` in ${course}` : ''} admissions.\n\n` +
      `Please find the brochure / admission details${college ? ` for ${college}` : ''} below.\n\n` +
      (course ? `Course: ${course}\n` : '') +
      (branch ? `Branch: ${branch}\n` : '') +
      `Brochure: ${brochure.url}\n\n` +
      `Our counselor will contact you shortly.\n\n` +
      `Regards,\nAdmissions Team`;

    const waMessage =
      `Hi ${firstName}, thank you for your interest${course ? ` in ${course}` : ''} admissions` +
      `${college ? ` at ${college}` : ''}.\n\n` +
      (branch ? `Branch: ${branch}\n` : '') +
      `Brochure: ${brochure.url}\n\n` +
      `Our counselor will contact you shortly.`;

    // 7. Fire enabled channels in parallel — best-effort. Each send result is
    //    ALSO recorded into lead_brochure_deliveries (additive tracking layer);
    //    recordBrochureDelivery never throws, so it can't affect the send flow.
    const brochureCtx = {
      tenantId, leadId, conversationId,
      brochureId: brochure.id, brochureName: brochure.name, brochureUrl: brochure.url,
      collegeName: college || null, courseName: course || null, branchName: branch || null,
      brochureMatched: brochure.matched,
    };
    const jobs: Array<Promise<{ channel: string; ok: boolean }>> = [];
    if (wantEmail) {
      jobs.push(
        sendEmail({
          tenant_id: tenantId, lead_id: leadId, conversation_id: conversationId,
          recipient: String(email).trim(), subject: emailSubject, body: emailBody,
          attachments, template_id: AUTO_EMAIL_TEMPLATE_ID,
        }).then(async (r) => {
          await recordBrochureDelivery({ ...brochureCtx, channel: 'email', recipientEmail: String(email).trim(), result: r });
          return { channel: 'email', ok: !!r.ok };
        }).catch(() => ({ channel: 'email', ok: false })),
      );
    }
    if (wantWhatsApp) {
      // NOTE: no template_id — keep this a free-form session message (passing a
      // template_id would force Meta template routing and fail).
      jobs.push(
        sendWhatsApp({
          tenant_id: tenantId, lead_id: leadId, conversation_id: conversationId,
          recipient: phoneE164!, message: waMessage, attachments,
        }).then(async (r) => {
          await recordBrochureDelivery({ ...brochureCtx, channel: 'whatsapp', recipientMobile: phoneE164!, result: r });
          return { channel: 'whatsapp', ok: !!r.ok };
        }).catch(() => ({ channel: 'whatsapp', ok: false })),
      );
    }
    if (wantSms) {
      jobs.push(
        sendSms({
          tenant_id: tenantId, lead_id: leadId, conversation_id: conversationId,
          recipient: phoneE164!, message: waMessage,
        }).then(async (r) => {
          await recordBrochureDelivery({ ...brochureCtx, channel: 'sms', recipientMobile: phoneE164!, result: r });
          return { channel: 'sms', ok: !!r.ok };
        }).catch(() => ({ channel: 'sms', ok: false })),
      );
    }

    const results = await Promise.all(jobs);
    const okChannels = results.filter((r) => r.ok).map((r) => r.channel);
    const anyOk = okChannels.length > 0;
    console.info(`[auto-brochure] dispatched (lead=${leadId}, matched=${brochure.matched}, ok=[${okChannels.join(',')}])`);

    // 8. Persist lead tracking (merge into custom_fields).
    if (anyOk) {
      const prevChannels = Array.from(sentChannelsFor(currentCustom));
      const mergedChannels = Array.from(new Set([...prevChannels, ...okChannels]));
      const alreadyFollowedUp = !!currentCustom?.brochure_followup_task_created;
      await updateLeadBrochureState(tenantId, leadId, currentCustom, {
        brochure_sent: true,
        brochure_sent_at: new Date().toISOString(),
        brochure_sent_channels: mergedChannels,
        brochure_id: brochure.id,
        brochure_name: brochure.name,
        brochure_send_failed: false,
        // Brochure follow-up workflow fields (kept in custom_fields — no leads
        // schema change). Drive the disabled "Send Brochure" button + the
        // follow-up pipeline.
        brochure_status: 'SENT',
        brochure_sent_by: 'SYSTEM',
        brochure_followup_required: true,
        brochure_resend_count: currentCustom?.brochure_resend_count || 0,
        brochure_followup_task_created: true,
        pipeline_stage: 'BROCHURE_FOLLOWUP_SCHEDULED',
      });

      // Auto-create a BROCHURE_CONFIRMATION follow-up (+4h) so the lead enters
      // the follow-up workflow visible on the Follow-ups page (followup_tasks
      // table). Guarded so a re-analyze of the same call doesn't duplicate it.
      if (!alreadyFollowedUp) {
        try {
          const { createFollowupForLead } = await import('./followupScheduler');
          await createFollowupForLead(pool, {
            tenantId, leadId, conversationId, agentId: agentId || undefined,
            type: 'brochure_follow_up_call',
            scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            notes: `Brochure sent via ${okChannels.join(', ')}. Follow-up: confirm receipt, discuss college/course/fee, and ask preferred visit date & time.`,
          });
          console.info(`[auto-brochure] brochure follow-up call scheduled (lead=${leadId}, +24h)`);
        } catch (e: any) {
          console.warn(`[auto-brochure] follow-up task creation failed (lead=${leadId}): ${e?.message}`);
        }
      }
    } else {
      await updateLeadBrochureState(tenantId, leadId, currentCustom, {
        brochure_send_failed: true,
        brochure_send_failed_at: new Date().toISOString(),
      });
    }

    // 9. No specific brochure matched → flag for admin to attach the right one.
    if (!brochure.matched) {
      await createAdminReviewTask(
        tenantId, leadId, conversationId, 'BROCHURE_NOT_FOUND',
        `No matching brochure for college="${college || ''}" course="${course || ''}" branch="${branch || ''}". Sent default URL; attach the correct brochure.`,
      );
    }
    // All channels failed → flag for manual outreach.
    if (!anyOk) {
      await createAdminReviewTask(
        tenantId, leadId, conversationId, 'BROCHURE_SEND_FAILED',
        'Auto brochure send failed on all channels. Resend manually from the lead detail page.',
      );
    }

    // 10. Preserve legacy recall enqueue: on any successful delivery, queue the
    //     "did you get the brochure?" follow-up loop.
    if (anyOk && phoneE164) {
      void enqueueLeadRecall({
        tenant_id: tenantId,
        lead_id: leadId,
        conversation_id: conversationId,
        agent_id: agentId || null,
        phone_number: phoneE164,
        lead_status: extendedStatus || null,
        preferred_callback_time: toHHmm(recommendedFollowUpTime),
      });
    }
  } catch (err: any) {
    console.warn(`[auto-brochure] maybeAutoSendBrochure error (lead=${leadId}): ${err?.message}`);
  }
}
