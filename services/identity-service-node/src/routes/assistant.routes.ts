import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';

// In-app help assistant. Tenant users open the floating chat bubble in the
// dashboard and ask any question — "how do I create an agent?", "what's my
// wallet balance?", "why did my last call fail?". This endpoint pulls the
// caller's live tenant data into the system prompt so the LLM can answer
// with real numbers, then forwards to ai-runtime /chat/simple.

const AI_RUNTIME_URL = process.env.AI_RUNTIME_URL || 'http://localhost:8000';

const ChatBody = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).min(1).max(40),
});

interface TenantContext {
  tenantName: string;
  plan: string | null;
  walletBalance: number | null;
  agentsTotal: number;
  agentsActive: number;
  callsToday: number;
  failedToday: number;
  recentFailureReasons: string[];
  voiceClonesUsed: number;
  userEmail: string;
  userRoles: string[];
}

async function gatherContext(pool: Pool, tenantId: string, userId: string, email: string, roles: string[]): Promise<TenantContext> {
  const today = new Date().toISOString().slice(0, 10);

  // identity_db queries (tenant + wallet)
  const tenantQ = pool.query(`SELECT name, plan FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
  const walletQ = pool.query(`SELECT balance FROM wallets WHERE tenant_id = $1 LIMIT 1`, [tenantId]);

  // conversation_db cross-DB query for today's calls — we use a separate Pool
  // bound to conversation_db to keep concerns clean.
  const convoPool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/\/[^/]+$/, '/conversation_db'),
    max: 2,
  });
  const callsTodayQ = convoPool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
     FROM conversations
     WHERE tenant_id = $1 AND started_at::date = $2::date`,
    [tenantId, today],
  );
  const failureReasonsQ = convoPool.query(
    `SELECT outcome, COUNT(*)::int AS n
       FROM conversations
       WHERE tenant_id = $1 AND status = 'FAILED' AND started_at > NOW() - INTERVAL '7 days'
       GROUP BY outcome
       ORDER BY n DESC
       LIMIT 5`,
    [tenantId],
  );

  // agent_db cross-DB queries
  const agentPool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/\/[^/]+$/, '/agent_db'),
    max: 2,
  });
  const agentsQ = agentPool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status IN ('PUBLISHED', 'ACTIVE'))::int AS active
     FROM agents WHERE tenant_id = $1`,
    [tenantId],
  );
  const voiceClonesQ = agentPool.query(
    `SELECT attempts_used FROM voice_clone_attempts WHERE user_id = $1 LIMIT 1`,
    [userId],
  );

  try {
    const [tenant, wallet, calls, failures, agents, voiceClones] = await Promise.all([
      tenantQ, walletQ, callsTodayQ, failureReasonsQ, agentsQ, voiceClonesQ,
    ]);
    return {
      tenantName: tenant.rows[0]?.name || 'your tenant',
      plan: tenant.rows[0]?.plan ?? null,
      walletBalance: wallet.rows[0]?.balance != null ? Number(wallet.rows[0].balance) : null,
      agentsTotal: agents.rows[0]?.total ?? 0,
      agentsActive: agents.rows[0]?.active ?? 0,
      callsToday: calls.rows[0]?.total ?? 0,
      failedToday: calls.rows[0]?.failed ?? 0,
      recentFailureReasons: failures.rows.map((r: any) => `${r.outcome || 'unknown'} (${r.n})`),
      voiceClonesUsed: voiceClones.rows[0]?.attempts_used ?? 0,
      userEmail: email,
      userRoles: roles,
    };
  } finally {
    convoPool.end().catch(() => {});
    agentPool.end().catch(() => {});
  }
}

function buildSystemPrompt(ctx: TenantContext): string {
  return `You are the in-app help assistant for an AI Voice Agent SaaS platform.
You help tenant users (your customers) understand and use the platform. Be concise,
direct, and friendly. Prefer 2-4 sentence answers. Use markdown for lists when needed.

PLATFORM CAPABILITIES (what users can do):
- Build AI voice agents with custom prompts, LLM provider, and voice (ElevenLabs, Deepgram, Azure)
- Take inbound and make outbound phone calls (Plivo)
- Run web call widgets and chat widgets on their site
- Clone their own voice (50 free demo clones; paid plans unlimited)
- Build knowledge bases for RAG-grounded responses
- Manage CRM contacts and run bulk campaigns
- View call logs, transcripts, recordings, and AI-generated call analysis
- Top up wallet (INR), see invoices, manage subscriptions

KEY DASHBOARD URLS (use these when guiding the user — render as markdown links):
- Agents: /agents — Calls log: /calls — Knowledge: /knowledge
- Voice cloning: /voice-cloning — Web calls: /web-calls
- Billing & wallet: /settings/billing — Pricing: /settings/pricing
- API keys: /settings/api-keys — Integrations: /integrations
- Phone numbers: /phone-numbers — Campaigns: /campaigns

LIVE CONTEXT FOR THIS USER (use these real numbers in your answers when relevant):
- Tenant: ${ctx.tenantName}${ctx.plan ? ` (plan: ${ctx.plan})` : ''}
- User: ${ctx.userEmail} · roles: ${ctx.userRoles.join(', ') || 'member'}
- Wallet balance: ${ctx.walletBalance != null ? `INR ${ctx.walletBalance.toFixed(2)}` : 'not set up'}
- Agents: ${ctx.agentsTotal} total, ${ctx.agentsActive} active/published
- Calls today: ${ctx.callsToday} total, ${ctx.failedToday} failed
- Recent 7d failure reasons: ${ctx.recentFailureReasons.length ? ctx.recentFailureReasons.join(', ') : 'none'}
- Voice clones used: ${ctx.voiceClonesUsed}/50 free demo

RULES:
- Answer the user's question directly. Don't preface with "Sure!" or "Great question!"
- When you reference a feature, link to its dashboard URL (e.g. "head to [agents](/agents)").
- If the user asks about their data, cite the live numbers above.
- If you don't know something or it's outside the platform, say so briefly and suggest where they could look.
- Never invent features that don't exist in the list above. Never invent prices.
- Don't reveal another tenant's data or platform internals (super-admin features, infra).`;
}

export function assistantRouter(): Router {
  const router = Router();
  router.use(authMiddleware);

  router.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = ChatBody.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
        return;
      }
      const { messages } = parse.data;

      const pool = (req as any).pool as Pool;
      const tenantId = (req as any).tenantId as string;
      const userId = (req as any).userId as string;
      const email = (req as any).email as string;
      const roles = ((req as any).roles as string[]) || [];

      const ctx = await gatherContext(pool, tenantId, userId, email, roles);
      const systemPrompt = buildSystemPrompt(ctx);

      const aiResp = await fetch(`${AI_RUNTIME_URL}/chat/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt: systemPrompt,
          messages,
          provider: process.env.ASSISTANT_LLM_PROVIDER || 'google',
          model: process.env.ASSISTANT_LLM_MODEL || 'gemini-2.5-flash',
          temperature: 0.4,
          max_tokens: 700,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!aiResp.ok) {
        const t = await aiResp.text().catch(() => '');
        res.status(502).json({ error: 'Assistant LLM upstream failed', detail: t.slice(0, 300) });
        return;
      }
      const data = await aiResp.json() as { reply: string; provider: string; mock?: boolean };
      res.json({
        reply: data.reply,
        provider: data.provider,
        mock: data.mock || false,
        context_summary: {
          agents: ctx.agentsTotal,
          wallet_balance: ctx.walletBalance,
          calls_today: ctx.callsToday,
          failed_today: ctx.failedToday,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
