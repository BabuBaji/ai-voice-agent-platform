import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';
import { emailProvider } from '../providers/email.provider';
import { smsProvider } from '../providers/sms.provider';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export const notificationRouter = Router();

const SendNotificationSchema = z.object({
  type: z.enum(['email', 'sms']),
  recipient: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
  html: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Interpolate template variables: {{varName}} -> value
 */
function interpolateTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : `{{${key}}}`;
  });
}

/**
 * GET /notifications — list notifications for tenant with optional filters
 */
notificationRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset = (page - 1) * pageSize;
  const typeFilter = req.query.type as string;
  const statusFilter = req.query.status as string;

  try {
    let whereClause = 'WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIdx = 2;

    if (typeFilter) {
      whereClause += ` AND type = $${paramIdx++}`;
      params.push(typeFilter);
    }
    if (statusFilter) {
      whereClause += ` AND status = $${paramIdx++}`;
      params.push(statusFilter);
    }

    const [notifications, countResult] = await Promise.all([
      pool.query(
        `SELECT id, tenant_id, type, recipient, subject, status, sent_at, error, metadata, created_at
         FROM notifications
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        [...params, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int as total FROM notifications ${whereClause}`,
        params
      ),
    ]);

    res.json({
      data: notifications.rows,
      total: countResult.rows[0].total,
      page,
      pageSize,
    });
  } catch (err) {
    logger.error(err, 'Failed to list notifications');
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

/**
 * GET /notifications/:id — get notification detail
 */
notificationRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error(err, 'Failed to get notification');
    res.status(500).json({ error: 'Failed to get notification' });
  }
});

/**
 * POST /notifications/send — send a notification immediately
 */
notificationRouter.post('/send', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  const parseResult = SendNotificationSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    return;
  }

  const { type, recipient, subject, body, html, metadata } = parseResult.data;

  // If a templateId is provided in metadata, look up the template and interpolate
  let finalSubject = subject || '';
  let finalBody = body;

  if (metadata?.templateId) {
    try {
      const tplResult = await pool.query(
        `SELECT * FROM notification_templates WHERE id = $1 AND tenant_id = $2`,
        [metadata.templateId, tenantId]
      );
      if (tplResult.rows.length > 0) {
        const tpl = tplResult.rows[0];
        const vars = (metadata.variables as Record<string, any>) || {};
        finalSubject = tpl.subject ? interpolateTemplate(tpl.subject, vars) : finalSubject;
        finalBody = interpolateTemplate(tpl.body, vars);
      }
    } catch (err) {
      logger.warn({ templateId: metadata.templateId }, 'Template lookup failed, using raw body');
    }
  }

  // Insert notification record as PENDING
  let notificationId: string;
  try {
    const insertResult = await pool.query(
      `INSERT INTO notifications (tenant_id, type, recipient, subject, body, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
       RETURNING id`,
      [tenantId, type, recipient, finalSubject, finalBody, JSON.stringify(metadata || {})]
    );
    notificationId = insertResult.rows[0].id;
  } catch (err) {
    logger.error(err, 'Failed to insert notification record');
    res.status(500).json({ error: 'Failed to create notification' });
    return;
  }

  // Attempt to send
  try {
    let sendResult: { messageId: string; status: string };

    switch (type) {
      case 'email':
        sendResult = await emailProvider.send({
          to: recipient,
          subject: finalSubject,
          body: finalBody,
          html: html || finalBody,
        });
        break;
      case 'sms':
        sendResult = await smsProvider.send({
          to: recipient,
          body: finalBody,
        });
        break;
      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }

    // Update record to SENT
    await pool.query(
      `UPDATE notifications SET status = 'SENT', sent_at = NOW(),
       metadata = metadata || $1
       WHERE id = $2`,
      [JSON.stringify({ messageId: sendResult.messageId, providerStatus: sendResult.status }), notificationId]
    );

    res.json({
      id: notificationId,
      type,
      recipient,
      status: sendResult.status,
      messageId: sendResult.messageId,
      sentAt: new Date().toISOString(),
    });
  } catch (err: any) {
    // Update record to FAILED
    await pool.query(
      `UPDATE notifications SET status = 'FAILED', error = $1 WHERE id = $2`,
      [err.message, notificationId]
    ).catch(() => {});

    logger.error({ notificationId, error: err.message }, 'Notification send failed');
    res.status(500).json({
      id: notificationId,
      type,
      recipient,
      status: 'failed',
      error: err.message,
    });
  }
});

/**
 * Dispatch a notification (used by the RabbitMQ consumer).
 */
export async function dispatchNotification(
  tenantId: string,
  type: string,
  recipient: string,
  subject: string,
  body: string,
  metadata?: Record<string, any>
): Promise<void> {
  // Insert record
  const insertResult = await pool.query(
    `INSERT INTO notifications (tenant_id, type, recipient, subject, body, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
     RETURNING id`,
    [tenantId, type, recipient, subject, body, JSON.stringify(metadata || {})]
  );
  const notificationId = insertResult.rows[0].id;

  try {
    switch (type) {
      case 'email':
        await emailProvider.send({ to: recipient, subject, body, html: body });
        break;
      case 'sms':
        await smsProvider.send({ to: recipient, body });
        break;
      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }

    await pool.query(
      `UPDATE notifications SET status = 'SENT', sent_at = NOW() WHERE id = $1`,
      [notificationId]
    );
  } catch (err: any) {
    await pool.query(
      `UPDATE notifications SET status = 'FAILED', error = $1 WHERE id = $2`,
      [err.message, notificationId]
    ).catch(() => {});
    throw err;
  }
}
