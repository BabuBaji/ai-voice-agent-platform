import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export interface PostCallAction {
  type: 'webhook' | 'slack' | 'email' | 'http';
  enabled?: boolean;
  label?: string;

  // webhook / http
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body_template?: string;

  // slack
  webhook_url?: string;
  message_template?: string;

  // email
  to?: string;
  subject_template?: string;
}

export interface PostCallContext {
  agentId: string;
  agentName: string;
  tenantId: string;
  conversationId: string | null;
  callerNumber: string | null;
  calledNumber: string | null;
  duration: number;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  summary: string;
  sentiment: string;
  outcome: string;
  interestLevel: number;
  topics: string[];
  keyPoints: string[];
  followUps: string[];
  transcript: Array<{ role: string; content: string }>;
  recordingUrl: string | null;
  providerCallSid: string | null;
}

function escapeHtmlLite(s: string): string {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * Substitute {placeholders} in a template string using values from ctx.
 * Unknown placeholders are left as-is so operators see what's missing.
 */
function interpolate(tpl: string, ctx: PostCallContext): string {
  if (!tpl) return '';
  const transcriptText = ctx.transcript
    .map((m) => `${m.role === 'assistant' ? 'Agent' : 'Caller'}: ${m.content}`)
    .join('\n');

  const map: Record<string, string> = {
    agent_id: ctx.agentId,
    agent_name: ctx.agentName,
    tenant_id: ctx.tenantId,
    conversation_id: ctx.conversationId || '',
    caller_number: ctx.callerNumber || '',
    called_number: ctx.calledNumber || '',
    duration: String(ctx.duration),
    duration_readable: `${Math.floor(ctx.duration / 60)}m ${ctx.duration % 60}s`,
    started_at: ctx.startedAt || '',
    ended_at: ctx.endedAt || '',
    status: ctx.status,
    summary: ctx.summary,
    sentiment: ctx.sentiment,
    outcome: ctx.outcome,
    interest_level: String(ctx.interestLevel),
    topics: ctx.topics.join(', '),
    key_points: ctx.keyPoints.join('\n- '),
    follow_ups: ctx.followUps.join('\n- '),
    transcript_text: transcriptText,
    recording_url: ctx.recordingUrl || '',
    provider_call_sid: ctx.providerCallSid || '',
  };

  return tpl.replace(/\{(\w+)\}/g, (_m, key) => (map[key] !== undefined ? map[key] : `{${key}}`));
}

async function runWebhookAction(action: PostCallAction, ctx: PostCallContext): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = (action.url || '').trim();
  if (!url) return { ok: false, error: 'url missing' };

  const method = (action.method || 'POST').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(action.headers || {}) };

  let body: string | undefined;
  if (method !== 'GET') {
    if (action.body_template) {
      body = interpolate(action.body_template, ctx);
    } else {
      // Default payload — everything useful
      body = JSON.stringify({
        event: 'call.ended',
        agent: { id: ctx.agentId, name: ctx.agentName },
        tenant_id: ctx.tenantId,
        conversation_id: ctx.conversationId,
        call: {
          caller_number: ctx.callerNumber,
          called_number: ctx.calledNumber,
          duration_seconds: ctx.duration,
          started_at: ctx.startedAt,
          ended_at: ctx.endedAt,
          status: ctx.status,
          provider_call_sid: ctx.providerCallSid,
          recording_url: ctx.recordingUrl,
        },
        analysis: {
          summary: ctx.summary,
          sentiment: ctx.sentiment,
          outcome: ctx.outcome,
          interest_level: ctx.interestLevel,
          topics: ctx.topics,
          key_points: ctx.keyPoints,
          follow_ups: ctx.followUps,
        },
        transcript: ctx.transcript,
      });
    }
  }

  try {
    const resp = await fetch(url, { method, headers, body });
    const ok = resp.ok;
    if (!ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: txt.slice(0, 300) };
    }
    return { ok: true, status: resp.status };
  } catch (err: any) {
    return { ok: false, error: err.message || 'fetch error' };
  }
}

