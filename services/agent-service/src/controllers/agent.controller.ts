import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  system_prompt: z.string().min(1),
  llm_provider: z.string().max(50).default('openai'),
  llm_model: z.string().max(100).default('gpt-4o'),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(128000).default(4096),
  tools_config: z.any().default([]),
  knowledge_base_ids: z.array(z.string().uuid()).default([]),
  greeting_message: z.string().optional(),
  voice_config: z.any().default({}),
  metadata: z.any().default({}),
  created_by: z.string().uuid().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  system_prompt: z.string().min(1).optional(),
  llm_provider: z.string().max(50).optional(),
  llm_model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(128000).optional(),
  tools_config: z.any().optional(),
  knowledge_base_ids: z.array(z.string().uuid()).optional(),
  greeting_message: z.string().optional(),
  voice_config: z.any().optional(),
  metadata: z.any().optional(),
});

const createPromptSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().min(1),
  variables: z.any().default([]),
  version: z.number().int().default(1),
  is_active: z.boolean().default(true),
});

const updatePromptSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  variables: z.any().optional(),
  version: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export async function listAgents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM agents WHERE tenant_id = $1';
    let countQuery = 'SELECT COUNT(*) FROM agents WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    const countParams: any[] = [tenantId];

    if (status) {
      query += ' AND status = $2';
      countQuery += ' AND status = $2';
      params.push(status);
      countParams.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    res.json({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      pageSize: limit,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const parsed = createAgentSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO agents (
        tenant_id, name, description, system_prompt, llm_provider, llm_model,
        temperature, max_tokens, tools_config, knowledge_base_ids,
        greeting_message, voice_config, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        tenantId,
        parsed.name,
        parsed.description || null,
        parsed.system_prompt,
        parsed.llm_provider,
        parsed.llm_model,
        parsed.temperature,
        parsed.max_tokens,
        JSON.stringify(parsed.tools_config),
        parsed.knowledge_base_ids,
        parsed.greeting_message || null,
        JSON.stringify(parsed.voice_config),
        JSON.stringify(parsed.metadata),
        parsed.created_by || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
}

export async function updateAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    const parsed = updateAgentSchema.parse(req.body);

    // Build dynamic UPDATE
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, any> = {
      name: parsed.name,
      description: parsed.description,
      system_prompt: parsed.system_prompt,
      llm_provider: parsed.llm_provider,
      llm_model: parsed.llm_model,
      temperature: parsed.temperature,
      max_tokens: parsed.max_tokens,
      tools_config: parsed.tools_config !== undefined ? JSON.stringify(parsed.tools_config) : undefined,
      knowledge_base_ids: parsed.knowledge_base_ids,
      greeting_message: parsed.greeting_message,
      voice_config: parsed.voice_config !== undefined ? JSON.stringify(parsed.voice_config) : undefined,
      metadata: parsed.metadata !== undefined ? JSON.stringify(parsed.metadata) : undefined,
    };

    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        setClauses.push(`${col} = $${paramIndex}`);
        values.push(val);
        paramIndex++;
      }
    }

    values.push(id, tenantId);

    const result = await pool.query(
      `UPDATE agents SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
}

export async function deleteAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE agents SET status = 'ARCHIVED', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function publishAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE agents SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function unpublishAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE agents SET status = 'DRAFT', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function cloneAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    // Fetch original agent
    const original = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (original.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    const agent = original.rows[0];

    const result = await pool.query(
      `INSERT INTO agents (
        tenant_id, name, description, system_prompt, llm_provider, llm_model,
        temperature, max_tokens, tools_config, knowledge_base_ids,
        greeting_message, voice_config, metadata, created_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'DRAFT')
      RETURNING *`,
      [
        tenantId,
        agent.name + ' (Copy)',
        agent.description,
        agent.system_prompt,
        agent.llm_provider,
        agent.llm_model,
        agent.temperature,
        agent.max_tokens,
        JSON.stringify(agent.tools_config),
        agent.knowledge_base_ids,
        agent.greeting_message,
        JSON.stringify(agent.voice_config),
        JSON.stringify(agent.metadata),
        agent.created_by,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getAgentPrompts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM prompt_templates WHERE agent_id = $1 AND tenant_id = $2 ORDER BY created_at DESC',
      [id, tenantId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function createAgentPrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    const parsed = createPromptSchema.parse(req.body);

    // Verify agent exists and belongs to tenant
    const agentCheck = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (agentCheck.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO prompt_templates (tenant_id, agent_id, name, content, variables, version, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenantId, id, parsed.name, parsed.content, JSON.stringify(parsed.variables), parsed.version, parsed.is_active]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
}

export async function updateAgentPrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id, promptId } = req.params;
    const parsed = updatePromptSchema.parse(req.body);

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (parsed.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(parsed.name);
    }
    if (parsed.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      values.push(parsed.content);
    }
    if (parsed.variables !== undefined) {
      setClauses.push(`variables = $${paramIndex++}`);
      values.push(JSON.stringify(parsed.variables));
    }
    if (parsed.version !== undefined) {
      setClauses.push(`version = $${paramIndex++}`);
      values.push(parsed.version);
    }
    if (parsed.is_active !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      values.push(parsed.is_active);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    values.push(promptId, id, tenantId);

    const result = await pool.query(
      `UPDATE prompt_templates SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex} AND agent_id = $${paramIndex + 1} AND tenant_id = $${paramIndex + 2}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Prompt template not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
}

export async function testAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Bad Request', message: 'message field is required' });
      return;
    }

    // Verify agent exists
    const agentCheck = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (agentCheck.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    // Forward to ai-runtime service
    try {
      const fetch = (await import('node:http')).request;
      const aiRuntimeUrl = process.env.AI_RUNTIME_URL || 'http://localhost:3004';

      const response = await new Promise<string>((resolve, reject) => {
        const postData = JSON.stringify({
          agentId: id,
          tenantId,
          message,
          systemPrompt: agentCheck.rows[0].system_prompt,
          llmProvider: agentCheck.rows[0].llm_provider,
          llmModel: agentCheck.rows[0].llm_model,
          temperature: agentCheck.rows[0].temperature,
          maxTokens: agentCheck.rows[0].max_tokens,
        });

        const url = new URL(`${aiRuntimeUrl}/api/v1/chat`);
        const req = fetch(
          { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } },
          (resp) => {
            let data = '';
            resp.on('data', (chunk) => { data += chunk; });
            resp.on('end', () => resolve(data));
          }
        );
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      res.json(JSON.parse(response));
    } catch (err) {
      // If ai-runtime is not available, return a helpful error
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'AI Runtime service is not available for test chat',
      });
    }
  } catch (err) {
    next(err);
  }
}
