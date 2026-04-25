import { Pool } from 'pg';
import { PHONE_RENTAL_DEFAULTS } from './plans';

export interface PhoneRental {
  id: string;
  tenant_id: string;
  number: string;
  country: string;
  provider: string;
  monthly_cost: number;
  channels: number;
  channel_extra_cost: number;
  status: string;
  agent_id: string | null;
  next_renewal_date: string;
  last_charged_at: string | null;
  created_at: string;
  updated_at: string;
  total_monthly: number;
}

function addOneMonth(d: Date): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + 1);
  return next;
}

function withTotal(row: any): PhoneRental {
  const extra = Math.max(0, row.channels - 1) * row.channel_extra_cost;
  return { ...row, total_monthly: +(row.monthly_cost + extra).toFixed(2) };
}

export async function listRentals(pool: Pool, tenantId: string): Promise<PhoneRental[]> {
  const res = await pool.query(
    `SELECT id, tenant_id, number, country, provider,
            monthly_cost::float8 AS monthly_cost, channels,
            channel_extra_cost::float8 AS channel_extra_cost,
            status, agent_id, next_renewal_date, last_charged_at, created_at, updated_at
     FROM phone_number_rentals
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return res.rows.map(withTotal);
}

export interface CreateRentalInput {
  tenant_id: string;
  number: string;
  country?: string;
  provider?: string;
  monthly_cost?: number;
  channels?: number;
  channel_extra_cost?: number;
  agent_id?: string | null;
}

export async function createRental(pool: Pool, input: CreateRentalInput): Promise<PhoneRental> {
  const now = new Date();
  const ins = await pool.query(
    `INSERT INTO phone_number_rentals
       (tenant_id, number, country, provider, monthly_cost, channels, channel_extra_cost, agent_id, next_renewal_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, number) DO UPDATE SET status = 'active', updated_at = now()
     RETURNING id, tenant_id, number, country, provider,
               monthly_cost::float8 AS monthly_cost, channels,
               channel_extra_cost::float8 AS channel_extra_cost,
               status, agent_id, next_renewal_date, last_charged_at, created_at, updated_at`,
    [
      input.tenant_id,
      input.number,
      input.country ?? 'IN',
      input.provider ?? 'plivo',
      input.monthly_cost ?? PHONE_RENTAL_DEFAULTS.monthly_cost,
      input.channels ?? PHONE_RENTAL_DEFAULTS.included_channels,
      input.channel_extra_cost ?? PHONE_RENTAL_DEFAULTS.channel_extra_cost,
      input.agent_id ?? null,
      addOneMonth(now),
    ],
  );
  return withTotal(ins.rows[0]);
}

export async function updateRental(
  pool: Pool,
  tenantId: string,
  id: string,
  patch: { agent_id?: string | null; channels?: number; status?: 'active' | 'released' },
): Promise<PhoneRental | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (patch.agent_id !== undefined) { sets.push(`agent_id = $${idx++}`); values.push(patch.agent_id); }
  if (patch.channels !== undefined) { sets.push(`channels = $${idx++}`); values.push(Math.max(1, Math.floor(patch.channels))); }
  if (patch.status !== undefined) { sets.push(`status = $${idx++}`); values.push(patch.status); }
  if (sets.length === 0) {
    const r = await pool.query(
      `SELECT id, tenant_id, number, country, provider, monthly_cost::float8 AS monthly_cost, channels,
              channel_extra_cost::float8 AS channel_extra_cost, status, agent_id, next_renewal_date, last_charged_at, created_at, updated_at
       FROM phone_number_rentals WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return r.rows[0] ? withTotal(r.rows[0]) : null;
  }
  sets.push(`updated_at = now()`);
  values.push(tenantId, id);
  const upd = await pool.query(
    `UPDATE phone_number_rentals SET ${sets.join(', ')}
     WHERE tenant_id = $${idx++} AND id = $${idx}
     RETURNING id, tenant_id, number, country, provider, monthly_cost::float8 AS monthly_cost, channels,
               channel_extra_cost::float8 AS channel_extra_cost, status, agent_id, next_renewal_date, last_charged_at, created_at, updated_at`,
    values,
  );
  return upd.rows[0] ? withTotal(upd.rows[0]) : null;
}
