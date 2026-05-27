import { Router, Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { randomBytes } from 'crypto';
import { pool } from '../index';
import { config } from '../config';
import { cacheAudio } from './audio';
import { executePostCallActions, PostCallContext } from '../services/postCallExecutor';
import { updateTargetFromCallEnd } from './campaigns';
import { maybeAugmentSystemPromptForBooking, maybeExecuteBooking } from '../integrations/calcom';
import { buildVoiceAgentPrompt } from '../prompts/voiceAgent';
import { resolveDeployedAgent } from '../services/deployedAgentResolver';
import { decideInboundRoute } from '../services/callRouting';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const webhookRouter = Router();

/**
 * Synthesize text to an MP3 and cache it so Plivo/Twilio can fetch it via <Play>.
 *
 * Provider cascade (tried in order, first success wins):
 *   1. Deepgram Aura — primary. High-quality neural voices. Works on our standard key.
 *   2. ElevenLabs    — only used when the account is on a paid plan (free tier blocks library voices with 402 "paid_plan_required").
 *   3. OpenAI TTS    — fallback. Currently disabled for this account (insufficient_quota / 429) but kept in the cascade for when credits are added.
 *
 * Returns a public URL served by our /audio route, or null if every provider
 * failed — in which case the caller falls back to Plivo's built-in <Speak>
 * (robotic voice, but keeps the call alive).
 */

// Map the agent's voice_config.voice_id (usually an ElevenLabs/OpenAI voice
// name) onto the equivalent-sounding Deepgram Aura voice.
// Aura voices: https://developers.deepgram.com/docs/tts-models
const DEEPGRAM_VOICE_MAP: Record<string, string> = {
  // Female, conversational
  rachel: 'aura-asteria-en',
  bella: 'aura-luna-en',
  nova: 'aura-asteria-en',
  shimmer: 'aura-luna-en',
  asteria: 'aura-asteria-en',
  luna: 'aura-luna-en',
  stella: 'aura-stella-en',
  hera: 'aura-hera-en',
  athena: 'aura-athena-en',
  // Male, conversational
  adam: 'aura-orion-en',
  josh: 'aura-arcas-en',
  onyx: 'aura-zeus-en',
  echo: 'aura-orion-en',
  fable: 'aura-orpheus-en',
  orion: 'aura-orion-en',
  arcas: 'aura-arcas-en',
  perseus: 'aura-perseus-en',
  angus: 'aura-angus-en',
  orpheus: 'aura-orpheus-en',
  helios: 'aura-helios-en',
  zeus: 'aura-zeus-en',
  // Neutral
  alloy: 'aura-orion-en',
};

const OPENAI_VOICE_MAP: Record<string, string> = {
  rachel: 'nova',
  bella: 'shimmer',
  adam: 'onyx',
  josh: 'echo',
  alloy: 'alloy',
  echo: 'echo',
  fable: 'fable',
  nova: 'nova',
  onyx: 'onyx',
  shimmer: 'shimmer',
};

function shortId(): string {
  return randomBytes(8).toString('hex');
}

/** Deepgram Aura TTS → MP3 bytes. Returns null on any failure. */
async function ttsDeepgram(clean: string, voiceIdRaw?: string): Promise<Buffer | null> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;
  const model = DEEPGRAM_VOICE_MAP[(voiceIdRaw || '').toLowerCase()] || 'aura-asteria-en';
  try {
    // Deepgram truncates at 2000 chars; we stay well under.
    const resp = await fetch(
      `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mp3`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: clean.slice(0, 1900) }),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: errText.slice(0, 200), model }, 'Deepgram TTS failed');
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 300) {
      logger.warn({ size: buf.length }, 'Deepgram TTS returned tiny buffer');
      return null;
    }
    return buf;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Deepgram TTS error');
    return null;
  }
}

/** OpenAI TTS → MP3 bytes. Returns null on any failure (including 429 quota). */
async function ttsOpenAI(clean: string, voiceIdRaw?: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const voice = OPENAI_VOICE_MAP[(voiceIdRaw || '').toLowerCase()] || 'nova';
  try {
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice,
        input: clean.slice(0, 3900),
        response_format: 'mp3',
        speed: 1.0,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: errText.slice(0, 200) }, 'OpenAI TTS failed');
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 300) {
      logger.warn({ size: buf.length }, 'OpenAI TTS returned tiny buffer');
      return null;
    }
    return buf;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'OpenAI TTS error');
    return null;
  }
}

/** ElevenLabs TTS → MP3 bytes. Returns null if on free tier (402) or on any failure. */
async function ttsElevenLabs(clean: string, voiceIdRaw?: string): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  // ElevenLabs expects a voice_id (22-char id). Fall back to Rachel (21m00Tcm4TlvDq8ikWAM).
  const id = voiceIdRaw && voiceIdRaw.length >= 20 ? voiceIdRaw : '21m00Tcm4TlvDq8ikWAM';
  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean.slice(0, 3900),
        model_id: 'eleven_multilingual_v2',
      }),
    });
    if (!resp.ok) {
      // 402 = free-tier library-voice block; don't spam logs — just fall through.
      if (resp.status !== 402) {
        const errText = await resp.text().catch(() => '');
        logger.warn({ status: resp.status, body: errText.slice(0, 200) }, 'ElevenLabs TTS failed');
      }
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 300) return null;
    return buf;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'ElevenLabs TTS error');
    return null;
  }
}

async function synthesizeToUrl(text: string, voiceIdRaw?: string): Promise<string | null> {
  const clean = (text || '').trim();
  if (!clean) return null;

  // Cascade: Deepgram Aura → ElevenLabs → OpenAI. First hit wins.
  const buf =
    (await ttsDeepgram(clean, voiceIdRaw)) ||
    (await ttsElevenLabs(clean, voiceIdRaw)) ||
    (await ttsOpenAI(clean, voiceIdRaw));

  if (!buf) return null;

  const id = shortId();
  cacheAudio(id, buf);
  return `${config.publicBaseUrl}/audio/${id}.mp3`;
}

// ---------- shared helpers ----------

/**
 * Escape text for inclusion inside a TwiML <Say> element.
 * (Twilio will treat unescaped XML characters as markup.)
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Fetch an agent from agent-service. Returns minimal config for the call loop.
 */
/**
 * Fire post-call actions (webhook/slack/email) for an ended call.
 * Fetches the full conversation + messages, then dispatches actions defined
 * in agent.post_call_config.actions. Runs in background — does not block
 * the provider status webhook response.
 */
