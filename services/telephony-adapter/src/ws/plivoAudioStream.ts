/**
 * Plivo AudioStream WebSocket bridge.
 *
 * Used when Plivo's built-in speech-recognition (<GetInput inputType="speech">)
 * is NOT available on the account (pending KYC / no speech entitlement).
 * Instead we hand Plivo a <Stream> element pointing to THIS WS endpoint,
 * then do STT/TTS ourselves:
 *
 *   Plivo  ──(audio)──>  this WS  ──>  Deepgram STT (nova-2, streaming)
 *                                                     │
 *                                                     ▼  final transcript
 *                                               ai-runtime /chat/simple
 *                                                     │
 *                                                     ▼  reply text
 *                                              Deepgram Aura TTS (mulaw 8k)
 *                                                     │
 *                                                     ▼  base64 mulaw
 *   Plivo  <─(playAudio)── this WS
 *
 * Messages persisted via conversation-service (same as /plivo/gather path),
 * call row inserted into `calls` (conversation_id + provider_call_sid). Plivo
 * keeps the audio recording going at the carrier level (record=true on dial),
 * so /webhooks/plivo/recording still fires on hangup.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import pino from 'pino';
import { pool } from '../index';
import { config } from '../config';
import { buildVoiceAgentPrompt } from '../prompts/voiceAgent';
import { recordingsDir } from '../routes/recordings';
import { startAzureStt, synthesizeAzureTtsMulaw, deepgramCanHandle, azureSpeechConfigured, AzureSttHandle } from '../providers/azureSpeech';
import { startSarvamStt, synthesizeSarvamTtsMulaw, sarvamCanHandle, sarvamConfigured, callSarvamLLM, SarvamSttHandle } from '../providers/sarvamSpeech';
import { plivoProvider } from '../providers/plivo.provider';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

// ---- helpers ----------------------------------------------------------------

function firstNonEmpty(...vals: (string | null | undefined)[]): string {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

async function loadAgent(agentId: string, tenantId: string): Promise<any | null> {
  try {
    const raw = process.env.AGENT_SERVICE_URL || 'http://localhost:3001/api/v1';
    const base = raw.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    const url = `${base}/api/v1/agents/${agentId}`;
    const resp = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data as any).data ?? data;
  } catch {
    return null;
  }
}

async function createConversation(
  agentId: string,
  tenantId: string,
  callerNumber: string,
  calledNumber: string,
  callSid: string,
  language: string
): Promise<string | null> {
  try {
    const resp = await fetch(`${config.conversationServiceUrl}/api/v1/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({
        agent_id: agentId,
        channel: 'PHONE',
        caller_number: callerNumber,
        called_number: calledNumber,
        call_sid: callSid,
        language,
      }),
    });
    if (!resp.ok) return null;
    const d = (await resp.json()) as { id: string };
    return d.id || null;
  } catch {
    return null;
  }
}

async function appendMessage(
  conversationId: string,
  tenantId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  try {
    await fetch(`${config.conversationServiceUrl}/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ role, content }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Pick the best LLM path for this call and call it.
 *
 * Priority:
 *   1. When the call is in an Indic language AND Sarvam is configured →
 *      call Sarvam-M directly. It natively understands Telugu/Hindi/etc. AND
 *      avoids ai-runtime's Google/OpenAI providers which currently 429 out.
 *   2. Otherwise → ai-runtime /chat/simple with the agent's configured provider
 *      (Gemini / Claude / OpenAI depending on config).
 *   3. Anything fails → empty string (caller uses a "sorry, could you repeat"
 *      fallback).
 */
async function callLLM(
  agent: any,
  history: Array<{ role: string; content: string }>,
  customerName: string | null,
  callType: string | null,
  language?: string | null,
): Promise<string> {
  const basePrompt = agent.system_prompt || 'helpful customer conversation';
  const systemPrompt = buildVoiceAgentPrompt(basePrompt, agent, {
    customerName,
    callType,
    language: language || undefined,
  });

  // Indic path: call Sarvam directly.
  const isIndic = language && !/^en/i.test(language) && sarvamCanHandle(language);
  if (isIndic && sarvamConfigured()) {
    const sarvamReply = await callSarvamLLM({
      systemPrompt,
      messages: history,
      temperature: parseFloat(agent.temperature) || 0.7,
    });
    if (sarvamReply) return sarvamReply;
    // Sarvam failed for some reason — fall through to ai-runtime so we at
    // least attempt the configured provider before giving up.
  }

  try {
    const aiRuntimeUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';
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
    const data = (await resp.json()) as { reply?: string; mock?: boolean };
    // Don't serve the mock-provider's canned replies — better to retry with
    // Sarvam as a last-resort even for English agents when their LLM is down.
    if (data.mock && sarvamConfigured()) {
      const fallback = await callSarvamLLM({
        systemPrompt,
        messages: history,
        temperature: parseFloat(agent.temperature) || 0.7,
      });
      if (fallback) return fallback;
    }
    return (data.reply || '').trim();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'callLLM failed in stream handler');
    return '';
  }
}

/** Deepgram Aura TTS → base64 mulaw 8000hz bytes (ready to send as Plivo playAudio). */
async function ttsDeepgramMulaw(text: string, voiceIdRaw?: string): Promise<string | null> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;
  const clean = (text || '').trim();
  if (!clean) return null;

  const voiceMap: Record<string, string> = {
    rachel: 'aura-asteria-en', bella: 'aura-luna-en', nova: 'aura-asteria-en',
    shimmer: 'aura-luna-en', asteria: 'aura-asteria-en', luna: 'aura-luna-en',
    stella: 'aura-stella-en', hera: 'aura-hera-en', athena: 'aura-athena-en',
    adam: 'aura-orion-en', josh: 'aura-arcas-en', onyx: 'aura-zeus-en',
    echo: 'aura-orion-en', fable: 'aura-orpheus-en', orion: 'aura-orion-en',
    arcas: 'aura-arcas-en', perseus: 'aura-perseus-en', angus: 'aura-angus-en',
    orpheus: 'aura-orpheus-en', helios: 'aura-helios-en', zeus: 'aura-zeus-en',
    alloy: 'aura-orion-en',
  };
  const model = voiceMap[(voiceIdRaw || '').toLowerCase()] || 'aura-asteria-en';
  try {
    const resp = await fetch(
      `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mulaw&sample_rate=8000&container=none`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean.slice(0, 1900) }),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: errText.slice(0, 200) }, 'Deepgram TTS (mulaw) failed');
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 200) return null;
    return buf.toString('base64');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Deepgram TTS (mulaw) error');
    return null;
  }
}

// ---- session state ---------------------------------------------------------

interface StreamSession {
  callSid: string;
  agentId: string;
  tenantId: string;
  agent: any | null;
  callerNumber: string;
  calledNumber: string;
  conversationId: string | null;
  streamId: string | null;
  language: string;          // agent voice_config.language, normalized
  sttBackend: 'deepgram' | 'azure' | 'sarvam' | null;
  ttsBackend: 'deepgram' | 'azure' | 'sarvam';
  dgWs: WebSocket | null;
  azureStt: AzureSttHandle | null;
  sarvamStt: SarvamSttHandle | null;
  plivoWs: WebSocket | null;
  history: Array<{ role: string; content: string }>;
  inFlightReply: boolean;
  closed: boolean;
  // Recording: Plivo doesn't record calls that use <Stream> XML (their
  // carrier-level recording is only triggered by <Record>, which is
  // mutually exclusive with <Stream>). So we build a stereo WAV ourselves:
  // left channel = caller audio (inbound frames), right channel = agent
  // audio (our Aura TTS output), aligned by wall-clock position.
  callerMulaw: Buffer[];
  callerBytes: number;             // running count = current timeline position
  agentMulawEvents: Array<{ offsetBytes: number; mulaw: Buffer }>;
  // Barge-in control: while playText() is streaming TTS chunks, this is true.
  // If the caller speaks (substantive utterance, not a filler) during this
  // window, we set bargeInRequested = true and the chunk loop aborts +
  // sends Plivo a clearAudio event to flush whatever's still buffered.
  isAgentSpeaking: boolean;
  bargeInRequested: boolean;
  // End-of-call latch: once the caller says goodbye / thank-you-bye / cut
  // the call, we set this and stop firing the LLM on any further utterances.
  // The caller still controls the actual hangup; we just stop talking.
  callEnded: boolean;
}

