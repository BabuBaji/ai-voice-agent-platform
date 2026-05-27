import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import pino from 'pino';
import { plivoProvider } from '../providers/plivo.provider';
import { pool } from '../index';
import { config } from '../config';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const plivoFeaturesRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /lookup — Number Lookup
// ─────────────────────────────────────────────────────────────────────────────

const lookupSchema = z.object({ phone_number: z.string().min(5) });

plivoFeaturesRouter.post('/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { phone_number } = lookupSchema.parse(req.body);
    const result = await plivoProvider.lookupNumber(phone_number);
    if (!result) {
      res.status(404).json({ error: 'Not Found', message: 'Number lookup returned no data' });
      return;
    }
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verify/send — Send OTP
// ─────────────────────────────────────────────────────────────────────────────

const verifySendSchema = z.object({
  phone_number: z.string().min(5),
  channel: z.enum(['sms', 'call']).default('sms'),
  code_length: z.number().min(4).max(8).default(6),
  locale: z.string().optional(),
});

plivoFeaturesRouter.post('/verify/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = verifySendSchema.parse(req.body);
    const result = await plivoProvider.startVerification({
      to: parsed.phone_number,
      channel: parsed.channel,
      codeLength: parsed.code_length,
      locale: parsed.locale,
    });
    res.json({ session_uuid: result.sessionUuid, status: result.status });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verify/check — Validate OTP
// ─────────────────────────────────────────────────────────────────────────────

const verifyCheckSchema = z.object({
  session_uuid: z.string().min(1),
  code: z.string().min(4).max(8),
});

plivoFeaturesRouter.post('/verify/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = verifyCheckSchema.parse(req.body);
    const result = await plivoProvider.checkVerification({
      sessionUuid: parsed.session_uuid,
      code: parsed.code,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /account — Account balance & info
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.get('/account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const result = await plivoProvider.getAccountBalance();
    if (!result) {
      res.status(503).json({ error: 'Unavailable', message: 'Could not reach Plivo API' });
      return;
    }
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /pricing/:country — Voice/SMS pricing
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.get('/pricing/:country', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const result = await plivoProvider.getPricing(req.params.country);
    if (!result) {
      res.status(404).json({ error: 'Not Found', message: 'Pricing data not available for this country' });
      return;
    }
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Recordings CRUD
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.get('/recordings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const callUuid = req.query.call_uuid as string | undefined;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await plivoProvider.listRecordings({ callUuid, limit, offset });
    res.json({ data: result, total: result.length });
  } catch (err) { next(err); }
});

plivoFeaturesRouter.get('/recordings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const result = await plivoProvider.getRecording(req.params.id);
    if (!result) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(result);
  } catch (err) { next(err); }
});

plivoFeaturesRouter.delete('/recordings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    await plivoProvider.deleteRecording(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sms/send — Direct SMS
// ─────────────────────────────────────────────────────────────────────────────

const smsSendSchema = z.object({
  from: z.string().optional(),
  to: z.string().min(5),
  text: z.string().min(1).max(1600),
  dlt_entity_id: z.string().optional(),
  dlt_template_id: z.string().optional(),
});

plivoFeaturesRouter.post('/sms/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = smsSendSchema.parse(req.body);
    const from = parsed.from || config.plivo.phoneNumber;
    if (!from) {
      res.status(400).json({ error: 'No From Number', message: 'Set PLIVO_PHONE_NUMBER or provide `from`' });
      return;
    }
    const callbackUrl = `${config.publicBaseUrl}/webhooks/plivo/sms-status`;
    const result = await plivoProvider.sendSms({
      from, to: parsed.to, text: parsed.text,
      callbackUrl, dltEntityId: parsed.dlt_entity_id, dltTemplateId: parsed.dlt_template_id,
    });
    // Log to communication_logs
    await pool.query(
      `INSERT INTO communication_logs
         (tenant_id, channel, provider, recipient, message, status, provider_response, sent_at)
       VALUES ($1, 'sms', 'plivo', $2, $3, 'sent', $4::jsonb, NOW())`,
      [tenantId, parsed.to, parsed.text, JSON.stringify({ message_uuid: result.messageUuid })],
    ).catch((e: any) => logger.warn({ err: e.message }, 'Failed to log SMS send'));
    res.json({ message_uuid: result.messageUuid, status: result.status });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /mms/send — Direct MMS
// ─────────────────────────────────────────────────────────────────────────────

const mmsSendSchema = z.object({
  from: z.string().optional(),
  to: z.string().min(5),
  text: z.string().min(1).max(1600),
  media_urls: z.array(z.string().url()).min(1),
});

plivoFeaturesRouter.post('/mms/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = mmsSendSchema.parse(req.body);
    const from = parsed.from || config.plivo.phoneNumber;
    if (!from) {
      res.status(400).json({ error: 'No From Number', message: 'Set PLIVO_PHONE_NUMBER or provide `from`' });
      return;
    }
    const result = await plivoProvider.sendMms({
      from, to: parsed.to, text: parsed.text, mediaUrls: parsed.media_urls,
      callbackUrl: `${config.publicBaseUrl}/webhooks/plivo/sms-status`,
    });
    res.json({ message_uuid: result.messageUuid, status: result.status });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /numbers/owned — List all Plivo numbers on the account
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.get('/numbers/owned', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = parseInt(req.query.offset as string) || 0;
    const numberType = req.query.number_type as string | undefined;
    const result = await plivoProvider.listOwnedNumbers({ limit, offset, numberType });
    res.json({ data: result, total: result.length });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /calls/:callUuid/cdr — Call Detail Record
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.get('/calls/:callUuid/cdr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const result = await plivoProvider.getCallDetailRecord(req.params.callUuid);
    if (!result) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /conference/create — Redirect a live call into a conference
// ─────────────────────────────────────────────────────────────────────────────

const conferenceSchema = z.object({
  call_uuid: z.string().min(1),
  conference_name: z.string().min(1).max(100),
  record: z.boolean().default(false),
  max_members: z.number().min(2).max(40).default(10),
});

plivoFeaturesRouter.post('/conference/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = conferenceSchema.parse(req.body);
    const cbUrl = `${config.publicBaseUrl}/webhooks/plivo/conference-event`;
    const result = await plivoProvider.createConference({
      conferenceName: parsed.conference_name,
      callUuid: parsed.call_uuid,
      record: parsed.record,
      maxMembers: parsed.max_members,
      callbackUrl: cbUrl,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /applications — Create a Plivo Application
// ─────────────────────────────────────────────────────────────────────────────

const appSchema = z.object({
  name: z.string().min(1).max(100),
  answer_url: z.string().url(),
  hangup_url: z.string().url().optional(),
  message_url: z.string().url().optional(),
});

plivoFeaturesRouter.post('/applications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = appSchema.parse(req.body);
    const result = await plivoProvider.createApplication({
      name: parsed.name, answerUrl: parsed.answer_url,
      hangupUrl: parsed.hangup_url, messageUrl: parsed.message_url,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /numbers/:number/application — Assign app to a number
// ─────────────────────────────────────────────────────────────────────────────

const assignAppSchema = z.object({ app_id: z.string().min(1) });

plivoFeaturesRouter.post('/numbers/:number/application', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { app_id } = assignAppSchema.parse(req.body);
    await plivoProvider.updateNumberApplication(req.params.number, app_id);
    res.json({ updated: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: err.errors }); return; }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /numbers/configure-webhooks — Auto-configure all owned numbers
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.post('/numbers/configure-webhooks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const base = config.publicBaseUrl;
    const appName = `VoiceAgent-${Date.now()}`;
    const app = await plivoProvider.createApplication({
      name: appName,
      answerUrl: `${base}/webhooks/plivo/voice`,
      hangupUrl: `${base}/webhooks/plivo/status`,
      messageUrl: `${base}/webhooks/plivo/sms-inbound`,
      fallbackUrl: `${base}/webhooks/plivo/voice`,
    });

    const numbers = await plivoProvider.listOwnedNumbers({ limit: 100 });
    let configured = 0;
    const errors: string[] = [];
    for (const num of numbers) {
      try {
        await plivoProvider.updateNumberApplication(num.number, app.appId);
        configured++;
      } catch (e: any) {
        errors.push(`${num.number}: ${e.message?.slice(0, 100)}`);
      }
    }
    logger.info({ appId: app.appId, configured, total: numbers.length }, 'Webhook auto-configuration complete');
    res.json({ app_id: app.appId, app_name: appName, configured, total: numbers.length, errors });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /webhooks/plivo/conference-xml — Returns Plivo Conference XML
// (Called by Plivo when we redirect a call into a conference)
// ─────────────────────────────────────────────────────────────────────────────

plivoFeaturesRouter.get('/conference-xml', async (req: Request, res: Response) => {
  const name = (req.query.name as string) || 'default-conf';
  const record = req.query.record === '1';
  const max = parseInt(req.query.max as string) || 10;
  const muted = req.query.muted === '1';
  const cb = req.query.cb as string || '';

  const attrs = [
    `maxMembers="${max}"`,
    muted ? 'muted="true"' : '',
    record ? `record="true" recordFileFormat="wav" recordCallbackUrl="${cb}" recordCallbackMethod="POST"` : '',
    cb ? `callbackUrl="${cb}" callbackMethod="POST"` : '',
    'enterSound="beep:1"',
    'exitSound="beep:2"',
    'stayAlone="false"',
    'endConferenceOnExit="true"',
  ].filter(Boolean).join(' ');

  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Conference ${attrs}>${name}</Conference>
</Response>`);
});
