import { Pool, PoolClient } from 'pg';
import { TRIAL_CREDIT_INR } from './plans';

export interface Wallet {
  id: string;
  tenant_id: string;
  balance: number;
  currency: string;
  low_balance_threshold: number;
  is_low: boolean;
}

export interface WalletTransaction {
  id: string;
  amount: number;
  type: 'credit' | 'debit';
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  balance_after: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function ensureWallet(pool: Pool, tenantId: string): Promise<Wallet> {
  const existing = await pool.query(
    'SELECT id, tenant_id, balance::float8 AS balance, currency, low_balance_threshold::float8 AS low_balance_threshold FROM wallets WHERE tenant_id = $1',
    [tenantId],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return { ...row, is_low: row.balance < row.low_balance_threshold };
  }

  // Brand-new tenant: seed with trial credit + log it as a credit transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO wallets (tenant_id, balance, currency, low_balance_threshold)
       VALUES ($1, $2, 'INR', 100)
       ON CONFLICT (tenant_id) DO NOTHING
       RETURNING id, tenant_id, balance::float8 AS balance, currency, low_balance_threshold::float8 AS low_balance_threshold`,
      [tenantId, TRIAL_CREDIT_INR],
    );
    if (ins.rows.length > 0) {
      await client.query(
        `INSERT INTO wallet_transactions (tenant_id, amount, type, reason, reference_type, balance_after, metadata)
         VALUES ($1, $2, 'credit', 'Trial credit', 'signup', $2, '{}')`,
        [tenantId, TRIAL_CREDIT_INR],
      );
    }
    await client.query('COMMIT');

    if (ins.rows.length > 0) {
      const row = ins.rows[0];
      return { ...row, is_low: row.balance < row.low_balance_threshold };
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Race: another connection inserted first — re-read.
  const reread = await pool.query(
    'SELECT id, tenant_id, balance::float8 AS balance, currency, low_balance_threshold::float8 AS low_balance_threshold FROM wallets WHERE tenant_id = $1',
    [tenantId],
  );
  const row = reread.rows[0];
  return { ...row, is_low: row.balance < row.low_balance_threshold };
}

export interface CreditOptions {
  reason: string;
  reference_type?: string;
  reference_id?: string;
  metadata?: Record<string, unknown>;
}

export async function creditWallet(
  pool: Pool,
  tenantId: string,
  amount: number,
  opts: CreditOptions,
): Promise<{ balance_after: number; transaction_id: string }> {
  if (amount <= 0) throw new Error('Credit amount must be positive');

  await ensureWallet(pool, tenantId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = now()
       WHERE tenant_id = $2
       RETURNING balance::float8 AS balance`,
      [amount, tenantId],
    );
    const balance_after = upd.rows[0].balance as number;
    const tx = await client.query(
      `INSERT INTO wallet_transactions
         (tenant_id, amount, type, reason, reference_type, reference_id, balance_after, metadata)
       VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        tenantId,
        amount,
        opts.reason,
        opts.reference_type ?? null,
        opts.reference_id ?? null,
        balance_after,
        JSON.stringify(opts.metadata ?? {}),
      ],
    );
    await client.query('COMMIT');
    return { balance_after, transaction_id: tx.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface DebitOptions extends CreditOptions {
  allow_negative?: boolean;
}

export interface DebitResult {
  success: boolean;
  balance_after: number;
  transaction_id?: string;
  insufficient?: boolean;
}

/**
 * Atomically debit the wallet. Uses SELECT FOR UPDATE to serialize
 * concurrent debits (e.g. two calls ending at the same instant).
 */
export async function debitWallet(
  pool: Pool,
  tenantId: string,
  amount: number,
  opts: DebitOptions,
): Promise<DebitResult> {
  if (amount <= 0) throw new Error('Debit amount must be positive');

  await ensureWallet(pool, tenantId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      'SELECT balance::float8 AS balance FROM wallets WHERE tenant_id = $1 FOR UPDATE',
      [tenantId],
    );
    const balance = cur.rows[0]?.balance as number | undefined;
    if (balance === undefined) {
      await client.query('ROLLBACK');
      return { success: false, balance_after: 0, insufficient: true };
    }
    if (balance < amount && !opts.allow_negative) {
      await client.query('ROLLBACK');
      return { success: false, balance_after: balance, insufficient: true };
    }

    const upd = await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = now()
       WHERE tenant_id = $2
       RETURNING balance::float8 AS balance`,
      [amount, tenantId],
    );
    const balance_after = upd.rows[0].balance as number;
    const tx = await client.query(
      `INSERT INTO wallet_transactions
         (tenant_id, amount, type, reason, reference_type, reference_id, balance_after, metadata)
       VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        tenantId,
        amount,
        opts.reason,
        opts.reference_type ?? null,
        opts.reference_id ?? null,
        balance_after,
        JSON.stringify(opts.metadata ?? {}),
      ],
    );
    await client.query('COMMIT');
    return { success: true, balance_after, transaction_id: tx.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listTransactions(
  pool: Pool,
  tenantId: string,
  limit = 50,
): Promise<WalletTransaction[]> {
  const res = await pool.query(
    `SELECT id, amount::float8 AS amount, type, reason, reference_type, reference_id,
            balance_after::float8 AS balance_after, metadata, created_at
     FROM wallet_transactions
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, Math.min(limit, 200)],
  );
  return res.rows;
}