// ---- main setup ------------------------------------------------------------

export function setupPlivoAudioStream(server: http.Server): WebSocketServer {
  // noServer — see ws/mediaStream.ts for the reason. Upgrades are dispatched
  // from a single listener in index.ts based on req.url pathname.
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (plivoWs: WebSocket, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const agentId = url.searchParams.get('agentId') || '';
    const tenantId = url.searchParams.get('tenantId') || '';
    // Plivo's start event body doesn't carry caller/called numbers on all
    // account tiers, so we accept them via URL params (set by /plivo/voice).
    const callerFromUrl = url.searchParams.get('from') || '';
    const calledFromUrl = url.searchParams.get('to') || '';
    const callSidFromUrl = url.searchParams.get('callSid') || '';

    const session: StreamSession = {
      callSid: callSidFromUrl,
      agentId,
      tenantId,
      agent: null,
      callerNumber: callerFromUrl,
      calledNumber: calledFromUrl,
      conversationId: null,
      streamId: null,
      language: 'en-IN',
      sttBackend: null,
      ttsBackend: 'deepgram',
      dgWs: null,
      azureStt: null,
      sarvamStt: null,
      plivoWs: plivoWs,
      history: [],
      inFlightReply: false,
      closed: false,
      callerMulaw: [],
      callerBytes: 0,
      agentMulawEvents: [],
      isAgentSpeaking: false,
      bargeInRequested: false,
      callEnded: false,
    };

    logger.info({ agentId, tenantId }, 'Plivo audio stream WS connected');

    plivoWs.on('message', async (data: RawData) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const event = msg.event;

      if (event === 'start') {
        // Prefer values from the WS URL (set by /plivo/voice), fall back to
        // anything Plivo included in the start payload.
        session.callSid = session.callSid || msg.start?.callId || msg.callId || msg.start?.streamId || '';
        session.streamId = msg.start?.streamId || msg.streamId || null;
        session.callerNumber = session.callerNumber || msg.start?.from || msg.from || '';
        session.calledNumber = session.calledNumber || msg.start?.to || msg.to || '';
        logger.info(
          { callSid: session.callSid, streamId: session.streamId, from: session.callerNumber, to: session.calledNumber },
          'Plivo stream started'
        );
        await onStart(plivoWs, session);
      } else if (event === 'media') {
        // base64 mulaw 8kHz from Plivo → forward to whichever STT is live
        const payload = msg.media?.payload;
        if (payload) {
          const audioBuf = Buffer.from(payload, 'base64');
          session.callerMulaw.push(audioBuf);
          session.callerBytes += audioBuf.length;
          if (session.sttBackend === 'deepgram' && session.dgWs && session.dgWs.readyState === WebSocket.OPEN) {
            session.dgWs.send(audioBuf);
          } else if (session.sttBackend === 'azure' && session.azureStt) {
            session.azureStt.push(audioBuf);
          } else if (session.sttBackend === 'sarvam' && session.sarvamStt) {
            session.sarvamStt.push(audioBuf);
          }
        }
      } else if (event === 'stop') {
        logger.info({ callSid: session.callSid }, 'Plivo stream stopped');
        await onStop(session);
      }
    });

    plivoWs.on('close', async () => {
      logger.info({ callSid: session.callSid }, 'Plivo stream WS closed');
      await onStop(session);
    });

    plivoWs.on('error', (err) => {
      logger.warn({ callSid: session.callSid, err: err.message }, 'Plivo stream WS error');
    });
  });

  logger.info('Plivo AudioStream server attached at /plivo/audio');
  return wss;
}

// ---- event handlers --------------------------------------------------------

