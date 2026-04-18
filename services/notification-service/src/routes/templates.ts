import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const templateRouter = Router();

templateRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    data: [
      {
        id: uuidv4(),
        tenantId: _req.headers['x-tenant-id'],
        name: 'call-summary',
        channel: 'email',
        subject: 'Call Summary - {{agentName}}',
        body: 'Dear {{contactName}}, here is a summary of your recent call...',
        variables: ['agentName', 'contactName', 'callDuration', 'callSummary'],
        createdAt: new Date().toISOString(),
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

templateRouter.get('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    tenantId: req.headers['x-tenant-id'],
    name: 'call-summary',
    channel: 'email',
    subject: 'Call Summary - {{agentName}}',
    body: 'Dear {{contactName}}, here is a summary of your recent call...',
    variables: ['agentName', 'contactName', 'callDuration', 'callSummary'],
  });
});

templateRouter.post('/', async (req: Request, res: Response) => {
  res.status(201).json({
    id: uuidv4(),
    tenantId: req.headers['x-tenant-id'],
    ...req.body,
    createdAt: new Date().toISOString(),
  });
});

templateRouter.put('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    ...req.body,
    updatedAt: new Date().toISOString(),
  });
});

templateRouter.delete('/:id', async (req: Request, res: Response) => {
  res.status(204).send();
});
