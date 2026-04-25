import { Pool } from 'pg';
import pino from 'pino';
import { advanceRenewal } from './subscription.service';
import { debitWallet } from './wallet.service';
import { createInvoice } from './invoice.service';

const logger = pino({ name: 'billing-cron' });

const TICK_MS = Number(process.env.BILLING_CRON_INTERVAL_MS || 60 * 60 * 1000); // 1h

function addOneMonth(d: Date): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + 1);
  return next;
}

async function processSubscriptions(pool: Pool): Promise<number> {
  const due = await pool.query(
    `SELECT id, tenant_id, plan_id, plan_name, price::float8 AS price, next_renewal_date, cancel_at_period_end
     FROM subscriptions
     WHERE status = 'active'
       AND next_renewal_date <= now()
     ORDER BY next_renewal_date ASC
     LIMIT 100`,
  );

  for (const sub of due.rows) {
    try {
      // If user requested cancel at period end — flip status, no charge.
      if (sub.cancel_at_period_end) {
        await pool.query(
          `UPDATE subscriptions SET status = 'canceled', auto_renew = false, updated_at = now()
           WHERE id = $1`,
          [sub.id],
        );
        await pool.query(
          `UPDATE tenants SET plan = 'free', updated_at = now() WHERE id = $1`,
          [sub.tenant_id],
        );
        logger.info({ tenantId: sub.tenant_id, plan: sub.plan_name }, 'Subscription canceled at period end');
        continue;
      }

      // Free plan auto-rolls without charging.
      if (Number(sub.price) <= 0) {
        await advanceRenewal(pool, sub.id);
        continue;
      }

      const debit = await debitWallet(pool, sub.tenant_id, sub.price, {
        reason: `${sub.plan_name} subscription renewal`,
        reference_type: 'subscription',
        reference_id: sub.id,
      });

      if (!debit.success) {
        // Mark past_due. UI shows a payment-failed banner; user must add funds
        // or change plan to recover. Don't advance the date so the next cron
        // tick retries.
        await pool.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE id = $1`,
          [sub.id],
        );
        await createInvoice(pool, {
          tenant_id: sub.tenant_id,
          reason: `${sub.plan_name} subscription renewal — payment failed`,
          status: 'failed',
          line_items: [{ description: `${sub.plan_name} Plan (monthly)`, amount: Number(sub.price) }],
        });
        logger.warn({ tenantId: sub.tenant_id, plan: sub.plan_name, balance: debit.balance_after }, 'Subscription renewal failed — insufficient funds');
        continue;
      }

      const next = await advanceRenewal(pool, sub.id);
      await createInvoice(pool, {
        tenant_id: sub.tenant_id,
        reason: `${sub.plan_name} subscription renewal`,
        status: 'paid',
        line_items: [{ description: `${sub.plan_name} Plan (monthly)`, amount: Number(sub.price) }],
        period_start: new Date(),
        period_end: next.next_renewal_date,
      });
      logger.info({ tenantId: sub.tenant_id, plan: sub.plan_name, charged: Number(sub.price) }, 'Subscription renewed');
    } catch (err) {
      logger.error({ err, sub: sub.id }, 'Subscription renewal error');
    }
  }
  return due.rows.length;
}

async function processPhoneRentals(pool: Pool): Promise<number> {
  const due = await pool.query(
    `SELECT id, tenant_id, number, monthly_cost::float8 AS monthly_cost, channels,
            channel_extra_cost::float8 AS channel_extra_cost, next_renewal_date
     FROM phone_number_rentals
     WHERE status = 'active'
       AND next_renewal_date <= now()
     ORDER BY next_renewal_date ASC
     LIMIT 100`,
  );

  for (const r of due.rows) {
    try {
      const extra = Math.max(0, r.channels - 1) * Number(r.channel_extra_cost);
      const total = +(Number(r.monthly_cost) + extra).toFixed(2);

      const debit = await debitWallet(pool, r.tenant_id, total, {
        reason: `Phone number rental ${r.number}`,
        reference_type: 'phone_rental',
        reference_id: r.id,
      });

      if (!debit.success) {
        await pool.query(
          `UPDATE phone_number_rentals SET status = 'suspended', updated_at = now() WHERE id = $1`,
          [r.id],
        );
        await createInvoice(pool, {
          tenant_id: r.tenant_id,
          reason: `Phone rental ${r.number} — payment failed`,
          status: 'failed',
          line_items: [
            { description: `Number ${r.number} (monthly)`, amount: Number(r.monthly_cost) },
            ...(extra > 0 ? [{ description: `Extra channels × ${r.channels - 1}`, amount: extra }] : []),
          ],
        });
        logger.warn({ tenantId: r.tenant_id, number: r.number }, 'Phone rental renewal failed — insufficient funds');
        continue;
      }

      await pool.query(
        `UPDATE phone_number_rentals
           SET next_renewal_date = $1, last_charged_at = now(), updated_at = now()
         WHERE id = $2`,
        [addOneMonth(new Date(r.next_renewal_date)), r.id],
      );

      await createInvoice(pool, {
        tenant_id: r.tenant_id,
        reason: `Phone rental ${r.number}`,
        status: 'paid',
        line_items: [
          { description: `Number ${r.number} (monthly)`, amount: Number(r.monthly_cost) },
          ...(extra > 0 ? [{ description: `Extra channels × ${r.channels - 1}`, amount: extra }] : []),
        ],
      });
      logger.info({ tenantId: r.tenant_id, number: r.number, charged: total }, 'Phone rental renewed');
    } catch (err) {
      logger.error({ err, rental: r.id }, 'Phone rental renewal error');
    }
  }
  return due.rows.length;
}

export async function tickRenewalCron(pool: Pool): Promise<{ subscriptions: number; phone_rentals: number }> {
  const subscriptions = await processSubscriptions(pool);
  const phone_rentals = await processPhoneRentals(pool);
  return { subscriptions, phone_rentals };
}

export function startRenewalCron(pool: Pool): void {
  if (process.env.BILLING_CRON === 'off') {
    logger.info('Billing cron disabled via BILLING_CRON=off');
    return;
  }

  const run = async () => {
    try {
      const result = await tickRenewalCron(pool);
      if (result.subscriptions > 0 || result.phone_rentals > 0) {
        logger.info(result, 'Billing cron tick processed renewals');
      }
    } catch (err) {
      logger.error({ err }, 'Billing cron tick failed');
    }
  };

  // Run once shortly after startup, then every TICK_MS.
  setTimeout(run, 30_000).unref();
  setInterval(run, TICK_MS).unref();
  logger.info({ intervalMs: TICK_MS }, 'Billing cron started');
}
