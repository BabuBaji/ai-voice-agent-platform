import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const callRouter = Router();

callRouter.post('/initiate', async (req: Request, res: Response) => {
  const callId = uuidv4();
  res.status(201).json({
    callId,
    status: 'initiating',
    from: req.body.from,
    to: req.body.to,
    agentId: req.body.agentId,
    provider: req.body.provider || 'twilio',
    createdAt: new Date().toISOString(),
  });
});

callRouter.post('/:id/end', async (req: Request, res: Response) => {
  res.json({
    callId: req.params.id,
    status: 'ended',
    endedAt: new Date().toISOString(),
    duration: 0,
  });
});

callRouter.get('/:id/status', async (req: Request, res: Response) => {
  res.json({
    callId: req.params.id,
    status: 'in-progress',
    duration: 45,
    startedAt: new Date().toISOString(),
  });
});

callRouter.post('/:id/transfer', async (req: Request, res: Response) => {
  res.json({
    callId: req.params.id,
    status: 'transferring',
    transferTo: req.body.transferTo,
    transferType: req.body.transferType || 'warm',
  });
});