async function onStart(plivoWs: WebSocket, session: StreamSession): Promise<void> {
  // Load agent (the query params carry agentId/tenantId from the XML we emitted)
  session.agent = await loadAgent(session.agentId, session.tenantId);
  if (!session.agent) {
    logger.warn({ agentId: session.agentId }, 'Stream handler: agent load failed');
    // Play a short error + hang up the stream (Plivo will end the call)
    await playText(plivoWs, session, "Sorry, the assistant is not available right now. Goodbye.");
    try { plivoWs.close(); } catch { /* ignore */ }
    return;
  }

  const lang = firstNonEmpty(session.agent.voice_config?.language, session.agent.voiceConfig?.language) || 'en-IN';
  session.language = lang;
  // Backend selection priority for non-English/Indic languages:
  //   1) Sarvam    — best Indic quality; native neural voices for te/ta/hi/kn/ml/mr/bn/gu/pa
  //   2) Azure     — fallback, also covers Indic
  //   3) Deepgram  — default for English and other Deepgram-native languages
  let stt: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  let tts: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  if (!deepgramCanHandle(lang)) {
    if (sarvamConfigured() && sarvamCanHandle(lang)) {
      stt = 'sarvam'; tts = 'sarvam';
    } else if (azureSpeechConfigured()) {
      stt = 'azure'; tts = 'azure';
    }
    // else: falls through to deepgram (en-IN approximation)
  }
  session.sttBackend = stt;
  session.ttsBackend = tts;
  logger.info({ callSid: session.callSid, language: lang, stt, tts }, 'Stream: backends chosen');

  // Create conversation + insert call row so transcripts + recording land in
  // the same places as the <GetInput> path.
  session.conversationId = await createConversation(
    session.agentId,
    session.tenantId,
    session.callerNumber,
    session.calledNumber,
    session.callSid,
    lang
  );
  try {
    await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, conversation_id, direction, status, caller_number, called_number, provider, provider_call_sid)
       VALUES ($1,$2,$3,'OUTBOUND','IN_PROGRESS',$4,$5,'plivo',$6)
       ON CONFLICT (provider_call_sid) DO UPDATE SET status='IN_PROGRESS', conversation_id=EXCLUDED.conversation_id,
         caller_number=COALESCE(NULLIF(EXCLUDED.caller_number,''), calls.caller_number),
         called_number=COALESCE(NULLIF(EXCLUDED.called_number,''), calls.called_number)`,
      [session.tenantId, session.agentId, session.conversationId, session.callerNumber, session.calledNumber, session.callSid]
    );
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to upsert call row');
  }

  // Mirror caller/called numbers onto the conversations row so the Call
  // Log UI (which reads from conversations) surfaces them.
  if (session.conversationId && (session.callerNumber || session.calledNumber)) {
    try {
      await pool.query(
        `UPDATE conversations
         SET caller_number = COALESCE(NULLIF($1,''), caller_number),
             called_number = COALESCE(NULLIF($2,''), called_number)
         WHERE id = $3 AND tenant_id = $4`,
        [session.callerNumber, session.calledNumber, session.conversationId, session.tenantId]
      );
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to mirror caller/called onto conversation');
    }
  }

  // Open the chosen STT backend. All onFinal callbacks route through
  // dispatchUserUtterance which ALWAYS appends the caller's words to the
  // transcript (never dropped) and then decides whether to trigger a new
  // LLM reply based on whether the agent is already mid-reply.
  if (session.sttBackend === 'sarvam') {
    session.sarvamStt = startSarvamStt({
      language: lang,
      onFinal: (text) => dispatchUserUtterance(session, text),
      onError: (msg) => logger.warn({ callSid: session.callSid, err: msg }, 'Sarvam STT error'),
    });
    logger.info({ callSid: session.callSid }, 'Sarvam STT opened');
  } else if (session.sttBackend === 'azure') {
    session.azureStt = startAzureStt({
      language: lang,
      onFinal: (text) => dispatchUserUtterance(session, text),
      onError: (msg) => logger.warn({ callSid: session.callSid, err: msg }, 'Azure STT error'),
    });
    logger.info({ callSid: session.callSid }, 'Azure STT opened');
  } else {
    await connectDeepgram(session, lang);
  }

  // Seed greeting through LLM so it follows the agent's configured prompt,
  // then stream it to Plivo as our first audio reply.
  const seeded = await callLLM(
    session.agent,
    [
      {
        role: 'user',
        content:
          'The call has just connected. Greet the caller briefly (one short sentence), introduce yourself by your first name only and what you help with, then ask ONE short opening question. Sound like a real human on the phone — no "I am an AI", no lists, one or two sentences max.',
      },
    ],
    null,
    'outbound',
    session.language,
  );
  const greeting = (seeded && seeded.trim()) || session.agent.greeting_message || 'Hey there — how can I help you today?';
  if (session.conversationId) {
    await appendMessage(session.conversationId, session.tenantId, 'assistant', greeting);
  }
  session.history.push({ role: 'assistant', content: greeting });
  await playText(plivoWs, session, greeting);
}

async function onStop(session: StreamSession): Promise<void> {
  if (session.closed) return;
  session.closed = true;
  if (session.dgWs && session.dgWs.readyState === WebSocket.OPEN) {
    try { session.dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
    try { session.dgWs.close(); } catch { /* ignore */ }
  }
  session.dgWs = null;
  if (session.azureStt) {
    try { session.azureStt.close(); } catch { /* ignore */ }
    session.azureStt = null;
  }
  if (session.sarvamStt) {
    try { session.sarvamStt.close(); } catch { /* ignore */ }
    session.sarvamStt = null;
  }
  // Write the stereo WAV and update calls.recording_url — fire-and-forget
  // so close latency doesn't block Plivo's stream-teardown.
  finalizeRecording(session).catch(() => { /* logged inside */ });
}

// ---- Deepgram bridge -------------------------------------------------------

async function connectDeepgram(session: StreamSession, language: string): Promise<void> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    logger.warn('DEEPGRAM_API_KEY missing — stream handler cannot STT');
    return;
  }

  // Deepgram nova-2 only supports a specific set of language codes. The agent
  // may be configured with languages Deepgram can't handle (e.g. Telugu te-IN);
  // fall back to en-IN which tolerates mixed Indian English reasonably well.
  // Official supported-model matrix: https://developers.deepgram.com/docs/models-languages-overview
  const DG_SUPPORTED = new Set([
    'en', 'en-US', 'en-GB', 'en-AU', 'en-NZ', 'en-IN',
    'es', 'es-419', 'fr', 'fr-CA', 'de', 'hi', 'hi-Latn',
    'it', 'ja', 'ko', 'nl', 'pt', 'pt-BR', 'ru', 'sv', 'tr', 'uk', 'zh',
    'multi',
  ]);
  const raw = (language || 'en-IN').trim();
  let dgLang = DG_SUPPORTED.has(raw) ? raw : '';
  if (!dgLang) {
    const short = raw.slice(0, 2).toLowerCase();
    dgLang = DG_SUPPORTED.has(short) ? short : 'en-IN';
    if (dgLang !== raw) {
      logger.info({ callSid: session.callSid, requested: raw, using: dgLang }, 'Deepgram: falling back to supported language');
    }
  }
  const qs = new URLSearchParams({
    model: 'nova-2',
    encoding: 'mulaw',
    sample_rate: '8000',
    interim_results: 'false',  // we only care about finals here — lower latency overall
    smart_format: 'true',
    endpointing: '600',         // ms of silence before finalising an utterance
    language: dgLang,
    punctuate: 'true',
  });
  const dgUrl = `wss://api.deepgram.com/v1/listen?${qs.toString()}`;
  const dg = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  dg.on('open', () => {
    logger.info({ callSid: session.callSid }, 'Deepgram STT WS opened');
  });

  dg.on('message', async (raw: RawData) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type !== 'Results') return;
      const alt = data.channel?.alternatives?.[0];
      const text = (alt?.transcript || '').trim();
      const isFinal = !!data.is_final;
      if (!text || !isFinal) return;
      // ALWAYS capture the utterance — even if the agent is mid-reply —
      // so the transcript is a complete record of what the caller said.
      // The dispatcher decides whether to also trigger a new LLM reply.
      await dispatchUserUtterance(session, text);
    } catch {
      /* ignore malformed frames */
    }
  });

  dg.on('close', () => {
    logger.info({ callSid: session.callSid }, 'Deepgram STT WS closed');
  });

  dg.on('error', (err) => {
    logger.warn({ callSid: session.callSid, err: err.message }, 'Deepgram STT WS error');
  });

  session.dgWs = dg;
}

// ---- turn handling ---------------------------------------------------------

/**
 * Route a final STT result into the transcript. ALWAYS persists the
 * caller's words (so we never lose a turn from the recording → transcript
 * alignment even if the agent is mid-reply). If the agent is idle, fire
 * a new LLM turn; otherwise the utterance stays in history + messages
 * and gets picked up when the current reply finishes.
 */
// Common acknowledgement-only utterances across the languages we support.
// When the caller responds with one of these RIGHT after the agent answered
// (and the agent's last turn was not a question), it's a back-channel
// acknowledgement — NOT a new request — and re-firing the LLM on it makes
// the agent re-explain what it just said. We still persist these to the
// transcript for fidelity, but skip the LLM call.
const FILLER_PATTERNS: RegExp[] = [
  // English
  /^(ok|okay|kk?|yes|yeah|yep|yup|right|sure|alright|fine|got it|i see|uh|uh-huh|mm|mmhmm|hmm|hm|nope|no problem|cool|nice|great|true|correct)\b/i,
  // Telugu
  /^(సరే|ఓకే|అవును|హా|ఉమ్|ఆ|హ్మ్|హ్మ|ఉ|హుం|హ|ఎస్|ఓ|హాయ్)/,
  // Hindi
  /^(हाँ|हां|ठीक|ठीक है|अच्छा|अच्छी|हम्म|जी|जी हाँ|हम|हू)/,
  // Tamil
  /^(சரி|ஆமா|ஆம்|ம்|ஓகே|ஓகே சரி|ஹா)/,
  // Kannada
  /^(ಸರಿ|ಹೌದು|ಹಾಂ|ಆಯ್ತು|ಹಾ)/,
  // Malayalam
  /^(ശരി|അതെ|ഉം|ഹം)/,
  // Marathi
  /^(ठीक|बरं|हो|बरोबर)/,
  // Bengali / Gujarati / Punjabi (basic acks)
  /^(হ্যাঁ|ঠিক|હા|ઠીક|ਹਾਂ|ਠੀਕ)/,
];

