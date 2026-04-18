import { Router, Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { pool } from '../index';
import { config } from '../config';
import { twilioProvider } from '../providers/twilio.provider';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const webhookRouter = Router();

// POST /webhooks/twilio/voice — incoming call webhook
webhookRouter.post('/twilio/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Twilio voice webhook received');

    const {
      CallSid,
      From,
      To,
      CallStatus,
      Direction,
    } = req.body;

    // Look up agent by called number
    const phoneResult = await pool.query(
      `SELECT pn.*, pn.tenant_id, pn.agent_id
       FROM phone_numbers pn
       WHERE pn.phone_number = $1 AND pn.is_active = TRUE
       LIMIT 1`,
      [To]
    );

    if (phoneResult.rows.length === 0) {
      logger.warn({ to: To }, 'No agent found for called number');
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, this number is not configured. Goodbye.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    const phoneNumber = phoneResult.rows[0];
    const tenantId = phoneNumber.tenant_id;
    const agentId = phoneNumber.agent_id;

    // Create conversation via HTTP call to conversation-service
    let conversationId: string | null = null;
    try {
      const convResponse = await fetch(`${config.conversationServiceUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({
          agent_id: agentId,
          channel: 'PHONE',
          caller_number: From,
          called_number: To,
          call_sid: CallSid,
        }),
      });
      if (convResponse.ok) {
        const convData = (await convResponse.json()) as { id: string };
        conversationId = convData.id;
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to create conversation');
    }

    // Create call record in DB
    await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, conversation_id, direction, status, caller_number, called_number, provider, provider_call_sid)
       VALUES ($1, $2, $3, 'INBOUND', 'IN_PROGRESS', $4, $5, 'twilio', $6)`,
      [tenantId, agentId, conversationId, From, To, CallSid]
    );

    // Return TwiML to connect Media Stream
    const wsUrl = config.publicBaseUrl.replace(/^http/, 'ws');
    const twiml = twilioProvider.generateTwiML(
      `${wsUrl}/media-stream?callSid=${CallSid}&conversationId=${conversationId || ''}&agentId=${agentId}&tenantId=${tenantId}`
    );

    res.type('text/xml').send(twiml);
  } catch (err) {
    next(err);
  }
});

// POST /webhooks/twilio/status — call status update
webhookRouter.post('/twilio/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Twilio status webhook received');

    const { CallSid, CallStatus, CallDuration, RecordingUrl } = req.body;

    // Map Twilio statuses to our statuses
    const statusMap: Record<string, string> = {
      'queued': 'RINGING',
      'ringing': 'RINGING',
      'in-progress': 'IN_PROGRESS',
      'completed': 'COMPLETED',
      'busy': 'FAILED',
      'no-answer': 'FAILED',
      'canceled': 'CANCELLED',
      'failed': 'FAILED',
    };

    const mappedStatus = statusMap[CallStatus] || CallStatus?.toUpperCase() || 'UNKNOWN';
    const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(mappedStatus);

    const updateFields: string[] = ['status = $1'];
    const updateValues: any[] = [mappedStatus];
    let paramIdx = 2;

    if (isTerminal) {
      updateFields.push(`ended_at = NOW()`);
    }
    if (CallDuration) {
      updateFields.push(`duration_seconds = $${paramIdx}`);
      updateValues.push(parseInt(CallDuration));
      paramIdx++;
    }
    if (RecordingUrl) {
      updateFields.push(`recording_url = $${paramIdx}`);
      updateValues.push(RecordingUrl);
      paramIdx++;
    }

    updateValues.push(CallSid);

    await pool.query(
      `UPDATE calls SET ${updateFields.join(', ')} WHERE provider_call_sid = $${paramIdx}`,
      updateValues
    );

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

// POST /webhooks/exotel/voice — Exotel incoming call
webhookRouter.post('/exotel/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Exotel voice webhook received');

    const {
      CallSid,
      From,
      To,
      CallType,
    } = req.body;

    // Look up agent by called number
    const phoneResult = await pool.query(
      `SELECT * FROM phone_numbers WHERE phone_number = $1 AND is_active = TRUE LIMIT 1`,
      [To]
    );

    if (phoneResult.rows.length === 0) {
      logger.warn({ to: To }, 'No agent found for called number (Exotel)');
      res.status(200).json({
        status: 'not_found',
        message: 'No agent configured for this number',
      });
      return;
    }

    const phoneNumber = phoneResult.rows[0];
    const tenantId = phoneNumber.tenant_id;
    const agentId = phoneNumber.agent_id;

    // Create conversation via HTTP call to conversation-service
    let conversationId: string | null = null;
    try {
      const convResponse = await fetch(`${config.conversationServiceUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({
          agent_id: agentId,
          channel: 'PHONE',
          caller_number: From,
          called_number: To,
          call_sid: CallSid,
        }),
      });
      if (convResponse.ok) {
        const convData = (await convResponse.json()) as { id: string };
        conversationId = convData.id;
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to create conversation (Exotel)');
    }

    // Create call record
    await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, conversation_id, direction, status, caller_number, called_number, provider, provider_call_sid)
       VALUES ($1, $2, $3, 'INBOUND', 'IN_PROGRESS', $4, $5, 'exotel', $6)`,
      [tenantId, agentId, conversationId, From, To, CallSid]
    );

    res.status(200).json({
      status: 'ok',
      conversation_id: conversationId,
    });
  } catch (err) {
    next(err);
  }
});

// POST /webhooks/exotel/status — Exotel status update
webhookRouter.post('/exotel/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Exotel status webhook received');

    const { CallSid, Status, Duration, RecordingUrl } = req.body;

    const statusMap: Record<string, string> = {
      'ringing': 'RINGING',
      'in-progress': 'IN_PROGRESS',
      'completed': 'COMPLETED',
      'busy': 'FAILED',
      'no-answer': 'FAILED',
      'canceled': 'CANCELLED',
      'failed': 'FAILED',
    };

    const mappedStatus = statusMap[Status?.toLowerCase()] || Status?.toUpperCase() || 'UNKNOWN';
    const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(mappedStatus);

    const updateFields: string[] = ['status = $1'];
    const updateValues: any[] = [mappedStatus];
    let paramIdx = 2;

    if (isTerminal) {
      updateFields.push(`ended_at = NOW()`);
    }
    if (Duration) {
      updateFields.push(`duration_seconds = $${paramIdx}`);
      updateValues.push(parseInt(Duration));
      paramIdx++;
    }
    if (RecordingUrl) {
      updateFields.push(`recording_url = $${paramIdx}`);
      updateValues.push(RecordingUrl);
      paramIdx++;
    }

    updateValues.push(CallSid);

    await pool.query(
      `UPDATE calls SET ${updateFields.join(', ')} WHERE provider_call_sid = $${paramIdx}`,
      updateValues
    );

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});
