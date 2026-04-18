import { Router } from 'express';
import * as agentController from '../controllers/agent.controller';

export const agentRouter = Router();

// CRUD
agentRouter.get('/', agentController.listAgents);
agentRouter.get('/:id', agentController.getAgent);
agentRouter.post('/', agentController.createAgent);
agentRouter.put('/:id', agentController.updateAgent);
agentRouter.delete('/:id', agentController.deleteAgent);

// Actions
agentRouter.post('/:id/publish', agentController.publishAgent);
agentRouter.post('/:id/clone', agentController.cloneAgent);

// Prompts
agentRouter.get('/:id/prompts', agentController.getAgentPrompts);
agentRouter.put('/:id/prompts', agentController.updateAgentPrompts);