/**
 * Voice-mode brevity guard: keep at most 2 sentences AND ≤ 45 words. If the
 * reply contains a question, prefer to keep that question even if it's the
 * 3rd sentence — callers should hear "answer + one question", not five
 * paragraphs of encyclopaedia followed by a question that gets cut.
 */
export function trimReplyForVoice(text: string, maxSentences = 2, maxWords = 45): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return trimmed;

  // Split on sentence-ending punctuation across scripts (latin .!? + Devanagari ।॥).
  // Keep the punctuation as part of each piece by using a lookbehind split.
  const sentences = trimmed
    .split(/(?<=[.!?।॥])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return trimmed;

  // Pick the first N sentences; if a later sentence is a question, swap it
  // into the last slot so the agent keeps the call moving instead of just
  // dumping facts.
  let pick = sentences.slice(0, maxSentences);
  if (sentences.length > maxSentences) {
    const tail = sentences.slice(maxSentences).find((s) => /[?？]\s*$/.test(s));
    if (tail) pick[pick.length - 1] = tail;
  }
  let out = pick.join(' ');

  // Hard word cap as a second safety net (handles single-sentence rambles).
  const words = out.split(/\s+/);
  if (words.length > maxWords) {
    out = words.slice(0, maxWords).join(' ').replace(/[,;:]?$/, '');
    if (!/[.!?।॥]$/u.test(out)) out += '.';
  }
  return out.trim();
}

// End-of-call signals across the languages we support. Matched against the
// trimmed user utterance — if any pattern fires, the agent says ONE short
// farewell and refuses to fire the LLM again. Caller still hangs up at their
// own pace; we just stay quiet.
const GOODBYE_PATTERNS: RegExp[] = [
  // English / common Indian-English phrasing.
  // Bare "bye"/"goodbye" / "tata" / "cya" anywhere in the utterance.
  /\b(bye|goodbye|good\s*bye|byee+|tata|cya)\b/i,
  // "thanks" + explicit goodbye token. "thanks for the info" must NOT match,
  // so we require "bye/goodbye" right after thanks/thank you (with optional
  // intensifier in between).
  /\b(thanks|thank\s*you)\s+(so\s+much\s+|a\s+lot\s+|very\s+much\s+)?(bye|goodbye)\b/i,
  // "thanks" alone — only when it's the WHOLE utterance (caller signing off).
  /^(thanks|thank\s*you)\s*[.!]?\s*$/i,
  /\b(that['']?s\s+(it|all)|i['']?m\s+done|i\s+am\s+done|nothing\s+(else|more)|no\s+more|that\s+will\s+be\s+all)\b/i,
  /\b(cut\s+the\s+call|hang\s+up|end\s+the\s+call|disconnect|please\s+stop|stop\s+(it|talking|speaking)|shut\s+up)\b/i,
  // Telugu
  /(బాయ్|వీడ్కోలు|ఇంక\s*చాలు|ఇంక\s*ఇంకేం|ధన్యవాదాలు\s*బాయ్|థాంక్\s*యూ\s*బాయ్|కాల్\s*కట్|కట్\s*చేయి|ఇది\s*చాలు|వద్దు\s*ఇంకేం)/,
  // Hindi
  /(अलविदा|टाटा|बाय|धन्यवाद\s*बाय|बस\s*हो\s*गया|बस\s*इतना|कॉल\s*काटो|बंद\s*करो)/,
  // Tamil
  /(விடைபெறுகிறேன்|பை|நன்றி\s*பை|போதும்|அவ்வளவே)/,
  // Kannada / Malayalam basic
  /(ಬೈ|ಧನ್ಯವಾದಗಳು\s*ಬೈ|ಸಾಕು)/,
  /(വിട|നന്ദി\s*ബൈ|മതി)/,
];

function isGoodbye(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  return GOODBYE_PATTERNS.some((re) => re.test(t));
}

/**
 * Generate a short farewell line dynamically in the caller's language and
 * the agent's persona. We feed the live conversation history so the goodbye
 * can reference what was just discussed if the LLM wants to ("Glad I could
 * help with the temple info — bye!"). Strict brevity guard: ≤ 1 sentence.
 *
 * Falls back to a static line per language if the LLM is unreachable, so
 * the call never hangs in silence after a goodbye is detected.
 */
async function generateFarewell(session: StreamSession, callerGoodbye: string): Promise<string> {
  const lang = (session.language || '').toLowerCase();
  const staticByLang: Record<string, string> = {
    te: 'సరే, కాల్ చేసినందుకు ధన్యవాదాలు. మీ రోజు బాగుండాలి!',
    hi: 'ठीक है, कॉल करने के लिए धन्यवाद। आपका दिन शुभ हो!',
    ta: 'சரி, அழைப்பிற்கு நன்றி. நல்ல நாள்!',
    kn: 'ಸರಿ, ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ಒಳ್ಳೆಯ ದಿನವಾಗಲಿ!',
    ml: 'ശരി, വിളിച്ചതിന് നന്ദി. നല്ല ദിവസം!',
    mr: 'ठीक आहे, कॉल केल्याबद्दल धन्यवाद. तुमचा दिवस छान जावो!',
    bn: 'ঠিক আছে, কল করার জন্য ধন্যবাদ। আপনার দিন শুভ হোক!',
    gu: 'ઠીક છે, કૉલ કરવા બદલ આભાર. તમારો દિવસ સારો જાય!',
    pa: 'ਠੀਕ ਹੈ, ਕਾਲ ਕਰਨ ਲਈ ਧੰਨਵਾਦ। ਤੁਹਾਡਾ ਦਿਨ ਸ਼ੁਭ ਹੋਵੇ!',
  };
  const fallback = staticByLang[lang.slice(0, 2)] || 'Alright, thanks for calling — have a great day!';

  try {
    const reply = await callLLM(
      session.agent,
      [
        ...session.history,
        { role: 'user', content: callerGoodbye },
        {
          role: 'user',
          content:
            `[FAREWELL_MODE] The caller is hanging up. Reply with ONE short, warm farewell in their language (max 8 words). ` +
            `Do NOT ask any question. Do NOT offer more info. Do NOT mention follow-ups. ` +
            `Just thank them briefly and wish them well. Match their language exactly.`,
        },
      ],
      null,
      'outbound',
      session.language,
    );
    const cleaned = trimReplyForVoice((reply || '').replace(/\[END_CALL\]/gi, '').trim(), 1, 15);
    return cleaned || fallback;
  } catch {
    return fallback;
  }
}

function isFillerOnly(text: string): boolean {
  const t = text
    .toLowerCase()
    .trim()
    // Strip terminal punctuation across scripts
    .replace(/[.!?,;:।॥]/g, '')
    // Drop common deference suffixes that decorate a real ack but don't
    // change its meaning ("okay sir", "హా సార్", "ठीक है साहब")
    .replace(/\b(sir|madam|saar|sar|mam|maam|saab|garu|jee|ji)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 3) return false;
  return FILLER_PATTERNS.some((re) => re.test(t));
}

