/**
 * Bulk WhatsApp campaign worker.
 *
 * Every TICK_MS the worker:
 *   1. Lists all RUNNING campaigns across all tenants.
 *   2. For each, claims at most (rate_limit_per_minute * TICK_MS / 60_000)
 *      queued targets via SELECT … FOR UPDATE SKIP LOCKED so two ticks (or
 *      two future worker instances) never double-send.
 *   3. For each claimed target: resolves template variables from the
 *      per-target variable_context, calls sendWhatsApp, writes back
 *      sent/failed + wamid + communication_log_id.
 *   4. After draining, calls maybeMarkCompleted() — when no queued rows
 *      remain, the campaign transitions to COMPLETED.
 *
 * Webhook propagation: after sendWhatsApp persists provider_message_id
 * onto communication_logs, Meta callbacks land in metaWhatsappWebhook
 * which updates BOTH communication_logs AND whatsapp_campaign_targets
 * (via the propagation patch in metaWhatsappWebhook.ts). That moves the
 * target through sent → delivered → read → replied without the worker
 * doing anything more.
 */
import pino from 'pino';
import {
  listRunningCampaigns, claimQueuedBatch, markTargetSent, markTargetFailed,
  maybeMarkCompleted, type WhatsAppCampaign, type CampaignTarget,
} from './whatsappCampaignStore';
import { getTemplate } from './whatsappTemplateStore';
import { resolveTemplateVariables } from './templateVariables';
import { sendWhatsApp } from './communications';

const logger = pino({ name: 'wa-campaign-worker' });

const TICK_MS = Number(process.env.WA_CAMPAIGN_TICK_MS || 5_000);
const MAX_ATTEMPTS = Number(process.env.WA_CAMPAIGN_MAX_ATTEMPTS || 3);

/** Per-tick claim size derived from the campaign's per-minute rate limit.
 *  60s / TICK_MS ticks per minute, divide the limit evenly. Minimum 1 so
 *  small campaigns still progress. */
function batchSizeFor(rateLimitPerMin: number): number {
  const ticksPerMin = Math.max(1, 60_000 / TICK_MS);
  return Math.max(1, Math.floor(rateLimitPerMin / ticksPerMin));
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startCampaignWorker(): void {
  if (timer) return;
  logger.info({ tick_ms: TICK_MS, max_attempts: MAX_ATTEMPTS }, 'wa-campaign-worker started');
  timer = setInterval(() => {
    void tick().catch((err) => logger.error({ err: err?.message || String(err) }, 'tick failed'));
  }, TICK_MS);
}

export function stopCampaignWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('wa-campaign-worker stopped');
  }
}

async function tick(): Promise<void> {
  // Single concurrent tick — drain across all campaigns within one pass.
  // If a previous tick is still running (slow Meta API), skip this one
  // so we don't blow past the rate limits.
  if (running) {
    logger.debug('previous tick still running — skipping');
    return;
  }
  running = true;
  try {
    const campaigns = await listRunningCampaigns();
    if (campaigns.length === 0) return;
    for (const camp of campaigns) {
      await drainCampaign(camp).catch((err) =>
        logger.warn({ campaign: camp.id, err: err?.message }, 'drainCampaign failed'),
      );
    }
  } finally {
    running = false;
  }
}

async function drainCampaign(camp: WhatsAppCampaign): Promise<void> {
  const batch = await claimQueuedBatch(camp.id, batchSizeFor(camp.rate_limit_per_minute));
  if (batch.length === 0) {
    // Nothing left to send — maybe everything terminal? Try marking complete.
    await maybeMarkCompleted(camp.id);
    return;
  }
  const tpl = await getTemplate(camp.tenant_id, camp.template_id);
  if (!tpl) {
    // Template deleted mid-campaign — fail all claimed targets, don't
    // re-queue them.
    logger.warn({ campaign: camp.id, template_id: camp.template_id }, 'template missing — failing batch');
    for (const t of batch) {
      await markTargetFailed(t.id, 'TEMPLATE_MISSING: referenced template no longer exists', null);
    }
    return;
  }
  // Sends are serial per tick. Meta enforces per-second caps on lower tiers
  // (250/s on the new test tier, 1000/s after verification). Parallel sends
  // would need an explicit p-limit to avoid 429s — for now serial keeps us
  // safe and predictable at the rate-limit-per-minute level.
  for (const target of batch) {
    await sendOneTarget(camp, tpl, target).catch((err) =>
      logger.warn({ target: target.id, err: err?.message }, 'sendOneTarget threw'),
    );
  }
}

async function sendOneTarget(camp: WhatsAppCampaign, tpl: any, target: CampaignTarget): Promise<void> {
  if (target.attempt_count > MAX_ATTEMPTS) {
    await markTargetFailed(target.id, `MAX_ATTEMPTS_REACHED (${MAX_ATTEMPTS})`, null);
    return;
  }
  const { params, missing } = resolveTemplateVariables(tpl, target.variable_context || {});
  if (missing.length > 0 && tpl.variable_count > 0) {
    // Empty strings can still produce a valid Meta call, but we record it
    // so the dashboard surfaces the gap.
    logger.info({ target: target.id, missing }, 'template variables missing — sending with empty strings');
  }
  const result = await sendWhatsApp({
    tenant_id: camp.tenant_id,
    lead_id: target.lead_id || undefined,
    recipient: target.recipient,
    message: tpl.body_text || '',
    template_id: tpl.name,
    template_language: tpl.language,
    template_params: params,
  });
  if (result.ok) {
    // The wamid is on communication_logs.provider_message_id (set by
    // sendWhatsAppWithProvider after the Meta call). The communication
    // log row id is returned directly. We re-query the log row to lift
    // the wamid onto the target — saves a JOIN at webhook time.
    const wamid = await fetchLogProviderMessageId(result.log_id);
    await markTargetSent(target.id, result.log_id, wamid);
  } else {
    await markTargetFailed(target.id, result.error || 'unknown', result.log_id);
  }
}

/** Look up communication_logs.provider_message_id by log row id. Single
 *  cheap indexed read; called once per send. */
async function fetchLogProviderMessageId(logId: string | null): Promise<string | null> {
  if (!logId) return null;
  // Lazy-import the pool to avoid a top-of-file circular-import risk with
  // index.ts where the pool is created.
  const { pool } = await import('../index');
  const r = await pool.query(
    `SELECT provider_message_id FROM communication_logs WHERE id = $1`, [logId],
  );
  return r.rows[0]?.provider_message_id || null;
}
