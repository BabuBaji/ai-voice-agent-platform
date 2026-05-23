import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pino from 'pino';
import { pool } from '../index';

const logger = pino({ name: 'meta-whatsapp-webhook' });
export const metaWhatsappWebhookRouter = Router();

/**
 * Meta WhatsApp Cloud webhook receiver.
 *
 * Two endpoints (Meta requires both at the same path):
 *   GET  /webhooks/meta/whatsapp — verification handshake (hub.challenge)
 *   POST /webhooks/meta/whatsapp — delivery status callbacks + incoming messages
 *
 * Security:
 *   - GET verifies hub.verify_token equals META_WA_VERIFY_TOKEN
 *   - POST verifies x-hub-signature-256 HMAC-SHA256 of raw body using
 *     META_WA_APP_SECRET. Requires app.ts to capture req.rawBody via the
 *     express.json verify hook.
 *
 * Delivery model:
 *   - Meta sends statuses (sent → delivered → read, or failed) referencing
 *     a wamid we logged at send time in communication_logs.provider_message_id.
 *   - Status updates are monotonic: 'queued' → 'sent' → 'delivered' → 'read'.
 *     'failed' is terminal except a later 'delivered' (rare race) is ignored.
 *   - Incoming messages with a `context.id` pointing at one of our sent
 *     wamids mark that log row as 'replied' + set replied_at.
 *
 * Idempotency:
 *   - Meta retries webhooks aggressively (up to 7 days) on any non-2xx.
 *   - We ACK 200 immediately after signature check, process async. Repeat
 *     deliveries of the same status are no-ops thanks to the monotonic
 *     WHERE clause.
 */

metaWhatsappWebhookRouter.get('/webhooks/meta/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WA_VERIFY_TOKEN;

  if (!expected) {
    logger.error('META_WA_VERIFY_TOKEN not configured');
    return res.status(500).send('verify_token_not_configured');
  }
  if (mode === 'subscribe' && token === expected && typeof challenge === 'string') {
    logger.info({ challenge: challenge.slice(0, 8) + '…' }, 'Meta webhook verified');
    return res.status(200).type('text/plain').send(challenge);
  }
  logger.warn({ mode, tokenMatch: token === expected }, 'Meta webhook verify failed');
  return res.sendStatus(403);
});

metaWhatsappWebhookRouter.post('/webhooks/meta/whatsapp', async (req: Request, res: Response) => {
  const sig = req.header('x-hub-signature-256');
  const secret = process.env.META_WA_APP_SECRET;
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (secret) {
    if (!sig || !rawBody) {
      logger.warn({ hasSig: !!sig, hasRaw: !!rawBody }, 'Webhook POST missing signature or raw body');
      return res.sendStatus(403);
    }
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      logger.warn({ sigPrefix: sig.slice(0, 16) + '…' }, 'Webhook HMAC mismatch');
      return res.sendStatus(403);
    }
  } else {
    // App secret missing — unsafe but allow during local bring-up. The verify
    // token alone protected the GET handshake; POSTs without HMAC are open.
    logger.warn('META_WA_APP_SECRET not set — accepting POST without HMAC verify');
  }

  // ACK fast. Meta retries on any non-2xx, so we must reply before doing
  // any DB work that might fail/timeout.
  res.sendStatus(200);

  try {
    await processWebhookEvent(req.body);
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, 'Webhook processing error');
  }
});

type MetaStatus = 'sent' | 'delivered' | 'read' | 'failed';

const STATUS_TIMESTAMP_COL: Record<MetaStatus, string> = {
  sent: 'sent_at',
  delivered: 'delivered_at',
  read: 'read_at',
  failed: 'failed_at',
};

async function processWebhookEvent(body: any): Promise<void> {
  if (body?.object !== 'whatsapp_business_account') {
    logger.debug({ object: body?.object }, 'Ignoring non-WABA webhook event');
    return;
  }
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      for (const status of value.statuses || []) {
        await handleStatusUpdate(status).catch((err) =>
          logger.warn({ err: err?.message, wamid: status?.id }, 'status update failed'),
        );
      }
      for (const msg of value.messages || []) {
        await handleIncomingMessage(msg).catch((err) =>
          logger.warn({ err: err?.message, from: msg?.from }, 'incoming message handler failed'),
        );
      }
    }
  }
}