async function dispatchUserUtterance(session: StreamSession, rawText: string): Promise<void> {
  const text = (rawText || '').trim();
  if (!text) return;

  // Greeting-race guard: the caller often speaks within the first 1-2 seconds
  // of the call connecting (e.g. "హలో"), but our seeded greeting LLM call
  // takes ~2-4s to generate. If we let user input through before the greeting
  // is in history, BOTH the greeting LLM call AND a fresh handleUserUtterance
  // run in parallel — Plivo plays both replies back-to-back ("Telugu hello"
  // then "Nice to meet you"). Drop everything until the greeting lands.
  if (session.history.length === 0) {
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 60) },
      'Stream: dropping pre-greeting user utterance (greeting still generating)',
    );
    return;
  }

  // End-of-call latch: caller said goodbye / thank-you-bye / cut the call.
  // We've already played the farewell once (or are about to). Any further
  // utterance is just the caller hanging up or background noise — log + drop,
  // never fire the LLM again on this call.
  if (session.callEnded) {
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'user', text);
    }
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 60) },
      'Stream: dropped post-farewell utterance (call already ended verbally)',
    );
    return;
  }

  // Goodbye detection: caller signalled they're done. Persist their utterance,
  // emit ONE short language-appropriate farewell, set the latch, and bail —
  // do NOT fire the LLM (which has been ignoring "please stop" rules).
  if (isGoodbye(text)) {
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 60) },
      'Stream: goodbye detected — emitting farewell + latching callEnded',
    );
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'user', text);
    }
    session.history.push({ role: 'user', content: text });
    // Make sure any in-flight playback is killed first so the caller actually
    // hears the farewell promptly instead of the tail end of the previous reply.
    if (session.isAgentSpeaking) {
      session.bargeInRequested = true;
    }
    // Latch immediately so any utterance arriving while the farewell is being
    // generated/played is dropped (won't trigger a second LLM call).
    session.callEnded = true;
    const farewell = await generateFarewell(session, text);
    session.history.push({ role: 'assistant', content: farewell });
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'assistant', farewell);
    }
    if (session.plivoWs) {
      // Play the farewell, then hang up the actual phone call. We await the
      // chunk-streaming loop so we know our last byte was sent, then wait a
      // small buffer for Plivo to flush its playback queue to the caller's
      // ear (~2s — chunks land at the caller at near real-time pace).
      // After that, hit Plivo's REST hangup so the call doesn't sit in
      // ACTIVE state with the caller wondering whether the line is dead.
      const wsRef = session.plivoWs;
      const callSidRef = session.callSid;
      playText(wsRef, session, farewell)
        .catch(() => { /* swallow */ })
        .then(() => new Promise((r) => setTimeout(r, 1800)))
        .then(async () => {
          if (!callSidRef) return;
          logger.info(
            { callSid: callSidRef },
            'Stream: hanging up Plivo call after farewell',
          );
          try {
            await plivoProvider.endCall(callSidRef);
          } catch (e: any) {
            logger.warn({ callSid: callSidRef, err: e?.message }, 'Plivo hangup failed');
          }
        });
    }
    return;
  }

  // Detect "back-channel" acks BEFORE pushing to in-memory history so they
  // don't pollute the LLM context window either. We still persist them to
  // the messages table so the recorded transcript reflects what was said.
  const lastIdx = session.history.length - 1;
  const lastEntry = lastIdx >= 0 ? session.history[lastIdx] : null;
  const lastWasAssistant = lastEntry?.role === 'assistant';
  const lastAssistantAskedQuestion = lastWasAssistant && /[?？]\s*$/.test((lastEntry?.content || '').trim());
  const filler = isFillerOnly(text);

  if (filler && lastWasAssistant && !lastAssistantAskedQuestion) {
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 60) },
      'Stream: skipped back-channel ack (no LLM trigger, would cause repeat)',
    );
    // Persist for transcript fidelity, but DON'T add to LLM history and
    // DON'T fire a reply.
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'user', text);
    }
    return;
  }

  // BARGE-IN: caller is speaking substantively while the agent is mid-reply.
  // Flag the playback loop to stop streaming TTS chunks and flush Plivo's
  // queue so the agent shuts up immediately and listens to what was said.
  if (session.isAgentSpeaking) {
    session.bargeInRequested = true;
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 60) },
      'Stream: barge-in requested — caller spoke during agent reply',
    );
  }

  logger.info({ callSid: session.callSid, userText: text.slice(0, 100), inFlight: session.inFlightReply }, 'Stream: user utterance');

  // Persist the utterance to BOTH the in-memory conversation history
  // (so the next LLM call sees it) and the messages table (so the Call
  // Detail transcript reflects every word from the recording).
  session.history.push({ role: 'user', content: text });
  if (session.conversationId) {
    await appendMessage(session.conversationId, session.tenantId, 'user', text);
  }

  // Mid-call language switch: if the caller asks ("speak in Telugu") OR
  // suddenly speaks in a different script, swap STT/TTS providers and tell
  // the LLM to follow them. Done before triggering the LLM reply so the
  // very next response comes back in the new language.
  const newLang = detectLanguageRequest(text, session.language);
  if (newLang && session.plivoWs) {
    await switchLanguage(session.plivoWs, session, newLang);
  }

  if (session.inFlightReply) {
    // Agent is still replying to a previous turn. The newly-stored user
    // turn will be picked up automatically by handleUserUtterance's drain
    // loop as soon as the current reply completes.
    return;
  }
  session.inFlightReply = true;
  handleUserUtterance(session).finally(() => { session.inFlightReply = false; });
}

/**
 * Generate an LLM reply for the most recent unanswered user turn(s).
 * Loops — if new user utterances were queued while the reply was being
 * synthesised, they'll have landed in session.history and we reply to
 * the new tail instead of dropping them.
 */
async function handleUserUtterance(session: StreamSession): Promise<void> {
  // Drain: loop until the last message in history is an assistant turn
  // (meaning there's no outstanding user input to respond to).
  while (session.history.length > 0 && session.history[session.history.length - 1].role === 'user') {
    const reply = await callLLM(session.agent, session.history, null, 'outbound', session.language);
    const raw = reply && reply.trim() ? reply.trim() : 'Sorry, could you repeat that?';

    // Strip the obsolete [END_CALL] token if the LLM still emits it from an
    // older prompt cache — never say "END_CALL" aloud, never hang up ourselves.
    // The caller always controls when the call ends; we just stop asking new
    // questions and go quiet after the farewell.
    const cleaned = raw.replace(/\[END_CALL\]/gi, '').trim() || 'Sorry, could you repeat that?';

    // Hard brevity cap: cut to first 2 sentences AND ≤ 45 words. Sarvam-m
    // (used for Indic calls) routinely ignores the prompt's "ONE or TWO short
    // sentences" rule and emits 5-paragraph encyclopedia entries. We trim
    // post-LLM so the rule is enforced regardless of which provider replied.
    const spoken = trimReplyForVoice(cleaned);

    session.history.push({ role: 'assistant', content: spoken });
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'assistant', spoken);
    }
    if (session.plivoWs) await playText(session.plivoWs, session, spoken);

    // If the caller barged in mid-playback, only the first ~10-20% of the
    // reply actually reached their ear. Trim what's in the LLM history down
    // to the spoken portion + an [interrupted] marker, otherwise the next
    // LLM call sees the full reply and thinks "I already covered this" — so
    // when the caller's barge-in utterance was "yes I want to know", the
    // LLM cheerfully re-emits the same answer it never finished delivering.
    if (session.bargeInRequested) {
      const last = session.history[session.history.length - 1];
      if (last && last.role === 'assistant') {
        // Take only the first sentence (caller heard at most ~1-2 sec).
        const firstSentence = last.content.split(/(?<=[.!?।॥])\s+/u)[0] || last.content.slice(0, 60);
        last.content = `${firstSentence.trim()} … [interrupted by caller before I could finish]`;
      }
      // Clear the flag so the very next reply starts with a clean slate.
      session.bargeInRequested = false;
    }
  }
}

// ---- sending audio back to Plivo -------------------------------------------