async function runSlackAction(action: PostCallAction, ctx: PostCallContext): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = (action.webhook_url || action.url || '').trim();
  if (!url) return { ok: false, error: 'slack webhook_url missing' };

  const template = action.message_template ||
    `*Call ended* — {agent_name}\n• Caller: {caller_number}\n• Duration: {duration_readable}\n• Sentiment: {sentiment}\n• Outcome: {outcome}\n\n*Summary:* {summary}`;

  const text = interpolate(template, ctx);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: txt.slice(0, 300) };
    }
    return { ok: true, status: resp.status };
  } catch (err: any) {
    return { ok: false, error: err.message || 'fetch error' };
  }
}

async function runEmailAction(action: PostCallAction, ctx: PostCallContext): Promise<{ ok: boolean; error?: string }> {
  const to = (action.to || '').trim();
  if (!to) return { ok: false, error: 'email `to` missing' };

  const subject = interpolate(action.subject_template || 'Call summary — {caller_number}', ctx);
  const bodyPlain = interpolate(
    action.body_template ||
      `Agent: {agent_name}\nCaller: {caller_number}\nDuration: {duration_readable}\nSentiment: {sentiment}\nOutcome: {outcome}\n\nSummary:\n{summary}\n\nTranscript:\n{transcript_text}\n`,
    ctx
  );

  const notifSvc = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004';
  try {
    const resp = await fetch(`${notifSvc}/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': ctx.tenantId },
      body: JSON.stringify({
        type: 'email',
        to,
        subject,
        body: bodyPlain,
        body_html: `<pre style="font-family:monospace">${escapeHtmlLite(bodyPlain)}</pre>`,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, error: `notification-service ${resp.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'fetch error' };
  }
}

/**
 * Reads agent.post_call_config.actions and executes each enabled action.
 * Errors in individual actions don't stop the rest — they're logged and returned
 * in the summary so a later UI panel can surface failures.
 *
 * This function is fire-and-forget from the caller's perspective (called via
 * void executePostCallActions(...)) so the /status webhook response isn't blocked.
 */
export async function executePostCallActions(
  agent: any,
  ctx: PostCallContext
): Promise<Array<{ type: string; label?: string; ok: boolean; status?: number; error?: string }>> {
  const cfg = agent?.post_call_config || {};
  const actions: PostCallAction[] = Array.isArray(cfg.actions) ? cfg.actions : [];
  if (!actions.length) return [];

  const enabled = actions.filter((a) => a && a.type && a.enabled !== false);
  if (!enabled.length) return [];

  logger.info(
    { agentId: ctx.agentId, conversationId: ctx.conversationId, count: enabled.length },
    'Executing post-call actions'
  );

  const results = await Promise.all(
    enabled.map(async (action) => {
      try {
        let r: { ok: boolean; status?: number; error?: string };
        switch (action.type) {
          case 'webhook':
          case 'http':
            r = await runWebhookAction(action, ctx);
            break;
          case 'slack':
            r = await runSlackAction(action, ctx);
            break;
          case 'email':
            r = await runEmailAction(action, ctx);
            break;
          default:
            r = { ok: false, error: `unknown action type: ${action.type}` };
        }
        if (!r.ok) {
          logger.warn(
            { agentId: ctx.agentId, type: action.type, label: action.label, err: r.error, status: r.status },
            'Post-call action failed'
          );
        } else {
          logger.info(
            { agentId: ctx.agentId, type: action.type, label: action.label, status: r.status },
            'Post-call action ok'
          );
        }
        return { type: action.type, label: action.label, ...r };
      } catch (err: any) {
        logger.error({ err: err.message, type: action.type }, 'Post-call action threw');
        return { type: action.type, label: action.label, ok: false, error: err.message };
      }
    })
  );

  return results;
}
