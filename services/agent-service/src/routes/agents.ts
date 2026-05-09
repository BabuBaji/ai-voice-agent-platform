import { Router, Request, Response, NextFunction } from 'express';
import * as agentController from '../controllers/agent.controller';

export const agentRouter = Router();

// UUID guard: rejects "null" / "undefined" / non-UUID :id params with a clean
// 400 BEFORE Postgres throws "invalid input syntax for type uuid".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
agentRouter.param('id', (req: Request, res: Response, next: NextFunction, value: string) => {
  if (!value || !UUID_RE.test(String(value))) {
    res.status(400).json({ error: 'Bad Request', message: `Invalid agent id "${value}" — must be a UUID` });
    return;
  }
  next();
});
agentRouter.param('promptId', (req: Request, res: Response, next: NextFunction, value: string) => {
  if (!value || !UUID_RE.test(String(value))) {
    res.status(400).json({ error: 'Bad Request', message: `Invalid prompt id "${value}" — must be a UUID` });
    return;
  }
  next();
});

// CRUD
agentRouter.get('/', agentController.listAgents);
agentRouter.get('/:id', agentController.getAgent);
agentRouter.post('/', agentController.createAgent);
agentRouter.put('/:id', agentController.updateAgent);
agentRouter.delete('/:id', agentController.deleteAgent);

// Actions
agentRouter.post('/:id/publish', agentController.publishAgent);
agentRouter.post('/:id/unpublish', agentController.unpublishAgent);
agentRouter.post('/:id/clone', agentController.cloneAgent);
agentRouter.post('/:id/test', agentController.testAgent);

// Prompts
agentRouter.get('/:id/prompts', agentController.getAgentPrompts);
agentRouter.post('/:id/prompts', agentController.createAgentPrompt);
agentRouter.put('/:id/prompts/:promptId', agentController.updateAgentPrompt);