async function playText(plivoWs: WebSocket, session: StreamSession, text: string): Promise<void> {
  session.plivoWs = plivoWs;
  if (plivoWs.readyState !== WebSocket.OPEN) return;
  // TTS: Sarvam (native Indic voices) → Azure (also Indic) → Deepgram Aura (English only).
  let b64: string | null = null;
  if (session.ttsBackend === 'sarvam') {
    b64 = await synthesizeSarvamTtsMulaw(text, session.language, session.agent?.voice_config?.voice_id);
    if (!b64) {
      logger.warn({ callSid: session.callSid, lang: session.language }, 'Sarvam TTS failed — falling back to Deepgram Aura');
      b64 = await ttsDeepgramMulaw(text, session.agent?.voice_config?.voice_id);
    }
  } else if (session.ttsBackend === 'azure') {
    b64 = await synthesizeAzureTtsMulaw(text, session.language, session.agent?.voice_config?.voice_id);
    if (!b64) {
      logger.warn({ callSid: session.callSid, lang: session.language }, 'Azure TTS failed — falling back to Deepgram Aura');
      b64 = await ttsDeepgramMulaw(text, session.agent?.voice_config?.voice_id);
    }
  } else {
    b64 = await ttsDeepgramMulaw(text, session.agent?.voice_config?.voice_id);
  }
  if (!b64) {
    logger.warn({ callSid: session.callSid }, 'TTS produced no audio — skipping playAudio');
    return;
  }
  // Capture the agent's TTS audio for the stereo recording, positioned at
  // the current caller-timeline offset. This lines up the agent's speech
  // with where the caller was "listening" at send-time.
  const fullBytes = Buffer.from(b64, 'base64');
  session.agentMulawEvents.push({
    offsetBytes: session.callerBytes,
    mulaw: fullBytes,
  });

  // Chunked playback for barge-in support. mulaw 8kHz = 8000 bytes/sec, so
  // ~800-byte chunks ≈ 100ms each. We send chunks at a 90ms cadence (slightly
  // ahead of real-time so playback never starves) and check bargeInRequested
  // between sends — the moment the caller starts speaking, we stop sending
  // and flush Plivo's queue. Caller hears at most ~150ms of overrun.
  const CHUNK_BYTES = 800;        // 100ms of mulaw 8kHz
  const SEND_INTERVAL_MS = 90;    // slightly ahead of playback rate
  session.isAgentSpeaking = true;
  session.bargeInRequested = false;
  let sentBytes = 0;
  try {
    for (let off = 0; off < fullBytes.length; off += CHUNK_BYTES) {
      if (session.bargeInRequested) {
        // Flush Plivo's playback queue so the caller stops hearing the agent.
        try {
          plivoWs.send(JSON.stringify({ event: 'clearAudio' }));
        } catch { /* socket may be gone */ }
        logger.info(
          { callSid: session.callSid, sentBytes, totalBytes: fullBytes.length },
          'Stream: barge-in — playback aborted',
        );
        break;
      }
      const slice = fullBytes.subarray(off, Math.min(off + CHUNK_BYTES, fullBytes.length));
      const playEvent = {
        event: 'playAudio',
        media: {
          contentType: 'audio/x-mulaw',
          sampleRate: '8000',
          payload: slice.toString('base64'),
        },
      };
      try {
        plivoWs.send(JSON.stringify(playEvent));
        sentBytes += slice.length;
      } catch (err: any) {
        logger.warn({ callSid: session.callSid, err: err.message }, 'Failed to send playAudio chunk');
        break;
      }
      // Pace ourselves so we don't blast the entire reply faster than playback.
      // Skip the sleep on the last chunk to avoid an extra idle delay.
      if (off + CHUNK_BYTES < fullBytes.length) {
        await new Promise((r) => setTimeout(r, SEND_INTERVAL_MS));
      }
    }
  } finally {
    session.isAgentSpeaking = false;
  }
}

// ---- Recording writer ------------------------------------------------------

/** Single-sample mulaw → linear PCM16 (signed). Standard G.711 mu-law decode. */
function mulawToPcm16(u: number): number {
  u = (~u) & 0xff;
  const sign = (u & 0x80) ? -1 : 1;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  return sign * magnitude;
}

function decodeMulawBuffer(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = mulawToPcm16(buf[i]);
  return out;
}

/**
 * Write a stereo WAV: L = caller (continuous), R = agent (TTS chunks aligned
 * at their send-offset, silence elsewhere). 8000 Hz, 16-bit PCM.
 */
function writeStereoWav(filePath: string, callerMulaw: Buffer, agentEvents: StreamSession['agentMulawEvents']): void {
  const totalBytes = callerMulaw.length;
  if (totalBytes === 0) return;

  // Build an agent-side mulaw track the same length as the caller track.
  // 0x7F is the mulaw encoding of "zero" (silence).
  const agentMulaw = Buffer.alloc(totalBytes, 0x7f);
  for (const ev of agentEvents) {
    const start = Math.min(ev.offsetBytes, totalBytes);
    const end = Math.min(start + ev.mulaw.length, totalBytes);
    ev.mulaw.copy(agentMulaw, start, 0, end - start);
  }

  const left = decodeMulawBuffer(callerMulaw);
  const right = decodeMulawBuffer(agentMulaw);
  const sampleCount = left.length;

  const sampleRate = 8000;
  const numChannels = 2;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataBytes = sampleCount * numChannels * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < sampleCount; i++) {
    body.writeInt16LE(left[i], i * 4);
    body.writeInt16LE(right[i], i * 4 + 2);
  }
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

/**
 * Compute acoustic quality metrics from a single-channel mulaw track:
 *   - clarity (RMS + clipping + silence) — how intelligible the audio is
 *   - pitch mean/std (Hz) via zero-crossing rate per 25ms window — used
 *     as a rough proxy for voice pitch variation / expressiveness
 *   - expressiveness score (0-100) — how much the pitch varies across the
 *     track. Monotone = low (~20), lively = high (~80+)
 */
