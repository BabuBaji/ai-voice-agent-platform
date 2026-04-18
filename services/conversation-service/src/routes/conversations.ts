import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const conversationRouter = Router();

conversationRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    data: [
      {
        id: uuidv4(),
        tenantId: _req.headers['x-tenant-id'],
        agentId: uuidv4(),
        contactId: uuidv4(),
        channel: 'voice',
        status: 'active',
        startedAt: new Date().toISOString(),
        metadata: {},
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

conversationRouter.get('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    tenantId: req.headers['x-tenant-id'],
    agentId: uuidv4(),
    contactId: uuidv4(),
    channel: 'voice',
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    metadata: {},
  });
});

conversationRouter.post('/', async (req: Request, res: Response) => {
  res.status(201).json({
    id: uuidv4(),
    tenantId: req.headers['x-tenant-id'],
    ...req.body,
    status: 'active',
    startedAt: new Date().toISOString(),
  });
});

conversationRouter.put('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    ...req.body,
    updatedAt: new Date().toISOString(),
  });
});

conversationRouter.delete('/:id', async (req: Request, res: Response) => {
  res.status(204).send();
});