async function firePostCallActions(
  tenantId: string,
  agentId: string,
  conversationId: string | null,
  providerCallSid: string | null
): Promise<void> {
  try {
    const agent = await loadAgent(agentId, tenantId);
    if (!agent) return;
    if (!agent.post_call_config?.actions?.length) return;

    // Wait briefly so analyze() has time to populate conversation analysis
    await new Promise((r) => setTimeout(r, 3000));

    let conv: any = null;
    let messages: any[] = [];
    if (conversationId) {
      try {
        const [convRes, msgRes] = await Promise.all([
          fetch(`${config.conversationServiceUrl}/api/v1/conversations/${conversationId}`, {
            headers: { 'x-tenant-id': tenantId },
          }),
          fetch(`${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/messages`, {
            headers: { 'x-tenant-id': tenantId },
          }),
        ]);
        if (convRes.ok) conv = await convRes.json();
        if (msgRes.ok) {
          const data: any = await msgRes.json();
          messages = Array.isArray(data) ? data : data.data || [];
        }
      } catch {
        // ignore — we'll fire with whatever we have
      }
    }

    const transcript = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const ctx: PostCallContext = {
      agentId,
      agentName: agent.name || 'Agent',
      tenantId,
      conversationId,
      callerNumber: conv?.caller_number || null,
      calledNumber: conv?.called_number || null,
      duration: conv?.duration_seconds || 0,
      startedAt: conv?.started_at || null,
      endedAt: conv?.ended_at || null,
      status: conv?.status || 'ENDED',
      summary: conv?.summary || conv?.analysis?.summary || '',
      sentiment: conv?.sentiment || conv?.analysis?.sentiment || '',
      outcome: conv?.outcome || conv?.analysis?.outcome || '',
      interestLevel: conv?.interest_level ?? conv?.analysis?.interest_level ?? 0,
      topics: conv?.topics || conv?.analysis?.topics || [],
      keyPoints: conv?.key_points || conv?.analysis?.key_points || [],
      followUps: conv?.follow_ups || conv?.analysis?.follow_ups || [],
      transcript,
      recordingUrl: conv?.recording_url || null,
      providerCallSid,
    };

    const results = await executePostCallActions(agent, ctx);

    // Record outcome in conversation metadata so the UI can surface success/failure
    if (conversationId && results.length) {
      try {
        await fetch(`${config.conversationServiceUrl}/api/v1/conversations/${conversationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify({
            metadata: { post_call_actions: { executed_at: new Date().toISOString(), results } },
          }),
        });
      } catch {
        // non-fatal
      }
    }
  } catch (err: any) {
    logger.error({ err: err.message, agentId, conversationId }, 'firePostCallActions failed');
  }
}

// Status gate: DRAFT and ARCHIVED agents shouldn't take real calls. Set
// `BYPASS_PUBLISH_GATE=true` to disable for QA / migration windows.
function isAgentLive(agent: any): boolean {
  if (process.env.BYPASS_PUBLISH_GATE === 'true') return true;
  const s = String(agent?.status || '').toUpperCase();
  return s !== 'DRAFT' && s !== 'ARCHIVED';
}

async function loadAgent(
  agentId: string,
  tenantId: string,
  opts?: { numberId?: string | null },
): Promise<any | null> {
  // Prefer the deployed snapshot when present so live calls never see
  // half-edited Agent Builder state. resolveDeployedAgent falls back to a
  // live agent-service fetch when no snapshot exists, preserving the
  // pre-deploy-flow behaviour.
  try {
    const resolved = await resolveDeployedAgent(pool, {
      agentId,
      tenantId,
      numberId: opts?.numberId || null,
    });
    if (resolved) return resolved;
  } catch (err: any) {
    logger.warn({ err: err.message, agentId }, 'resolveDeployedAgent threw — falling through to direct fetch');
  }
  // Last-resort direct fetch in case resolver returned null on a transient.
  try {
    const raw = process.env.AGENT_SERVICE_URL || 'http://localhost:3001/api/v1';
    const base = raw.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    const url = `${base}/api/v1/agents/${agentId}`;
    const resp = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
    if (!resp.ok) {
      logger.warn({ status: resp.status, agentId, url }, 'Agent-service returned non-OK for loadAgent');
      return null;
    }
    const data = await resp.json();
    return (data as any).data ?? data;
  } catch (err: any) {
    logger.warn({ err: err.message, agentId }, 'Failed to load agent');
    return null;
  }
}

/**
 * Pick a Polly voice + Twilio speech-recognition language from the agent's voice_config.
 */
function voiceForLanguage(language: string): { pollyVoice: string; language: string } {
  const lang = (language || 'en-US').toLowerCase();
  const base = lang.split('-')[0];

  // Polly Neural voices that work well with <Say>
  if (lang === 'en-us') return { pollyVoice: 'Polly.Joanna-Neural', language: 'en-US' };
  if (lang === 'en-gb') return { pollyVoice: 'Polly.Amy-Neural', language: 'en-GB' };
  if (lang === 'en-in' || base === 'hi' || base === 'te' || base === 'ta' || base === 'kn' || base === 'ml' || base === 'mr' || base === 'bn') {
    return { pollyVoice: 'Polly.Aditi', language: 'en-IN' };
  }
  if (lang === 'es-es' || base === 'es') return { pollyVoice: 'Polly.Lucia-Neural', language: 'es-ES' };
  if (lang === 'fr-fr' || base === 'fr') return { pollyVoice: 'Polly.Lea-Neural', language: 'fr-FR' };
  if (lang === 'de-de' || base === 'de') return { pollyVoice: 'Polly.Vicki-Neural', language: 'de-DE' };
  if (lang === 'ja-jp' || base === 'ja') return { pollyVoice: 'Polly.Mizuki-Neural', language: 'ja-JP' };
  if (lang === 'pt-br' || base === 'pt') return { pollyVoice: 'Polly.Camila-Neural', language: 'pt-BR' };
  return { pollyVoice: 'Polly.Joanna-Neural', language: 'en-US' };
}

/**
 * Build TwiML that speaks `text`, then gathers the user's next speech,
 * and posts it to `/webhooks/twilio/gather`.
 *
 * Prefers OpenAI TTS via <Play> for human-sounding voice. Falls back to
 * Twilio Polly <Say> if synthesis fails.
 */
async function buildGatherTwiML(
  speakText: string,
  pollyVoice: string,
  language: string,
  gatherUrl: string,
  voiceIdPref: string | undefined,
  hangup: boolean = false
): Promise<string> {
  const safe = escapeXml(speakText);
  const playUrl = await synthesizeToUrl(speakText, voiceIdPref);
  const speakTag = playUrl
    ? `<Play>${escapeXml(playUrl)}</Play>`
    : `<Say voice="${pollyVoice}" language="${language}">${safe}</Say>`;

  if (hangup) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speakTag}
  <Hangup/>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speakTag}
  <Gather input="speech"
          action="${gatherUrl}"
          method="POST"
          speechTimeout="auto"
          speechModel="phone_call"
          language="${language}"
          actionOnEmptyResult="true">
  </Gather>
</Response>`;
}

/**
 * Look up conversation by Twilio CallSid so the Gather loop can keep appending
 * to the correct transcript.
 */
async function findConversationByCallSid(callSid: string): Promise<{ id: string; tenantId: string; agentId: string } | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, agent_id FROM calls WHERE provider_call_sid = $1 LIMIT 1`,
    [callSid]
  );
  if (result.rows.length === 0) return null;
  return {
    id: result.rows[0].conversation_id || result.rows[0].id,
    tenantId: result.rows[0].tenant_id,
    agentId: result.rows[0].agent_id,
  };
}

/**
 * Fetch prior messages from conversation-service so the LLM has context.
 */
async function loadHistory(conversationId: string, tenantId: string): Promise<Array<{ role: string; content: string }>> {
  try {
    const resp = await fetch(
      `${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/messages`,
      { headers: { 'x-tenant-id': tenantId } }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    const rows = ((data as any).data ?? data ?? []) as Array<{ role: string; content: string }>;
    return rows.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
      role: m.role,
      content: m.content,
    }));
  } catch {
    return [];
  }
}

async function appendMessage(
  conversationId: string,
  tenantId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  if (!conversationId || !content.trim()) return;
  try {
    await fetch(
      `${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ role, content: content.trim() }),
      }
    );
  } catch (err: any) {
    logger.warn({ err: err.message, conversationId }, 'Failed to append message');
  }
}

/**
 * Turn a thin user-provided agent prompt (sometimes just one word like
 * "education") into a fully-scaffolded persona that sounds natural on a
 * phone call. We always wrap with these rules so:
 *   - the agent never opens with "I'm an AI assistant"
 *   - replies stay short (≤2 sentences, phone-appropriate)
 *   - turn-taking feels natural — a question every couple of turns
 *   - no markdown, no lists, no URLs, no special characters
 */
function buildHumanVoicePrompt(
  basePrompt: string,
  agent: any,
  opts?: { customerName?: string | null; callType?: string | null }
): string {
  return buildVoiceAgentPrompt(basePrompt, agent, {
    customerName: opts?.customerName ?? null,
    callType: opts?.callType ?? null,
  });
}

/**
 * Look up the customer's name from calls.metadata.target_name (set when the
 * call was dialled as part of a campaign). Returns null for non-campaign calls.
 */
async function lookupCustomerName(callSid: string | null | undefined): Promise<string | null> {
  if (!callSid) return null;
  try {
    const r = await pool.query(
      `SELECT metadata FROM calls WHERE provider_call_sid = $1 LIMIT 1`,
      [callSid]
    );
    const md = (r.rows[0]?.metadata as any) || {};
    const n = md.target_name || md.customer_name;
    return n ? String(n) : null;
  } catch {
    return null;
  }
}

/**
 * Call ai-runtime /chat/simple with history + agent's system prompt.
 */