function voiceAcousticAnalysis(mulaw: Buffer): {
  clarity_score: number;
  clarity_label: 'clear' | 'good' | 'muffled' | 'unclear';
  rms_db: number;
  clip_ratio: number;
  silence_ratio: number;
  pitch_mean_hz: number;
  pitch_std_hz: number;
  expressiveness_score: number;
  expressiveness_label: 'monotone' | 'flat' | 'natural' | 'expressive';
} {
  if (mulaw.length === 0) {
    return {
      clarity_score: 0, clarity_label: 'unclear',
      rms_db: -99, clip_ratio: 0, silence_ratio: 1,
      pitch_mean_hz: 0, pitch_std_hz: 0,
      expressiveness_score: 0, expressiveness_label: 'monotone',
    };
  }

  // ── Per-sample totals for clarity metrics ────────────────────────
  const CLIP_PCM = 30000;
  const SILENCE_PCM = 500;
  let sumSquares = 0;
  let clipCount = 0;
  let silenceCount = 0;

  // Decode to PCM16 once so we can reuse for the pitch pass.
  const pcm = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    const v = mulawToPcm16(mulaw[i]);
    pcm[i] = v;
    sumSquares += v * v;
    const abs = Math.abs(v);
    if (abs >= CLIP_PCM) clipCount++;
    if (abs <= SILENCE_PCM) silenceCount++;
  }
  const rms = Math.sqrt(sumSquares / mulaw.length);
  const rms_db = rms > 0 ? 20 * Math.log10(rms / 32768) : -99;
  const clip_ratio = clipCount / mulaw.length;
  const silence_ratio = silenceCount / mulaw.length;

  let clarity_score = 100;
  clarity_score -= clip_ratio * 400;
  if (silence_ratio > 0.5) clarity_score -= (silence_ratio - 0.5) * 120;
  if (rms_db < -60) clarity_score = Math.min(clarity_score, 10);
  else if (rms_db < -50) clarity_score -= (-50 - rms_db) * 2;
  else if (rms_db > -10) clarity_score -= (rms_db - -10) * 3;
  clarity_score = Math.max(0, Math.min(100, Math.round(clarity_score)));

  const clarity_label: 'clear' | 'good' | 'muffled' | 'unclear' =
    clarity_score >= 80 ? 'clear' : clarity_score >= 60 ? 'good' : clarity_score >= 40 ? 'muffled' : 'unclear';

  // ── Pitch via zero-crossing rate on 25ms windows ────────────────
  // Cheap F0 proxy that works surprisingly well on speech once you gate
  // out silent windows. Human voice is 80-400 Hz; we reject out-of-range
  // windows as noise.
  const SAMPLE_RATE = 8000;
  const WIN = Math.round(SAMPLE_RATE * 0.025); // 25ms
  const VOICE_MIN = 80;
  const VOICE_MAX = 400;
  const MIN_RMS_FOR_PITCH = 800; // skip silent / near-silent windows
  const f0Samples: number[] = [];
  for (let start = 0; start + WIN <= pcm.length; start += WIN) {
    let ss = 0;
    for (let i = start; i < start + WIN; i++) ss += pcm[i] * pcm[i];
    const winRms = Math.sqrt(ss / WIN);
    if (winRms < MIN_RMS_FOR_PITCH) continue;

    // Count sign changes, discounting noise via a small hysteresis.
    let zc = 0;
    let lastSign = 0;
    for (let i = start; i < start + WIN; i++) {
      const v = pcm[i];
      if (v > 200 && lastSign <= 0) { zc++; lastSign = 1; }
      else if (v < -200 && lastSign >= 0) { zc++; lastSign = -1; }
    }
    const f0 = (zc / 2) / 0.025; // Hz
    if (f0 >= VOICE_MIN && f0 <= VOICE_MAX) f0Samples.push(f0);
  }

  let pitch_mean_hz = 0, pitch_std_hz = 0;
  if (f0Samples.length > 0) {
    const mean = f0Samples.reduce((a, b) => a + b, 0) / f0Samples.length;
    let variance = 0;
    for (const f of f0Samples) variance += (f - mean) * (f - mean);
    variance /= f0Samples.length;
    pitch_mean_hz = Math.round(mean);
    pitch_std_hz = Math.round(Math.sqrt(variance));
  }

  // Expressiveness = coefficient of variation (std/mean), scaled. On
  // natural speech std/mean is roughly 0.10-0.25; monotone < 0.06.
  let expressiveness_score = 0;
  if (pitch_mean_hz > 0) {
    const cv = pitch_std_hz / pitch_mean_hz;
    expressiveness_score = Math.max(0, Math.min(100, Math.round(cv * 500))); // cv=0.2 → 100
  }
  const expressiveness_label: 'monotone' | 'flat' | 'natural' | 'expressive' =
    expressiveness_score >= 75 ? 'expressive'
    : expressiveness_score >= 45 ? 'natural'
    : expressiveness_score >= 20 ? 'flat'
    : 'monotone';

  return {
    clarity_score, clarity_label,
    rms_db: Math.round(rms_db * 10) / 10,
    clip_ratio: Math.round(clip_ratio * 10000) / 10000,
    silence_ratio: Math.round(silence_ratio * 10000) / 10000,
    pitch_mean_hz,
    pitch_std_hz,
    expressiveness_score,
    expressiveness_label,
  };
}

async function finalizeRecording(session: StreamSession): Promise<void> {
  try {
    if (session.callerMulaw.length === 0) {
      logger.info({ callSid: session.callSid }, 'No caller audio captured — skipping recording');
      return;
    }
    const callerBuf = Buffer.concat(session.callerMulaw);
    // Synth agent mulaw track from the aligned offsets so we can score it
    // the same way as the caller track.
    const agentBuf = Buffer.alloc(callerBuf.length, 0x7f);
    for (const ev of session.agentMulawEvents) {
      const start = Math.min(ev.offsetBytes, agentBuf.length);
      const end = Math.min(start + ev.mulaw.length, agentBuf.length);
      ev.mulaw.copy(agentBuf, start, 0, end - start);
    }

    const filename = `${session.callSid || `stream-${Date.now()}`}.wav`;
    const filePath = path.join(recordingsDir(), filename);
    writeStereoWav(filePath, callerBuf, session.agentMulawEvents);

    const url = `${config.publicBaseUrl}/recordings/${filename}`;
    const callerAcoustic = voiceAcousticAnalysis(callerBuf);
    const agentAcoustic = voiceAcousticAnalysis(agentBuf);
    // Keep the existing shape (score/label/rms/clip/silence) so old UI code
    // still works, and add the new pitch + expressiveness fields alongside.
    const voiceQuality = {
      caller: {
        score: callerAcoustic.clarity_score,
        label: callerAcoustic.clarity_label,
        rms_db: callerAcoustic.rms_db,
        clip_ratio: callerAcoustic.clip_ratio,
        silence_ratio: callerAcoustic.silence_ratio,
        pitch_mean_hz: callerAcoustic.pitch_mean_hz,
        pitch_std_hz: callerAcoustic.pitch_std_hz,
        expressiveness_score: callerAcoustic.expressiveness_score,
        expressiveness_label: callerAcoustic.expressiveness_label,
      },
      agent: {
        score: agentAcoustic.clarity_score,
        label: agentAcoustic.clarity_label,
        rms_db: agentAcoustic.rms_db,
        clip_ratio: agentAcoustic.clip_ratio,
        silence_ratio: agentAcoustic.silence_ratio,
        pitch_mean_hz: agentAcoustic.pitch_mean_hz,
        pitch_std_hz: agentAcoustic.pitch_std_hz,
        expressiveness_score: agentAcoustic.expressiveness_score,
        expressiveness_label: agentAcoustic.expressiveness_label,
      },
    };

    // Update the calls row.
    try {
      await pool.query(
        `UPDATE calls SET recording_url = $1,
           metadata = COALESCE(metadata,'{}') || $2
         WHERE provider_call_sid = $3`,
        [url, JSON.stringify({ recording_source: 'local_stream_wav', voice_quality: voiceQuality }), session.callSid]
      );
    } catch (err: any) {
      logger.warn({ err: err.message, callSid: session.callSid }, 'Failed to update calls.recording_url');
    }

    // Mirror onto the conversations row. Recording URL on the top-level
    // column, voice quality into the analysis JSONB so the AI-analytics
    // panel on Call Detail can pick it up. Also flip status → ENDED and
    // stamp ended_at so the row never gets stuck on ACTIVE.
    if (session.conversationId) {
      try {
        await pool.query(
          `UPDATE conversations
           SET recording_url = $1,
               analysis = COALESCE(analysis, '{}'::jsonb) || $2::jsonb,
               status = CASE WHEN status = 'ACTIVE' THEN 'ENDED' ELSE status END,
               ended_at = COALESCE(ended_at, now())
           WHERE id = $3 AND tenant_id = $4`,
          [url, JSON.stringify({ voice_quality: voiceQuality }), session.conversationId, session.tenantId]
        );
      } catch (err: any) {
        logger.warn({ err: err.message, conversationId: session.conversationId }, 'Failed to update conversations.recording_url');
      }
    }
    logger.info({ callSid: session.callSid, url, bytes: callerBuf.length, callerScore: callerAcoustic.clarity_score, agentScore: agentAcoustic.clarity_score }, 'Recording written');
  } catch (err: any) {
    logger.warn({ err: err.message, callSid: session.callSid }, 'finalizeRecording error');
  }
}

