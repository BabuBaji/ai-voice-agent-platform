import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Stub controller - returns mock data

export async function listAgents(req: Request, res: Response): Promise<void> {
  const tenantId = req.headers['x-tenant-id'] as string;
  res.json({
    data: [
      {
        id: uuidv4(),
        tenantId,
        name: 'Sales Agent',
        description: 'Handles outbound sales calls',
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
}

export async function getAgent(req: Request, res: Response): Promise<void> {
  res.json({
    id: req.params.id,
    tenantId: req.headers['x-tenant-id'],
    name: 'Sales Agent',
    description: 'Handles outbound sales calls',
    status: 'draft',
    voiceConfig: { provider: 'elevenlabs', voiceId: 'default' },
    llmConfig: { provider: 'openai', model: 'gpt-4' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function createAgent(req: Request, res: Response): Promise<void> {
  const id = uuidv4();
  res.status(201).json({
    id,
    tenantId: req.headers['x-tenant-id'],
    ...req.body,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function updateAgent(req: Request, res: Response): Promise<void> {
  res.json({
    id: req.params.id,
    tenantId: req.headers['x-tenant-id'],
    ...req.body,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteAgent(req: Request, res: Response): Promise<void> {
  res.status(204).send();
}

export async function publishAgent(req: Request, res: Response): Promise<void> {
  res.json({
    id: req.params.id,
    status: 'published',
    publishedAt: new Date().toISOString(),
  });
}

export async function cloneAgent(req: Request, res: Response): Promise<void> {
  const newId = uuidv4();
  res.status(201).json({
    id: newId,
    clonedFrom: req.params.id,
    tenantId: req.headers['x-tenant-id'],
    name: 'Sales Agent (Copy)',
    status: 'draft',
    createdAt: new Date().toISOString(),
  });
}

export async function getAgentPrompts(req: Request, res: Response): Promise<void> {
  res.json({
    agentId: req.params.id,
    systemPrompt: 'You are a helpful sales assistant.',
    greeting: 'Hello! How can I help you today?',
    fallback: 'I apologize, could you please rephrase that?',
    closingMessage: 'Thank you for your time. Have a great day!',
  });
}

export async function updateAgentPrompts(req: Request, res: Response): Promise<void> {
  res.json({
    agentId: req.params.id,
    ...req.body,
    updatedAt: new Date().toISOString(),
  });
}
