import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const phoneNumberRouter = Router();

phoneNumberRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    data: [
      {
        id: uuidv4(),
        number: '+14155551234',
        provider: 'twilio',
        capabilities: ['voice', 'sms'],
        status: 'active',
        assignedAgentId: null,
        createdAt: new Date().toISOString(),
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

phoneNumberRouter.get('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    number: '+14155551234',
    provider: 'twilio',
    capabilities: ['voice', 'sms'],
    status: 'active',
    assignedAgentId: null,
  });
});

phoneNumberRouter.post('/', async (req: Request, res: Response) => {
  res.status(201).json({
    id: uuidv4(),
    ...req.body,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
});

phoneNumberRouter.put('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    ...req.body,
    updatedAt: new Date().toISOString(),
  });
});

phoneNumberRouter.delete('/:id', async (req: Request, res: Response) => {
  res.status(204).send();
});

phoneNumberRouter.post('/provision', async (req: Request, res: Response) => {
  res.status(201).json({
    id: uuidv4(),
    number: '+14155559999',
    provider: req.body.provider || 'twilio',
    country: req.body.country || 'US',
    capabilities: req.body.capabilities || ['voice'],
    status: 'provisioning',
    createdAt: new Date().toISOString(),
  });
});
