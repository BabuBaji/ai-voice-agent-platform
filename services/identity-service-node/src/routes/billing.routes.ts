import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware, requireRoles } from '../middleware/auth.middleware';
import { PLANS, getPlan } from '../services/billing/plans';
import { ensureSubscription, changePlan, cancelSubscription } from '../services/billing/subscription.service';
import {
  ensureWallet,
  creditWallet,
  debitWallet,
  listTransactions,
} from '../services/billing/wallet.service';
import { recordCall, getUsageSummary, listCalls } from '../services/billing/usage.service';
import {
  listRentals,
  createRental,
  updateRental,
} from '../services/billing/phoneRental.service';
import {
  listPaymentMethods,
  addPaymentMethod,
  setDefaultPaymentMethod,
  deletePaymentMethod,
} from '../services/billing/paymentMethod.service';
import { createInvoice, listInvoices, getInvoice } from '../services/billing/invoice.service';
import { getPaymentProvider } from '../services/billing/paymentProvider';
import { tickRenewalCron } from '../services/billing/renewalCron';

const upgradeSchema = z.object({ plan_id: z.string().min(1) });
const addFundsSchema = z.object({
  amount: z.number().positive().max(500000),
  payment_method_id: z.string().uuid().optional(),
});
const recordCallSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().min(1),
  duration_sec: z.number().int().nonnegative(),
  agent_id: z.string().uuid().optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
  channel: z.enum(['voice', 'web', 'chat', 'whatsapp']).optional(),
});
const addPaymentMethodSchema = z.object({
  type: z.enum(['card', 'upi']),
  brand: z.string().optional(),
  last4: z.string().regex(/^\d{4}$/).optional(),
  holder_name: z.string().max(100).optional(),
  exp_month: z.number().int().min(1).max(12).optional(),
  exp_year: z.number().int().min(new Date().getFullYear()).max(new Date().getFullYear() + 30).optional(),
  upi_id: z.string().regex(/^[\w.-]+@[\w.-]+$/).optional(),
  set_default: z.boolean().optional(),
});
const createRentalSchema = z.object({
  number: z.string().min(5),
  country: z.string().length(2).optional(),
  provider: z.string().optional(),
  monthly_cost: z.number().nonnegative().optional(),
  channels: z.number().int().min(1).optional(),
  agent_id: z.string().uuid().nullable().optional(),
});
const updateRentalSchema = z.object({
  agent_id: z.string().uuid().nullable().optional(),
  channels: z.number().int().min(1).max(50).optional(),
  status: z.enum(['active', 'released']).optional(),
});

