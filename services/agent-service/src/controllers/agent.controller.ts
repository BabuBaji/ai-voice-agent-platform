import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('INBOUND'),
  system_prompt: z.string().min(1),
  llm_provider: z.string().max(50).default('openai'),
  llm_model: z.string().max(100).default('gpt-4o'),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(128000).default(4096),
  tools_config: z.any().default([]),
  knowledge_base_ids: z.array(z.string().uuid()).default([]),
  greeting_message: z.string().optional(),
  welcome_dynamic: z.boolean().default(true),
  welcome_interruptible: z.boolean().default(false),
  voice_config: z.any().default({}),
  stt_config: z.any().default({}),
  post_call_config: z.any().default({}),
  integrations_config: z.any().default({}),
  call_config: z.any().default({}),
  cost_per_min: z.number().min(0).max(10).default(0.115),
  metadata: z.any().default({}),
  created_by: z.string().uuid().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  system_prompt: z.string().min(1).optional(),
  llm_provider: z.string().max(50).optional(),
  llm_model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(128000).optional(),
  tools_config: z.any().optional(),
  knowledge_base_ids: z.array(z.string().uuid()).optional(),
  greeting_message: z.string().optional(),
  welcome_dynamic: z.boolean().optional(),
  welcome_interruptible: z.boolean().optional(),
  voice_config: z.any().optional(),
  stt_config: z.any().optional(),
  post_call_config: z.any().optional(),
  integrations_config: z.any().optional(),
  call_config: z.any().optional(),
  cost_per_min: z.number().min(0).max(10).optional(),
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

/**
 * Public agent lookup — no tenant header required.
 * Returns the minimum fields needed by the embeddable chat widget. Only
 * exposes ACTIVE agents so unfinished DRAFT agents stay private.
 *
 * Caller must already know the agent UUID (unguessable). The response
 * intentionally omits private fields like integrations_config and
 * post_call_config.
 */
export async function getAgentPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, tenant_id, name, status, system_prompt,
              llm_provider, llm_model, temperature, greeting_message,
              voice_config, call_config, integrations_config, knowledge_base_ids
       FROM agents
       WHERE id = $1 AND status = 'ACTIVE'`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found or not active' });
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
        tenant_id, name, description, direction, system_prompt, llm_provider, llm_model,
        temperature, max_tokens, tools_config, knowledge_base_ids,
        greeting_message, welcome_dynamic, welcome_interruptible,
        voice_config, stt_config, post_call_config, integrations_config, call_config,
        cost_per_min, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        tenantId,
        parsed.name,
        parsed.description || null,
        parsed.direction,
        parsed.system_prompt,
        parsed.llm_provider,
        parsed.llm_model,
        parsed.temperature,
        parsed.max_tokens,
        JSON.stringify(parsed.tools_config),
        parsed.knowledge_base_ids,
        parsed.greeting_message || null,
        parsed.welcome_dynamic,
        parsed.welcome_interruptible,
        JSON.stringify(parsed.voice_config),
        JSON.stringify(parsed.stt_config),
        JSON.stringify(parsed.post_call_config),
        JSON.stringify(parsed.integrations_config),
        JSON.stringify(parsed.call_config),
        parsed.cost_per_min,
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
      direction: parsed.direction,
      system_prompt: parsed.system_prompt,
      llm_provider: parsed.llm_provider,
      llm_model: parsed.llm_model,
      temperature: parsed.temperature,
      max_tokens: parsed.max_tokens,
      tools_config: parsed.tools_config !== undefined ? JSON.stringify(parsed.tools_config) : undefined,
      knowledge_base_ids: parsed.knowledge_base_ids,
      greeting_message: parsed.greeting_message,
      welcome_dynamic: parsed.welcome_dynamic,
      welcome_interruptible: parsed.welcome_interruptible,
      voice_config: parsed.voice_config !== undefined ? JSON.stringify(parsed.voice_config) : undefined,
      stt_config: parsed.stt_config !== undefined ? JSON.stringify(parsed.stt_config) : undefined,
      post_call_config: parsed.post_call_config !== undefined ? JSON.stringify(parsed.post_call_config) : undefined,
      integrations_config: parsed.integrations_config !== undefined ? JSON.stringify(parsed.integrations_config) : undefined,
      call_config: parsed.call_config !== undefined ? JSON.stringify(parsed.call_config) : undefined,
      cost_per_min: parsed.cost_per_min,
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
        tenant_id, name, description, direction, system_prompt, llm_provider, llm_model,
        temperature, max_tokens, tools_config, knowledge_base_ids,
        greeting_message, welcome_dynamic, welcome_interruptible,
        voice_config, stt_config, post_call_config, integrations_config, call_config,
        cost_per_min, metadata, created_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'DRAFT')
      RETURNING *`,
      [
        tenantId,
        agent.name + ' (Copy)',
        agent.description,
        agent.direction || 'INBOUND',
        agent.system_prompt,
        agent.llm_provider,
        agent.llm_model,
        agent.temperature,
        agent.max_tokens,
        JSON.stringify(agent.tools_config),
        agent.knowledge_base_ids,
        agent.greeting_message,
        agent.welcome_dynamic ?? true,
        agent.welcome_interruptible ?? false,
        JSON.stringify(agent.voice_config),
        JSON.stringify(agent.stt_config || {}),
        JSON.stringify(agent.post_call_config || {}),
        JSON.stringify(agent.integrations_config || {}),
        JSON.stringify(agent.call_config || {}),
        agent.cost_per_min ?? 0.115,
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
    const { message, history = [] } = req.body;

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const agentResult = await pool.query(
      'SELECT * FROM agents WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (agentResult.rows.length === 0) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const agent = agentResult.rows[0];
    const aiRuntimeUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';

    // Build messages from history + new message
    const messages = [
      ...history,
      { role: 'user', content: message }
    ];

    // Call ai-runtime simple chat endpoint
    const http = await import('http');
    const postData = JSON.stringify({
      system_prompt: agent.system_prompt,
      messages,
      provider: agent.llm_provider || 'openai',
      model: agent.llm_model || 'gpt-4o',
      temperature: parseFloat(agent.temperature) || 0.7,
      max_tokens: agent.max_tokens || 4096,
    });

    const response = await new Promise<string>((resolve, reject) => {
      const url = new URL(`${aiRuntimeUrl}/chat/simple`);
      const httpReq = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (resp) => {
          let data = '';
          resp.on('data', (chunk: Buffer) => { data += chunk; });
          resp.on('end', () => resolve(data));
        }
      );
      httpReq.on('error', reject);
      httpReq.setTimeout(30000, () => { httpReq.destroy(); reject(new Error('Timeout')); });
      httpReq.write(postData);
      httpReq.end();
    });

    const parsed = JSON.parse(response);
    res.json({
      reply: parsed.reply,
      agent: { name: agent.name, provider: agent.llm_provider, model: agent.llm_model },
    });
  } catch (err: any) {
    if (err.message === 'Timeout' || err.code === 'ECONNREFUSED') {
      res.status(503).json({ error: 'AI Runtime service unavailable. Make sure it is running and OPENAI_API_KEY is set.' });
      return;
    }
    next(err);
  }
}