async function handleStatusUpdate(status: any): Promise<void> {
  const wamid: string | undefined = status?.id;
  const metaStatus: string | undefined = status?.status;
  if (!wamid || !metaStatus) return;
  if (!(metaStatus in STATUS_TIMESTAMP_COL)) {
    logger.debug({ metaStatus }, 'Unknown Meta status — ignoring');
    return;
  }
  const tsCol = STATUS_TIMESTAMP_COL[metaStatus as MetaStatus];
  const errorText = status.errors?.[0]?.message || status.errors?.[0]?.title || null;

  // Monotonic transitions: queued→sent→delivered→read; failed is terminal.
  // The CASE in the WHERE clause prevents race regressions where 'sent'
  // arrives after 'delivered'.
  const sql = `
    UPDATE communication_logs
       SET status = $2::text,
           ${tsCol} = COALESCE(${tsCol}, NOW()),
           last_error = COALESCE($3, last_error),
           provider_response = COALESCE(provider_response, '{}'::jsonb) || $4::jsonb
     WHERE provider_message_id = $1
       AND channel = 'whatsapp'
       AND (
         ($2 = 'sent'      AND status IN ('queued'))
         OR ($2 = 'delivered' AND status IN ('queued','sent'))
         OR ($2 = 'read'      AND status IN ('queued','sent','delivered'))
         OR ($2 = 'failed'    AND status NOT IN ('failed','replied'))
       )
  `;
  const r = await pool.query(sql, [
    wamid,
    metaStatus,
    errorText,
    JSON.stringify({ webhook_status: status }),
  ]);
  if (r.rowCount === 0) {
    logger.info({ wamid, metaStatus }, 'No-op status update (unknown wamid or non-monotonic)');
  } else {
    logger.info({ wamid, metaStatus }, 'Status applied');
    // Propagate to any campaign target that matches this wamid. Same
    // monotonic guard as above so out-of-order webhooks don't regress.
    await propagateStatusToCampaignTarget(wamid, metaStatus as MetaStatus, tsCol, errorText);
  }
}

async function propagateStatusToCampaignTarget(
  wamid: string, metaStatus: MetaStatus, tsCol: string, errorText: string | null,
): Promise<void> {
  const sql = `
    UPDATE whatsapp_campaign_targets
       SET status = $2::text,
           ${tsCol} = COALESCE(${tsCol}, NOW()),
           last_error = COALESCE($3, last_error)
     WHERE provider_message_id = $1
       AND (
         ($2 = 'sent'      AND status IN ('queued'))
         OR ($2 = 'delivered' AND status IN ('queued','sent'))
         OR ($2 = 'read'      AND status IN ('queued','sent','delivered'))
         OR ($2 = 'failed'    AND status NOT IN ('failed','replied'))
       )
  `;
  const r = await pool.query(sql, [wamid, metaStatus, errorText]);
  if ((r.rowCount ?? 0) > 0) {
    logger.info({ wamid, metaStatus }, 'Campaign target status propagated');
  }
}

async function handleIncomingMessage(msg: any): Promise<void> {
  const referencedWamid: string | undefined = msg?.context?.id;
  const from: string | undefined = msg?.from;
  if (!referencedWamid) {
    // Inbound message that isn't a reply to one of ours — log for visibility.
    // Future phase will store these into a dedicated whatsapp_inbox table.
    logger.info({ from, type: msg?.type }, 'Inbound WhatsApp (not a reply)');
    return;
  }
  const sql = `
    UPDATE communication_logs
       SET status = 'replied',
           replied_at = COALESCE(replied_at, NOW())
     WHERE provider_message_id = $1
       AND channel = 'whatsapp'
       AND status <> 'replied'
  `;
  const r = await pool.query(sql, [referencedWamid]);
  logger.info({ referencedWamid, from, matched: r.rowCount }, 'Reply detected');
  // Same propagation to campaign targets — replies are a marketing-success
  // signal we want surfaced in the campaign dashboard.
  await pool.query(
    `UPDATE whatsapp_campaign_targets
        SET status = 'replied', replied_at = COALESCE(replied_at, NOW())
      WHERE provider_message_id = $1 AND status <> 'replied'`,
    [referencedWamid],
  );
}