export function billingRouter(): Router {
  const router = Router();

  // Internal endpoint — service-to-service. Used by conversation-service when
  // a call ends. Authed via shared secret header so we don't need a JWT loop.
  router.post('/usage/record-call', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const expected = process.env.BILLING_INTERNAL_TOKEN || 'dev-billing-internal-token';
      const provided = (req.headers['x-internal-token'] as string) || '';
      if (!provided || provided !== expected) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const data = recordCallSchema.parse(req.body);
      const pool = (req as any).pool;
      const result = await recordCall(pool, data);
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        res.status(400).json({ error: 'Validation failed', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // All routes below require auth.
  router.use(authMiddleware);

  // Plan catalog (public to authed users — no tenant scoping needed)
  router.get('/plans', async (_req: Request, res: Response) => {
    res.json({ data: PLANS });
  });

  // Current plan / subscription
  router.get('/plan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const sub = await ensureSubscription(pool, tenantId);
      res.json(sub);
    } catch (err) { next(err); }
  });

  router.post('/upgrade', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { plan_id } = upgradeSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        const newPlan = getPlan(plan_id);
        if (!newPlan) { res.status(400).json({ error: 'Unknown plan' }); return; }
        if (newPlan.custom) {
          res.status(400).json({ error: 'Enterprise plans require a sales quote — contact us.' });
          return;
        }

        const oldSub = await ensureSubscription(pool, tenantId);

        // For paid plan changes, debit the wallet up-front (the wallet IS the
        // payment source — top-ups credit it, plan/rental purchases debit it).
        // Free → paid and paid → paid both pay the new plan's first month now.
        if (newPlan.price > 0 && oldSub.plan_id !== plan_id) {
          const wallet = await ensureWallet(pool, tenantId);
          if (wallet.balance < newPlan.price) {
            res.status(402).json({
              error: 'Insufficient wallet balance',
              required: newPlan.price,
              available: wallet.balance,
              shortfall: +(newPlan.price - wallet.balance).toFixed(2),
              message: `Top up at least ₹${(newPlan.price - wallet.balance).toFixed(2)} to upgrade to ${newPlan.name}.`,
            });
            return;
          }
          const debit = await debitWallet(pool, tenantId, newPlan.price, {
            reason: `Upgrade to ${newPlan.name}`,
            reference_type: 'subscription_change',
            reference_id: oldSub.id,
          });
          if (!debit.success) {
            res.status(402).json({ error: 'Wallet debit failed', balance_after: debit.balance_after });
            return;
          }
          await createInvoice(pool, {
            tenant_id: tenantId,
            reason: `Upgrade to ${newPlan.name}`,
            status: 'paid',
            line_items: [{ description: `${newPlan.name} Plan (first month)`, amount: newPlan.price }],
          });
        }

        const updated = await changePlan(pool, tenantId, plan_id);
        res.json(updated);
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    });

  router.post('/cancel', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        const sub = await cancelSubscription(pool, tenantId);
        res.json(sub);
      } catch (err) { next(err); }
    });

  // Wallet
  router.get('/wallet', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const wallet = await ensureWallet(pool, tenantId);
      res.json(wallet);
    } catch (err) { next(err); }
  });

  router.post('/wallet/add-funds', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { amount, payment_method_id } = addFundsSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;

        const provider = getPaymentProvider();
        const charge = await provider.charge({
          amount,
          currency: 'INR',
          description: 'Wallet top-up',
          payment_method_id,
          tenant_id: tenantId,
        });

        if (!charge.success) {
          res.status(402).json({
            error: 'Payment failed',
            provider: charge.provider,
            reason: charge.failure_reason,
          });
          return;
        }

        const result = await creditWallet(pool, tenantId, amount, {
          reason: 'Wallet top-up',
          reference_type: 'topup',
          reference_id: charge.provider_ref,
          metadata: { provider: charge.provider, ref: charge.provider_ref },
        });
        await createInvoice(pool, {
          tenant_id: tenantId,
          reason: 'Wallet top-up',
          status: 'paid',
          line_items: [{ description: `Wallet top-up`, amount }],
        });
        res.json({ balance_after: result.balance_after, transaction_id: result.transaction_id, provider: charge.provider });
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    });

  router.get('/wallet/transactions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const limit = Number(req.query.limit) || 50;
      const data = await listTransactions(pool, tenantId, limit);
      res.json({ data });
    } catch (err) { next(err); }
  });

  // Usage
  router.get('/usage', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const summary = await getUsageSummary(pool, tenantId);
      res.json(summary);
    } catch (err) { next(err); }
  });

  router.get('/usage/calls', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const limit = Number(req.query.limit) || 50;
      const data = await listCalls(pool, tenantId, limit);
      res.json({ data });
    } catch (err) { next(err); }
  });

  // Phone numbers (billing)
  router.get('/phone-numbers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const data = await listRentals(pool, tenantId);
      res.json({ data });
    } catch (err) { next(err); }
  });

  router.post('/phone-numbers', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = createRentalSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;

        // Compute first-month cost and debit wallet up-front. Refuse purchase
        // if balance insufficient — caller can top up and retry.
        const monthly = data.monthly_cost ?? 500;
        const channels = data.channels ?? 1;
        const firstMonth = +(monthly + Math.max(0, channels - 1) * 200).toFixed(2);

        const wallet = await ensureWallet(pool, tenantId);
        if (wallet.balance < firstMonth) {
          res.status(402).json({
            error: 'Insufficient wallet balance',
            required: firstMonth,
            available: wallet.balance,
            shortfall: +(firstMonth - wallet.balance).toFixed(2),
            message: `Top up at least ₹${(firstMonth - wallet.balance).toFixed(2)} to rent ${data.number}.`,
          });
          return;
        }

        const rental = await createRental(pool, { ...data, tenant_id: tenantId });

        const debit = await debitWallet(pool, tenantId, firstMonth, {
          reason: `Phone number rental ${rental.number}`,
          reference_type: 'phone_rental',
          reference_id: rental.id,
        });
        if (!debit.success) {
          res.status(402).json({ error: 'Wallet debit failed' });
          return;
        }

        await createInvoice(pool, {
          tenant_id: tenantId,
          reason: `Phone rental ${rental.number}`,
          status: 'paid',
          line_items: [
            { description: `Number ${rental.number} (first month)`, amount: monthly },
            ...(channels > 1 ? [{ description: `Extra channels × ${channels - 1}`, amount: +(monthly + (channels - 1) * 200 - monthly).toFixed(2) }] : []),
          ],
        });

        res.status(201).json(rental);
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    });

  router.patch('/phone-numbers/:id', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = updateRentalSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        const updated = await updateRental(pool, tenantId, req.params.id, data);
        if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
        res.json(updated);
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    });

  // Payment methods
  router.get('/payment-methods', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const data = await listPaymentMethods(pool, tenantId);
      res.json({ data });
    } catch (err) { next(err); }
  });

  router.post('/payment-methods', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = addPaymentMethodSchema.parse(req.body);
        // Server-side validation that card has the right fields and UPI has upi_id
        if (data.type === 'card' && (!data.last4 || !data.brand)) {
          res.status(400).json({ error: 'Card requires brand + last4' });
          return;
        }
        if (data.type === 'upi' && !data.upi_id) {
          res.status(400).json({ error: 'UPI requires upi_id' });
          return;
        }
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        const pm = await addPaymentMethod(pool, { ...data, tenant_id: tenantId });
        res.status(201).json(pm);
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    });

  router.post('/payment-methods/:id/default', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        await setDefaultPaymentMethod(pool, tenantId, req.params.id);
        res.status(204).send();
      } catch (err) { next(err); }
    });

  router.delete('/payment-methods/:id', requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        await deletePaymentMethod(pool, tenantId, req.params.id);
        res.status(204).send();
      } catch (err) { next(err); }
    });

  // Invoices
  router.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const limit = Number(req.query.limit) || 50;
      const data = await listInvoices(pool, tenantId, limit);
      res.json({ data });
    } catch (err) { next(err); }
  });

  router.get('/invoices/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const inv = await getInvoice(pool, tenantId, req.params.id);
      if (!inv) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(inv);
    } catch (err) { next(err); }
  });

  // Admin: trigger renewal cron tick manually (useful in dev/testing).
  router.post('/admin/run-renewals', requireRoles('OWNER'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = (req as any).pool;
        const result = await tickRenewalCron(pool);
        res.json(result);
      } catch (err) { next(err); }
    });

  return router;
}
