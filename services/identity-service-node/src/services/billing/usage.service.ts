import { Pool } from 'pg';
import { COST_BREAKDOWN_RATIOS } from './plans';
import { ensureSubscription } from './subscription.service';
import { debitWallet } from './wallet.service';

export interface RecordCallInput {
  tenant_id: string;
  call_id: string;
  duration_sec: number;
  agent_id?: string | null;
  campaign_id?: string | null;
  channel?: 'voice' | 'web' | 'chat' | 'whatsapp';
}

export interface RecordCallResult {
  cost: number;
  rate_per_min: number;
  duration_sec: number;
  included_minutes_remaining: number;
  wallet_debited: number;
  wallet_balance_after: number | null;
  insufficient_funds: boolean;
  duplicate?: boolean;
}

function startOfPeriod(periodStart: string | Date): Date {
  return typeof periodStart === 'string' ? new Date(periodStart) : periodStart;
}

/**
 * Record a finished call: write a usage_log row, deduct from wallet if the
 * call exceeds the plan's included minutes for the current billing period.
 *
 * Idempotent on (tenant_id, call_id) — duplicate calls return the existing row.
 */
export async function recordCall(pool: Pool, input: RecordCallInput): Promise<RecordCallResult> {
  const { tenant_id, call_id } = input;
  const duration_sec = Math.max(0, Math.round(input.duration_sec));
  const channel = input.channel ?? 'voice';

  // Idempotency: if we've already billed this call, return the prior result
  // so the analyzer can be triggered multiple times safely.
  const dup = await pool.query(
    'SELECT cost::float8 AS cost, rate_per_min::float8 AS rate_per_min, duration_sec FROM usage_logs WHERE tenant_id = $1 AND call_id = $2',
    [tenant_id, call_id],
  );
  if (dup.rows.length > 0) {
    const r = dup.rows[0];
    return {
      cost: r.cost,
      rate_per_min: r.rate_per_min,
      duration_sec: r.duration_sec,
      included_minutes_remaining: 0,
      wallet_debited: 0,
      wallet_balance_after: null,
      insufficient_funds: false,
      duplicate: true,
    };
  }

  const sub = await ensureSubscription(pool, tenant_id);
  const rate_per_min = sub.plan?.features.rate_per_min ?? 4.0;
  const included_minutes = sub.plan?.features.included_minutes ?? 0;

  // Tally minutes already billed this billing period to know how much of the
  // included allowance is left.
  const periodUsage = await pool.query(
    `SELECT COALESCE(SUM(duration_sec), 0) AS sec
     FROM usage_logs
     WHERE tenant_id = $1 AND created_at >= $2`,
    [tenant_id, startOfPeriod(sub.current_period_start)],
  );
  const usedSec = Number(periodUsage.rows[0].sec || 0);
  const usedMin = usedSec / 60;
  const includedRemainingMin = Math.max(0, included_minutes - usedMin);

  const callMin = duration_sec / 60;
  const billedMin = Math.max(0, callMin - includedRemainingMin);
  const cost = +(billedMin * rate_per_min).toFixed(4);

  const breakdown = {
    voice: +(cost * COST_BREAKDOWN_RATIOS.voice).toFixed(4),
    stt: +(cost * COST_BREAKDOWN_RATIOS.stt).toFixed(4),
    tts: +(cost * COST_BREAKDOWN_RATIOS.tts).toFixed(4),
    ai: +(cost * COST_BREAKDOWN_RATIOS.ai).toFixed(4),
    free_minutes_applied: Math.max(0, callMin - billedMin),
  };

  await pool.query(
    `INSERT INTO usage_logs
       (tenant_id, call_id, agent_id, campaign_id, channel, duration_sec, rate_per_min, cost, cost_breakdown)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, call_id) DO NOTHING`,
    [
      tenant_id,
      call_id,
      input.agent_id ?? null,
      input.campaign_id ?? null,
      channel,
      duration_sec,
      rate_per_min,
      cost,
      JSON.stringify(breakdown),
    ],
  );

  let wallet_debited = 0;
  let wallet_balance_after: number | null = null;
  let insufficient_funds = false;

  if (cost > 0) {
    // allow_negative so a wallet that briefly dips below zero still records
    // the call cost. The low-balance banner will fire next time the user
    // opens the dashboard, and the renewal cron handles auto top-ups.
    const r = await debitWallet(pool, tenant_id, cost, {
      reason: 'Call usage',
      reference_type: 'call',
      reference_id: call_id,
      metadata: { duration_sec, rate_per_min, channel, agent_id: input.agent_id ?? null },
      allow_negative: true,
    });
    wallet_debited = cost;
    wallet_balance_after = r.balance_after;
    insufficient_funds = r.balance_after < 0;
  }

  return {
    cost,
    rate_per_min,
    duration_sec,
    included_minutes_remaining: Math.max(0, includedRemainingMin - callMin),
    wallet_debited,
    wallet_balance_after,
    insufficient_funds,
  };
}

