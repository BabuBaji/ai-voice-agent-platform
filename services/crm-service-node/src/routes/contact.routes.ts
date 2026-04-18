import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';
import { getContactsPaginated } from '../services/lead.service';

const router = Router();

const createContactSchema = z.object({
  first_name: z.string().min(1).max(255),
  last_name: z.string().min(1).max(255),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  company: z.string().max(255).optional().nullable(),
  job_title: z.string().max(255).optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  custom_fields: z.record(z.any()).optional(),
});

const updateContactSchema = createContactSchema.partial();

// GET /contacts
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sort = (req.query.sort as string) || 'created_at';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';
    const search = req.query.search as string | undefined;

    const result = await getContactsPaginated(
      req.tenantId,
      { page, limit, sort, order },
      { search }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /contacts
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createContactSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO contacts (tenant_id, lead_id, first_name, last_name, email, phone, company, job_title, custom_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.tenantId,
        parsed.lead_id || null,
        parsed.first_name,
        parsed.last_name,
        parsed.email || null,
        parsed.phone || null,
        parsed.company || null,
        parsed.job_title || null,
        JSON.stringify(parsed.custom_fields || {}),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /contacts/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /contacts/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateContactSchema.parse(req.body);
    const fields: string[] = [];
    const values: any[] = [req.params.id, req.tenantId];
    let paramIdx = 3;

    const fieldMap: Record<string, any> = {
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      email: parsed.email,
      phone: parsed.phone,
      company: parsed.company,
      job_title: parsed.job_title,
      lead_id: parsed.lead_id,
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
      `UPDATE contacts SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /contacts/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
