import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const notificationRouter = Router();

notificationRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    data: [
      {
        id: uuidv4(),
        tenantId: _req.headers['x-tenant-id'],
        channel: 'email',
        recipient: 'user@example.com',
        subject: 'Call Summary',
        status: 'sent',
        sentAt: new Date().toISOString(),
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

notificationRouter.get('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    tenantId: req.headers['x-tenant-id'],
    channel: 'email',
    recipient: 'user@example.com',
    subject: 'Call Summary',
    body: 'Your call has been completed successfully.',
    status: 'sent',
    sentAt: new Date().toISOString(),
  });
});

notificationRouter.post('/', async (req: Request, res: Response) => {
  const id = uuidv4();
  res.status(201).json({
    id,
    tenantId: req.headers['x-tenant-id'],
    ...req.body,
    status: 'queued',
    createdAt: new Date().toISOString(),
  });
});

notificationRouter.post('/send', async (req: Request, res: Response) => {
  res.json({
    id: uuidv4(),
    channel: req.body.channel || 'email',
    recipient: req.body.recipient,
    status: 'sent',
    sentAt: new Date().toISOString(),
  });
});
