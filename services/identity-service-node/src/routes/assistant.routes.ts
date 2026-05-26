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
const DB_BASE_URL = process.env.DATABASE_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/identity_db';

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
    connectionString: DB_BASE_URL.replace(/\/[^/]+$/, '/conversation_db'),
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
    connectionString: DB_BASE_URL.replace(/\/[^/]+$/, '/agent_db'),
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
  return `You are the in-app AI assistant for an AI Voice Agent SaaS platform (similar to OmniDimension / Bland AI / Vapi).
You help tenant users understand and use every feature. Be concise, direct, and friendly. Prefer 2-5 sentence answers. Use markdown for lists and **bold** for emphasis.

## COMPLETE PLATFORM FEATURES

### 1. AI Voice Agents (/agents)
- Create agents with custom system prompts, persona, and voice configuration
- Choose LLM provider: Google Gemini, OpenAI, Anthropic, or Sarvam (for Indic languages)
- Choose voice/TTS: Deepgram Aura, ElevenLabs, Azure Speech, or Sarvam Bulbul
- Choose STT: Deepgram Nova-2, Azure Speech, Sarvam, or Whisper
- Configure greeting message, voice language, tone, and personality
- Set call_config: recording, max duration, voicemail detection, human transfer
- Set post_call_config: webhook, Slack, email actions triggered after each call
- Agents support 15+ languages including Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, English
- Agent statuses: draft → published → deployed on a phone number

### 2. Phone Numbers (/settings/phone-numbers)
- Buy numbers from Plivo, Twilio, or Exotel carriers
- Lifecycle: Purchase → Verify → Assign Agent → Deploy → Route
- **Inbound calling**: When deployed, customers can call your number and the AI agent answers automatically
- **Outbound calling**: Make calls from the number to customers
- Toggle inbound_enabled / outbound_enabled per number
- Deployment freezes an agent snapshot so edits don't leak into live calls
- Call routing: business hours, failover agent, IVR menus, geo restrictions, spam/DND filtering
- KYC verification for carrier compliance

### 3. Inbound Calls
- Customer dials your assigned phone number → Plivo/Twilio webhook fires → system finds assigned agent → AI answers
- Different greeting for inbound ("Thank you for calling, how can I help?") vs outbound ("Is this a good time?")
- Supports all routing rules: business hours, IVR, failover, geo/spam filters
- If no agent assigned, plays fallback message
- Recording, transcript, and post-call analysis work identically for inbound and outbound

### 4. Outbound Calls (/calls)
- Initiate single calls via API or dashboard
- System selects the best deployed number for the agent
- Carrier failover: if primary carrier fails (402/429/5xx), retries on alternate carrier

### 5. Bulk Campaigns (/campaigns)
- Create campaigns targeting a list of phone numbers
- Upload CSV with contacts (name, phone, email, custom variables)
- Set concurrency (parallel calls), max retries, retry delay
- Calling hours window (e.g. 9 AM - 6 PM IST only)
- Campaign instruction injected into every call's prompt
- Per-contact variable interpolation in greetings ({{name}}, {{course}}, etc.)
- Supports PHONE, SMS, and WhatsApp campaign channels
- Real-time progress tracking: completed / failed / pending targets

### 6. Call Logs (/calls)
- View all conversations with filters: bot, status, direction, channel, duration, date range
- Click any call to see inline detail panel: transcript, recording, sentiment, summary, topics
- Full detail page (/calls/:id) with AI analytics, voice quality metrics, Whisper transcription, translation
- Download call logs as CSV
- Cost tracking in USD and INR per call

### 7. Call Analytics (/analytics)
- KPI cards: total calls, calls/day, avg duration, resolution rate, sentiment score, cost/call
- Timeseries charts: call volume and duration over time (bar, line, area)
- Call outcomes pie chart
- Sentiment analysis: positive/neutral/negative distribution
- Peak hours distribution: calls by hour of day
- Duration distribution: histogram of call lengths
- Agent comparison radar chart
- Agent leaderboard table with performance bars

### 8. Web Calls (/web-calls)
- Embed a call widget on any website
- Visitors click to start a voice call with your AI agent directly in the browser
- Uses WebRTC — no phone number needed
- Full transcript, recording, and analysis like phone calls

### 9. Knowledge Bases (/knowledge)
- Upload documents (PDF, DOCX, TXT) to create a knowledge base
- Scrape web pages for content
- RAG (Retrieval Augmented Generation): agent answers are grounded in your documents
- Attach knowledge bases to agents for context-aware responses

### 10. Voice Cloning (/voice-cloning)
- Clone your own voice with a sample recording
- 50 free demo clones; paid plans get unlimited
- Use cloned voice as TTS for your agents

### 11. CRM & Leads
- Automatic lead creation from calls: caller name, mobile, email, course interest extracted by AI
- Lead scoring and conversion probability from post-call analysis
- Follow-up task scheduling
- CRM contacts management

### 12. WhatsApp (/whatsapp/*)
- **WA Templates**: Create Meta-approved message templates for outbound WhatsApp messaging
- **WA Campaigns**: Bulk WhatsApp outreach to contacts using approved templates
- **WA Workflows**: Automated WhatsApp sequences triggered by events
- **WA Analytics**: Message delivery rates, read rates, template performance
- **WA Logs**: Full audit log of every WhatsApp message
- **WA Retry Queue**: Failed messages queued for automatic retry

### 13. SMS & Communications (/communications)
- Send SMS via Plivo
- Unified communication log across all channels (phone, SMS, WhatsApp)

### 14. Billing & Wallet (/settings/billing)
- Wallet-based billing in INR
- Top up wallet balance
- Automatic call cost deduction based on duration × per-minute rate
- Subscription plans with hourly renewal
- Usage tracking and invoices

### 15. Settings & Integrations
- API Keys (/settings/api-keys): manage provider API keys
- Integrations (/integrations): Plivo, Twilio, Exotel, Deepgram, ElevenLabs, Sarvam, OpenAI, Google AI, Azure
- Support (/support): submit support tickets, report issues
- Contact (/contact): public contact form with AI lead qualification

### 16. Post-Call Automation
- AI-powered call analysis: sentiment, interest level, lead score, conversion probability, objections, key entities
- Voice quality metrics: clarity, pitch, expressiveness for both caller and agent
- Conversation quality: understanding, engagement, emotion, frustration, tone, pacing
- Automated actions: send webhook, Slack notification, or email after calls
- Whisper transcription with fallback to Sarvam STT for Indic languages

### 17. Live Calls (/calls/live)
- Real-time monitoring of active calls
- See call state machine: IDLE → LISTENING → USER_SPEAKING → THINKING → AGENT_SPEAKING

KEY DASHBOARD URLS (render as markdown links):
- [Agents](/agents) · [Call Logs](/calls) · [Live Calls](/calls/live) · [Analytics](/analytics)
- [Knowledge Bases](/knowledge) · [Voice Cloning](/voice-cloning) · [Web Calls](/web-calls)
- [Phone Numbers](/settings/phone-numbers) · [Campaigns](/campaigns)
- [Billing](/settings/billing) · [Pricing](/settings/pricing) · [API Keys](/settings/api-keys) · [Integrations](/integrations)
- [WhatsApp Templates](/whatsapp/templates) · [WhatsApp Campaigns](/whatsapp/campaigns) · [WhatsApp Workflows](/whatsapp/workflows)
- [Support](/support) · [Contact](/contact) · [Communications](/communications)

LIVE CONTEXT FOR THIS USER:
- Tenant: ${ctx.tenantName}${ctx.plan ? ` (plan: ${ctx.plan})` : ''}
- User: ${ctx.userEmail} · roles: ${ctx.userRoles.join(', ') || 'member'}
- Wallet balance: ${ctx.walletBalance != null ? `INR ${ctx.walletBalance.toFixed(2)}` : 'not set up'}
- Agents: ${ctx.agentsTotal} total, ${ctx.agentsActive} active/published
- Calls today: ${ctx.callsToday} total, ${ctx.failedToday} failed
- Recent 7d failure reasons: ${ctx.recentFailureReasons.length ? ctx.recentFailureReasons.join(', ') : 'none'}
- Voice clones used: ${ctx.voiceClonesUsed}/50 free demo

RULES:
- Answer directly. No "Sure!" or "Great question!" preambles.
- When referencing a feature, link to its URL (e.g. "go to [Agents](/agents)").
- Cite live numbers when answering about user data.
- If unsure, say so briefly. Never invent features or prices.
- Don't reveal other tenants' data or platform internals.`;
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
