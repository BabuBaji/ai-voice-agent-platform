import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool, ensureDefaultPipeline } from '../db/init';
import { getLeadsPaginated } from '../services/lead.service';
import { fireLeadWorkflow, mapStatusToEvent, leadContext } from '../services/whatsappWorkflow.client';

const router = Router();

const createLeadSchema = z.object({
  first_name: z.string().min(1).max(255),
  last_name: z.string().min(1).max(255),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  company: z.string().max(255).optional().nullable(),
  source: z.string().max(100).optional().nullable(),
  status: z.string().max(50).optional(),
  score: z.number().int().min(0).max(100).optional(),
  assigned_to: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.any()).optional(),
});

const updateLeadSchema = createLeadSchema.partial();

// GET /leads
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sort = (req.query.sort as string) || 'created_at';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';
    const status = req.query.status as string | undefined;
    const source = req.query.source as string | undefined;
    const search = req.query.search as string | undefined;

    const result = await getLeadsPaginated(
      req.tenantId,
      { page, limit, sort, order },
      { status, source, search }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /leads
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createLeadSchema.parse(req.body);

    // Ensure default pipeline exists for this tenant
    await ensureDefaultPipeline(req.tenantId);

    const result = await pool.query(
      `INSERT INTO leads (tenant_id, first_name, last_name, email, phone, company, source, status, score, assigned_to, tags, custom_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.tenantId,
        parsed.first_name,
        parsed.last_name,
        parsed.email || null,
        parsed.phone || null,
        parsed.company || null,
        parsed.source || null,
        parsed.status || 'NEW',
        parsed.score || 0,
        parsed.assigned_to || null,
        parsed.tags || [],
        JSON.stringify(parsed.custom_fields || {}),
      ]
    );
    const lead = result.rows[0];
    res.status(201).json(lead);

    // Fire-and-forget WhatsApp workflow. lead_created fires for every new
    // lead regardless of source (post-call analyzer, contact form, manual,
    // CSV one-off). If the lead was created with a non-NEW status that maps
    // to a workflow event (e.g. analyzer wrote 'QUALIFIED'), fire that too.
    if (lead.phone) {
      const ctx = leadContext(lead);
      fireLeadWorkflow({
        tenant_id: req.tenantId, workflow_event: 'lead_created',
        lead_id: lead.id, phone: lead.phone, context: ctx,
      });
      const event = mapStatusToEvent(lead.status, lead.custom_fields);
      if (event && event !== 'lead_created') {
        fireLeadWorkflow({
          tenant_id: req.tenantId, workflow_event: event,
          lead_id: lead.id, phone: lead.phone, context: ctx,
        });
      }
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /leads/import
router.post('/import', async (req: Request, res: Response) => {
  try {
    const leadsArray = z.array(createLeadSchema).parse(req.body);
    await ensureDefaultPipeline(req.tenantId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const imported: any[] = [];

      for (const lead of leadsArray) {
        const result = await client.query(
          `INSERT INTO leads (tenant_id, first_name, last_name, email, phone, company, source, status, score, assigned_to, tags, custom_fields)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            req.tenantId,
            lead.first_name,
            lead.last_name,
            lead.email || null,
            lead.phone || null,
            lead.company || null,
            lead.source || null,
            lead.status || 'NEW',
            lead.score || 0,
            lead.assigned_to || null,
            lead.tags || [],
            JSON.stringify(lead.custom_fields || {}),
          ]
        );
        imported.push(result.rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json({ imported: imported.length, leads: imported });

      // Fire lead_created for each imported lead (post-commit so we never
      // notify on rolled-back rows). Phone-less imports are silently skipped.
      for (const lead of imported) {
        if (lead.phone) {
          fireLeadWorkflow({
            tenant_id: req.tenantId, workflow_event: 'lead_created',
            lead_id: lead.id, phone: lead.phone, context: leadContext(lead),
          });
        }
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /leads/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const leadRes = await pool.query(
      'SELECT * FROM leads WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (leadRes.rows.length === 0) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const notesRes = await pool.query(
      `SELECT * FROM notes WHERE entity_type = 'LEAD' AND entity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 10`,
      [req.params.id, req.tenantId]
    );

    const lead = leadRes.rows[0];
    lead.recent_notes = notesRes.rows;

    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /leads/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateLeadSchema.parse(req.body);

    // Read prior state so we can detect a status change. Cheap indexed read
    // on the same row we're about to update.
    const priorRes = await pool.query(
      `SELECT status, custom_fields FROM leads WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    const priorStatus = priorRes.rows[0]?.status || null;
    const priorCustom = priorRes.rows[0]?.custom_fields || {};

    // Build dynamic SET clause
    const fields: string[] = [];
    const values: any[] = [req.params.id, req.tenantId];
    let paramIdx = 3;

    const fieldMap: Record<string, any> = {
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      email: parsed.email,
      phone: parsed.phone,
      company: parsed.company,
      source: parsed.source,
      status: parsed.status,
      score: parsed.score,
      assigned_to: parsed.assigned_to,
      tags: parsed.tags,
      custom_fields: parsed.custom_fields !== undefined ? JSON.stringify(parsed.custom_fields) : undefined,
    };

    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        fields.push(`${col} = $${paramIdx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    fields.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE leads SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    const lead = result.rows[0];
    res.json(lead);

    // Detect status change → fire the mapped workflow event. We compare
    // BOTH the canonical status field AND the extended_lead_status nested
    // in custom_fields (which the voice-agent analyzer writes). Sending on
    // every PUT would spam — only fire when the mapped event changed.
    if (lead.phone) {
      const priorEvent = mapStatusToEvent(priorStatus, priorCustom);
      const nextEvent = mapStatusToEvent(lead.status, lead.custom_fields);
      if (nextEvent && nextEvent !== priorEvent) {
        fireLeadWorkflow({
          tenant_id: req.tenantId, workflow_event: nextEvent,
          lead_id: lead.id, phone: lead.phone, context: leadContext(lead),
        });
      }
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /leads/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM leads WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
