import { Pool } from 'pg';
import crypto from 'crypto';

export interface PaymentMethod {
  id: string;
  type: 'card' | 'upi';
  provider: string;
  brand: string | null;
  last4: string | null;
  upi_id: string | null;
  holder_name: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  created_at: string;
}

export interface AddPaymentMethodInput {
  tenant_id: string;
  type: 'card' | 'upi';
  // For card. Real flow tokenizes via gateway and never receives the PAN.
  // We accept last4 + brand directly here (mock provider).
  brand?: string;
  last4?: string;
  holder_name?: string;
  exp_month?: number;
  exp_year?: number;
  upi_id?: string;
  set_default?: boolean;
}

export async function listPaymentMethods(pool: Pool, tenantId: string): Promise<PaymentMethod[]> {
  const res = await pool.query(
    `SELECT id, type, provider, brand, last4, upi_id, holder_name, exp_month, exp_year, is_default, created_at
     FROM payment_methods
     WHERE tenant_id = $1
     ORDER BY is_default DESC, created_at DESC`,
    [tenantId],
  );
  return res.rows;
}

export async function addPaymentMethod(pool: Pool, input: AddPaymentMethodInput): Promise<PaymentMethod> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT COUNT(*)::int AS n FROM payment_methods WHERE tenant_id = $1',
      [input.tenant_id],
    );
    const isFirst = existing.rows[0].n === 0;
    const setDefault = input.set_default ?? isFirst;

    if (setDefault) {
      await client.query(
        'UPDATE payment_methods SET is_default = false WHERE tenant_id = $1',
        [input.tenant_id],
      );
    }

    const provider_ref = `mock_pm_${crypto.randomBytes(6).toString('hex')}`;
    const ins = await client.query(
      `INSERT INTO payment_methods
         (tenant_id, type, provider, brand, last4, upi_id, holder_name, exp_month, exp_year, is_default, provider_ref)
       VALUES ($1, $2, 'mock', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, type, provider, brand, last4, upi_id, holder_name, exp_month, exp_year, is_default, created_at`,
      [
        input.tenant_id,
        input.type,
        input.brand ?? null,
        input.last4 ?? null,
        input.upi_id ?? null,
        input.holder_name ?? null,
        input.exp_month ?? null,
        input.exp_year ?? null,
        setDefault,
        provider_ref,
      ],
    );
    await client.query('COMMIT');
    return ins.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setDefaultPaymentMethod(pool: Pool, tenantId: string, id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE payment_methods SET is_default = false WHERE tenant_id = $1', [tenantId]);
    await client.query(
      'UPDATE payment_methods SET is_default = true WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePaymentMethod(pool: Pool, tenantId: string, id: string): Promise<void> {
  await pool.query(
    'DELETE FROM payment_methods WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
}