// ---- Mid-call language switching -------------------------------------------
//
// Goal: when the caller says "speak in Telugu" / "switch to Hindi" / starts
// speaking in a different script entirely, swap STT + TTS providers AND tell
// the LLM to respond in the new language going forward.
//
// Three signals trigger a switch:
//   1. Script detection — if the transcribed text contains a non-Latin
//      script that maps to a specific language (Telugu/Hindi/Tamil/etc).
//      This is deterministic and fast (one regex per script range).
//   2. English request — "speak in <lang>", "switch to <lang>", etc.
//   3. Indic-romanized request — "<lang> lo matladu" (Telugu),
//      "<lang> mein baat karo" (Hindi), etc.

const LANG_KEYWORDS: Record<string, string[]> = {
  'te-IN': ['telugu', 'తెలుగు'],
  'hi-IN': ['hindi', 'हिंदी', 'हिन्दी'],
  'ta-IN': ['tamil', 'தமிழ்'],
  'kn-IN': ['kannada', 'ಕನ್ನಡ'],
  'ml-IN': ['malayalam', 'മലയാളം'],
  'mr-IN': ['marathi', 'मराठी'],
  'bn-IN': ['bengali', 'bangla', 'বাংলা'],
  'gu-IN': ['gujarati', 'ગુજરાતી'],
  'pa-IN': ['punjabi', 'ਪੰਜਾਬੀ'],
  'or-IN': ['odia', 'oriya', 'ଓଡ଼ିଆ'],
  'as-IN': ['assamese', 'অসমীয়া'],
  'ur-IN': ['urdu', 'اردو'],
  'en-IN': ['english'],
};

const SCRIPT_TO_LANG: Array<{ re: RegExp; lang: string }> = [
  { re: /[ఀ-౿]/, lang: 'te-IN' }, // Telugu
  { re: /[஀-௿]/, lang: 'ta-IN' }, // Tamil
  { re: /[ಀ-೿]/, lang: 'kn-IN' }, // Kannada
  { re: /[ഀ-ൿ]/, lang: 'ml-IN' }, // Malayalam
  { re: /[ঀ-৿]/, lang: 'bn-IN' }, // Bengali
  { re: /[઀-૿]/, lang: 'gu-IN' }, // Gujarati
  { re: /[਀-੿]/, lang: 'pa-IN' }, // Gurmukhi (Punjabi)
  { re: /[଀-୿]/, lang: 'or-IN' }, // Odia
  { re: /[ऀ-ॿ]/, lang: 'hi-IN' }, // Devanagari — Hindi/Marathi (default Hindi)
];

const FRIENDLY: Record<string, string> = {
  'en-IN': 'English', 'te-IN': 'Telugu', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil',
  'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'mr-IN': 'Marathi', 'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati', 'pa-IN': 'Punjabi', 'or-IN': 'Odia', 'as-IN': 'Assamese',
  'ur-IN': 'Urdu',
};

const SWITCH_VERB_RE = /\b(speak|talk|switch|change|continue|reply|respond|converse|chat)\s+(in|to)\b/i;
const INDIC_ASK_HINTS_RE = /\b(lo|mein|me|la|il|para|please|kindly|matladu|matladandi|baat|karo|karein|karo na|pesu|pesungal|maatadi|kannadalli)\b/i;

function detectLanguageRequest(text: string, currentLang: string): string | null {
  const lower = (text || '').toLowerCase();
  if (!lower) return null;

  // 1. Explicit English ask: "speak in Telugu", "switch to Hindi"
  if (SWITCH_VERB_RE.test(lower)) {
    for (const lang of Object.keys(LANG_KEYWORDS)) {
      const kws = LANG_KEYWORDS[lang];
      if (kws.some((k) => lower.includes(k.toLowerCase()))) {
        return lang === currentLang ? null : lang;
      }
    }
  }

  // 2. Indic-romanized ask: "Telugu lo matladu" / "Hindi mein baat karo"
  const langWord = /(telugu|hindi|tamil|kannada|malayalam|marathi|bengali|bangla|gujarati|punjabi|odia|oriya|assamese|urdu|english)/i.exec(lower);
  if (langWord && INDIC_ASK_HINTS_RE.test(lower)) {
    const k = langWord[1].toLowerCase();
    for (const lang of Object.keys(LANG_KEYWORDS)) {
      if (LANG_KEYWORDS[lang].some((kw) => kw.toLowerCase() === k)) {
        return lang === currentLang ? null : lang;
      }
    }
  }

  // 3. Script detection — caller is suddenly speaking in a different script.
  // We require enough non-Latin characters to avoid false positives from a
  // single emoji or stray glyph.
  for (const s of SCRIPT_TO_LANG) {
    if ((text.match(s.re) || []).length >= 3 && s.lang !== currentLang) {
      return s.lang;
    }
  }

  return null;
}

async function switchLanguage(plivoWs: WebSocket, session: StreamSession, newLang: string): Promise<void> {
  const oldLang = session.language;
  if (oldLang === newLang || session.closed) return;

  // Pick backends for the new language using the same priority as onStart.
  let stt: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  let tts: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  if (!deepgramCanHandle(newLang)) {
    if (sarvamConfigured() && sarvamCanHandle(newLang)) {
      stt = 'sarvam'; tts = 'sarvam';
    } else if (azureSpeechConfigured()) {
      stt = 'azure'; tts = 'azure';
    }
  }

  logger.info({ callSid: session.callSid, oldLang, newLang, stt, tts }, 'Stream: switching language mid-call');

  // Tear down whichever STT was active.
  if (session.dgWs && session.dgWs.readyState === WebSocket.OPEN) {
    try { session.dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
    try { session.dgWs.close(); } catch { /* ignore */ }
  }
  session.dgWs = null;
  if (session.azureStt) {
    try { session.azureStt.close(); } catch { /* ignore */ }
    session.azureStt = null;
  }
  if (session.sarvamStt) {
    try { session.sarvamStt.close(); } catch { /* ignore */ }
    session.sarvamStt = null;
  }

  // Update session state BEFORE opening the new STT so any race with
  // incoming media uses the new backend pointer.
  session.language = newLang;
  session.sttBackend = stt;
  session.ttsBackend = tts;

  // Open the new STT.
  if (stt === 'sarvam') {
    session.sarvamStt = startSarvamStt({
      language: newLang,
      onFinal: (t) => dispatchUserUtterance(session, t),
      onError: (m) => logger.warn({ callSid: session.callSid, err: m }, 'Sarvam STT error (post-switch)'),
    });
  } else if (stt === 'azure') {
    session.azureStt = startAzureStt({
      language: newLang,
      onFinal: (t) => dispatchUserUtterance(session, t),
      onError: (m) => logger.warn({ callSid: session.callSid, err: m }, 'Azure STT error (post-switch)'),
    });
  } else {
    await connectDeepgram(session, newLang);
  }

  // Tell the LLM to follow them. The next LLM turn (which is about to fire
  // because we're already inside dispatchUserUtterance) will see this hint
  // at the tail of history and reply in the new language.
  const friendlyNew = FRIENDLY[newLang] || newLang;
  session.history.push({
    role: 'system',
    content: `The caller wants to continue in ${friendlyNew}. From this point forward, respond ONLY in ${friendlyNew}, in short natural sentences for a phone call. If they switch language again, follow them.`,
  });
}