export interface UsageSummary {
  period_start: string;
  period_end: string;
  total_calls: number;
  total_minutes: number;
  total_cost: number;
  rate_per_min: number;
  included_minutes: number;
  included_minutes_used: number;
  included_minutes_remaining: number;
  active_agents: number;
  concurrent_channels: number;
  breakdown: {
    voice: number;
    stt: number;
    tts: number;
    ai: number;
    phone_numbers: number;
    extra_channels: number;
    total: number;
  };
}

export async function getUsageSummary(pool: Pool, tenantId: string): Promise<UsageSummary> {
  const sub = await ensureSubscription(pool, tenantId);
  const periodStart = startOfPeriod(sub.current_period_start);

  const calls = await pool.query(
    `SELECT
        COUNT(*)::int AS total_calls,
        COALESCE(SUM(duration_sec), 0)::int AS total_sec,
        COALESCE(SUM(cost), 0)::float8 AS total_cost,
        COALESCE(SUM((cost_breakdown->>'voice')::numeric), 0)::float8 AS voice,
        COALESCE(SUM((cost_breakdown->>'stt')::numeric), 0)::float8 AS stt,
        COALESCE(SUM((cost_breakdown->>'tts')::numeric), 0)::float8 AS tts,
        COALESCE(SUM((cost_breakdown->>'ai')::numeric), 0)::float8 AS ai,
        COUNT(DISTINCT agent_id)::int AS active_agents
     FROM usage_logs
     WHERE tenant_id = $1 AND created_at >= $2`,
    [tenantId, periodStart],
  );
  const c = calls.rows[0];

  const phoneRentals = await pool.query(
    `SELECT
        COALESCE(SUM(monthly_cost), 0)::float8 AS rental,
        COALESCE(SUM(GREATEST(channels - 1, 0) * channel_extra_cost), 0)::float8 AS extra_channels,
        COALESCE(SUM(channels), 0)::int AS total_channels
     FROM phone_number_rentals
     WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );
  const p = phoneRentals.rows[0];

  const totalMin = (c.total_sec || 0) / 60;
  const includedMin = sub.plan?.features.included_minutes ?? 0;
  const includedUsed = Math.min(totalMin, includedMin);
  const breakdownTotal = +(c.voice + c.stt + c.tts + c.ai + p.rental + p.extra_channels).toFixed(2);

  return {
    period_start: typeof sub.current_period_start === 'string'
      ? sub.current_period_start
      : sub.current_period_start,
    period_end: typeof sub.next_renewal_date === 'string'
      ? sub.next_renewal_date
      : sub.next_renewal_date,
    total_calls: c.total_calls,
    total_minutes: +totalMin.toFixed(2),
    total_cost: +c.total_cost.toFixed(2),
    rate_per_min: sub.plan?.features.rate_per_min ?? 4.0,
    included_minutes: includedMin,
    included_minutes_used: +includedUsed.toFixed(2),
    included_minutes_remaining: +Math.max(0, includedMin - includedUsed).toFixed(2),
    active_agents: c.active_agents,
    concurrent_channels: p.total_channels,
    breakdown: {
      voice: +c.voice.toFixed(2),
      stt: +c.stt.toFixed(2),
      tts: +c.tts.toFixed(2),
      ai: +c.ai.toFixed(2),
      phone_numbers: +p.rental.toFixed(2),
      extra_channels: +p.extra_channels.toFixed(2),
      total: breakdownTotal,
    },
  };
}

export async function listCalls(pool: Pool, tenantId: string, limit = 50) {
  const res = await pool.query(
    `SELECT id, call_id, agent_id, channel, duration_sec, rate_per_min::float8 AS rate_per_min,
            cost::float8 AS cost, cost_breakdown, created_at
     FROM usage_logs
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, Math.min(limit, 200)],
  );
  return res.rows;
}