async function callLLM(
  agent: any,
  history: Array<{ role: string; content: string }>,
  opts?: { callSid?: string | null; callType?: string | null; customerName?: string | null }
): Promise<string> {
  try {
    const aiRuntimeUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';
    const basePrompt = agent.system_prompt || 'helpful customer conversation';
    // Pull the caller's name from the campaign target (if any) unless caller passed one explicitly.
    const customerName =
      opts?.customerName ?? (await lookupCustomerName(opts?.callSid));
    // Scaffold the prompt with voice/persona rules so thin user prompts still sound human.
    const humanPrompt = buildHumanVoicePrompt(basePrompt, agent, {
      customerName,
      callType: opts?.callType ?? null,
    });
    // Append SCHEDULING TOOL instructions when Cal.com is configured so the
    // LLM knows to emit the [BOOK ...] sentinel for the gather handler to parse.
    const systemPrompt = maybeAugmentSystemPromptForBooking(humanPrompt, agent);
    const resp = await fetch(`${aiRuntimeUrl}/chat/simple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        messages: history,
        provider: agent.llm_provider || 'google',
        model: agent.llm_model || 'gemini-2.5-flash',
        temperature: parseFloat(agent.temperature) || 0.7,
        max_tokens: 300,
      }),
    });
    if (!resp.ok) return '';
    const data = (await resp.json()) as { reply?: string };
    return (data.reply || '').trim();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'LLM call failed');
    return '';
  }
}

// ---------- webhook routes ----------

/**
 * POST /webhooks/twilio/voice — initial inbound or outbound answer webhook.
 *
 * For OUTBOUND calls (from /calls/initiate), we pass agentId/tenantId as query params.
 * For INBOUND calls to a configured Twilio number, we look up the agent via phone_numbers.
 */
webhookRouter.post('/twilio/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body, query: req.query }, 'Twilio voice webhook received');

    const { CallSid, From, To } = req.body;
    let agentId = (req.query.agentId as string) || '';
    let tenantId = (req.query.tenantId as string) || '';

    // Inbound: look up by called number (also fetches lifecycle hints for snapshot)
    let twilioNumberId: string | null = null;
    let twilioDeployStatus: string | null = null;
    if (!agentId || !tenantId) {
      const phoneResult = await pool.query(
        `SELECT id, agent_id, tenant_id, deployment_status FROM phone_numbers
         WHERE phone_number = $1 AND is_active = TRUE LIMIT 1`,
        [To]
      );
      if (phoneResult.rows.length === 0) {
        logger.warn({ to: To }, 'No agent for this number');
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, this number is not configured. Goodbye.</Say>
  <Hangup/>
</Response>`);
        return;
      }
      agentId = phoneResult.rows[0].agent_id;
      tenantId = phoneResult.rows[0].tenant_id;
      twilioNumberId = phoneResult.rows[0].id;
      twilioDeployStatus = phoneResult.rows[0].deployment_status;
    }

    if (twilioDeployStatus === 'paused') {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>This number is temporarily paused. Please try again later.</Say><Hangup/></Response>`);
      return;
    }

    const agent = await loadAgent(agentId, tenantId, { numberId: twilioNumberId });
    if (!agent) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>I could not load the assistant configuration. Goodbye.</Say>
  <Hangup/>
</Response>`);
      return;
    }
    if (!isAgentLive(agent)) {
      logger.warn({ agentId, tenantId, status: agent.status }, 'Twilio inbound rejected — agent not deployed');
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This assistant is not yet deployed. Please try again later.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    const lang = agent.voice_config?.language || agent.voiceConfig?.language || 'en-US';
    const { pollyVoice, language } = voiceForLanguage(lang);

    // Create a conversation row so we can store the transcript
    let conversationId: string | null = null;
    try {
      const resp = await fetch(`${config.conversationServiceUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({
          agent_id: agentId,
          channel: 'PHONE',
          caller_number: From,
          called_number: To,
          call_sid: CallSid,
          language: lang,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { id: string };
        conversationId = data.id;
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to create conversation');
    }

    // Insert the call row (needed so recording + gather can find it by CallSid)
    await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, conversation_id, direction, status, caller_number, called_number, provider, provider_call_sid)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $6, 'twilio', $7)
       ON CONFLICT (provider_call_sid) DO UPDATE SET status='IN_PROGRESS', conversation_id=EXCLUDED.conversation_id`,
      [tenantId, agentId, conversationId, From === agent.voice_config?.from ? 'OUTBOUND' : 'INBOUND', From, To, CallSid]
    );

    // Generate the first turn from the LLM so it follows the agent's system prompt
    // (instead of a static greeting that ignores the prompt).
    // Fall back to the agent's greeting_message if the LLM call fails.
    let greeting: string;
    try {
      const seeded = await callLLM(
        agent,
        [
          {
            role: 'user',
            content:
              'The call has just connected. Greet the caller briefly (one sentence) and then ask your FIRST question according to your instructions. Speak naturally for a phone call — no lists, no formatting, just conversational speech.',
          },
        ],
        { callSid: CallSid }
      );
      greeting =
        (seeded && seeded.trim()) ||
        agent.greeting_message ||
        agent.greetingMessage ||
        'Hello! How can I help you today?';
    } catch {
      greeting =
        agent.greeting_message ||
        agent.greetingMessage ||
        'Hello! How can I help you today?';
    }

    if (conversationId) {
      await appendMessage(conversationId, tenantId, 'assistant', greeting);
    }

    const gatherUrl = `${config.publicBaseUrl}/webhooks/twilio/gather?conversationId=${conversationId || ''}&agentId=${agentId}&tenantId=${tenantId}`;
    const voiceIdPref = agent.voice_config?.voice_id || agent.voiceConfig?.voiceId;
    const twiml = await buildGatherTwiML(greeting, pollyVoice, language, gatherUrl, voiceIdPref);
    res.type('text/xml').send(twiml);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/twilio/gather — called after user speaks.
 *
 * Twilio posts `SpeechResult` (the transcribed text) and `Confidence`.
 * We run the LLM and return TwiML that speaks the reply, then Gathers again.
 */
webhookRouter.post('/twilio/gather', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { CallSid, SpeechResult, Confidence } = req.body;
    const conversationId = (req.query.conversationId as string) || '';
    const agentId = (req.query.agentId as string) || '';
    const tenantId = (req.query.tenantId as string) || '';

    logger.info(
      { callSid: CallSid, speech: SpeechResult, confidence: Confidence, conversationId },
      'Twilio gather webhook'
    );

    const agent = await loadAgent(agentId, tenantId);
    if (!agent) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Sorry, an error occurred.</Say><Hangup/></Response>`);
      return;
    }

    const lang = agent.voice_config?.language || 'en-US';
    const { pollyVoice, language } = voiceForLanguage(lang);
    const voiceIdPref = agent.voice_config?.voice_id || agent.voiceConfig?.voiceId;

    const userText = (SpeechResult || '').trim();

    // Empty gather — maybe user didn't speak. Prompt once more, then hang up.
    if (!userText) {
      const gatherUrl = `${config.publicBaseUrl}/webhooks/twilio/gather?conversationId=${conversationId}&agentId=${agentId}&tenantId=${tenantId}&emptyCount=${(parseInt((req.query.emptyCount as string) || '0') + 1)}`;
      const emptyCount = parseInt((req.query.emptyCount as string) || '0') + 1;
      if (emptyCount >= 2) {
        res.type('text/xml').send(await buildGatherTwiML(
          "I didn't hear anything. Goodbye for now.",
          pollyVoice,
          language,
          '',
          voiceIdPref,
          true
        ));
        return;
      }
      res.type('text/xml').send(await buildGatherTwiML(
        "I didn't catch that. Could you repeat?",
        pollyVoice,
        language,
        gatherUrl,
        voiceIdPref
      ));
      return;
    }

    // Persist user message
    if (conversationId) {
      await appendMessage(conversationId, tenantId, 'user', userText);
    }

    // Load history + call LLM
    const history = conversationId ? await loadHistory(conversationId, tenantId) : [];
    // Ensure the user message is at the end (loadHistory may be slightly stale)
    if (!history.length || history[history.length - 1].content !== userText) {
      history.push({ role: 'user', content: userText });
    }

    const reply =
      (await callLLM(agent, history, { callSid: CallSid })) ||
      "I'm sorry, could you repeat that?";

    if (conversationId) {
      await appendMessage(conversationId, tenantId, 'assistant', reply);
    }

    const gatherUrl = `${config.publicBaseUrl}/webhooks/twilio/gather?conversationId=${conversationId}&agentId=${agentId}&tenantId=${tenantId}`;
    res.type('text/xml').send(await buildGatherTwiML(reply, pollyVoice, language, gatherUrl, voiceIdPref));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/twilio/status — call status updates (ringing, in-progress, completed).
 * When COMPLETED, trigger conversation analyze.
 */
webhookRouter.post('/twilio/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Twilio status webhook received');

    const { CallSid, CallStatus, CallDuration } = req.body;

    const statusMap: Record<string, string> = {
      queued: 'RINGING',
      ringing: 'RINGING',
      'in-progress': 'IN_PROGRESS',
      completed: 'COMPLETED',
      busy: 'FAILED',
      'no-answer': 'FAILED',
      canceled: 'CANCELLED',
      failed: 'FAILED',
    };
    const mappedStatus = statusMap[CallStatus] || CallStatus?.toUpperCase() || 'UNKNOWN';
    const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(mappedStatus);

    const setClauses: string[] = ['status = $1'];
    const values: any[] = [mappedStatus];
    let paramIdx = 2;

    if (isTerminal) setClauses.push(`ended_at = NOW()`);
    if (CallDuration) {
      setClauses.push(`duration_seconds = $${paramIdx}`);
      values.push(parseInt(CallDuration));
      paramIdx++;
    }
    values.push(CallSid);

    const result = await pool.query(
      `UPDATE calls SET ${setClauses.join(', ')} WHERE provider_call_sid = $${paramIdx}
       RETURNING tenant_id, conversation_id, agent_id`,
      values
    );

    // On terminal state, trigger analysis + mark conversation ended
    if (isTerminal && result.rows.length > 0) {
      const { tenant_id: tenantId, conversation_id: conversationId, agent_id: agentId } = result.rows[0];
      if (conversationId) {
        try {
          await fetch(
            `${config.conversationServiceUrl}/api/v1/conversations/${conversationId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
              body: JSON.stringify({
                status: 'ENDED',
                duration_seconds: CallDuration ? parseInt(CallDuration) : 0,
              }),
            }
          );
          await fetch(
            `${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/analyze`,
            { method: 'POST', headers: { 'x-tenant-id': tenantId } }
          );
        } catch (err: any) {
          logger.warn({ err: err.message }, 'Failed to finalize conversation');
        }
      }
      if (agentId) {
        void firePostCallActions(tenantId, agentId, conversationId, CallSid);
      }
      void updateTargetFromCallEnd(
        CallSid,
        mappedStatus === 'COMPLETED' ? 'COMPLETED' : mappedStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        conversationId
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/twilio/recording — Twilio notifies us when the recording is available.
 * We download the MP3 and upload it to conversation-service so it's stored under our URL.
 */
webhookRouter.post('/twilio/recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Twilio recording webhook received');

    const { CallSid, RecordingUrl, RecordingSid, RecordingStatus } = req.body;
    if (RecordingStatus !== 'completed' || !RecordingUrl) {
      res.status(200).json({ received: true });
      return;
    }

    const callResult = await pool.query(
      `SELECT tenant_id, conversation_id FROM calls WHERE provider_call_sid = $1`,
      [CallSid]
    );
    if (callResult.rows.length === 0) {
      res.status(200).json({ received: true });
      return;
    }
    const { tenant_id: tenantId, conversation_id: conversationId } = callResult.rows[0];

    // Store Twilio's recording URL as a reference (append .mp3 for direct media access).
    // Twilio recordings are authenticated with the account SID/token; we embed basic auth
    // into the URL for simplicity in dev. For production, proxy through our server.
    const mp3Url = `${RecordingUrl}.mp3`;

    // Download the MP3 with Twilio basic auth and upload to conversation-service
    try {
      const basic = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
      const audioResp = await fetch(mp3Url, {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (audioResp.ok && conversationId) {
        const audioBuf = Buffer.from(await audioResp.arrayBuffer());
        await fetch(
          `${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/recording`,
          {
            method: 'POST',
            headers: {
              'x-tenant-id': tenantId,
              'Content-Type': 'audio/mpeg',
            },
            body: audioBuf as any,
          }
        );
        logger.info({ conversationId, size: audioBuf.length }, 'Recording uploaded');
      } else {
        logger.warn({ status: audioResp.status }, 'Failed to download Twilio recording');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, CallSid }, 'Recording download/upload failed');
    }

    // Also store the Twilio SID for reference
    await pool.query(
      `UPDATE calls SET metadata = COALESCE(metadata, '{}') || $1 WHERE provider_call_sid = $2`,
      [JSON.stringify({ twilio_recording_sid: RecordingSid, twilio_recording_url: mp3Url }), CallSid]
    );

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/exotel/voice — kept for future; unchanged from before.
 */
webhookRouter.post('/exotel/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Exotel voice webhook received');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

webhookRouter.post('/exotel/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Exotel status webhook received');
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

// =================== PLIVO ===================
//
// Plivo uses Plivo XML (similar spirit to TwiML). Key verbs:
//   <Speak voice="WOMAN" language="en-US">text</Speak>
//   <Play>https://...mp3</Play>
//   <GetInput action="..." method="POST" inputType="speech" language="en-US"
//             executionTimeout="3" timeout="5">
//     <Speak>prompt</Speak>
//   </GetInput>
//   <Hangup/>
//
// Plivo posts the user's transcribed speech as `Digits` (when DTMF) or `Speech`
// (when inputType=speech). We look for either.

function plivoVoiceFor(language: string): { plivoVoice: string; plivoLang: string } {
  const lang = (language || 'en-US').toLowerCase();
  const base = lang.split('-')[0];
  if (lang === 'hi-in' || base === 'hi') return { plivoVoice: 'Polly.Aditi', plivoLang: 'hi-IN' };
  if (base === 'te' || base === 'ta' || base === 'kn' || base === 'ml' || base === 'mr' || base === 'bn') {
    return { plivoVoice: 'Polly.Aditi', plivoLang: 'hi-IN' };
  }
  if (lang === 'en-in') return { plivoVoice: 'Polly.Raveena', plivoLang: 'en-IN' };
  if (lang === 'en-gb') return { plivoVoice: 'Polly.Amy', plivoLang: 'en-GB' };
  if (lang === 'es-es' || base === 'es') return { plivoVoice: 'Polly.Lucia', plivoLang: 'es-ES' };
  if (lang === 'fr-fr' || base === 'fr') return { plivoVoice: 'Polly.Lea', plivoLang: 'fr-FR' };
  return { plivoVoice: 'Polly.Joanna', plivoLang: 'en-US' };
}

/**
 * Pick a random filler phrase from the agent's call_config. Returns empty
 * string if none configured. Fillers make the agent feel less robotic by
 * acknowledging the caller before the LLM-generated reply.
 */
function pickFiller(agent: any): string {
  const list = agent?.call_config?.filler_phrases;
  if (!Array.isArray(list) || list.length === 0) return '';
  const cleaned = list.filter((s: any) => typeof s === 'string' && s.trim().length > 0);
  if (cleaned.length === 0) return '';
  return cleaned[Math.floor(Math.random() * cleaned.length)];
}

const DEFAULT_TRANSFER_PHRASES = [
  'transfer me', 'speak to a human', 'speak to an agent', 'talk to a person',
  'talk to someone', 'can i talk to', 'real person', 'live agent', 'real human',
  'manager', 'representative', 'customer service rep',
];

/**
 * Detect whether the caller's last utterance is asking for a human transfer.
 * Uses both the agent-configured trigger phrases and a sensible default list.
 */
function detectTransferIntent(userText: string, agentTriggers?: string[]): boolean {
  const text = (userText || '').toLowerCase();
  if (!text) return false;
  const phrases = [...DEFAULT_TRANSFER_PHRASES, ...(agentTriggers || [])].map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  return phrases.some((p) => text.includes(p));
}

/**
 * Build Plivo `<Dial>` XML for a call transfer. Loops through `numbers` via
 * the action URL — when a leg fails, /plivo/transfer-result advances `attempt`.
 */
function buildPlivoTransferXml(
  numbers: string[],
  attempt: number,
  conversationId: string,
  agentId: string,
  tenantId: string,
  plivoVoice: string,
  plivoLang: string,
  preamble: string = 'One moment, transferring you now.'
): string {
  const target = numbers[attempt];
  const action = `${config.publicBaseUrl}/webhooks/plivo/transfer-result?conversationId=${conversationId}&agentId=${agentId}&tenantId=${tenantId}&attempt=${attempt}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="${plivoVoice}" language="${plivoLang}">${escapeXml(preamble)}</Speak>
  <Dial action="${escapeXml(action)}" method="POST" timeout="30" callerId="">
    <Number>${escapeXml(target)}</Number>
  </Dial>
</Response>`;
}

async function buildPlivoGatherXml(
  speakText: string,
  plivoVoice: string,
  language: string,
  gatherUrl: string,
  voiceIdPref?: string,
  hangup: boolean = false
): Promise<string> {
  const safe = escapeXml(speakText);
  const playUrl = await synthesizeToUrl(speakText, voiceIdPref);
  const speakTag = playUrl
    ? `<Play>${escapeXml(playUrl)}</Play>`
    : `<Speak voice="${plivoVoice}" language="${language}">${safe}</Speak>`;

  if (hangup) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speakTag}
  <Hangup/>
</Response>`;
  }

  // GetInput with speech recognition. Plivo's `inputType="speech"` auto-transcribes
  // and posts the result as `Speech` in the action POST body.
  // IMPORTANT: Plivo rejects unknown attributes on <GetInput> ("Invalid Answer
  // XML", code 8011). Valid attrs are: action, method, inputType, language,
  // executionTimeout, speechEndTimeout, digitEndTimeout, interimSpeechResultsCallback,
  // hints, log, profanityFilter, redirect.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <GetInput action="${escapeXml(gatherUrl)}"
            method="POST"
            inputType="speech"
            language="${language}"
            executionTimeout="6"
            speechEndTimeout="1">
    ${speakTag}
  </GetInput>
  <Redirect>${escapeXml(gatherUrl + '&empty=1')}</Redirect>
</Response>`;
}

/**
 * POST /webhooks/plivo/voice — initial answer webhook.
 */
webhookRouter.post('/plivo/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body, query: req.query }, 'Plivo voice webhook received');

    const { CallUUID, From, To } = req.body;
    let agentId = (req.query.agentId as string) || '';
    let tenantId = (req.query.tenantId as string) || '';

    // Inbound: look up by called number. We also pull the row's id +
    // deployment_status so the deploy-gate uses the number's lifecycle state
    // (paused vs deployed) instead of just is_active.
    let numberId: string | null = null;
    let deploymentStatus: string | null = null;
    let isInboundCall = false;
    if (!agentId || !tenantId) {
      isInboundCall = true;
      const phoneResult = await pool.query(
        `SELECT id, agent_id, tenant_id, deployment_status, inbound_enabled FROM phone_numbers
         WHERE phone_number = $1 AND is_active = TRUE LIMIT 1`,
        [To]
      );
      if (phoneResult.rows.length === 0) {
        logger.info({ to: To }, '[INBOUND_NUMBER_NOT_REGISTERED]');
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>Sorry, this number is not configured. Goodbye.</Speak><Hangup/></Response>`);
        return;
      }
      const phoneRow = phoneResult.rows[0];
      if (phoneRow.inbound_enabled === false) {
        logger.info({ to: To, numberId: phoneRow.id }, '[INBOUND_DISABLED] inbound_enabled=false');
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>This number does not accept incoming calls at this time. Goodbye.</Speak><Hangup/></Response>`);
        return;
      }
      if (!phoneRow.agent_id) {
        logger.info({ to: To, numberId: phoneRow.id }, '[INBOUND_NO_AGENT_ASSIGNED]');
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>Thank you for calling. No AI agent is assigned to this number yet. Please contact support.</Speak><Hangup/></Response>`);
        return;
      }
      agentId = phoneRow.agent_id;
      tenantId = phoneRow.tenant_id;
      numberId = phoneRow.id;
      deploymentStatus = phoneRow.deployment_status;
      logger.info({ to: To, numberId, agentId, tenantId }, '[INBOUND_NUMBER_MATCHED]');
    } else {
      // Outbound (we already know agent + tenant from query). Best-effort
      // lookup of a deployed number for this agent so the snapshot path can
      // resolve the right snapshot.
      const phoneRow = await pool.query(
        `SELECT id, deployment_status FROM phone_numbers
          WHERE tenant_id = $1 AND agent_id = $2 AND is_active = TRUE
          ORDER BY deployed_at DESC NULLS LAST LIMIT 1`,
        [tenantId, agentId],
      );
      numberId = phoneRow.rows[0]?.id || null;
      deploymentStatus = phoneRow.rows[0]?.deployment_status || null;
    }

    // Mark any active inbound-probe as satisfied — runs BEFORE the pause
    // gate so a paused number's probe still completes (lets users verify
    // before deploying).
    if (numberId) {
      try {
        const probe = await pool.query(
          `SELECT id, run_id FROM number_verifications
            WHERE number_id = $1 AND test_type = 'inbound_call_probe' AND status = 'pending'
              AND started_at > NOW() - INTERVAL '60 seconds'
            ORDER BY started_at DESC LIMIT 1`,
          [numberId],
        );
        if (probe.rows.length > 0) {
          await pool.query(
            `UPDATE number_verifications
                SET status = 'pass',
                    completed_at = NOW(),
                    log = COALESCE(log, '{}'::jsonb) || $2::jsonb
              WHERE id = $1`,
            [probe.rows[0].id, JSON.stringify({ caller: From, at: new Date().toISOString() })],
          );
          logger.info({ numberId, probeId: probe.rows[0].run_id, From }, 'inbound_call_probe satisfied');
        }
      } catch (e: any) {
        logger.warn({ err: e.message }, 'inbound_call_probe lookup failed');
      }
    }

    if (deploymentStatus === 'paused') {
      logger.warn({ numberId, deploymentStatus }, 'Inbound call rejected — number paused');
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>This number is temporarily paused. Please try again later.</Speak><Hangup/></Response>`);
      return;
    }

    // Routing rules: spam/DND, geo, business hours, failover. Skip for outbound
    // (numberId only set on inbound lookups).
    if (numberId) {
      const decision = await decideInboundRoute(pool, { tenantId, numberId, callerNumber: From });
      if (decision.action === 'reject') {
        logger.info({ numberId, reason: decision.reason }, 'Inbound call rejected by route policy');
        const safe = escapeXml(decision.message || 'Sorry, this call cannot be accepted.');
        res.type('text/xml').send(
          `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Speak>${safe}</Speak><Hangup/></Response>`,
        );
        return;
      }
      if (decision.action === 'failover' && decision.failover_agent_id) {
        logger.info({ numberId, failoverAgentId: decision.failover_agent_id }, 'Routing to failover agent');
        agentId = decision.failover_agent_id;
      }
      // IVR runtime: render a Plivo <GetInput> with the configured greeting +
      // numeric menu. Caller's DTMF reply hits /webhooks/plivo/ivr where it's
      // sub-routed (route_to_agent / transfer_to_number / hangup).
      // Skip IVR rendering when redirected from /ivr (avoids infinite loop).
      const ivrFallback = req.query.ivrFallback === '1';
      if (!ivrFallback && decision.action === 'ivr' && decision.ivr) {
        const ivr = decision.ivr;
        const lang = 'en-US';
        const { plivoVoice, plivoLang } = plivoVoiceFor(lang);
        const greeting = String(ivr.greeting || 'Welcome. Please make a selection.');
        const menuLines: string[] = (Array.isArray(ivr.menu) ? ivr.menu : [])
          .map((m: any) => `Press ${m.digit} for ${m.label}.`);
        const fullPrompt = [greeting, ...menuLines].join(' ');
        const ivrAction = `${config.publicBaseUrl}/webhooks/plivo/ivr?numberId=${encodeURIComponent(numberId)}&tenantId=${encodeURIComponent(tenantId)}&originalAgentId=${encodeURIComponent(agentId)}&from=${encodeURIComponent(From || '')}&to=${encodeURIComponent(To || '')}`;
        const safe = escapeXml(fullPrompt);
        const timeout = Math.max(3, Math.min(60, parseInt(ivr.timeout_seconds || 8)));
        res.type('text/xml').send(
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <GetInput action="${escapeXml(ivrAction)}" method="POST" inputType="dtmf" digitEndTimeout="${timeout}" finishOnKey="#" numDigits="1">
    <Speak voice="${plivoVoice}" language="${plivoLang}">${safe}</Speak>
  </GetInput>
  <Speak voice="${plivoVoice}" language="${plivoLang}">No selection made. Connecting you to an agent.</Speak>
  <Redirect method="POST">${escapeXml(`${config.publicBaseUrl}/webhooks/plivo/voice?agentId=${agentId}&tenantId=${tenantId}&ivrFallback=1`)}</Redirect>
</Response>`,
        );
        return;
      }
    }

    const agent = await loadAgent(agentId, tenantId, { numberId });
    if (!agent) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>I could not load the assistant configuration. Goodbye.</Speak><Hangup/></Response>`);
      return;
    }
    if (!isAgentLive(agent)) {
      logger.warn({ agentId, tenantId, status: agent.status }, 'Inbound call rejected — agent not deployed');
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>This assistant is not yet deployed. Please try again later.</Speak><Hangup/></Response>`);
      return;
    }

    const lang = agent.voice_config?.language || agent.voiceConfig?.language || 'en-US';
    const { plivoVoice, plivoLang } = plivoVoiceFor(lang);

    // ─── Voicemail / answering-machine detection ────────────────────────
    // Plivo posts `Machine=true` (and `MachineDetectionDuration`) when AMD
    // fires. If the agent is configured to detect voicemail, branch here
    // before doing any LLM/conversation work.
    const machineFlag = String((req.body as any)?.Machine || (req.body as any)?.AnsweredBy || '').toLowerCase();
    const isMachine = machineFlag === 'true' || machineFlag === 'machine' || machineFlag === 'machine_start' || machineFlag === 'machine_end_beep' || machineFlag === 'machine_end_silence' || machineFlag === 'machine_end_other';
    const vmCfg = agent.call_config?.voicemail_detection;
    if (isMachine && vmCfg?.enabled) {
      logger.info({ agentId, tenantId, action: vmCfg.action }, 'Voicemail detected on call');
      // Mark the call so analytics + post-call actions can see the outcome
      await pool.query(
        `UPDATE calls SET outcome = 'VOICEMAIL', metadata = COALESCE(metadata,'{}') || $1
         WHERE provider_call_sid = $2`,
        [JSON.stringify({ machine_detection: machineFlag }), CallUUID]
      );
      if (vmCfg.action === 'leave_message' && vmCfg.message) {
        const safe = escapeXml(vmCfg.message);
        res.type('text/xml').send(
          `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Speak voice="${plivoVoice}" language="${plivoLang}">${safe}</Speak>\n  <Hangup/>\n</Response>`
        );
      } else {
        // Default to immediate hangup
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`);
      }
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    // Stream mode (default): Plivo's own <GetInput inputType="speech"> requires
    // speech-recognition entitlement on the account. Pending-KYC accounts get
    // back "Invalid Answer XML" (code 8011) and the call ends in ~5s.
    // We bypass Plivo STT by handing it a bidirectional <Stream> that lands
    // on OUR WebSocket endpoint (/plivo/audio), where we run Deepgram STT +
    // Aura TTS ourselves. Falls back to the legacy <GetInput> flow when
    // `?mode=gather` is present on the answer_url.
    const mode = String(req.query.mode || '').toLowerCase();
    const useGather = mode === 'gather';

    if (!useGather) {
      // Build the public WSS URL the ngrok tunnel exposes. ngrok's https
      // hostname also terminates wss — we just swap the scheme.
      const wsBase = config.publicBaseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
      // Plivo's Stream start event does NOT include the caller's number,
      // so we pass From/To/CallUUID through the WS URL query string. The
      // WS handler uses them to populate calls + conversations rows.
      const streamUrl = `${wsBase}/plivo/audio?agentId=${encodeURIComponent(agentId)}&tenantId=${encodeURIComponent(tenantId)}&from=${encodeURIComponent(From || '')}&to=${encodeURIComponent(To || '')}&callSid=${encodeURIComponent(CallUUID || '')}&direction=${isInboundCall ? 'inbound' : 'outbound'}`;
      // Plivo docs: contentType MUST combine codec + rate with a semicolon
      // (e.g. "audio/x-mulaw;rate=8000"). A separate sampleRate attr is
      // ignored, which means Plivo may silently skip the Stream entirely.
      // <Wait length="3600"/> is a safety net: if Plivo somehow skips the
      // Stream, Wait keeps the call up so we at least see the 4010 symptom
      // change instead of a 1-second hangup.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Stream keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000">${escapeXml(streamUrl)}</Stream>\n  <Wait length="3600"/>\n</Response>`;
      logger.info({ agentId, tenantId, streamUrl }, 'Plivo /voice: emitting Stream XML');
      res.type('text/xml').send(xml);
      return;
    }

    // ─── Legacy <GetInput> path (only when ?mode=gather) ────────────────
    // Kept so we can flip back to Plivo's built-in STT once KYC is approved.
    let conversationId: string | null = null;
    try {
      const resp = await fetch(`${config.conversationServiceUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({
          agent_id: agentId,
          channel: 'PHONE',
          caller_number: From,
          called_number: To,
          call_sid: CallUUID,
          language: lang,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { id: string };
        conversationId = data.id;
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to create conversation');
    }

    const callDirection = isInboundCall ? 'INBOUND' : 'OUTBOUND';
    await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, conversation_id, direction, status, caller_number, called_number, provider, provider_call_sid)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $6, 'plivo', $7)
       ON CONFLICT (provider_call_sid) DO UPDATE SET status='IN_PROGRESS', conversation_id=EXCLUDED.conversation_id`,
      [tenantId, agentId, conversationId, callDirection, From, To, CallUUID]
    );
    logger.info({ callSid: CallUUID, direction: callDirection }, isInboundCall ? '[INBOUND_CALL_SESSION_CREATED]' : 'Outbound call row created');

    let greeting: string;
    try {
      const seeded = await callLLM(
        agent,
        [
          {
            role: 'user',
            content:
              'The call has just connected. Say hello warmly, introduce yourself by your first name only, mention the topic you help with in a friendly way, and ask ONE short opening question. Sound like a real human — no "I am an AI", no corporate scripts, no lists. One or two sentences max.',
          },
        ],
        { callSid: CallUUID }
      );
      greeting = (seeded && seeded.trim()) || agent.greeting_message || 'Hey there — how can I help you today?';
    } catch {
      greeting = agent.greeting_message || 'Hey there — how can I help you today?';
    }

    if (conversationId) await appendMessage(conversationId, tenantId, 'assistant', greeting);

    const voiceIdPref = agent.voice_config?.voice_id;
    const gatherUrl = `${config.publicBaseUrl}/webhooks/plivo/gather?conversationId=${conversationId || ''}&agentId=${agentId}&tenantId=${tenantId}`;

    if (req.query.simple === '1') {
      const safe = escapeXml(greeting);
      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Speak voice="${plivoVoice}" language="${plivoLang}">${safe}</Speak>\n  <Hangup/>\n</Response>`
      );
      return;
    }

    const xml = await buildPlivoGatherXml(greeting, plivoVoice, plivoLang, gatherUrl, voiceIdPref);
    res.type('text/xml').send(xml);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/gather — called after user speech is captured.
 * Plivo posts `Speech` (transcribed text) or `Digits` for DTMF.
 */
webhookRouter.post('/plivo/gather', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { CallUUID, Speech, Digits } = req.body;
    const conversationId = (req.query.conversationId as string) || '';
    const agentId = (req.query.agentId as string) || '';
    const tenantId = (req.query.tenantId as string) || '';
    const empty = req.query.empty === '1';

    logger.info({ callUuid: CallUUID, speech: Speech, digits: Digits, empty }, 'Plivo gather webhook');

    const agent = await loadAgent(agentId, tenantId);
    if (!agent) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Speak>Sorry, an error occurred.</Speak><Hangup/></Response>`);
      return;
    }

    const lang = agent.voice_config?.language || 'en-US';
    const { plivoVoice, plivoLang } = plivoVoiceFor(lang);
    const voiceIdPref = agent.voice_config?.voice_id;

    const userText = ((Speech as string) || (Digits as string) || '').trim();

    if (!userText || empty) {
      const emptyCount = parseInt((req.query.emptyCount as string) || '0') + 1;
      if (emptyCount >= 2) {
        res.type('text/xml').send(
          await buildPlivoGatherXml("I didn't hear anything. Goodbye.", plivoVoice, plivoLang, '', voiceIdPref, true)
        );
        return;
      }
      const gatherUrl = `${config.publicBaseUrl}/webhooks/plivo/gather?conversationId=${conversationId}&agentId=${agentId}&tenantId=${tenantId}&emptyCount=${emptyCount}`;
      res.type('text/xml').send(
        await buildPlivoGatherXml("I didn't catch that. Could you say that again?", plivoVoice, plivoLang, gatherUrl, voiceIdPref)
      );
      return;
    }

    if (conversationId) await appendMessage(conversationId, tenantId, 'user', userText);

    // ─── Call transfer (caller-initiated trigger) ────────────────────────
    // If the caller asked to be transferred and the agent has transfer numbers,
    // dial the first available one. Backup numbers are handled by /plivo/transfer-result.
    const transferCfg = agent.call_config?.call_transfer;
    const userWantsTransfer =
      transferCfg?.enabled &&
      Array.isArray(transferCfg.numbers) &&
      transferCfg.numbers.length > 0 &&
      detectTransferIntent(userText, transferCfg.trigger_phrases);

    if (userWantsTransfer) {
      const xml = buildPlivoTransferXml(transferCfg.numbers, 0, conversationId, agentId, tenantId, plivoVoice, plivoLang);
      if (conversationId) {
        await appendMessage(conversationId, tenantId, 'assistant', '[Transferring caller to human agent]');
      }
      res.type('text/xml').send(xml);
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    const history = conversationId ? await loadHistory(conversationId, tenantId) : [];
    if (!history.length || history[history.length - 1].content !== userText) {
      history.push({ role: 'user', content: userText });
    }
    let reply =
      (await callLLM(agent, history, { callSid: CallUUID })) ||
      'Sorry, could you repeat?';

    // LLM-initiated booking: model can emit [BOOK ...] sentinel to schedule via Cal.com.
    // Replaces the spoken reply with the confirmation/error from Cal.com.
    const bookingMessage = await maybeExecuteBooking(reply, agent);
    if (bookingMessage) {
      reply = bookingMessage;
    }

    // LLM-initiated transfer: model can emit [TRANSFER] sentinel to escalate.
    if (transferCfg?.enabled && reply.toUpperCase().includes('[TRANSFER]')) {
      const cleaned = reply.replace(/\[TRANSFER\]/gi, '').trim() || 'Let me transfer you now.';
      if (conversationId) await appendMessage(conversationId, tenantId, 'assistant', cleaned);
      const xml = buildPlivoTransferXml(transferCfg.numbers, 0, conversationId, agentId, tenantId, plivoVoice, plivoLang, cleaned);
      res.type('text/xml').send(xml);
      return;
    }

    // Filler phrase prepending — short verbal acknowledgment so the caller
    // doesn't hear dead air after they finish speaking. Skip when this is a
    // booking confirmation since that's already a complete sentence.
    if (!bookingMessage) {
      const filler = pickFiller(agent);
      if (filler) reply = `${filler} ${reply}`;
    }

    if (conversationId) await appendMessage(conversationId, tenantId, 'assistant', reply);

    const gatherUrl = `${config.publicBaseUrl}/webhooks/plivo/gather?conversationId=${conversationId}&agentId=${agentId}&tenantId=${tenantId}`;
    res.type('text/xml').send(await buildPlivoGatherXml(reply, plivoVoice, plivoLang, gatherUrl, voiceIdPref));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/ivr — DTMF response from the IVR menu rendered in the
 * inbound voice handler. Routes the caller based on the configured menu:
 *   - route_to_agent → redirect to /plivo/voice with the chosen agentId
 *   - transfer_to_number → <Dial> to the configured PSTN number
 *   - hangup → end the call
 *
 * If the caller pressed an unmapped digit (or timed out), we fall back to the
 * original agent that was attached to the number.
 */
webhookRouter.post('/plivo/ivr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Digits } = req.body;
    const numberId = (req.query.numberId as string) || '';
    const tenantId = (req.query.tenantId as string) || '';
    const originalAgentId = (req.query.originalAgentId as string) || '';
    const From = (req.query.from as string) || '';
    const To = (req.query.to as string) || '';

    let cfg: any = {};
    try {
      const r = await pool.query(
        `SELECT route_config FROM call_routes WHERE tenant_id = $1 AND number_id = $2`,
        [tenantId, numberId],
      );
      cfg = r.rows[0]?.route_config || {};
    } catch { /* fall through */ }

    const menu: any[] = Array.isArray(cfg?.ivr?.menu) ? cfg.ivr.menu : [];
    const choice = menu.find((m) => String(m.digit) === String(Digits || '').trim());

    const lang = 'en-US';
    const { plivoVoice, plivoLang } = plivoVoiceFor(lang);

    if (!choice) {
      logger.info({ numberId, digits: Digits }, 'IVR no-match — falling back to original agent');
      // Redirect back to /plivo/voice with the original agent and ivrFallback flag
      // so we don't re-render the menu.
      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Redirect method="POST">${escapeXml(`${config.publicBaseUrl}/webhooks/plivo/voice?agentId=${originalAgentId}&tenantId=${tenantId}&ivrFallback=1`)}</Redirect></Response>`,
      );
      return;
    }

    if (choice.action === 'hangup') {
      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Speak voice="${plivoVoice}" language="${plivoLang}">Thank you. Goodbye.</Speak><Hangup/></Response>`,
      );
      return;
    }

    if (choice.action === 'transfer_to_number' && choice.transfer_to) {
      const target = String(choice.transfer_to);
      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Speak voice="${plivoVoice}" language="${plivoLang}">Connecting you now.</Speak><Dial timeout="30"><Number>${escapeXml(target)}</Number></Dial></Response>`,
      );
      return;
    }

    if (choice.action === 'route_to_agent' && choice.agent_id) {
      // Redirect to /plivo/voice with the chosen agent. Pass ivrFallback=1 so
      // the inbound handler doesn't re-render the IVR (would loop forever).
      res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Redirect method="POST">${escapeXml(`${config.publicBaseUrl}/webhooks/plivo/voice?agentId=${choice.agent_id}&tenantId=${tenantId}&from=${encodeURIComponent(From)}&to=${encodeURIComponent(To)}&ivrFallback=1`)}</Redirect></Response>`,
      );
      return;
    }

    // Unrecognized action shape — fall back to original agent.
    res.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Redirect method="POST">${escapeXml(`${config.publicBaseUrl}/webhooks/plivo/voice?agentId=${originalAgentId}&tenantId=${tenantId}&ivrFallback=1`)}</Redirect></Response>`,
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/transfer-result — Plivo POSTs here when a `<Dial>` ends.
 * If the dial failed and there are more backup numbers, try the next.
 */
webhookRouter.post('/plivo/transfer-result', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { DialStatus } = req.body;
    const conversationId = (req.query.conversationId as string) || '';
    const agentId = (req.query.agentId as string) || '';
    const tenantId = (req.query.tenantId as string) || '';
    const attempt = parseInt((req.query.attempt as string) || '0', 10);

    logger.info({ DialStatus, attempt, agentId }, 'Plivo transfer-result webhook');

    // If the leg connected and ended cleanly, just hang up.
    if (DialStatus === 'completed' || DialStatus === 'answer') {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`);
      return;
    }

    const agent = await loadAgent(agentId, tenantId);
    if (!agent) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`);
      return;
    }
    const transferCfg = agent.call_config?.call_transfer;
    const lang = agent.voice_config?.language || 'en-US';
    const { plivoVoice, plivoLang } = plivoVoiceFor(lang);

    const next = attempt + 1;
    if (transferCfg?.numbers && next < transferCfg.numbers.length) {
      // Try the next number
      const xml = buildPlivoTransferXml(
        transferCfg.numbers, next, conversationId, agentId, tenantId, plivoVoice, plivoLang,
        'That line was busy. Trying another agent.'
      );
      res.type('text/xml').send(xml);
      return;
    }

    // No more backups — say goodbye and hang up
    res.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Speak voice="${plivoVoice}" language="${plivoLang}">Sorry, no agents are available right now. Please try again later. Goodbye.</Speak>\n  <Hangup/>\n</Response>`
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/status — Plivo posts call lifecycle events here.
 */
