import { Pool } from 'pg';

export interface InvoiceLineItem {
  description: string;
  quantity?: number;
  unit_price?: number;
  amount: number;
}

export interface CreateInvoiceInput {
  tenant_id: string;
  reason: string;
  line_items: InvoiceLineItem[];
  status?: 'paid' | 'failed' | 'pending';
  period_start?: Date;
  period_end?: Date;
  tax_rate?: number;
}

const COMPACT_DATE = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export async function createInvoice(pool: Pool, input: CreateInvoiceInput) {
  const subtotal = input.line_items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const tax_rate = input.tax_rate ?? 18; // GST default
  const tax = +(subtotal * (tax_rate / 100)).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  const today = new Date();
  // Pull a per-tenant short code so invoice numbers don't collide.
  const seq = await pool.query(
    `SELECT COUNT(*)::int + 1 AS n FROM invoices WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`,
    [input.tenant_id],
  );
  const invoice_no = `INV-${COMPACT_DATE(today)}-${input.tenant_id.slice(0, 4).toUpperCase()}-${String(seq.rows[0].n).padStart(4, '0')}`;

  const ins = await pool.query(
    `INSERT INTO invoices
       (tenant_id, invoice_no, subtotal, tax, tax_rate, total_amount, currency, status, reason, line_items, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, $8, $9, $10, $11)
     RETURNING id, invoice_no, subtotal::float8 AS subtotal, tax::float8 AS tax, tax_rate::float8 AS tax_rate,
               total_amount::float8 AS total_amount, currency, status, reason, line_items,
               period_start, period_end, created_at`,
    [
      input.tenant_id,
      invoice_no,
      subtotal,
      tax,
      tax_rate,
      total,
      input.status ?? 'paid',
      input.reason,
      JSON.stringify(input.line_items),
      input.period_start ?? null,
      input.period_end ?? null,
    ],
  );
  return ins.rows[0];
}

export async function listInvoices(pool: Pool, tenantId: string, limit = 50) {
  const res = await pool.query(
    `SELECT id, invoice_no, subtotal::float8 AS subtotal, tax::float8 AS tax, tax_rate::float8 AS tax_rate,
            total_amount::float8 AS total_amount, currency, status, reason, line_items,
            period_start, period_end, created_at
     FROM invoices
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, Math.min(limit, 200)],
  );
  return res.rows;
}

export async function getInvoice(pool: Pool, tenantId: string, id: string) {
  const res = await pool.query(
    `SELECT id, invoice_no, subtotal::float8 AS subtotal, tax::float8 AS tax, tax_rate::float8 AS tax_rate,
            total_amount::float8 AS total_amount, currency, status, reason, line_items,
            period_start, period_end, created_at
     FROM invoices
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return res.rows[0] || null;
}
