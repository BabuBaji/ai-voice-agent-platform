import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const messageRouter = Router();

messageRouter.get('/', async (req: Request, res: Response) => {
  const conversationId = req.query.conversationId as string;
  res.json({
    data: [
      {
        id: uuidv4(),
        conversationId: conversationId || uuidv4(),
        role: 'user',
        content: 'Hello, I need help.',
        timestamp: new Date().toISOString(),
      },
      {
        id: uuidv4(),
        conversationId: conversationId || uuidv4(),
        role: 'agent',
        content: 'Hi! How can I assist you today?',
        timestamp: new Date().toISOString(),
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  });
});

messageRouter.get('/:id', async (req: Request, res: Response) => {
  res.json({
    id: req.params.id,
    conversationId: uuidv4(),
    role: 'user',
    content: 'Hello, I need help.',
    timestamp: new Date().toISOString(),
  });
});

messageRouter.post('/', async (req: Request, res: Response) => {
  res.status(201).json({
    id: uuidv4(),
    ...req.body,
    timestamp: new Date().toISOString(),
  });
});

messageRouter.delete('/:id', async (req: Request, res: Response) => {
  res.status(204).send();
});