webhookRouter.post('/plivo/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Plivo status webhook received');

    const { CallUUID, CallStatus, Duration, HangupCause } = req.body;

    const statusMap: Record<string, string> = {
      queued: 'RINGING',
      ringing: 'RINGING',
      'in-progress': 'IN_PROGRESS',
      completed: 'COMPLETED',
      answer: 'IN_PROGRESS',
      busy: 'FAILED',
      'no-answer': 'FAILED',
      failed: 'FAILED',
      rejected: 'FAILED',
    };
    const mapped = statusMap[(CallStatus || '').toLowerCase()] || (CallStatus || '').toUpperCase() || 'UNKNOWN';
    const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(mapped);

    const setClauses: string[] = ['status = $1'];
    const values: any[] = [mapped];
    let p = 2;
    if (isTerminal) setClauses.push(`ended_at = NOW()`);
    if (Duration) {
      setClauses.push(`duration_seconds = $${p}`);
      values.push(parseInt(Duration));
      p++;
    }
    if (HangupCause) {
      setClauses.push(`metadata = COALESCE(metadata, '{}') || $${p}`);
      values.push(JSON.stringify({ plivo_hangup_cause: HangupCause }));
      p++;
    }
    values.push(CallUUID);

    const result = await pool.query(
      `UPDATE calls SET ${setClauses.join(', ')} WHERE provider_call_sid = $${p} RETURNING tenant_id, conversation_id, agent_id`,
      values
    );

    if (isTerminal && result.rows.length > 0) {
      const { tenant_id: tenantId, conversation_id: conversationId, agent_id: agentId } = result.rows[0];
      if (conversationId) {
        try {
          await fetch(`${config.conversationServiceUrl}/api/v1/conversations/${conversationId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
            body: JSON.stringify({ status: 'ENDED', duration_seconds: Duration ? parseInt(Duration) : 0 }),
          });
          await fetch(`${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/analyze`, {
            method: 'POST',
            headers: { 'x-tenant-id': tenantId },
          });
        } catch (err: any) {
          logger.warn({ err: err.message }, 'Failed to finalize Plivo conversation');
        }
      }
      // Fire post-call actions in background (non-blocking)
      if (agentId) {
        void firePostCallActions(tenantId, agentId, conversationId, CallUUID);
      }
      // Update campaign target row if this call belongs to a campaign
      void updateTargetFromCallEnd(
        CallUUID,
        mapped === 'COMPLETED' ? 'COMPLETED' : mapped === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        conversationId
      );
      // Update lead_recall_queue if this call originated from a recall dial.
      // Classifies HangupCause → CONNECTED / NO_ANSWER / BUSY / REJECTED so
      // recallScheduler decides whether to retry or stop.
      void updateRecallQueueFromCallEnd(
        CallUUID,
        mapped,
        String(HangupCause || ''),
        Duration ? parseInt(Duration) : 0,
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/recording — Plivo posts recording URL when call completes.
 */
webhookRouter.post('/plivo/recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'Plivo recording webhook received');
    const { CallUUID, RecordUrl, RecordingID } = req.body;
    if (!RecordUrl) {
      res.status(200).json({ received: true });
      return;
    }
    await pool.query(
      `UPDATE calls SET recording_url = $1, metadata = COALESCE(metadata, '{}') || $2 WHERE provider_call_sid = $3`,
      [RecordUrl, JSON.stringify({ plivo_recording_id: RecordingID, plivo_recording_url: RecordUrl }), CallUUID]
    );
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/sms-status — Plivo posts message-delivery updates here.
 * Body (form-encoded): MessageUUID, Status, From, To, ErrorCode, etc.
 * Status flow: queued → sent → delivered (success) | failed | undelivered.
 * We update communication_logs.status so the brochure modal stops showing a
 * misleading "sent" when Indian carriers actually rejected for DLT.
 */
webhookRouter.post('/plivo/sms-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const uuid = body.MessageUUID || body.message_uuid;
    const plivoStatus = String(body.Status || body.status || '').toLowerCase();
    const errCode = body.ErrorCode || body.error_code || null;
    const errMsg = body.ErrorMessage || body.error_message || null;
    if (!uuid) {
      logger.warn({ body }, 'Plivo sms-status webhook missing MessageUUID');
      res.status(200).json({ received: true });
      return;
    }
    // Map Plivo states to our log states.
    let logStatus: string | null = null;
    if (plivoStatus === 'delivered') logStatus = 'delivered';
    else if (plivoStatus === 'failed' || plivoStatus === 'undelivered' || plivoStatus === 'rejected') logStatus = 'failed';
    else if (plivoStatus === 'sent') logStatus = 'sent';
    logger.info({ uuid, plivoStatus, logStatus, errCode, errMsg }, 'Plivo SMS status callback');
    if (!logStatus) {
      res.status(200).json({ received: true });
      return;
    }
    // Match the log row by message_uuid stored inside provider_response.
    // The send helper writes Plivo's response (which contains message_uuid[]).
    await pool.query(
      `UPDATE communication_logs
         SET status = $1::text,
             delivered_at = CASE WHEN $1::text = 'delivered' THEN NOW() ELSE delivered_at END,
             last_error = CASE WHEN $1::text = 'failed'
                                THEN COALESCE($2::text, last_error)
                                ELSE last_error END
       WHERE channel = 'sms'
         AND provider_response->'message_uuid' ? $3`,
      [logStatus, errCode && errMsg ? `Plivo ${errCode}: ${errMsg}` : (errMsg || errCode || null), uuid]
    );
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/whatsapp-status — Plivo WhatsApp delivery callbacks.
 * Same wire format as sms-status but channel='whatsapp' in our log table.
 * Plivo WhatsApp adds a `read` state when the recipient opens the message,
 * which we map to communication_logs.read_at.
 */
webhookRouter.post('/plivo/whatsapp-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const uuid = body.MessageUUID || body.message_uuid;
    const plivoStatus = String(body.Status || body.status || '').toLowerCase();
    const errCode = body.ErrorCode || body.error_code || null;
    const errMsg = body.ErrorMessage || body.error_message || null;
    if (!uuid) {
      logger.warn({ body }, 'Plivo whatsapp-status webhook missing MessageUUID');
      res.status(200).json({ received: true });
      return;
    }
    let logStatus: string | null = null;
    let setReadAt = false;
    if (plivoStatus === 'delivered') logStatus = 'delivered';
    else if (plivoStatus === 'read') { logStatus = 'read'; setReadAt = true; }
    else if (plivoStatus === 'failed' || plivoStatus === 'undelivered' || plivoStatus === 'rejected') logStatus = 'failed';
    else if (plivoStatus === 'sent') logStatus = 'sent';
    logger.info({ uuid, plivoStatus, logStatus, errCode, errMsg }, 'Plivo WhatsApp status callback');
    if (!logStatus) {
      res.status(200).json({ received: true });
      return;
    }
    await pool.query(
      `UPDATE communication_logs
         SET status = $1::text,
             delivered_at = CASE WHEN $1::text IN ('delivered','read') THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
             read_at = CASE WHEN $4::boolean THEN NOW() ELSE read_at END,
             last_error = CASE WHEN $1::text = 'failed'
                                THEN COALESCE($2::text, last_error)
                                ELSE last_error END
       WHERE channel = 'whatsapp'
         AND provider_response->'message_uuid' ? $3`,
      [logStatus, errCode && errMsg ? `Plivo ${errCode}: ${errMsg}` : (errMsg || errCode || null), uuid, setReadAt]
    );
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/whatsapp-inbound — incoming WhatsApp message from a
 * contact. We log it as an inbound row in communication_logs so the CRM
 * lead-detail view can show the conversation thread. The recipient (us) is
 * the tenant's WhatsApp sender; the From is the lead's phone.
 *
 * NOTE — we don't auto-route replies into the AI agent here. That's a
 * Phase 2 item (chatbot inbox). For now this is a passive record so nothing
 * is lost while we ship the rest of the comms stack.
 */
webhookRouter.post('/plivo/whatsapp-inbound', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const from = body.From || body.from || '';        // lead's phone
    const to = body.To || body.to || '';              // tenant's WA sender
    const text = body.Text || body.text || body.Body || '';
    const uuid = body.MessageUUID || body.message_uuid || null;
    if (!from || !to) {
      logger.warn({ body }, 'Plivo whatsapp-inbound webhook missing From/To');
      res.status(200).json({ received: true });
      return;
    }
    // Find which tenant owns this WA sender — look up tenant_plivo_integrations
    // by whatsapp_sender match. Stripped digits comparison so '+91…' vs '91…'
    // both work.
    const toDigits = String(to).replace(/\D/g, '');
    const tenantRow = await pool.query(
      `SELECT tenant_id FROM tenant_plivo_integrations
        WHERE regexp_replace(COALESCE(whatsapp_sender, ''), '\\D', '', 'g') = $1
        LIMIT 1`,
      [toDigits],
    );
    if (!tenantRow.rows.length) {
      logger.warn({ to, toDigits }, 'Plivo whatsapp-inbound: no tenant matched WhatsApp sender');
      res.status(200).json({ received: true });
      return;
    }
    const tenantId = tenantRow.rows[0].tenant_id;
    await pool.query(
      `INSERT INTO communication_logs
         (tenant_id, channel, provider, recipient, message, status, provider_response, sent_at)
       VALUES ($1, 'whatsapp_inbound', 'plivo', $2, $3, 'received', $4::jsonb, NOW())`,
      [tenantId, from, text, JSON.stringify({ message_uuid: uuid, from, to })],
    );
    logger.info({ tenantId, from, len: text.length }, 'Plivo WhatsApp inbound logged');

    // Auto-reply via AI agent if a number+agent is linked
    if (text.trim()) {
      try {
        const agentRow = await pool.query(
          `SELECT agent_id FROM phone_numbers
           WHERE tenant_id = $1 AND is_active = TRUE AND agent_id IS NOT NULL
           ORDER BY deployed_at DESC NULLS LAST LIMIT 1`,
          [tenantId],
        );
        const waAgentId = agentRow.rows[0]?.agent_id;
        if (waAgentId) {
          const result = await routeInboundToAI({
            tenantId, agentId: waAgentId, from, text,
            channel: 'whatsapp',
            replyTo: to,
          });
          if (result.replied) {
            logger.info({ tenantId, from, replyLen: result.replyText?.length }, 'WhatsApp AI auto-reply sent');
          }
        }
      } catch (e: any) {
        logger.warn({ err: e.message }, 'WhatsApp AI auto-reply failed (non-fatal)');
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared AI auto-reply helper for inbound SMS and WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

async function routeInboundToAI(opts: {
  tenantId: string;
  agentId: string;
  from: string;
  text: string;
  channel: 'sms' | 'whatsapp';
  replyTo: string;
}): Promise<{ replied: boolean; replyText?: string }> {
  try {
    const fromDigits = String(opts.from).replace(/\D/g, '');
    const aiResp = await fetch('http://localhost:8000/chat/simple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: opts.agentId,
        tenant_id: opts.tenantId,
        message: opts.text,
        conversation_id: `${opts.channel}-${fromDigits}`,
        metadata: { channel: opts.channel, from: opts.from },
      }),
    });
    if (!aiResp.ok) {
      logger.warn({ status: aiResp.status, channel: opts.channel }, 'AI runtime returned non-200 for inbound reply');
      return { replied: false };
    }
    const aiData: any = await aiResp.json().catch(() => ({}));
    const replyText = String(aiData.response || aiData.message || aiData.reply || '').trim();
    if (!replyText || replyText.length < 2) return { replied: false };

    const smsUrl = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Message/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const callbackPath = opts.channel === 'whatsapp' ? 'whatsapp-status' : 'sms-status';
    const payload: Record<string, any> = {
      src: opts.replyTo,
      dst: opts.from,
      text: replyText.slice(0, 1600),
      url: `${config.publicBaseUrl}/webhooks/plivo/${callbackPath}`,
      method: 'POST',
    };
    if (opts.channel === 'whatsapp') {
      payload.type = 'whatsapp';
    }

    const sendResp = await fetch(smsUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (sendResp.ok) {
      const sendData: any = await sendResp.json().catch(() => ({}));
      const msgUuid = sendData.message_uuid?.[0] || sendData.message_uuid || '';
      // Log the outbound reply
      await pool.query(
        `INSERT INTO communication_logs
           (tenant_id, channel, provider, recipient, message, status, provider_response, sent_at)
         VALUES ($1, $2, 'plivo', $3, $4, 'sent', $5::jsonb, NOW())`,
        [opts.tenantId, opts.channel, opts.from, replyText.slice(0, 1600),
         JSON.stringify({ message_uuid: msgUuid, auto_reply: true })],
      );
      return { replied: true, replyText };
    }
    logger.warn({ status: sendResp.status, channel: opts.channel }, 'Plivo reply send failed');
    return { replied: false };
  } catch (err: any) {
    logger.warn({ err: err.message, channel: opts.channel }, 'routeInboundToAI error');
    return { replied: false };
  }
}

/**
 * POST /webhooks/plivo/sms-inbound — incoming SMS from a contact.
 * Logs the message, looks up the assigned AI agent, generates an AI reply,
 * and sends it back via Plivo SMS API.
 */
webhookRouter.post('/plivo/sms-inbound', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const from = body.From || body.from || '';
    const to = body.To || body.to || '';
    const text = body.Text || body.text || body.Body || '';
    const uuid = body.MessageUUID || body.message_uuid || null;
    if (!from || !to) {
      logger.warn({ body }, 'Plivo sms-inbound webhook missing From/To');
      res.status(200).json({ received: true });
      return;
    }

    // Find which tenant + agent owns the destination number
    const toDigits = String(to).replace(/\D/g, '');
    const phoneRow = await pool.query(
      `SELECT tenant_id, agent_id FROM phone_numbers
       WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1 AND is_active = TRUE
       LIMIT 1`,
      [toDigits],
    );
    if (!phoneRow.rows.length) {
      logger.warn({ to, toDigits }, 'Plivo sms-inbound: no tenant matched number');
      res.status(200).json({ received: true });
      return;
    }
    const { tenant_id: tenantId, agent_id: agentId } = phoneRow.rows[0];

    // Log inbound message
    await pool.query(
      `INSERT INTO communication_logs
         (tenant_id, channel, provider, recipient, message, status, provider_response, sent_at)
       VALUES ($1, 'sms_inbound', 'plivo', $2, $3, 'received', $4::jsonb, NOW())`,
      [tenantId, from, text, JSON.stringify({ message_uuid: uuid, from, to })],
    );
    logger.info({ tenantId, from, len: text.length }, 'Plivo SMS inbound logged');

    // AI auto-reply if agent is assigned
    if (agentId && text.trim()) {
      try {
        const result = await routeInboundToAI({
          tenantId, agentId, from, text,
          channel: 'sms',
          replyTo: to,
        });
        if (result.replied) {
          logger.info({ tenantId, from, replyLen: result.replyText?.length }, 'SMS AI auto-reply sent');
        }
      } catch (e: any) {
        logger.warn({ err: e.message }, 'SMS AI auto-reply failed (non-fatal)');
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/machine-detection — AMD callback.
 * Plivo fires this when machine_detection=true was set on an outbound call.
 * Body: CallUUID, Machine (true/false), MachineDetectionDuration
 */
webhookRouter.post('/plivo/machine-detection', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const callUuid = body.CallUUID || body.call_uuid || '';
    const machineRaw = body.Machine || body.machine || '';
    const duration = body.MachineDetectionDuration || body.machine_detection_duration || 0;
    const isMachine = machineRaw === true || machineRaw === 'true' || machineRaw === 'machine';
    const amdResult = isMachine ? 'machine' : 'human';

    logger.info({ callUuid, amdResult, duration }, 'Plivo AMD callback');

    if (callUuid) {
      await pool.query(
        `UPDATE calls SET metadata = COALESCE(metadata, '{}')::jsonb || $1::jsonb WHERE provider_call_sid = $2`,
        [JSON.stringify({ amd_result: amdResult, amd_duration: duration }), callUuid],
      );
      // Update campaign target if this was a campaign call
      await pool.query(
        `UPDATE campaign_targets SET metadata = COALESCE(metadata, '{}')::jsonb || $1::jsonb
         WHERE call_sid = $2`,
        [JSON.stringify({ amd_result: amdResult }), callUuid],
      ).catch(() => {});
    }
    res.status(200).json({ received: true, amd_result: amdResult });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhooks/plivo/conference-event — conference room lifecycle events.
 * Events: ConferenceEnter, ConferenceExit, ConferenceDigit, ConferenceRecording,
 *         ConferenceFloor, ConferenceSpeaking
 */
webhookRouter.post('/plivo/conference-event', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const event = body.Event || body.event || '';
    const conferenceName = body.ConferenceName || body.conference_name || '';
    const conferenceUuid = body.ConferenceUUID || body.conference_uuid || '';
    const memberIdRaw = body.ConferenceMemberID || body.conference_member_id || '';
    const callUuid = body.CallUUID || body.call_uuid || '';

    logger.info({ event, conferenceName, conferenceUuid, memberIdRaw, callUuid }, 'Plivo conference event');

    if (event === 'ConferenceRecording') {
      const recordUrl = body.RecordUrl || body.record_url || '';
      const recordingId = body.RecordingID || body.recording_id || '';
      if (recordUrl) {
        await pool.query(
          `UPDATE calls SET recording_url = $1,
             metadata = COALESCE(metadata, '{}')::jsonb || $2::jsonb
           WHERE provider_call_sid = $3`,
          [recordUrl, JSON.stringify({
            conference_recording_id: recordingId,
            conference_name: conferenceName,
          }), callUuid],
        ).catch(() => {});
      }
    }

    res.status(200).json({ received: true, event });
  } catch (err) {
    next(err);
  }
});

/**
 * Classify a Plivo HangupCause + Plivo CallStatus into a recall outcome and
 * write it into lead_recall_queue. The recall scheduler (in conversation-
 * service) reads these rows on its 60s tick to decide whether to retry.
 *
 * Mapping (Plivo HangupCause docs):
 *   NORMAL_CLEARING + Duration>0   → CONNECTED (caller talked)
 *   NO_USER_RESPONSE / NO_ANSWER   → NO_ANSWER
 *   USER_BUSY                      → BUSY
 *   CALL_REJECTED                  → REJECTED
 *   SUBSCRIBER_ABSENT / SWITCHED_OFF → SWITCHED_OFF
 *   anything else with FAILED      → FAILED
 */
async function updateRecallQueueFromCallEnd(
  providerCallSid: string,
  mappedStatus: string,
  hangupCause: string,
  durationSeconds: number,
): Promise<void> {
  try {
    // Resolve which phone this call dialed so we can find the recall row.
    const callRow = await pool.query(
      `SELECT called_number, tenant_id FROM calls WHERE provider_call_sid = $1 LIMIT 1`,
      [providerCallSid],
    );
    if (!callRow.rows.length) return;
    const phone = callRow.rows[0].called_number;
    if (!phone) return;
    const digits = String(phone).replace(/\D/g, '');

    // Decide outcome.
    const cause = hangupCause.toUpperCase();
    let outcome: string;
    if (mappedStatus === 'COMPLETED' && durationSeconds > 5) outcome = 'CONNECTED';
    else if (cause.includes('NO_USER_RESPONSE') || cause.includes('NO_ANSWER')) outcome = 'NO_ANSWER';
    else if (cause.includes('USER_BUSY') || cause === 'BUSY') outcome = 'BUSY';
    else if (cause.includes('CALL_REJECTED') || cause.includes('REJECTED')) outcome = 'REJECTED';
    else if (cause.includes('SUBSCRIBER_ABSENT') || cause.includes('SWITCHED_OFF')) outcome = 'SWITCHED_OFF';
    else outcome = mappedStatus === 'COMPLETED' ? 'CONNECTED' : 'FAILED';

    // For CONNECTED → close the recall (stop further retries).
    if (outcome === 'CONNECTED') {
      await pool.query(
        `UPDATE lead_recall_queue
            SET state = 'COMPLETED', last_call_status = 'CONNECTED',
                last_attempt_at = NOW(), updated_at = NOW()
          WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1
            AND state IN ('PENDING', 'IN_FLIGHT')`,
        [digits],
      );
    } else {
      // No-answer / busy / rejected etc. — push back to PENDING so the next
      // tick computes the next slot via computeNextSlot(retry_count).
      // retry_count was already bumped when we marked IN_FLIGHT.
      await pool.query(
        `UPDATE lead_recall_queue
            SET state = 'PENDING', last_call_status = $2,
                last_attempt_at = NOW(), retry_reason = $3, updated_at = NOW()
          WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1
            AND state = 'IN_FLIGHT'`,
        [digits, outcome, cause || null],
      );
    }
    logger.info({ providerCallSid, phone, outcome, cause }, 'recall queue updated from call end');
  } catch (err: any) {
    logger.warn({ providerCallSid, err: err.message }, 'updateRecallQueueFromCallEnd failed');
  }
}
