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
import { Pool } from 'pg';
import { pool } from '../index';
import { config } from '../config';
import { buildVoiceAgentPrompt, buildVoiceAgentPromptSlim } from '../prompts/voiceAgent';
import { recordingsDir } from '../routes/recordings';
import { startAzureStt, synthesizeAzureTtsMulaw, deepgramCanHandle, azureSpeechConfigured, AzureSttHandle } from '../providers/azureSpeech';
import { startSarvamStt, synthesizeSarvamTtsMulaw, sarvamCanHandle, sarvamConfigured, callSarvamLLM, callSarvamLLMStream, SarvamSttHandle } from '../providers/sarvamSpeech';
import { SarvamTtsStream, sarvamStreamConfigured } from '../providers/sarvamStreamTts';
import { startWhisperStt, whisperConfigured, WhisperSttHandle } from '../providers/whisperSpeech';
import { plivoProvider } from '../providers/plivo.provider';
import { resolveDeployedAgent } from '../services/deployedAgentResolver';
import { updateTargetFromCallEnd } from '../routes/campaigns';
import { normalizePronunciation } from '../utils/pronunciation';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

/**
 * Structured event emitter for the live-call pipeline. Every state-machine
 * transition flows through this so the live-monitor script and ops dashboards
 * can grep one canonical shape:
 *
 *   { event: 'CALL_CONNECTED', call_sid: '…', ts_ms: 17792…, … }
 *
 * Replaces ad-hoc log strings ("Stream: backends chosen", "barge-in
 * requested") which were inconsistent + hard to alert on. Existing string
 * logs stay as-is for backward compat with the live-monitor.sh script;
 * structured events sit alongside them under `evt` key.
 */
type LiveEvent =
  | 'CALL_CONNECTED'
  | 'STT_STARTED'
  | 'STT_FINAL'
  | 'STT_PARTIAL'
  | 'SPEECH_STARTED'
  | 'UTTERANCE_END'
  | 'INTERRUPT_DETECTED'
  | 'TTS_STARTED'
  | 'TTS_STOPPED'
  | 'TTS_CANCELLED'
  | 'LISTENING_RESUMED'
  | 'STATE_FORCED_RECOVERY'
  | 'LLM_RESPONSE_STARTED'
  | 'LLM_RESPONSE_COMPLETED'
  | 'WEBSOCKET_RECONNECTED'
  | 'WEBSOCKET_DEAD'
  | 'INFLIGHT_WATCHDOG_FIRED'
  | 'SARVAM_FALLBACK_TRIGGERED'
  | 'CALL_ENDED'
  | 'STATE_CHANGE';

/**
 * High-level conversation states for the live-call pipeline. Layered ON TOP
 * of the existing boolean flags (isAgentSpeaking, inFlightReply, callEnded)
 * so no downstream call sites need to change — `setCallState` mutates the
 * derived state field + emits STATE_CHANGE for visibility.
 */
type CallState =
  | 'IDLE'           // ws connected, before any greeting
  | 'LISTENING'      // agent quiet, waiting for caller
  | 'USER_SPEAKING'  // SpeechStarted but no final yet
  | 'THINKING'       // STT final received, LLM call pending
  | 'AGENT_SPEAKING' // TTS playback active
  | 'ENDED';         // session torn down

function setCallState(session: any, next: CallState, reason?: string): void {
  if (session.callState === next) return;
  const prev = session.callState || 'IDLE';
  session.callState = next;
  emit(session, 'STATE_CHANGE', { from: prev, to: next, reason: reason || null });
}

/**
 * Per-call barge-in grace window. Defaults differ by language because Indic
 * speakers' natural pauses (~700-900ms) are noticeably longer than English
 * (~300-400ms); 1.5s cuts Hindi/Telugu callers off mid-thought too often.
 *
 * Overrides (highest first):
 *   1. session.agentBargeInGraceMs (set from agent.voice_config.barge_in_grace_ms)
 *   2. BARGE_IN_GRACE_MS_EN / BARGE_IN_GRACE_MS_INDIC env vars
 *   3. Language defaults: 1500ms English, 2000ms Indic
 */
const INDIC_LANG_PREFIXES = ['hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'or', 'as'];
function bargeInGraceMs(session: { language?: string; agentBargeInGraceMs?: number | null }): number {
  if (session.agentBargeInGraceMs && session.agentBargeInGraceMs > 0) {
    return session.agentBargeInGraceMs;
  }
  const lang = String(session.language || 'en').toLowerCase();
  const isIndic = INDIC_LANG_PREFIXES.some((p) => lang === p || lang.startsWith(p + '-'));
  if (isIndic) {
    const envIndic = Number(process.env.BARGE_IN_GRACE_MS_INDIC);
    // 3500ms for Indic — long enough that the agent isn't cut off mid-sentence
    // by carrier echo / the caller's natural pauses. (Reverted from a 2800ms
    // experiment that contributed to clipped Telugu replies.)
    return Number.isFinite(envIndic) && envIndic > 0 ? envIndic : 3500;
  }
  const envEn = Number(process.env.BARGE_IN_GRACE_MS_EN);
  return Number.isFinite(envEn) && envEn > 0 ? envEn : 2000;
}

function emit(session: { callSid?: string; conversationId?: string | null } | null, event: LiveEvent, fields: Record<string, any> = {}): void {
  const payload = {
    evt: event,
    call_sid: session?.callSid || null,
    conv_id: session?.conversationId || null,
    ts_ms: Date.now(),
    ...fields,
  };
  logger.info(payload, `evt:${event}`);
  // Persist live state to conversations.metadata so the Live Calls dashboard
  // can show call_state, latency, provider info without a separate event bus.
  if (session?.conversationId && (event === 'STATE_CHANGE' || event === 'CALL_CONNECTED' || event === 'CALL_ENDED' || event === 'LLM_RESPONSE_COMPLETED' || event === 'SARVAM_FALLBACK_TRIGGERED' || event === 'INTERRUPT_DETECTED' || event === 'INFLIGHT_WATCHDOG_FIRED' || event === 'STATE_FORCED_RECOVERY' || event === 'WEBSOCKET_DEAD')) {
    persistLiveState(session as any, event, fields).catch(() => {});
  }
}

let _persistThrottle: Map<string, number> = new Map();
async function persistLiveState(session: StreamSession, event: LiveEvent, fields: Record<string, any>): Promise<void> {
  const convId = session.conversationId;
  if (!convId) return;
  const now = Date.now();
  const last = _persistThrottle.get(convId) || 0;
  if (now - last < 1000 && event === 'STATE_CHANGE') return; // throttle state changes to 1/sec
  _persistThrottle.set(convId, now);
  const liveState = {
    call_state: session.callState || 'IDLE',
    stt_backend: session.sttBackend || null,
    tts_backend: session.ttsBackend || null,
    language: session.language || null,
    is_inbound: session.isInbound || false,
    last_event: event,
    last_event_at: now,
    ttft_ms: session.turn?.llmStartAt && session.turn?.sttFinalAt ? session.turn.llmStartAt - session.turn.sttFinalAt : null,
    ttfa_ms: session.turn?.audioFirstByteAt && session.turn?.llmStartAt ? session.turn.audioFirstByteAt - session.turn.llmStartAt : null,
    provider_pref: session.providerPref || null,
    stt_downshifted: session.sarvamSttDownshifted || false,
    dg_dead: session.dgDead || false,
    ...fields,
  };
  try {
    const convUrl = (process.env.CONVERSATION_SERVICE_URL || config.conversationServiceUrl || 'http://localhost:3003');
    await fetch(`${convUrl}/api/v1/conversations/${convId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': session.tenantId || '' },
      body: JSON.stringify({ metadata: { live_state: liveState } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* non-fatal */ }
}

// ---- module state ----------------------------------------------------------

/**
 * Gemini-cooldown timestamp (ms epoch). When set to a future value, the
 * Indic-call hybrid path skips the Gemini probe and goes straight to Sarvam.
 * Set by streamLLMReply when /chat/simple returns mock=true (Gemini quota
 * exhausted on free tier); cleared automatically when a future Gemini call
 * succeeds. 5-minute window so we don't hammer the rate-limited provider.
 */
let geminiCooldownUntilMs = 0;
const GEMINI_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Sarvam bulbul:v2 speaker catalog (mirror of SARVAM_SPEAKERS in
 * sarvamSpeech.ts). Used to validate an agent's configured voice_id before we
 * pin it as the call's single premium voice — anything outside this set falls
 * back to PREMIUM_VOICE_ID (default 'abhilash').
 */
const SARVAM_PREMIUM_SPEAKERS = new Set([
  'anushka', 'abhilash', 'manisha', 'vidya', 'arya', 'karun', 'hitesh',
]);

// ---- helpers ----------------------------------------------------------------

function firstNonEmpty(...vals: (string | null | undefined)[]): string {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * Normalize a free-form language hint (CSV "language" column, agent default,
 * Sarvam confidence) into a BCP-47 code our STT/TTS providers accept. Returns
 * null if the input doesn't map cleanly — caller falls back to agent default.
 *
 * Accepts:
 *   - already-formed BCP-47: "te-IN", "en-US", "hi-IN" → returned as-is
 *   - bare ISO-639 codes:    "te", "hi", "en", "ta"    → appended with "-IN" (Indic) / "-US" (en)
 *   - English language names: "telugu", "english", "hindi", "tamil", "kannada"
 *   - Hinglish-style hints:   "hi+en", "hinglish", "mixed"
 *
 * Anything else returns null. Case-insensitive.
 */
export function normalizeLanguageCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!s) return null;
  // already a BCP-47-ish code
  if (/^[a-z]{2}-[a-z]{2}$/.test(s)) {
    const [a, b] = s.split('-');
    return `${a}-${b.toUpperCase()}`;
  }
  const NAME_TO_CODE: Record<string, string> = {
    english: 'en-US', en: 'en-US',
    hindi: 'hi-IN', hi: 'hi-IN', hinglish: 'hi-IN', 'hi+en': 'hi-IN', 'en+hi': 'hi-IN', mixed: 'hi-IN',
    telugu: 'te-IN', te: 'te-IN', 'te+en': 'te-IN',
    tamil: 'ta-IN', ta: 'ta-IN',
    kannada: 'kn-IN', kn: 'kn-IN',
    malayalam: 'ml-IN', ml: 'ml-IN',
    marathi: 'mr-IN', mr: 'mr-IN',
    bengali: 'bn-IN', bn: 'bn-IN', bangla: 'bn-IN',
    gujarati: 'gu-IN', gu: 'gu-IN',
    punjabi: 'pa-IN', pa: 'pa-IN',
    odia: 'or-IN', oriya: 'or-IN', or: 'or-IN',
    assamese: 'as-IN', as: 'as-IN',
    urdu: 'ur-IN', ur: 'ur-IN',
  };
  return NAME_TO_CODE[s] || null;
}

/**
 * Transliterate Latin-script strings (name, college) into the call's Indic
 * script via Sarvam's transliteration API, so the Indic TTS pronounces them
 * natively. "Baji Babu" on a Telugu call was read as "OG Babu" because the
 * Latin letters confuse Sarvam's Telugu TTS; "బాజీ బాబు" is read correctly.
 * Best-effort + parallel: any failure yields null and the caller keeps the
 * original Latin string. Skips inputs with no Latin letters (already native).
 */
async function transliterateToIndic(texts: string[], targetLang: string): Promise<(string | null)[]> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return texts.map(() => null);
  return Promise.all(
    texts.map(async (t): Promise<string | null> => {
      const s = String(t || '').trim();
      if (!s || !/[A-Za-z]/.test(s)) return null;
      try {
        const resp = await fetch('https://api.sarvam.ai/transliterate', {
          method: 'POST',
          headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: s,
            source_language_code: 'en-IN',
            target_language_code: targetLang,
            spoken_form: true,
          }),
        });
        if (!resp.ok) return null;
        const j: any = await resp.json();
        const out = String(j?.transliterated_text || '').trim();
        return out || null;
      } catch {
        return null;
      }
    }),
  );
}

// CRM pool (crm_db) for inbound lead lookup — separate from the conversation_db
// `pool`. Lazily created; mirrors the scheduler services' getCrmPool pattern.
const CRM_DB_URL = process.env.CRM_DB_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db';
let inboundCrmPool: Pool | null = null;
function getInboundCrmPool(): Pool {
  if (!inboundCrmPool) inboundCrmPool = new Pool({ connectionString: CRM_DB_URL });
  return inboundCrmPool;
}

/**
 * Find the most relevant existing CRM lead for an inbound caller by phone
 * (last-10-digits match). Prefers real leads over placeholder NEEDS_REVIEW
 * rows, newest first. Best-effort — returns null on any failure.
 */
async function lookupLeadByPhone(phone: string): Promise<any | null> {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length < 10) return null;
  try {
    const r = await getInboundCrmPool().query(
      `SELECT id, first_name, last_name, email, phone, status, custom_fields
         FROM leads
        WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
        ORDER BY (status = 'NEEDS_REVIEW') ASC,
                 (COALESCE(custom_fields->>'interested_university', custom_fields->>'interested_college', '') <> '') DESC,
                 updated_at DESC
        LIMIT 1`,
      [digits],
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

/** Derive the caller's current admission stage from their lead's custom_fields,
 *  for an inbound stage-aware greeting. */
function deriveInboundStage(cf: Record<string, any>): 'VISIT_PLANNING' | 'POST_VISIT_FEEDBACK' | 'ADMISSION_INTERESTED' | 'NOT_INTERESTED' | 'BROCHURE_SENT' | 'NEW_CALLER' {
  const ps = String(cf?.pipeline_stage || '').toUpperCase();
  const ext = String(cf?.extended_lead_status || '').toUpperCase();
  if (ps === 'NOT_INTERESTED' || ext === 'NOT_INTERESTED') return 'NOT_INTERESTED';
  if (ext === 'ADMISSION_INTERESTED' || ps === 'ADMISSION_INTERESTED' || ps === 'ADMISSION_READY') return 'ADMISSION_INTERESTED';
  if (ps === 'VISITED' || ps === 'FEEDBACK_COLLECTED' || ps.includes('FEEDBACK')) return 'POST_VISIT_FEEDBACK';
  if (ps === 'VISIT_SCHEDULED' || ps === 'ALTERNATIVE_COLLEGE_INTERESTED') return 'VISIT_PLANNING';
  if (String(cf?.brochure_sent || '') === 'true' || ps.includes('BROCHURE')) return 'BROCHURE_SENT';
  return 'NEW_CALLER';
}

async function loadAgent(
  agentId: string,
  tenantId: string,
  numberId?: string | null,
): Promise<any | null> {
  try {
    const resolved = await resolveDeployedAgent(pool, { agentId, tenantId, numberId: numberId || null });
    if (resolved) return resolved;
  } catch {
    /* fall through to direct fetch */
  }
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
 * Sanitize an LLM reply for TTS so the voice doesn't read out markup, emojis
 * or repeated punctuation. Applied unconditionally before every TTS provider
 * call (Sarvam, Azure, Deepgram). KB chunks and prompt text can leak `**bold**`,
 * `🎯`, em-dashes, multi-newline lists etc. into the reply, all of which some
 * voices verbalise literally ("star star important star star").
 *
 * Rules (kept narrow — anything more invasive risks dropping content):
 *  - strip markdown emphasis / code / links / headings / bullets
 *  - strip emoji + pictograph code-points
 *  - collapse repeated terminal punctuation (??? → ?, !!! → !)
 *  - replace em/en dashes with comma (natural short pause)
 *  - collapse newlines and runs of spaces into a single space
 *  - keep numerics, currency, and phone formatting intact
 */
export function sanitizeForTts(text: string): string {
  if (!text) return '';
  let s = String(text);
  // markdown link: [label](url) → label
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // raw URLs (some voices spell them out letter by letter)
  s = s.replace(/https?:\/\/\S+/g, '');
  // markdown emphasis & code
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  // markdown headings + bullet/list markers at line starts
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s*[-*•]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  // emoji / pictograph / symbol ranges (keep CJK + Indic scripts intact)
  s = s.replace(
    /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{2300}-\u{23FF}]/gu,
    '',
  );
  // bare zero-width / control chars
  s = s.replace(/[\u200B-\u200F\u2028\u2029\uFEFF]/g, '');
  // collapse long dash runs to a single comma-pause
  s = s.replace(/\s*[—–\-]{2,}\s*/g, ', ');
  // em/en dash surrounded by spaces → comma (natural pause for TTS)
  s = s.replace(/\s+[—–]\s+/g, ', ');
  // collapse repeated terminal punctuation
  s = s.replace(/([!?])\1{1,}/g, '$1');
  // 3+ dots → single ellipsis (keep ONE short pause, drop the "...." chains)
  s = s.replace(/\.{3,}/g, '…');
  // commas/semicolons stacked → single comma
  s = s.replace(/[,;]{2,}/g, ',');
  // any newline → space (TTS doesn't need line breaks)
  s = s.replace(/\r?\n+/g, ' ');
  // collapse runs of whitespace
  s = s.replace(/\s{2,}/g, ' ');
  // strip leading/trailing whitespace + orphan punctuation
  s = s.replace(/^[\s,;:.!?…—–-]+/, '').replace(/[\s,;:]+$/, '');
  return s.trim();
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
/**
 * Detect when the caller is asking about something that needs *current* data
 * (trending tools, today's news, latest releases, stock/sports/weather, etc.).
 * These queries are wasted on Wikipedia (encyclopedia, not a news feed) so we
 * route them through Tavily instead. Pattern matches both English and Indic
 * keywords for "latest / trending / today / news / current / recent".
 */
function needsLiveSearch(query: string): boolean {
  if (!query || query.length < 3) return false;
  const q = query.toLowerCase();
  return (
    /\b(latest|trending|today|news|current|recent|now|breaking|live|2024|2025|2026|this week|this month|this year)\b/i.test(q) ||
    /(अभी|ताज़ा|ताजा|आज|इस साल|इस महीने|इस हफ्ते|हाल ही|नवीनतम|खबर)/.test(query) ||
    /(ఇప్పుడు|నేడు|తాజా|ఈ సంవత్సరం|ఈ నెల|ఈ వారం|వార్త)/.test(query) ||
    /(இப்போது|இன்று|சமீபத்திய|இந்த ஆண்டு|இந்த மாதம்|செய்தி)/.test(query) ||
    /(ಈಗ|ಇಂದು|ಇತ್ತೀಚಿನ|ಈ ವರ್ಷ|ಸುದ್ದಿ)/.test(query)
  );
}

/**
 * Live web-search grounding via Tavily (https://tavily.com). Tavily is built
 * for AI/agent grounding — returns a synthesized answer plus the underlying
 * source snippets. We only fire this when the query has "live data" keywords
 * (see needsLiveSearch) — Wikipedia handles encyclopedia-style questions
 * faster and cheaper, and Tavily's free tier is 1000 calls/month so we
 * shouldn't blast it on every "what's the cast of Animal" turn.
 *
 * No-op when TAVILY_API_KEY is unset, so this is safe to ship without the
 * key and have it activate the moment the env var lands.
 */
async function fetchLiveSearchContext(
  history: Array<{ role: string; content: string }>,
): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return '';
  let query = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') { query = history[i].content; break; }
  }
  query = (query || '').trim();
  if (!needsLiveSearch(query)) return '';

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000); // hard 2s budget
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',     // ~1-2s, vs "advanced" which is 3-5s
        max_results: 3,
        include_answer: true,       // Tavily synthesises a one-paragraph answer
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Tavily search non-OK');
      return '';
    }
    const data = await resp.json() as any;
    const answer = (data?.answer || '').toString().trim();
    const results = (data?.results || []).slice(0, 3) as Array<{ title?: string; content?: string; url?: string }>;
    if (!answer && results.length === 0) return '';

    const parts: string[] = [];
    if (answer) parts.push(`### Synthesised answer\n${answer.slice(0, 600)}`);
    for (const r of results) {
      const title = (r.title || '').toString().trim();
      const content = (r.content || '').toString().trim();
      if (!content) continue;
      parts.push(`### ${title}\n${content.slice(0, 400)}`);
    }
    if (parts.length === 0) return '';

    logger.info(
      { query: query.slice(0, 60), resultCount: results.length, hasAnswer: !!answer },
      'Stream: live web-search context fetched',
    );
    return `\n\n## LIVE_WEB_SEARCH (current/trending info from Tavily — quote these as fresh facts; supersedes any older info you may have)\n${parts.join('\n\n')}\n`;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Tavily search failed');
    return '';
  }
}

/**
 * Live Wikipedia grounding. Hits Wikipedia's public search + summary REST
 * APIs (no key, free, public) and returns 1-2 short page extracts to inject
 * into the LLM prompt. This is the workaround for "Sarvam-M makes up movie
 * cast and confuses Animal with Brahmastra" — when the model would otherwise
 * hallucinate, we hand it the actual encyclopedia entry first so it answers
 * from facts, not guesses.
 *
 * Strategy:
 *   - Build a short search query from the last user utterance + agent name.
 *     Agent name (e.g. "2024 Bollywood movies") biases the search toward the
 *     agent's domain when the user query is ambiguous ("tell me cast" → no
 *     entity to look up; agent name gives a hint).
 *   - Try the language's native Wikipedia first (hi.wikipedia for Hindi
 *     calls, te.wikipedia for Telugu, etc.) — Indic Wikipedia titles match
 *     better when the user's query is in Indic script. Fall through to
 *     English Wikipedia which has far more Bollywood coverage.
 *   - 800ms total budget. If Wikipedia is slow, we serve without grounding
 *     rather than make every voice turn 1-2s slower.
 */
async function fetchWebContext(
  agent: any,
  history: Array<{ role: string; content: string }>,
  language: string | null | undefined,
): Promise<string> {
  // Build query from last user utterance.
  let query = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') { query = history[i].content; break; }
  }
  query = (query || '').trim();
  if (!query || query.length < 3) return '';

  // Add the agent's domain hint so a vague follow-up like "uske director ka
  // naam" still routes to the right page set.
  const agentHint = (agent?.name || agent?.description || '').trim();
  const enrichedQuery = agentHint ? `${query} ${agentHint}` : query;

  // Race en.wikipedia AND the native-script wiki (when call is Indic).
  // Native-wiki matters because Hindi queries like "मशीन लर्निंग" return 0
  // hits on en.wikipedia (no transliteration), but match perfectly on
  // hi.wikipedia. We launch both, take whichever returns valid hits first.
  // Total budget 1500ms — most replies come back well under 800ms.
  const langCode = (language || 'en').toLowerCase().slice(0, 2);
  const hosts = ['en.wikipedia.org'];
  if (langCode !== 'en' && /^(hi|te|ta|kn|ml|mr|bn|gu|pa|or|as|ur|ne)$/.test(langCode)) {
    hosts.push(`${langCode}.wikipedia.org`);
  }
  const deadline = Date.now() + 1500;

  async function fetchOneHost(host: string): Promise<string[] | null> {
    try {
      const searchUrl = `https://${host}/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(enrichedQuery)}&srlimit=2&utf8=1&origin=*`;
      const c1 = new AbortController();
      const t1 = setTimeout(() => c1.abort(), Math.max(200, deadline - Date.now()));
      const sres = await fetch(searchUrl, { signal: c1.signal });
      clearTimeout(t1);
      if (!sres.ok) return null;
      const sdata = await sres.json() as any;
      const hits = (sdata?.query?.search || []).slice(0, 2);
      if (hits.length === 0) return null;

      const summaries = await Promise.all(hits.map(async (h: any) => {
        try {
          const title = encodeURIComponent(h.title);
          const remaining = Math.max(150, deadline - Date.now());
          if (remaining < 150) return null;
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), remaining);
          const r = await fetch(`https://${host}/api/rest_v1/page/summary/${title}`, { signal: c2.signal });
          clearTimeout(t2);
          if (!r.ok) return null;
          const d = await r.json() as any;
          const extract = (d?.extract || '').toString().trim();
          if (!extract) return null;
          return `### ${d.title || h.title}\n${extract.slice(0, 600)}`;
        } catch { return null; }
      }));
      const valid = summaries.filter((s): s is string => !!s);
      return valid.length > 0 ? valid : null;
    } catch {
      return null;
    }
  }

  // Race: take the FIRST host that returns a non-null result, but wait for
  // both to settle so we don't miss a hi.wikipedia hit just because en
  // happened to error out faster. Promise.any resolves on first success.
  try {
    const results = await Promise.any(
      hosts.map((h) => fetchOneHost(h).then((r) => r ? { host: h, items: r } : Promise.reject(new Error('no hits'))))
    );
    logger.info(
      { host: results.host, query: query.slice(0, 60), hits: results.items.length },
      'Stream: web context fetched',
    );
    return `\n\n## LIVE_WEB_CONTEXT (Wikipedia summaries — quote facts from here verbatim; never contradict these)\n${results.items.join('\n\n')}\n`;
  } catch {
    // All hosts returned null / errored. Degrade silently.
    return '';
  }
}

/**
 * Best-effort RAG: query the knowledge-service /search with the latest user
 * utterance and return a markdown block to prepend to the system prompt.
 * Returns '' on any failure or if the agent has no knowledge_base_ids — the
 * caller should still operate (the agent's system_prompt and the relaxed
 * safety rule give the LLM enough to work with).
 */
async function fetchRagContext(
  agent: any,
  history: Array<{ role: string; content: string }>,
): Promise<string> {
  const kbIds: string[] = Array.isArray(agent?.knowledge_base_ids)
    ? agent.knowledge_base_ids
    : Array.isArray(agent?.knowledgeBaseIds)
      ? agent.knowledgeBaseIds
      : [];
  if (kbIds.length === 0) return '';

  // Use the last user utterance as the search query.
  let query = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') { query = history[i].content; break; }
  }
  if (!query.trim()) return '';

  const url = process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:8003';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500); // hard 1.5s budget — RAG must not block speech
    const resp = await fetch(`${url}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, knowledge_base_ids: kbIds, top_k: 2 }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return '';
    const data = (await resp.json()) as { chunks?: Array<{ content?: string; score?: number }> };
    const chunks = (data.chunks || []).filter((c) => c.content && c.content.trim());
    if (chunks.length === 0) return '';
    const joined = chunks.map((c, i) => `### Source ${i + 1}\n${c.content!.trim()}`).join('\n\n');
    return `\n\n## RETRIEVED_CONTEXT (relevant excerpts from your knowledge base — quote facts from here when applicable)\n${joined}\n`;
  } catch {
    // Timeout / network / index error — degrade silently. The expanded
    // system_prompt already carries the most-needed facts inline.
    return '';
  }
}

/**
 * Short-acknowledgement detector. Used to skip grounding fetches (Wikipedia,
 * Tavily, RAG) when the caller just said "yes" / "thanks" / "హా" etc. Saves
 * ~500–1500ms per ack turn because the slowest grounding call sets the floor.
 *
 * Strict matching only — substantive short messages like "MBA fee?" or
 * "Charminar timings" must NOT skip grounding, since RAG is where the
 * answers live. So we match against an explicit allowlist with punctuation
 * stripped, and cap at 30 chars to avoid greedy false positives.
 */
const SHORT_ACK_SET = new Set([
  // English
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'kk', 'hmm', 'mhm', 'sure', 'right',
  'fine', 'great', 'nice', 'good', 'cool', 'alright', 'gotcha', 'got it',
  'thanks', 'thank you', 'thank you very much', 'thanks a lot', 'thank you so much',
  'no problem', 'no worries',
  // Telugu — note: 'హలో' deliberately NOT here. Callers use "హలో" as an
  // attention-getting "are you there?" when the agent is silent; if we treat
  // it as an ack the agent stays silent and the caller hears "హలో, హలో,
  // హలో" without any reply. Same logic for English "hello".
  'హా', 'మంచిది', 'బాగుంది', 'థాంక్యూ', 'ధన్యవాదాలు', 'సరే', 'ఓకే', 'ఉమ్', 'అవును', 'అచ్ఛా',
  // Hindi
  'धन्यवाद', 'शुक्रिया', 'ठीक', 'हाँ', 'हां', 'अच्छा', 'ठीक है',
  // Tamil
  'சரி', 'ஆம்', 'நன்றி',
  // Kannada
  'ಸರಿ', 'ಧನ್ಯವಾದ', 'ಹೌದು',
  // Malayalam
  'ശരി', 'നന്ദി', 'അതെ',
]);

function isShortAck(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase().replace(/[.,!?…]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 30) return false;
  return SHORT_ACK_SET.has(t);
}

/**
 * Indic-alphabet → English-letter map used by `decodeIndicSpelling`.
 *
 * Sarvam STT transcribes a Telugu speaker spelling an English email/phone as
 * a sequence of Telugu syllables ("వి ఏ జె ఐ వి ఏ బి యు" instead of
 * "V A J I V A B U"). The LLM then reads back the wrong value because the
 * raw transcript looks like gibberish. Mapping the spelled syllables back
 * to ASCII letters lets us inject a "parsed spelling" hint into the user
 * turn so the LLM has a usable candidate to read back for confirmation.
 *
 * Each value MUST be lowercase ASCII so downstream regex stays simple.
 */
const INDIC_LETTER_MAPS: Record<string, Record<string, string>> = {
  te: {
    // Telugu — covers the common pronunciations callers actually use.
    'ఏ': 'a', 'ఎ': 'a', 'ఎయ్': 'a', 'ఆ': 'a',
    'బి': 'b', 'బీ': 'b',
    'సి': 'c', 'సీ': 'c',
    'డి': 'd', 'డీ': 'd',
    'ఈ': 'e', 'ఇ': 'e', 'ఇమ్': 'e',
    'ఎఫ్': 'f', 'ఎఫ': 'f', 'ఎఫ్ఫ్': 'f',
    'జి': 'g', 'జీ': 'g',
    'హెచ్': 'h', 'ఎచ్': 'h',
    'ఐ': 'i', 'ఆయ్': 'i',
    'జే': 'j', 'జె': 'j',
    'కే': 'k', 'కె': 'k', 'కా': 'k',
    'ఎల్': 'l', 'ఎల': 'l',
    'ఎమ్': 'm', 'ఎం': 'm',
    'ఎన్': 'n', 'ఎన': 'n',
    'ఓ': 'o', 'ఒ': 'o',
    'పి': 'p', 'పీ': 'p',
    'క్యూ': 'q', 'క్యు': 'q',
    'ఆర్': 'r', 'ఆర': 'r', 'అర్': 'r',
    'ఎస్': 's', 'ఎస': 's',
    'టి': 't', 'టీ': 't',
    'యు': 'u', 'యూ': 'u', 'ఉ': 'u',
    'వి': 'v', 'వీ': 'v',
    'డబల్యూ': 'w', 'డబల్యు': 'w', 'డబ్ల్యు': 'w',
    'ఎక్స్': 'x', 'ఎక్స': 'x',
    'వై': 'y', 'వాయ్': 'y',
    'జెడ్': 'z', 'జెడ': 'z', 'జీడ్': 'z',
  },
  hi: {
    // Hindi — most common pronunciations.
    'ए': 'a', 'अ': 'a', 'आ': 'a',
    'बी': 'b', 'बि': 'b',
    'सी': 'c', 'सि': 'c',
    'डी': 'd', 'डि': 'd',
    'ई': 'e', 'इ': 'e',
    'एफ': 'f', 'एफ़': 'f',
    'जी': 'g', 'जि': 'g',
    'एच': 'h', 'एचएच': 'h',
    'आई': 'i', 'आइ': 'i', 'अाई': 'i',
    'जे': 'j', 'जै': 'j',
    'के': 'k', 'का': 'k',
    'एल': 'l', 'एलएल': 'l',
    'एम': 'm', 'एमएम': 'm',
    'एन': 'n', 'एनएन': 'n',
    'ओ': 'o',
    'पी': 'p', 'पि': 'p',
    'क्यू': 'q', 'क्यु': 'q',
    'आर': 'r', 'अार': 'r',
    'एस': 's',
    'टी': 't', 'टि': 't',
    'यू': 'u', 'यु': 'u',
    'वी': 'v', 'वि': 'v',
    'डब्ल्यू': 'w', 'डब्लू': 'w',
    'एक्स': 'x',
    'वाई': 'y', 'वाय': 'y',
    'ज़ेड': 'z', 'जेड': 'z',
  },
};

/**
 * Map common spoken digit names (Hindi/Telugu/Tamil) into ASCII digits, in
 * addition to literal Devanagari/Telugu/Tamil digit code-points. Used by
 * `decodeIndicSpelling` so "నైన్ ఫోర్ నైన్" → "949".
 */
const SPOKEN_DIGIT_MAP: Record<string, string> = {
  // English-ish (already work but normalize the spellings Sarvam emits)
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  // Telugu
  'సున్నా': '0', 'ఒకటి': '1', 'రెండు': '2', 'మూడు': '3', 'నాలుగు': '4', 'ఐదు': '5', 'ఆరు': '6', 'ఏడు': '7', 'ఎనిమిది': '8', 'తొమ్మిది': '9',
  // Hindi
  'शून्य': '0', 'जीरो': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
  // English digits spoken (Sarvam emits these on bilingual lines)
  'नैन': '9', 'नाइन': '9', 'फोर': '4', 'थ्री': '3', 'टू': '2', 'वन': '1', 'फाइव': '5', 'सिक्स': '6', 'सेवन': '7', 'एट': '8', 'ओह': '0',
  'నైన్': '9', 'నైను': '9', 'ఫోర్': '4', 'ఫోర': '4', 'త్రీ': '3', 'త్రి': '3', 'టు': '2', 'టూ': '2', 'వన్': '1', 'వన': '1', 'ఎయిట్': '8', 'ఏట్': '8', 'సెవెన్': '7', 'సెవన్': '7', 'సిక్స్': '6', 'సిక్': '6', 'ఫైవ్': '5', 'ఫైవు': '5', 'ఫైవ్‌': '5', 'జీరో': '0', 'ఓ': '0', 'ఓహ్': '0',
};

/**
 * Indic-script domain / connector hints. Sarvam sometimes transliterates
 * "gmail" → "జీమెయిల్" / "जीमेल" — those forms don't survive `toLowerCase`
 * so the canonical English equivalent is mapped in explicitly. Each value
 * goes into the decoded output verbatim.
 */
const INDIC_DOMAIN_HINTS: Record<string, string> = {
  'జీమెయిల్': 'gmail', 'జిమెయిల్': 'gmail', 'జీమెయిల': 'gmail',
  'జీమెయిల్.కామ్': 'gmail.com', 'జీమెయిల్‌డాట్‌కామ్': 'gmail.com',
  'యాహూ': 'yahoo', 'హాట్‌మెయిల్': 'hotmail', 'ఔట్‌లుక్': 'outlook',
  'జీమేల్': 'gmail',
  'जीमेल': 'gmail', 'जीमैल': 'gmail', 'याहू': 'yahoo', 'हॉटमेल': 'hotmail',
  'आउटलुक': 'outlook',
  'డాట్': '.', 'కామ్': 'com', 'ఇన్': 'in', 'కోడాట్': 'co.',
  'डॉट': '.', 'कॉम': 'com', 'इन': 'in',
};

/**
 * Decode "spelling-mode" Indic utterances into a candidate ASCII string.
 *
 * Returns `null` when the utterance doesn't look like spelling (so the caller
 * can skip the hint). The detector accepts an utterance as spelling when at
 * least 3 tokens map cleanly to either a single ASCII letter or a digit, AND
 * ≥50% of tokens map (so a regular sentence with one stray letter-name like
 * "వి ఆర్ S.R.M" doesn't trigger).
 *
 * Email markers like "@", "gmail", "yahoo", ".com" are preserved as-is and
 * collapsed into the output, so "వి ఏ జె ఐ at gmail dot com" decodes to
 * "vaji@gmail.com".
 *
 * Example
 * -------
 *   in:  "వి ఏ జె ఐ వి ఏ బి యు 3223@gmail.com"
 *   out: "vajivabu3223@gmail.com"
 *   in:  "మొబైల్ నెంబర్ 9 4 9 3 3 2 4 7 9 5"
 *   out: "9493324795"  (the "mobile number" preamble is dropped because
 *                       only digits and letter-names map; non-mappers are
 *                       skipped as long as a strong majority map)
 */
export function decodeIndicSpelling(text: string, language: string): string | null {
  if (!text) return null;
  const langKey = String(language || '').toLowerCase().slice(0, 2);
  const letterMap = INDIC_LETTER_MAPS[langKey];
  if (!letterMap) return null;

  // Double/triple-digit normalization. Callers commonly say "double nine"
  // or "triple five" instead of repeating digits — expand these to "99"/"555"
  // BEFORE the rest of the decoder runs, so the digit regex catches them.
  // Supports English, Hindi, and Telugu phrasings.
  const REPEAT_WORD_MAP: Record<string, number> = {
    double: 2, triple: 3, quadruple: 4,
    'डबल': 2, 'ट्रिपल': 3,
    'డబల్': 2, 'ట్రిపుల్': 3, 'డబుల్': 2,
  };
  const repeatPreprocessed = (text || '').replace(
    /(double|triple|quadruple|डबल|ट्रिपल|డబల్|డబుల్|ట్రిపుల్)\s+(zero|one|two|three|four|five|six|seven|eight|nine|शून्य|एक|दो|तीन|चार|पांच|छह|सात|आठ|नौ|సున్నా|ఒకటి|రెండు|మూడు|నాలుగు|ఐదు|ఆరు|ఏడు|ఎనిమిది|తొమ్మిది|నైన్|ఫోర్|ఫైవ్|త్రీ|టు|టూ|వన్|ఎయిట్|సెవెన్|సిక్స్|जीरो|नैन|नाइन|फोर|थ्री|टू|वन|फाइव|सिक्स|सेवन|एट|0|1|2|3|4|5|6|7|8|9)\b/giu,
    (_full, repeatWord: string, digitWord: string) => {
      const n = REPEAT_WORD_MAP[repeatWord.toLowerCase()] || 2;
      const digit = SPOKEN_DIGIT_MAP[digitWord.toLowerCase()] || SPOKEN_DIGIT_MAP[digitWord] || (/^[0-9]$/.test(digitWord) ? digitWord : null);
      return digit ? digit.repeat(n) : '';
    },
  );

  // Fast-path: a single dense 10-digit run is almost certainly a mobile
  // number — return it directly without requiring the 50% confidence gate.
  // Without this, "మొబైల్ నెంబర్ వచ్చేసరికి 9493324795" fails because the
  // filler outweighs the lone digit token even though the digit run IS the
  // entire answer. Match Indian mobile shape (10 digits, starts 6-9, with
  // optional +91 / 91 prefix that we strip).
  const phoneMatch = repeatPreprocessed.match(/(?:\+?91[-\s]*)?([6-9]\d{9})\b/);
  if (phoneMatch) return phoneMatch[1];

  // Use the doubled/tripled-expanded text for the rest of the decoder.
  const decodingText = repeatPreprocessed;

  // Normalise common spoken connectors that bridge spelled letters. The
  // `/u` flag is required so `\b` honours Devanagari/Telugu word boundaries;
  // without it, "एट द रेट" (Hindi "at the rate") never matches and the "एट"
  // token gets misread as the digit 8 by the SPOKEN_DIGIT_MAP fallback.
  let normalised = decodingText
    .replace(/\bat\s+the\s+rate\b/giu, '@')
    .replace(/\bat\s+gmail/giu, '@gmail')
    .replace(/\bat\s+yahoo/giu, '@yahoo')
    .replace(/\bdot\s+com\b/giu, '.com')
    .replace(/\bdot\s+in\b/giu, '.in')
    .replace(/\bdot\s+co\s+dot\s+in\b/giu, '.co.in')
    .replace(/(^|\s)అట్\s+ద\s+రేట్(\s|$)/giu, '$1@$2')
    .replace(/(^|\s)డాట్\s+కామ్(\s|$)/giu, '$1.com$2')
    .replace(/(^|\s)డాట్\s+ఇన్(\s|$)/giu, '$1.in$2')
    .replace(/(^|\s)एट\s+द\s+रेट(\s|$)/giu, '$1@$2')
    .replace(/(^|\s)डॉट\s+कॉम(\s|$)/giu, '$1.com$2')
    .replace(/(^|\s)डॉट\s+इन(\s|$)/giu, '$1.in$2')
    // Email punctuation words → symbols. "dot com"/"dot in" are handled above;
    // a remaining standalone "dot" becomes "." (e.g. "rahul dot reddy").
    .replace(/\bunder[\s-]?score\b/giu, '_')
    .replace(/\b(hyphen|dash)\b/giu, '-')
    .replace(/\bdot\b/giu, '.')
    .replace(/(^|\s)డాట్(\s|$)/giu, '$1.$2')
    .replace(/(^|\s)అండర్\s*స్కోర్(\s|$)/giu, '$1_$2')
    .replace(/(^|\s)హైఫన్(\s|$)/giu, '$1-$2');

  // Tokenise on whitespace + common separators (commas/hyphens).
  const tokens = normalised
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 3) return null;

  const decoded: string[] = [];
  let mappedCount = 0;
  let totalConsidered = 0;

  for (const raw of tokens) {
    // Strip surrounding punctuation but keep internal symbols (@, ., 0-9).
    const t = raw.replace(/^[.,!?;:'"`]+|[,!?;:'"`]+$/g, '');
    if (!t) continue;
    totalConsidered++;

    // ASCII letter (single char) — keep
    if (/^[a-zA-Z]$/.test(t)) { decoded.push(t.toLowerCase()); mappedCount++; continue; }
    // ASCII digit run — keep
    if (/^[0-9]+$/.test(t)) { decoded.push(t); mappedCount++; continue; }
    // Embedded email atoms — keep (incl. _ and - from underscore/hyphen words)
    if (/[@._-]/.test(t)) { decoded.push(t.toLowerCase()); mappedCount++; continue; }
    // Devanagari / Telugu / Tamil etc. digit codepoint runs (rare but seen).
    if (/^[०-९૦-૯௦-௯౦-౯೦-೯൦-൯]+$/.test(t)) {
      const ascii = t.replace(/./g, (ch) => {
        const code = ch.codePointAt(0)!;
        if (code >= 0x0966 && code <= 0x096F) return String(code - 0x0966);
        if (code >= 0x0AE6 && code <= 0x0AEF) return String(code - 0x0AE6);
        if (code >= 0x0BE6 && code <= 0x0BEF) return String(code - 0x0BE6);
        if (code >= 0x0C66 && code <= 0x0C6F) return String(code - 0x0C66);
        if (code >= 0x0CE6 && code <= 0x0CEF) return String(code - 0x0CE6);
        if (code >= 0x0D66 && code <= 0x0D6F) return String(code - 0x0D66);
        return ch;
      });
      decoded.push(ascii); mappedCount++; continue;
    }
    // Indic letter-pronunciation
    const lower = t.toLowerCase();
    const letter = letterMap[t] || letterMap[lower];
    if (letter) { decoded.push(letter); mappedCount++; continue; }
    // Spoken digit name
    const digit = SPOKEN_DIGIT_MAP[t] || SPOKEN_DIGIT_MAP[lower];
    if (digit) { decoded.push(digit); mappedCount++; continue; }
    // Domain hints (case-insensitive) — keep verbatim, contributes to confidence.
    if (/^(gmail|yahoo|hotmail|outlook|rediffmail|protonmail|icloud)$/i.test(t)) {
      decoded.push(t.toLowerCase()); mappedCount++; continue;
    }
    // Indic-script domain / dot / com hints (Sarvam transliterates "gmail"
    // → "జీమెయిల్" / "जीमेल"). Map to canonical English so the parsed
    // address looks like "vaji@gmail.com" instead of "vajiజీమెయిల్".
    const indicDomain = INDIC_DOMAIN_HINTS[t] || INDIC_DOMAIN_HINTS[lower];
    if (indicDomain) { decoded.push(indicDomain); mappedCount++; continue; }
    // Otherwise: skip — but don't penalise the count, this token is just
    // ignored. Non-mapping words like "మొబైల్ నెంబర్" are filler.
  }

  if (mappedCount < 3) return null;
  // Require a meaningful majority so a sentence with ONE letter-name doesn't
  // trigger. totalConsidered may include filler that was skipped — base the
  // ratio on total tokens, not on mapped subset.
  if (mappedCount / Math.max(1, totalConsidered) < 0.5) return null;

  // Stitch the decoded tokens into a contiguous string. Letters/digits glue
  // directly together; multi-char domain hints ("gmail", ".", "com") also
  // glue. The result for ["v","a","j","i","v","a","b","u","3223","@","gmail",".","com"]
  // is "vajivabu3223@gmail.com" — exactly what we want for an email.
  let out = decoded.join('');
  // Common Sarvam pattern: ends with "gmail" / "yahoo" but missed the @.
  // If we have ≥3 letters followed by a recognised domain stem and no @,
  // splice @ in front of the domain so the LLM gets a usable email shape.
  out = out.replace(/([a-z0-9.]{3,})(gmail|yahoo|hotmail|outlook|rediffmail|protonmail|icloud)(\.[a-z.]+)?$/, '$1@$2$3');
  // Trail off with ".com" if a domain stem was emitted without a TLD.
  out = out.replace(/@(gmail|yahoo|hotmail|outlook|rediffmail|protonmail|icloud)$/, '@$1.com');
  // Tidy duplicate at-signs or dots that the user/STT may have emitted twice.
  out = out.replace(/@+/g, '@').replace(/\.{2,}/g, '.').replace(/\s+/g, '');
  // Lowercase canonical form for emails; digit runs are already ASCII.
  return out.toLowerCase();
}

// ----- Slot extraction + confirmation -------------------------------------
//
// Structured field capture. Runs on every user utterance to populate
// `session.collectedFields` from regex / decoder / heuristic extraction. The
// goal is to give the LLM a SINGLE structured view of what's been captured
// so it stops re-asking confirmed fields and reads back unconfirmed ones.
//
// We never overwrite a CONFIRMED slot. New extractions with higher confidence
// for an unconfirmed slot replace the old value.

type SlotName = 'name' | 'mobile' | 'email' | 'course' | 'city' | 'callback_time' | 'university';
type Slot = { value: string; confidence: number; confirmed: boolean; source: string };

const VALID_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const VALID_INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/** Pull a 10-digit Indian mobile out of a phone-shaped string, or null. */
function extractMobile(text: string): string | null {
  if (!text) return null;
  // Try the spelling decoder's phone fast-path first (it strips +91 / 91).
  const m = text.match(/(?:\+?91[-\s]*)?([6-9]\d{9})\b/);
  if (m) return m[1];
  // Sometimes the user gives the number with spaces or "double/triple" already
  // normalised by decodeIndicSpelling — try a digit-run fallback.
  const digits = text.replace(/[^\d]/g, '');
  if (VALID_INDIAN_MOBILE_RE.test(digits)) return digits;
  // Or maybe the +91 was emitted as part of a longer digit run (12 digits).
  if (digits.length === 12 && digits.startsWith('91') && VALID_INDIAN_MOBILE_RE.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return null;
}

/** Pull an email out of a string, or null. Decoder runs first; this is the
 *  final sanity-check on the post-decoded text. */
function extractEmail(text: string): string | null {
  if (!text) return null;
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (!m) return null;
  const candidate = m[0].toLowerCase();
  return VALID_EMAIL_RE.test(candidate) ? candidate : null;
}

/** Detect explicit affirmative confirmation in the caller's language(s). Used
 *  to flip the most-recently-touched UNCONFIRMED slot to confirmed when the
 *  caller agrees to the agent's read-back. */
function isAffirmative(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return /\b(yes|yeah|correct|right|that('?s)?\s+right|that('?s)?\s+correct|ok(ay)?|sure|absolutely)\b/i.test(t)
    || /(సరి|సరిగ్గా|కరెక్ట్|అవును|నిజమే|హా|ఓకే|సరే)/.test(t)
    || /(हाँ|हां|सही|बिलकुल|ठीक|ओके|एकदम)/.test(t)
    || /(ஆம்|சரி|நிச்சயம்|ஓகே)/.test(t)
    || /(ಹೌದು|ಸರಿ|ಸರಿಯಾಗಿದೆ|ಓಕೆ)/.test(t)
    || /(അതെ|ശരി|കൃത്യം)/.test(t);
}

function isNegative(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return /\b(no|nope|wrong|incorrect|not\s+(right|correct))\b/i.test(t)
    || /(కాదు|తప్పు|వద్దు)/.test(t)
    || /(नहीं|गलत|नही)/.test(t)
    || /(இல்லை|தவறு)/.test(t)
    || /(ಇಲ್ಲ|ತಪ್ಪು)/.test(t)
    || /(ഇല്ല|തെറ്റ്)/.test(t);
}

/**
 * Extract slot values from a single user utterance. Writes into `dst` in
 * place. NEVER overwrites a confirmed slot. Higher-confidence extractions
 * replace existing unconfirmed slots; lower-confidence ones are dropped.
 *
 * `spellingHint` is the decoder's parsed ASCII candidate (if any) — that's
 * usually higher confidence than free-text regex because the decoder
 * normalised the syllables.
 */
function extractSlotsFromUtterance(
  text: string,
  spellingHint: string | null,
  dst: { [k in SlotName]?: Slot },
): SlotName[] {
  const updated: SlotName[] = [];
  const writeSlot = (name: SlotName, slot: Slot) => {
    const cur = dst[name];
    if (cur?.confirmed) return; // never overwrite confirmed
    if (!cur || slot.confidence >= cur.confidence) {
      dst[name] = slot;
      updated.push(name);
    }
  };

  // Mobile from decoder hint (high confidence) OR regex on raw text (medium).
  const mobileFromHint = spellingHint ? extractMobile(spellingHint) : null;
  if (mobileFromHint) {
    writeSlot('mobile', { value: mobileFromHint, confidence: 0.92, confirmed: false, source: 'spelling_decoder' });
  } else {
    const mobileFromText = extractMobile(text);
    if (mobileFromText) writeSlot('mobile', { value: mobileFromText, confidence: 0.78, confirmed: false, source: 'regex' });
  }

  // Email from decoder hint (high confidence) OR regex on raw text.
  const emailFromHint = spellingHint ? extractEmail(spellingHint) : null;
  if (emailFromHint) {
    writeSlot('email', { value: emailFromHint, confidence: 0.9, confirmed: false, source: 'spelling_decoder' });
  } else {
    const emailFromText = extractEmail(text);
    if (emailFromText) writeSlot('email', { value: emailFromText, confidence: 0.8, confirmed: false, source: 'regex' });
  }

  return updated;
}

/**
 * Compute the "[CAPTURED SO FAR: …]" hint string that gets appended to the
 * LLM's view of the user turn. Returns '' when no slots have been collected
 * yet so the prompt stays short on early turns.
 *
 * Format the LLM sees:
 *   [CAPTURED SO FAR: name="Rahul" (confirmed), mobile=9876543210 (UNCONFIRMED — read back),
 *    email=rahul@gmail.com (UNCONFIRMED — read back). DO NOT re-ask confirmed fields.]
 */
function buildSlotHint(slots: { [k in SlotName]?: Slot }): string {
  const parts: string[] = [];
  const ORDER: SlotName[] = ['name', 'mobile', 'email', 'course', 'university', 'city', 'callback_time'];
  for (const key of ORDER) {
    const s = slots[key];
    if (!s || !s.value) continue;
    const status = s.confirmed ? 'CONFIRMED' : 'UNCONFIRMED — read back letter-by-letter and ask if correct';
    parts.push(`${key}=${JSON.stringify(s.value)} (${status})`);
  }
  if (parts.length === 0) return '';
  return `\n[CAPTURED SO FAR: ${parts.join(', ')}. DO NOT re-ask CONFIRMED fields. Read UNCONFIRMED fields back for explicit yes/no.]`;
}

async function callLLM(
  agent: any,
  history: Array<{ role: string; content: string }>,
  customerName: string | null,
  callType: string | null,
  language?: string | null,
  campaignContext?: CampaignContext,
): Promise<string> {
  const basePrompt = agent.system_prompt || 'helpful customer conversation';

  // Latency optimization 1: skip ALL grounding fetches when the last user
  // utterance is a pure acknowledgement ("ok", "thanks", "హా", etc.). Saves
  // ~500–1500ms per ack turn because Wikipedia/Tavily/RAG don't fire. The
  // ack still gets a reply — just from the prompt + history, which is what
  // the LLM needs for "anything else?" type follow-ups anyway.
  const lastUserUtter = history.length > 0 && history[history.length - 1].role === 'user'
    ? history[history.length - 1].content : '';
  const skipGrounding = isShortAck(lastUserUtter);

  // Grounding strategy — three parallel sources, slowest sets the floor:
  //   1. Wikipedia (always, both langs) — encyclopedia facts: cast, plot,
  //      director, dates. ~800ms typical, public, no key.
  //   2. Tavily live search (only for "trending/today/news/latest" queries)
  //      — current data Wikipedia can't have: today's news, trending tools,
  //      stock prices, latest releases. ~1.5-2s. Conditional so we don't
  //      burn the 1000/month free quota on plain "tell me about Animal".
  //   3. Internal RAG (English calls only) — anything we've ingested into
  //      the agent's knowledge base. Skipped for Indic to keep Sarvam-M's
  //      context small.
  const isIndic = !!(language && !/^en/i.test(language) && sarvamCanHandle(language));
  // Grounding strategy by path:
  //  - Campaign calls skip Wikipedia + Tavily (external HTTP, 0.5–1.5s).
  //  - Indic (Sarvam) calls skip RAG too because Sarvam-M only has a
  //    7192-token context — RAG chunks were pushing prompts past it,
  //    causing 422 errors and the say-again loop. RAG is restored for
  //    English/ai-runtime calls (Gemini has 1M+ context, plenty of room).
  const isCampaignCall = !!(campaignContext && campaignContext.instruction);
  const skipExternalGrounding = skipGrounding || isCampaignCall;
  const skipRag = skipGrounding || isIndic;
  const [webContext, liveContext, ragContext] = await Promise.all([
    skipExternalGrounding ? Promise.resolve('') : fetchWebContext(agent, history, language || null),
    skipExternalGrounding ? Promise.resolve('') : fetchLiveSearchContext(history),
    skipRag ? Promise.resolve('') : fetchRagContext(agent, history),
  ]);
  const groundingContext = (liveContext || '') + (webContext || '') + (ragContext || '');
  const systemPrompt = buildVoiceAgentPrompt(basePrompt + groundingContext, agent, {
    customerName,
    callType,
    language: language || undefined,
    campaignInstruction: campaignContext?.instruction || null,
    contactVariables: campaignContext?.variables || null,
    isFollowup: !!(campaignContext as any)?.isFollowup,
    isFeedback: !!(campaignContext as any)?.isFeedback,
    stage: (campaignContext as any)?.stage || null,
  });

  // Latency optimization 2: trim history to the last 14 turns. Sarvam-M is
  // sensitive to abrupt history cuts — when we tried 10 the model started
  // returning empty replies (its <think> block ate the response slot) and
  // the agent fell back to "say-again" on every turn. 14 preserves enough
  // dialogue tail without blowing context. Do NOT lower this again.
  const trimmedHistory = history.length > 10 ? history.slice(-10) : history;

  // Indic path: call Sarvam directly. CRITICAL — Sarvam-M's context window
  // is ONLY 7192 tokens. Build a SLIM system prompt for Sarvam that
  // contains only the essentials (~800-1200 tokens) instead of the full
  // 3500-4500-token English prompt the ai-runtime path uses. This leaves
  // ~5000 tokens for history + reply, which is plenty even for Telugu/
  // Hindi conversations where Indic tokens are heavy. RAG is skipped on
  // the Sarvam path (see fetchRagContext call above) for the same reason.
  if (isIndic && sarvamConfigured()) {
    const slimPrompt = buildVoiceAgentPromptSlim(basePrompt, agent, {
      customerName,
      callType,
      language: language || undefined,
      campaignInstruction: campaignContext?.instruction || null,
      contactVariables: campaignContext?.variables || null,
      isFollowup: !!(campaignContext as any)?.isFollowup,
    isFeedback: !!(campaignContext as any)?.isFeedback,
    stage: (campaignContext as any)?.stage || null,
    });
    const sarvamHistory = trimmedHistory.length > 10 ? trimmedHistory.slice(-10) : trimmedHistory;
    let sarvamReply = await callSarvamLLM({
      systemPrompt: slimPrompt,
      messages: sarvamHistory.slice(-4),
      maxTokens: 500,
      temperature: 0.5,
    });
    if (!sarvamReply && sarvamHistory.length > 4) {
      sarvamReply = await callSarvamLLM({
        systemPrompt: slimPrompt,
        messages: sarvamHistory.slice(-4),
        maxTokens: 1000,
        temperature: 0.5,
      });
    }
    if (sarvamReply) return sarvamReply;

    // Both Sarvam attempts failed. We do NOT fall through to ai-runtime
    // here because that path ends in mock-English when Gemini is 429'd —
    // and an English template on a Hindi/Telugu call is the worst possible
    // outcome. Instead emit a native "could you say that again?" so the
    // caller stays in their own language.
    logger.warn(
      { language, historyLen: history.length },
      'callLLM: Sarvam returned null twice on Indic call — emitting native say-again',
    );
    const lang = String(language).toLowerCase();
    return SAY_AGAIN[lang] || SAY_AGAIN[lang.slice(0, 2)] || 'Sorry, could you say that again?';
  }

  try {
    const aiRuntimeUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';
    const resp = await fetch(`${aiRuntimeUrl}/chat/simple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        messages: trimmedHistory,
        provider: agent.llm_provider || 'google',
        model: agent.llm_model || 'gemini-2.5-flash',
        temperature: 0.5,
        max_tokens: 250,
        knowledge_base_ids: Array.isArray(agent?.knowledge_base_ids) ? agent.knowledge_base_ids : [],
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
        temperature: 0.5,
      });
      if (fallback) return fallback;
    }
    const reply = (data.reply || '').trim();

    // Language-mismatch guard: if the call is in an Indic language but the
    // reply has zero Indic-script characters, the LLM (mock or otherwise)
    // produced English on a Hindi/Telugu/Tamil call. Replace with a polite
    // "say-that-again" in the call's language so the caller doesn't hear
    // canned English on a Hindi call. We've already exhausted Sarvam in the
    // chain above, so this is the last line of defence.
    if (isIndic && reply && !hasIndicScript(reply)) {
      logger.warn(
        { language, replyPreview: reply.slice(0, 80) },
        'callLLM: Latin-only reply on Indic call — replacing with native say-again',
      );
      return SAY_AGAIN[String(language).toLowerCase()] || SAY_AGAIN[String(language).slice(0, 2).toLowerCase()] || reply;
    }
    return reply;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'callLLM failed in stream handler');
    return '';
  }
}

/** True when the text contains any Devanagari / Telugu / Tamil / Kannada /
 *  Malayalam / Bengali / Gujarati / Gurmukhi / Oriya code-point. Used to spot
 *  an English-only reply on an Indic-language call. */
function hasIndicScript(text: string): boolean {
  return /[ऀ-ॿ਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/.test(text);
}

/**
 * Token-streaming LLM call for the ai-runtime path.
 *
 * Mirrors callLLM's grounding/RAG/Sarvam-fallback decisions but uses the
 * /chat/simple-stream SSE endpoint so we can hand each finished sentence to
 * TTS as soon as it's complete, instead of waiting for the whole reply.
 *
 * `onSentence` fires every time a sentence-terminator is detected in the
 * accumulating buffer (latin .!? + Devanagari ।॥). The whole accumulated
 * reply is returned at the end so the caller can persist it to the
 * transcript / apply trimReplyForVoice + dedupeReply.
 *
 * Indic / Sarvam path is NOT streamed here — Sarvam-M emits a <think>…</think>
 * reasoning block that has to be fully received and stripped before any of
 * the actual reply is usable. Caller should keep using callLLM for Indic.
 *
 * Returns '' on any error (matching callLLM's contract).
 */
async function streamLLMReply(
  agent: any,
  history: Array<{ role: string; content: string }>,
  customerName: string | null,
  callType: 'inbound' | 'outbound',
  language: string | null,
  campaignContext: { instruction: string | null; variables: Record<string, any> } | null,
  onSentence: (sentence: string) => void,
): Promise<string> {
  if (!agent) return '';
  const basePrompt = agent.system_prompt || 'helpful customer conversation';
  const lastUserUtter = history.length > 0 && history[history.length - 1].role === 'user'
    ? history[history.length - 1].content : '';
  const skipGrounding = isShortAck(lastUserUtter);
  const isIndic = !!(language && !/^en/i.test(language) && sarvamCanHandle(language));
  const isCampaignCall = !!(campaignContext && campaignContext.instruction);
  const skipExternalGrounding = skipGrounding || isCampaignCall;
  const skipRag = skipGrounding || isIndic;
  const [webContext, liveContext, ragContext] = await Promise.all([
    skipExternalGrounding ? Promise.resolve('') : fetchWebContext(agent, history, language || null),
    skipExternalGrounding ? Promise.resolve('') : fetchLiveSearchContext(history),
    skipRag ? Promise.resolve('') : fetchRagContext(agent, history),
  ]);
  const groundingContext = (liveContext || '') + (webContext || '') + (ragContext || '');
  const systemPrompt = buildVoiceAgentPrompt(basePrompt + groundingContext, agent, {
    customerName,
    callType,
    language: language || undefined,
    campaignInstruction: campaignContext?.instruction || null,
    contactVariables: campaignContext?.variables || null,
    isFollowup: !!(campaignContext as any)?.isFollowup,
    isFeedback: !!(campaignContext as any)?.isFeedback,
    stage: (campaignContext as any)?.stage || null,
  });
  const trimmedHistory = history.length > 10 ? history.slice(-10) : history;

  // Indic path: HYBRID Gemini-first → Sarvam-fallback for latency.
  // Sarvam-M's <think> block makes it 1.5–3s per turn; Gemini-Flash returns
  // in 500–800ms. We try Gemini first with an explicit "REPLY ONLY IN <lang>"
  // instruction, check the output actually contains the right script, and
  // fall back to Sarvam-M only when Gemini drifted to English. This keeps
  // most turns fast while preserving Sarvam-quality Telugu on the rare miss.
  //
  // Gemini cooldown: when Gemini returns mock=true (rate-limited / no-key),
  // we set a process-wide cooldown for the next 5 minutes. During that
  // window every Indic call skips Gemini entirely and goes straight to
  // Sarvam — saving the ~1.5s wasted fetch + 30s retry-delay per turn when
  // the free-tier 20-RPD limit is exhausted. Cooldown resets on any
  // successful Gemini hit so the fast path resumes the moment quota frees.
  if (isIndic) {
    const slimPrompt = buildVoiceAgentPromptSlim(basePrompt, agent, {
      customerName,
      callType,
      language: language || undefined,
      campaignInstruction: campaignContext?.instruction || null,
      contactVariables: campaignContext?.variables || null,
      isFollowup: !!(campaignContext as any)?.isFollowup,
    isFeedback: !!(campaignContext as any)?.isFeedback,
    stage: (campaignContext as any)?.stage || null,
    });
    const sarvamHistory = trimmedHistory.length > 6 ? trimmedHistory.slice(-6) : trimmedHistory;

    // Language-lock the prompt so LLM doesn't drift to English mid-turn.
    const langName = (() => {
      const l = String(language || '').toLowerCase().slice(0, 2);
      return ({ te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', or: 'Odia', as: 'Assamese' } as Record<string, string>)[l] || 'the caller\'s language';
    })();
    // Build a conversation summary from history so even with trimmed context
    // the LLM knows what's already been discussed and captured.
    const histSummaryParts: string[] = [];
    for (const h of history) {
      if (h.role === 'user') histSummaryParts.push(`Customer: ${h.content.split('\n')[0].slice(0, 60)}`);
      else if (h.role === 'assistant') histSummaryParts.push(`Agent: ${h.content.slice(0, 60)}`);
    }
    const histSummary = histSummaryParts.length > 6
      ? `\n\nCALL SUMMARY SO FAR (DO NOT re-ask these):\n${histSummaryParts.slice(0, -4).map(l => `- ${l}`).join('\n')}`
      : '';

    // Keep this append SHORT: the slim prompt already carries brevity, one-
    // question, voice-friendly and anti-repetition rules. Re-stating them all
    // (plus a full call summary) every turn made each Groq request ~1600+
    // tokens, which exhausted Groq's per-minute token budget after ~1-2 turns
    // → 429 → fall back to slow Sarvam. This compact lock keeps requests small
    // so fast Groq stays primary. (histSummary dropped — the message history is
    // already passed to the model below.)
    const langLockedPrompt = `${slimPrompt}\n\nLANGUAGE: Reply ONLY in ${langName} script (course/branch names too: బీటెక్, సీఎస్ఈ, ఐటీ, ఏఐ — never English letters or dotted abbreviations). ONE short complete sentence, under 18 words, ONE question max. Acknowledge their last answer in 2-3 words, then move FORWARD — never repeat a question already asked.`;

    // Single-model strategy: Groq llama is the fastest and most reliable for
    // Indic voice. Only fall back to Sarvam if Groq is down.
    let finalReply: string | null = null;
    // True once we've emitted sentences to onSentence DURING streaming, so the
    // tail emit below doesn't double-speak the reply.
    let streamedSentences = false;
    const t0 = Date.now();

    // Incremental sentence emitter: as Groq streams tokens we flush each
    // COMPLETE sentence to onSentence the instant its terminator arrives, so
    // the first sentence's TTS starts ~300ms in instead of after the whole
    // reply finishes generating. This is the main latency win for Telugu/Hindi.
    let emitBuf = '';
    const SENT_BOUNDARY_INDIC = /^[\s\S]*?[.!?।॥](?=\s|$|["')\]])/u;
    const flushIndicSentences = (force: boolean) => {
      while (true) {
        const m = emitBuf.match(SENT_BOUNDARY_INDIC);
        if (!m) break;
        const s = m[0].trim();
        emitBuf = emitBuf.slice(m[0].length).replace(/^\s+/, '');
        if (s) { onSentence(s); streamedSentences = true; }
      }
      if (force && emitBuf.trim()) { onSentence(emitBuf.trim()); emitBuf = ''; streamedSentences = true; }
    };

    // PRIMARY: Groq — try multiple models, each with its OWN rate-limit pool, so
    // a 429 on one rolls to another FAST model before falling back to slow
    // Sarvam. Order: fastest/best-Telugu first. Each pool is independent, so
    // adding models materially raises the odds a turn stays on fast Groq (~1s)
    // instead of Sarvam (~2.5s).
    const groqKey = config.groq?.apiKey || process.env.GROQ_API_KEY || '';
    const groqModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it'];
    // Telugu/Indic is token-heavy in the llama tokenizer — 120 tokens cut
    // replies mid-word ("…ఈశ్వరుని ఆ."). 300 gives a 1-2 sentence Telugu reply
    // room to FINISH; brevity is enforced by the prompt (model stops naturally
    // at end-of-reply, finish_reason=stop, well before this cap), so this only
    // prevents mid-sentence truncation, it does NOT make replies longer.
    const groqMaxTokens = Number(process.env.GROQ_MAX_TOKENS) || 300;
    if (groqKey) {
      for (const groqModel of groqModels) {
        if (finalReply) break;
        try {
          const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${groqKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: groqModel,
              messages: [
                { role: 'system', content: langLockedPrompt },
                ...sarvamHistory,
              ],
              temperature: 0.4,
              max_tokens: groqMaxTokens,
              stream: true,
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (groqResp.ok && (groqResp as any).body) {
            const reader = (groqResp.body as any).getReader();
            const decoder = new TextDecoder();
            let acc = '';
            let sseAccum = '';
            let firstTokenAt = 0;
            while (true) {
              // NOTE: no session handle in this function — barge-in is handled
              // downstream (onSentence no-ops + playback aborts on barge-in), so
              // we just let the cheap token stream finish.
              const { done, value } = await reader.read();
              if (done) break;
              sseAccum += decoder.decode(value, { stream: true });
              let nl;
              while ((nl = sseAccum.indexOf('\n')) >= 0) {
                const line = sseAccum.slice(0, nl).trim();
                sseAccum = sseAccum.slice(nl + 1);
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                  const obj = JSON.parse(payload) as any;
                  const delta = obj?.choices?.[0]?.delta?.content || '';
                  if (delta) {
                    if (!firstTokenAt) { firstTokenAt = Date.now(); logger.info({ model: groqModel, ms: firstTokenAt - t0 }, '[LLM_FIRST_TOKEN_RECEIVED]'); }
                    acc += delta;
                    emitBuf += delta;
                    flushIndicSentences(false);
                  }
                } catch { /* skip malformed SSE chunk */ }
              }
            }
            flushIndicSentences(true); // emit any trailing partial sentence
            if (acc.trim().length > 2) {
              finalReply = acc.trim();
              logger.info({ language, model: groqModel, replyLen: finalReply.length, ttftMs: firstTokenAt ? firstTokenAt - t0 : null, latencyMs: Date.now() - t0, preview: finalReply.slice(0, 80) }, 'streamLLMReply (Indic): Groq stream hit');
            }
          } else {
            const errBody = await groqResp.text().catch(() => '');
            const is429 = groqResp.status === 429;
            if (is429) {
              logger.info({ model: groqModel, latencyMs: Date.now() - t0, retryAfter: (groqResp.headers as any)?.get?.('retry-after') || null, limit: errBody.slice(0, 160) }, 'streamLLMReply (Indic): Groq 429 — trying next model');
            } else {
              logger.warn({ status: groqResp.status, model: groqModel, body: errBody.slice(0, 150), latencyMs: Date.now() - t0 }, 'streamLLMReply (Indic): Groq HTTP error');
            }
          }
        } catch (err: any) {
          logger.warn({ err: err.message, model: groqModel, latencyMs: Date.now() - t0 }, 'streamLLMReply (Indic): Groq failed');
        }
      }
    } else {
      logger.warn('streamLLMReply (Indic): GROQ_API_KEY not set — skipping Groq');
    }

    // FALLBACK: Sarvam LLM (only if Groq is unavailable)
    // Sarvam-M is a reasoning model that emits <think>...</think> before
    // the reply. Long histories cause it to burn all tokens on thinking.
    // Fix: trim to last 4 messages + use 1500 max_tokens so it has room
    // for both the think block and the actual reply.
    if (!finalReply && sarvamConfigured()) {
      let sarvamReply = await callSarvamLLM({
        systemPrompt: langLockedPrompt,
        messages: sarvamHistory.slice(-4),
        maxTokens: 1500,
        temperature: 0.4,
      });
      if (sarvamReply) {
        finalReply = sarvamReply;
        logger.info({ language, replyLen: sarvamReply.length, latencyMs: Date.now() - t0, preview: sarvamReply.slice(0, 80) }, 'streamLLMReply (Indic): Sarvam fallback hit');
      }
    }

    if (!finalReply) {
      const lang = String(language).toLowerCase();
      const sayAgain = SAY_AGAIN[lang] || SAY_AGAIN[lang.slice(0, 2)] || 'Sorry, could you say that again?';
      logger.warn({ language, historyLen: history.length, latencyMs: Date.now() - t0 }, 'streamLLMReply: all LLMs failed — emitting say-again');
      onSentence(sayAgain);
      return sayAgain;
    }
    // If Groq streamed, sentences were already emitted incrementally above —
    // don't re-emit (that would double-speak). For the buffered Sarvam fallback,
    // emit per-sentence: the first sentence's TTS starts while the rest is still
    // synthesizing, so the caller hears audio sooner (lower first-audio latency).
    // (Emitting the whole reply as one chunk made the agent wait for the entire
    // reply to synthesize before speaking — noticeably slower.)
    if (!streamedSentences) {
      const sents = finalReply.split(/(?<=[.!?।॥])\s+/u).map((s) => s.trim()).filter(Boolean);
      if (sents.length === 0) {
        onSentence(finalReply);
      } else {
        for (const s of sents) onSentence(s);
      }
    }
    return finalReply;
  }

  const aiRuntimeUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';
  let fullReply = '';
  let buffer = '';

  // Sentence-terminator regex covering latin + Devanagari + Sinhala/Indic full
  // stops. Match the first terminator + optional trailing space/quote so the
  // sentence's punctuation comes along for natural TTS prosody.
  const SENT_BOUNDARY = /^[\s\S]*?[.!?।॥](?=\s|$|["')\]])/u;
  const flushBuffer = (force: boolean) => {
    while (true) {
      const m = buffer.match(SENT_BOUNDARY);
      if (!m) break;
      const sentence = m[0].trim();
      buffer = buffer.slice(m[0].length).replace(/^\s+/, '');
      if (sentence) onSentence(sentence);
    }
    if (force && buffer.trim()) {
      onSentence(buffer.trim());
      buffer = '';
    }
  };

  try {
    const resp = await fetch(`${aiRuntimeUrl}/chat/simple-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        messages: trimmedHistory,
        provider: agent.llm_provider || 'google',
        model: agent.llm_model || 'gemini-2.5-flash',
        temperature: 0.5,
        max_tokens: 250,
        knowledge_base_ids: Array.isArray(agent?.knowledge_base_ids) ? agent.knowledge_base_ids : [],
      }),
    });
    if (!resp.ok || !resp.body) return '';
    const reader = (resp.body as any).getReader();
    const decoder = new TextDecoder();
    let sseAccum = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseAccum += decoder.decode(value, { stream: true });
      // SSE events are split by blank lines.
      let idx;
      while ((idx = sseAccum.indexOf('\n\n')) >= 0) {
        const evRaw = sseAccum.slice(0, idx);
        sseAccum = sseAccum.slice(idx + 2);
        // Each event line starts with "data: ".
        for (const line of evRaw.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload) as { type?: string; content?: string };
            if (obj.type === 'content' && obj.content) {
              buffer += obj.content;
              fullReply += obj.content;
              flushBuffer(false);
            } else if (obj.type === 'done') {
              flushBuffer(true);
            }
          } catch { /* malformed SSE chunk — skip */ }
        }
      }
    }
    flushBuffer(true);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'streamLLMReply failed');
    return '';
  }

  // Language-mismatch guard for the streamed path: same logic as callLLM.
  if (isIndic && fullReply && !hasIndicScript(fullReply)) {
    logger.warn(
      { language, replyPreview: fullReply.slice(0, 80) },
      'streamLLMReply: Latin-only reply on Indic call — falling back to native say-again',
    );
    const lang = String(language).toLowerCase();
    return SAY_AGAIN[lang] || SAY_AGAIN[lang.slice(0, 2)] || fullReply;
  }
  return fullReply.trim();
}

const SAY_AGAIN: Record<string, string> = {
  'hi-IN': 'माफ़ कीजिए, क्या आप दोबारा बोल सकते हैं?',
  hi: 'माफ़ कीजिए, क्या आप दोबारा बोल सकते हैं?',
  'te-IN': 'క్షమించండి, మీరు మళ్ళీ చెప్పగలరా?',
  te: 'క్షమించండి, మీరు మళ్ళీ చెప్పగలరా?',
  'ta-IN': 'மன்னிக்கவும், மீண்டும் சொல்ல முடியுமா?',
  ta: 'மன்னிக்கவும், மீண்டும் சொல்ல முடியுமா?',
  'kn-IN': 'ಕ್ಷಮಿಸಿ, ಮತ್ತೊಮ್ಮೆ ಹೇಳುವಿರಾ?',
  kn: 'ಕ್ಷಮಿಸಿ, ಮತ್ತೊಮ್ಮೆ ಹೇಳುವಿರಾ?',
  'ml-IN': 'ക്ഷമിക്കണം, ഒന്ന് കൂടി പറയാമോ?',
  ml: 'ക്ഷമിക്കണം, ഒന്ന് കൂടി പറയാമോ?',
  'mr-IN': 'माफ करा, परत बोलाल का?',
  mr: 'माफ करा, परत बोलाल का?',
  'bn-IN': 'দুঃখিত, আবার বলবেন?',
  bn: 'দুঃখিত, আবার বলবেন?',
  'gu-IN': 'માફ કરશો, ફરી કહેશો?',
  gu: 'માફ કરશો, ફરી કહેશો?',
  'pa-IN': 'ਮੁਆਫ਼ ਕਰਨਾ, ਦੁਬਾਰਾ ਕਹੋਗੇ?',
  pa: 'ਮੁਆਫ਼ ਕਰਨਾ, ਦੁਬਾਰਾ ਕਹੋਗੇ?',
};

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
    // Append a short mulaw-silence tail (parity with Sarvam) so the final word
    // isn't clipped at the audio boundary on jittery PSTN paths. Deepgram is
    // only a last-resort fallback now (Sarvam is the pinned premium voice), but
    // keep the guard so a fallback turn doesn't sound truncated.
    const tailMs = Number(process.env.TTS_TRAILING_SILENCE_MS) || 60;
    const tail = Buffer.alloc(Math.round(8000 * tailMs / 1000), 0xff);
    return Buffer.concat([buf, tail]).toString('base64');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Deepgram TTS (mulaw) error');
    return null;
  }
}

// ---- session state ---------------------------------------------------------

/**
 * Replace {{var}} placeholders in a template with values from `vars`. Missing
 * keys collapse to empty + extra whitespace is cleaned so a missing {{name}}
 * doesn't leave "Hello , this is Priya". Used for the per-contact welcome
 * message in outbound campaigns.
 */
function interpolateVars(template: string, vars: Record<string, any>): string {
  if (!template) return template;
  return template
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
      const v = vars?.[key];
      return v !== undefined && v !== null && String(v).trim() ? String(v).trim() : '';
    })
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .trim();
}

type CampaignContext = {
  instruction: string | null;
  variables: Record<string, any>;
  targetName: string | null;
  campaignId: string | null;
  isFollowup?: boolean;
  /** True when this follow-up is a POST-VISIT FEEDBACK call (task type
   *  post_visit_feedback_call) — selects the feedback FLOW vs the
   *  visit-planning FLOW in the prompt builders. */
  isFeedback?: boolean;
  /** Explicit admissions-journey stage derived from call metadata:
   *  BULK_CALL | FOLLOW_UP | VISIT_PLANNING | POST_VISIT_FEEDBACK. Drives the
   *  stage-specific opening script + flow in the prompt builders. Additive —
   *  isFollowup/isFeedback remain for backward-compat. */
  stage?: 'BULK_CALL' | 'FOLLOW_UP' | 'VISIT_PLANNING' | 'POST_VISIT_FEEDBACK';
};

interface StreamSession {
  callSid: string;
  agentId: string;
  tenantId: string;
  agent: any | null;
  callerNumber: string;
  calledNumber: string;
  conversationId: string | null;
  streamId: string | null;
  // OmniDim-style runtime overlay: set in onStart from calls.metadata when the
  // dial was kicked by the campaign runner. Used to (a) interpolate the
  // greeting and (b) inject CAMPAIGN_CONTEXT + CONTACT_CONTEXT into every LLM
  // turn so the agent acts on the per-contact data without permanently
  // modifying the agent record.
  campaignContext: CampaignContext;
  language: string;          // agent voice_config.language, normalized
  sttBackend: 'deepgram' | 'azure' | 'sarvam' | 'whisper' | null;
  ttsBackend: 'deepgram' | 'azure' | 'sarvam';
  /** Pinned Sarvam speaker id for the single-premium-voice path. Locked once
   *  in onStart and reused for every turn / language switch / STT fallback so
   *  the caller hears ONE consistent voice for the whole call. */
  ttsVoiceId?: string | null;
  /** Persistent Sarvam streaming-TTS WebSocket (opened lazily, reused across
   *  turns). Null until first use; ttsStreamFailed latches HTTP fallback. */
  ttsStream?: any | null;
  ttsStreamFailed?: boolean;
  /** Per-turn streaming-TTS scratch state (reset each turn). */
  ttsChunkQueue?: Buffer[];
  ttsTurnDone?: boolean;
  ttsStreamError?: string | null;
  /** Consecutive Sarvam STT 429s (reset on any successful transcript). Used to
   *  retry Sarvam on transient rate-limits before downshifting to Deepgram. */
  sarvamStt429Count?: number;
  dgWs: WebSocket | null;
  /** Mulaw frame batcher — accumulates incoming 20ms frames and flushes
   *  every ~60ms (3 frames). Cuts WebSocket overhead ~3x under high
   *  concurrency without adding meaningful STT latency. Deepgram's docs
   *  recommend 20-100ms chunks; 60ms sits inside that window. */
  dgFrameBatch: Buffer[];
  dgBatchFlushTimer?: NodeJS.Timeout | null;
  /** Keepalive timer (NodeJS.Timeout) pinging Deepgram every 8s to prevent
   *  silent idle-disconnect when caller is quiet for >12s. */
  dgKeepaliveTimer?: NodeJS.Timeout | null;
  /** Reconnect attempt counter — exponential backoff 1s/2s/4s capped at 3.
   *  Resets to 0 on successful 'open'. */
  dgReconnectAttempts: number;
  /** Ring-buffer of mulaw frames received while the Deepgram WS was
   *  closed/reconnecting. Replayed on reopen so we don't miss speech that
   *  arrived during the gap. Cap ~3s = 150 frames @ 20ms each. */
  dgReplayBuffer: Buffer[];
  /** Once we've exhausted reconnect attempts, set this flag so frames stop
   *  trying to write to a dead WS and the session can downshift cleanly. */
  dgDead: boolean;
  /** The validated Deepgram language code in use. Stashed so reconnect can
   *  reopen with the same model+language pair without re-deriving it. */
  dgLang?: string;
  azureStt: AzureSttHandle | null;
  sarvamStt: SarvamSttHandle | null;
  /** Whisper STT handle — only opened when the silent-failure watchdog
   *  swaps to Whisper, OR when default_provider=whisper from agent config. */
  whisperStt: WhisperSttHandle | null;
  /** Set once when Sarvam STT hits a quota/429 error and we permanently
   * downshift this session to Deepgram. Prevents repeat downshift attempts. */
  sarvamSttDownshifted?: boolean;
  plivoWs: WebSocket | null;
  history: Array<{ role: string; content: string }>;
  inFlightReply: boolean;
  /** Watchdog timer that clears inFlightReply if the LLM call doesn't
   *  complete within 15s. Without this a hung Gemini/Sarvam request
   *  leaves the session deaf forever — utterances queue in history but
   *  no new reply ever fires. Cleared on normal LLM completion. */
  inFlightWatchdog?: NodeJS.Timeout | null;
  /** Wall-clock timestamps for the most recent turn. Used to log
   *  ttft (STT-final → LLM start) and ttfa (LLM start → first TTS audio)
   *  on LLM_RESPONSE_COMPLETED / TTS_STARTED events. */
  turn: {
    sttFinalAt: number;
    llmStartAt: number;
    ttsStartAt: number;
    audioFirstByteAt: number;
  };
  /** Set by Deepgram's `SpeechStarted` VAD event. Used for early barge-in:
   *  if the agent is mid-TTS and the user starts speaking past the grace
   *  window, we abort playback BEFORE waiting for a full final transcript,
   *  shaving 400-600ms off interrupt latency. */
  userSpeechStartedAt: number;
  /** High-level conversation state — derived from the existing boolean
   *  flags (isAgentSpeaking, inFlightReply, callEnded) via setCallState().
   *  STATE_CHANGE events surface every transition so ops can spot stuck
   *  states (e.g. THINKING for >15s = LLM hang). */
  callState: CallState;
  /** Per-agent barge-in grace override (ms). Falls back to language-default
   *  via bargeInGraceMs() when null. Set once from agent.voice_config. */
  agentBargeInGraceMs?: number | null;
  /** Provider preference from agent.voice_config.default_provider:
   *  "deepgram" (default) | "sarvam" | "auto" (legacy Indic→Sarvam). */
  providerPref?: string;
  /** True when voice_config.enable_auto_fallback is set — armed-only
   *  silent-failure watchdog will swap STT to Sarvam mid-call. */
  enableAutoFallback?: boolean;
  /** Wall-clock of the most recent SUBSTANTIVE STT event (non-empty partial
   *  or non-empty final). SpeechStarted does NOT reset this — that's a VAD
   *  signal, not a sign Deepgram is actually transcribing. */
  lastSttEventAt?: number;
  /** Timer that periodically checks how long since lastSttEventAt; fires the
   *  Sarvam/Whisper fallback when threshold crossed. */
  sttSilenceWatchdog?: NodeJS.Timeout | null;
  /** Rolling count of empty Deepgram partials in the last 3s. Each emit pushes
   *  current ts; entries older than 3s are pruned. ≥3 → fallback fires
   *  (Deepgram is "speaking" but producing junk — common on unsupported langs). */
  dgEmptyPartials?: number[];
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
  // Earliest wall-clock time barge-in is allowed for the current agent reply.
  // Set when playText() starts streaming. Suppresses barge-in for the first
  // ~1.5s of every agent reply so trivial "హలో" / "yes" interjections don't
  // chop the agent off after only a few hundred bytes of audio.
  bargeInAllowedAt: number;
  // The text the agent is currently speaking (set by playText, cleared at
  // end). dispatchUserUtterance compares incoming STT against this — if the
  // "user" utterance is just an echo of the agent's own TTS (carrier echo
  // cancellation is imperfect on PSTN), we drop it instead of triggering a
  // bogus barge-in that would spawn a duplicate, overlapping reply.
  currentAgentText: string;
  // End-of-call latch: once the caller says goodbye / thank-you-bye / cut
  // the call, we set this and stop firing the LLM on any further utterances.
  // The caller still controls the actual hangup; we just stop talking.
  callEnded: boolean;
  /**
   * Structured per-field slot store. Populated incrementally as the caller
   * gives details — overrides what the LLM might otherwise dump-collect, and
   * is the single source of truth for what gets persisted to CRM at call end.
   *
   * Each slot tracks:
   *  - value: extracted text (canonical, post-decode)
   *  - confidence: 0–1 score from extraction heuristic / decoder
   *  - confirmed: caller verbally agreed when the agent read it back ("yes correct")
   *  - source: where it came from ("spelling_decoder", "regex", "llm_extract", "csv_var")
   *
   * Used by:
   *  - injectSlotHint(): emits "[CAPTURED SO FAR: name=Rahul (confirmed), mobile=… (unconfirmed)]"
   *    into the LLM's view of each user turn so the agent NEVER re-asks a confirmed
   *    field and treats unconfirmed ones as needing read-back.
   *  - createLeadFromAnalysis(): merges slot store with analyzer extraction; slot
   *    store wins on conflict because it has explicit caller confirmation.
   */
  collectedFields: {
    name?: { value: string; confidence: number; confirmed: boolean; source: string };
    mobile?: { value: string; confidence: number; confirmed: boolean; source: string };
    email?: { value: string; confidence: number; confirmed: boolean; source: string };
    course?: { value: string; confidence: number; confirmed: boolean; source: string };
    city?: { value: string; confidence: number; confirmed: boolean; source: string };
    callback_time?: { value: string; confidence: number; confirmed: boolean; source: string };
    university?: { value: string; confidence: number; confirmed: boolean; source: string };
  };
  isInbound: boolean;
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
    const directionFromUrl = (url.searchParams.get('direction') || '').toLowerCase();
    const isInbound = directionFromUrl === 'inbound';

    const session: StreamSession = {
      callSid: callSidFromUrl,
      agentId,
      tenantId,
      agent: null,
      callerNumber: callerFromUrl,
      calledNumber: calledFromUrl,
      conversationId: null,
      streamId: null,
      isInbound,
      campaignContext: { instruction: null, variables: {}, targetName: null, campaignId: null },
      language: 'en-IN',
      sttBackend: null,
      ttsBackend: 'deepgram',
      ttsVoiceId: null,
      dgWs: null,
      dgFrameBatch: [],
      dgBatchFlushTimer: null,
      dgKeepaliveTimer: null,
      dgReconnectAttempts: 0,
      dgReplayBuffer: [],
      dgDead: false,
      azureStt: null,
      sarvamStt: null,
      whisperStt: null,
      plivoWs: plivoWs,
      history: [],
      inFlightReply: false,
      inFlightWatchdog: null,
      turn: { sttFinalAt: 0, llmStartAt: 0, ttsStartAt: 0, audioFirstByteAt: 0 },
      userSpeechStartedAt: 0,
      callState: 'IDLE',
      agentBargeInGraceMs: null,
      providerPref: 'deepgram',
      enableAutoFallback: false,
      lastSttEventAt: 0,
      sttSilenceWatchdog: null,
      dgEmptyPartials: [],
      closed: false,
      callerMulaw: [],
      callerBytes: 0,
      agentMulawEvents: [],
      isAgentSpeaking: false,
      bargeInRequested: false,
      bargeInAllowedAt: 0,
      currentAgentText: '',
      callEnded: false,
      collectedFields: {},
    };

    logger.info({ agentId, tenantId }, 'Plivo audio stream WS connected');
    emit(session, 'CALL_CONNECTED', { agent_id: agentId, tenant_id: tenantId });

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
            pushDeepgramFrame(session, audioBuf);
          } else if (session.sttBackend === 'deepgram' && !session.dgDead) {
            // Deepgram WS is reconnecting — buffer this frame to replay on
            // reopen so we don't lose mid-disconnect speech. Cap the ring
            // buffer at ~150 frames (~3s) to avoid unbounded growth if
            // reconnect never succeeds.
            const MAX_REPLAY_FRAMES = 150;
            if (session.dgReplayBuffer.length < MAX_REPLAY_FRAMES) {
              session.dgReplayBuffer.push(audioBuf);
            }
          } else if (session.sttBackend === 'azure' && session.azureStt) {
            session.azureStt.push(audioBuf);
          } else if (session.sttBackend === 'sarvam' && session.sarvamStt) {
            session.sarvamStt.push(audioBuf);
          } else if (session.sttBackend === 'whisper' && session.whisperStt) {
            session.whisperStt.push(audioBuf);
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
  // Resolve number_id (if any) so the deployed snapshot is keyed correctly.
  // Inbound: look up by the called number; outbound: by agent_id.
  let numberId: string | null = null;
  try {
    if (session.calledNumber) {
      const r = await pool.query(
        `SELECT id FROM phone_numbers
          WHERE phone_number = $1 AND tenant_id = $2 AND is_active = TRUE LIMIT 1`,
        [session.calledNumber, session.tenantId],
      );
      numberId = r.rows[0]?.id || null;
    }
    if (!numberId) {
      const r = await pool.query(
        `SELECT id FROM phone_numbers
          WHERE tenant_id = $1 AND agent_id = $2 AND is_active = TRUE
          ORDER BY deployed_at DESC NULLS LAST LIMIT 1`,
        [session.tenantId, session.agentId],
      );
      numberId = r.rows[0]?.id || null;
    }
  } catch {
    /* non-fatal */
  }
  // Load agent (snapshot first via resolver, then live fetch).
  session.agent = await loadAgent(session.agentId, session.tenantId, numberId);
  if (!session.agent) {
    logger.warn({ agentId: session.agentId }, 'Stream handler: agent load failed');
    // Play a short error + hang up the stream (Plivo will end the call)
    await playText(plivoWs, session, "Sorry, the assistant is not available right now. Goodbye.");
    try { plivoWs.close(); } catch { /* ignore */ }
    return;
  }

  // Pull the campaign overlay from calls.metadata (set by the campaign runner).
  // For non-campaign calls (inbound, ad-hoc outbound), metadata is empty and
  // we keep the zero-value overlay — system prompt blocks render to nothing.
  if (session.callSid) {
    try {
      const cr = await pool.query(
        `SELECT metadata FROM calls WHERE provider_call_sid = $1 LIMIT 1`,
        [session.callSid],
      );
      const md = (cr.rows[0]?.metadata as any) || {};
      if (md && (md.campaign_id || md.target_name || md.campaign_instruction)) {
        // Derive the explicit admissions-journey stage from existing metadata.
        // No scheduler change needed — keys off is_followup + followup_type that
        // the schedulers already thread through. isFollowup/isFeedback stay as-is.
        const followupType = String(md.followup_type || '');
        const stage: CampaignContext['stage'] =
          followupType === 'post_visit_feedback_call' ? 'POST_VISIT_FEEDBACK'
          : followupType === 'visit_confirmation' ? 'VISIT_PLANNING'
          : md.is_followup ? 'FOLLOW_UP'
          : 'BULK_CALL';
        session.campaignContext = {
          campaignId: md.campaign_id || null,
          instruction: typeof md.campaign_instruction === 'string' && md.campaign_instruction.trim()
            ? md.campaign_instruction.trim() : null,
          variables: (md.vars && typeof md.vars === 'object') ? md.vars : {},
          targetName: md.target_name || null,
          isFollowup: !!md.is_followup,
          isFeedback: md.followup_type === 'post_visit_feedback_call',
          stage,
        };
        logger.info(
          { callSid: session.callSid, stage: session.campaignContext.stage, campaignId: session.campaignContext.campaignId, hasInstruction: !!session.campaignContext.instruction, varKeys: Object.keys(session.campaignContext.variables) },
          'Stream handler: campaign overlay loaded',
        );
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load campaign overlay from calls.metadata');
    }
  }

  // INBOUND: no campaign metadata. Look up the caller's CRM lead so the agent
  // can greet with their name + current admission stage and reuse known
  // details (CONTACT_CONTEXT) instead of treating them as a stranger. We do NOT
  // set isFollowup/isFeedback (those drive the scripted OUTBOUND flows) — inbound
  // stays caller-led; we only supply context + an inbound stage for the greeting.
  if (session.isInbound && !session.campaignContext?.instruction && session.callerNumber) {
    try {
      const lead = await lookupLeadByPhone(session.callerNumber);
      if (lead) {
        const cf = (lead.custom_fields || {}) as Record<string, any>;
        const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
        const college = cf.interested_university || cf.interested_college || '';
        const course = cf.interested_course || '';
        const inboundStage = deriveInboundStage(cf);
        session.campaignContext = {
          campaignId: null,
          instruction: null,
          variables: {
            name, college, course,
            visit_date: cf.last_visit_date || cf.visit_date || '',
            visit_time: cf.visit_time || '',
            inbound_stage: inboundStage,
          },
          targetName: name || null,
          isFollowup: false,
          isFeedback: false,
          stage: undefined,
        };
        logger.info(
          { callSid: session.callSid, leadId: lead.id, inboundStage, hasCollege: !!college },
          'Inbound: matched caller to existing lead',
        );
      } else {
        logger.info({ callSid: session.callSid, caller: session.callerNumber }, 'Inbound: no lead matched — new caller');
      }
    } catch (e: any) {
      logger.warn({ callSid: session.callSid, err: e?.message }, 'Inbound lead lookup failed');
    }
  }

  // Language priority (matches the spec):
  //   1. Campaign per-contact CSV language column (variables.language / lang /
  //      preferred_language) → wins over agent default so a Telugu lead dialed
  //      via a multi-language campaign always opens in Telugu.
  //   2. Agent default voice_config.language.
  //   3. Hard fallback en-IN.
  // The session language is the OPENING language only; mid-call detection
  // (detectLanguageRequest, around L1695) can still flip session.language
  // when the caller asks "Telugu lo cheppu" / "English mein bolo".
  const contactLangRaw =
    session.campaignContext?.variables?.language ||
    session.campaignContext?.variables?.lang ||
    session.campaignContext?.variables?.preferred_language ||
    null;
  const contactLang = normalizeLanguageCode(contactLangRaw);
  const agentLang = firstNonEmpty(session.agent.voice_config?.language, session.agent.voiceConfig?.language);
  const lang = contactLang || agentLang || 'en-IN';
  if (contactLang && agentLang && contactLang !== agentLang) {
    logger.info(
      { callSid: session.callSid, contactLang, agentLang, raw: contactLangRaw },
      'Stream: per-contact CSV language overrides agent default',
    );
  }
  session.language = lang;

  // Transliterate the lead's name + college into the call's Indic script so the
  // Indic TTS pronounces them natively (Latin "Baji Babu"/"SRM University" were
  // mangled into "OG Babu"/garble). Runs once per call before the greeting;
  // best-effort, ~200-400ms, falls back to the Latin form on any failure.
  const isIndicForTranslit = !/^en/i.test(lang) && /^(te|hi|ta|kn|ml|mr|bn|gu|pa|or|as)/i.test(lang);
  if (isIndicForTranslit && session.campaignContext) {
    const v = session.campaignContext.variables || {};
    const nm = String(session.campaignContext.targetName || v.name || '').trim();
    const col = String(v.college || '').trim();
    if ((nm && /[A-Za-z]/.test(nm)) || (col && /[A-Za-z]/.test(col))) {
      try {
        const [tlName, tlCollege] = await transliterateToIndic([nm, col], lang);
        if (tlName) { session.campaignContext.targetName = tlName; v.name = tlName; }
        if (tlCollege) { v.college = tlCollege; }
        session.campaignContext.variables = v;
        logger.info(
          { callSid: session.callSid, lang, name: tlName || nm, college: tlCollege || col },
          'Stream: transliterated name/college to call script',
        );
      } catch (err: any) {
        logger.warn({ callSid: session.callSid, err: err?.message }, 'Transliteration failed — keeping Latin form');
      }
    }
  }

  // Honor per-agent barge-in override (voice_config.barge_in_grace_ms). When
  // unset, bargeInGraceMs() falls back to language-default 1500/2000ms.
  const agentGraceRaw =
    session.agent.voice_config?.barge_in_grace_ms ??
    session.agent.voiceConfig?.barge_in_grace_ms ??
    null;
  const agentGrace = Number(agentGraceRaw);
  session.agentBargeInGraceMs = Number.isFinite(agentGrace) && agentGrace > 0 ? agentGrace : null;
  // ── Provider selection ───────────────────────────────────────────────────
  // Driven by agent.voice_config.default_provider:
  //   - "deepgram" (default)  → Deepgram STT + Aura TTS for EVERY language.
  //                             Lower latency, better interruption handling,
  //                             cleaner bulk-call scaling. Non-DG languages
  //                             (Telugu/Tamil/etc.) fall back to en-IN
  //                             approximation inside connectDeepgram.
  //   - "sarvam"              → Sarvam STT + Sarvam TTS for EVERY language.
  //                             Use when native Indic voice quality matters
  //                             more than latency.
  //   - "auto" (legacy)       → Indic languages → Sarvam, else Deepgram.
  //                             Preserved so existing agents keep working
  //                             exactly as before if they opt in.
  // Plus enable_auto_fallback: when Deepgram emits no transcripts for 8s of
  // audio (silent-failure watchdog), we switch the live session to Sarvam
  // without dropping the call. See deepgramSilentFailureWatchdog.
  const voiceCfg: any = session.agent.voice_config || session.agent.voiceConfig || {};
  const providerPref = String(voiceCfg.default_provider || 'deepgram').toLowerCase();
  const enableAutoFallback = voiceCfg.enable_auto_fallback === true;
  session.providerPref = providerPref;
  session.enableAutoFallback = enableAutoFallback;

  let stt: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  let tts: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';

  if (providerPref === 'sarvam' && sarvamConfigured()) {
    // Force-Sarvam: tenant explicitly chose Sarvam for native voice quality.
    stt = 'sarvam'; tts = 'sarvam';
  } else if (providerPref === 'auto') {
    // Legacy auto-routing — Indic gets Sarvam, else Deepgram. Same as the
    // pre-change behavior; kept so existing agents that depended on it
    // (e.g. a tenant explicitly chose Sarvam-for-Telugu) keep working.
    const isIndicLang = sarvamCanHandle(lang) && !/^en/i.test(lang);
    if (isIndicLang && sarvamConfigured()) {
      stt = 'sarvam'; tts = 'sarvam';
    } else if (!deepgramCanHandle(lang)) {
      if (sarvamConfigured() && sarvamCanHandle(lang)) {
        stt = 'sarvam'; tts = 'sarvam';
      } else if (azureSpeechConfigured()) {
        stt = 'azure'; tts = 'azure';
      }
    }
  }
  // Else providerPref === "deepgram" (new default) → both already 'deepgram'.

  // TTS-only override for Indic languages: Deepgram Aura has no native
  // Telugu/Tamil/Kannada/Malayalam/Hindi/etc. voices — if we let it speak
  // those, Aura tries to pronounce the script as English, producing
  // unintelligible gibberish (caller stays silent → Plivo MEDIA_TIMEOUT).
  // So when the call language is Indic AND Sarvam is configured, we always
  // route TTS through Sarvam regardless of providerPref. STT routing stays
  // untouched — Deepgram STT can still be primary with Whisper/Sarvam
  // fallback handling the Indic STT problem separately.
  const isIndicForTts = /^(hi|te|ta|kn|ml|mr|bn|gu|pa|or|as|ur|ne)/i.test(lang);
  if (isIndicForTts && sarvamConfigured() && tts === 'deepgram') {
    tts = 'sarvam';
    logger.info(
      { callSid: session.callSid, lang, stt, tts },
      'TTS routed to Sarvam for Indic language (Aura has no native Indic voices)',
    );
  }

  // ── Single premium voice (one voice for the WHOLE call) ─────────────────
  // Premium-voice requirement: the caller must hear ONE consistent voice
  // across Telugu / Hindi / English / mixed — never a mid-call voice switch.
  // Only Sarvam bulbul:v2 covers all of these in a single speaker, so when
  // Sarvam is configured we pin TTS to Sarvam for EVERY language (English
  // included) and lock the speaker for the rest of the call. STT routing is
  // left untouched (Deepgram stays primary for English etc.) — STT never
  // affects the heard voice. Set PREMIUM_VOICE_ENABLED=0 to opt out and keep
  // the legacy per-language TTS routing above.
  const premiumVoiceEnabled = process.env.PREMIUM_VOICE_ENABLED !== '0';
  if (premiumVoiceEnabled && sarvamConfigured()) {
    tts = 'sarvam';
    // Resolve the pinned speaker once: a valid Sarvam speaker from the agent's
    // voice_config wins; otherwise the platform premium default (abhilash —
    // a mature, warm male counsellor voice). Locked onto the session so every
    // turn, language switch, and STT fallback reuses the exact same voice.
    const cfgVoice = String(voiceCfg.voice_id || '').toLowerCase();
    session.ttsVoiceId = SARVAM_PREMIUM_SPEAKERS.has(cfgVoice)
      ? cfgVoice
      : (process.env.PREMIUM_VOICE_ID || 'abhilash');
    logger.info(
      { callSid: session.callSid, lang, stt, tts, voice: session.ttsVoiceId },
      'Stream: premium single-voice pinned (Sarvam) for whole call',
    );
  }

  // ── Indic STT → Sarvam ───────────────────────────────────────────────────
  // Deepgram's en-IN model CANNOT transcribe Telugu/Indic speech — on live
  // calls it returns garbage ("When", Japanese) or no final at all, so the
  // conversation never advances past the greeting. Sarvam saarika:v2.5 DOES
  // transcribe Telugu natively. So for Indic-language calls we route STT to
  // Sarvam (English stays on Deepgram — faster + accurate there). The Sarvam
  // 429-under-load risk is handled by retrying Sarvam on transient rate-limits
  // (see startSarvamStt onError below) — we only downshift to Deepgram as a
  // last resort after MAX consecutive 429s, since Deepgram can't do Telugu.
  // Set INDIC_STT_SARVAM=0 to fall back to the old Deepgram-for-everything.
  const indicSttSarvam = process.env.INDIC_STT_SARVAM !== '0';
  const isIndicForStt = /^(hi|te|ta|kn|ml|mr|bn|gu|pa|or|as)/i.test(lang);
  if (indicSttSarvam && isIndicForStt && sarvamConfigured() && stt === 'deepgram') {
    stt = 'sarvam';
    logger.info(
      { callSid: session.callSid, lang },
      'STT routed to Sarvam for Indic language (Deepgram en-IN cannot transcribe Telugu/Indic)',
    );
  }

  session.sttBackend = stt;
  session.ttsBackend = tts;
  logger.info(
    { callSid: session.callSid, language: lang, stt, tts, providerPref, autoFallback: enableAutoFallback },
    'Stream: backends chosen',
  );

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
  const callDir = session.isInbound ? 'INBOUND' : 'OUTBOUND';
  try {
    await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, conversation_id, direction, status, caller_number, called_number, provider, provider_call_sid)
       VALUES ($1,$2,$3,$4,'IN_PROGRESS',$5,$6,'plivo',$7)
       ON CONFLICT (provider_call_sid) DO UPDATE SET status='IN_PROGRESS', conversation_id=EXCLUDED.conversation_id,
         caller_number=COALESCE(NULLIF(EXCLUDED.caller_number,''), calls.caller_number),
         called_number=COALESCE(NULLIF(EXCLUDED.called_number,''), calls.called_number)`,
      [session.tenantId, session.agentId, session.conversationId, callDir, session.callerNumber, session.calledNumber, session.callSid]
    );
    logger.info({ callSid: session.callSid, direction: callDir }, session.isInbound ? '[INBOUND_CALL_SESSION_CREATED]' : 'Outbound call row created');
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
      // Reset the 429 streak on every successful transcript — a 429 is only
      // "persistent" if SEVERAL land back-to-back with no success between.
      onFinal: (text) => { session.sarvamStt429Count = 0; dispatchUserUtterance(session, text); },
      onError: (msg) => {
        const isQuota = /429|No credits|insufficient_quota|quota|rate.?limit/i.test(String(msg || ''));
        if (!isQuota) {
          logger.warn({ callSid: session.callSid, err: msg }, 'Sarvam STT error (non-quota)');
          return;
        }
        // 429 / rate-limit. The Sarvam STT handler STAYS ALIVE and re-POSTs on
        // the next utterance automatically (natural backoff between turns, since
        // the caller pauses while the agent speaks). For Indic we keep RETRYING
        // Sarvam rather than downshifting to Deepgram — Deepgram's en-IN cannot
        // transcribe Telugu, so downshifting on a transient blip is what broke
        // the back half of calls. Only after MAX consecutive 429s (with zero
        // success between) do we downshift as a last resort to avoid silence.
        session.sarvamStt429Count = (session.sarvamStt429Count || 0) + 1;
        const MAX_429 = Number(process.env.SARVAM_STT_MAX_429) || 5;
        if (isIndicForStt && session.sarvamStt429Count < MAX_429) {
          emit(session, 'SARVAM_FALLBACK_TRIGGERED', { stage: 'stt_429_retry', count: session.sarvamStt429Count, max: MAX_429 });
          logger.warn(
            { callSid: session.callSid, count: session.sarvamStt429Count, max: MAX_429 },
            'Sarvam STT 429 — transient rate-limit; retrying Sarvam on next utterance (NOT downshifting)',
          );
          return; // keep sarvamStt; it retries the next utterance
        }
        if (!session.sarvamSttDownshifted) {
          session.sarvamSttDownshifted = true;
          logger.warn(
            { callSid: session.callSid, count: session.sarvamStt429Count, indic: isIndicForStt },
            isIndicForStt
              ? 'Sarvam STT 429 persisted past retries — last-resort downshift to Deepgram (Telugu accuracy will degrade)'
              : 'Sarvam STT quota exhausted — downshifting to Deepgram for the rest of this call',
          );
          try { session.sarvamStt?.close(); } catch { /* ignore */ }
          session.sarvamStt = null;
          session.sttBackend = 'deepgram';
          connectDeepgram(session, lang).catch((err: any) => {
            logger.error({ callSid: session.callSid, err: err?.message }, 'Deepgram fallback open failed');
          });
        }
      },
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

  // Seed greeting. For campaign dials with a templated greeting_message that
  // contains {{vars}}, interpolate and use directly — it's faster and more
  // deterministic than re-asking the LLM, which is what OmniDim does too.
  // Otherwise route through the LLM with the campaign overlay so the greeting
  // is personalized but stays on-prompt.
  // Strip placeholder names ("Contact 3", "Customer 1", etc.) before they
  // hit the greeting template — otherwise an agent with greeting "Hello
  // {{name}}!" announces "Hello Contact 3!" and the caller knows it's a bot
  // in the first half-second. Same regex as voiceAgent.ts sanitizeCustomerName.
  const PLACEHOLDER_NAME_RE = /^(contact|customer|test(ing)?|sample|lead|user|client|prospect|guest|caller|na|n\/a|unknown|tbd)\b[\s\-_]*\d*$/i;
  const rawTargetName = session.campaignContext.targetName || session.campaignContext.variables?.name || '';
  const safeName = rawTargetName && !PLACEHOLDER_NAME_RE.test(rawTargetName.trim()) ? rawTargetName.trim() : '';
  const greetingVars: Record<string, any> = {
    ...(session.campaignContext.variables || {}),
    name: safeName,
  };

  // ── INBOUND stage-aware greeting ───────────────────────────────────────────
  // The caller dialed us. Greet by name + their current admission stage (from
  // the matched lead) then hand control to the caller — inbound is caller-led,
  // not a scripted outbound flow. Deterministic (instant). Unknown callers get a
  // generic admissions greeting.
  if (session.isInbound) {
    const v = session.campaignContext.variables || {};
    const inStage = String((v as any).inbound_stage || 'NEW_CALLER');
    const col = String((v as any).college || '').trim() || 'the college';
    const vdate = String((v as any).visit_date || '').trim();
    const vtime = String((v as any).visit_time || '').trim();
    const lk = String(session.language || 'en-IN');
    const isTe = lk.startsWith('te'); const isHi = lk.startsWith('hi');
    const nm = safeName ? (isTe ? `${safeName} గారు` : isHi ? `${safeName} जी` : `${safeName} garu`) : '';
    let g = '';
    if (safeName && inStage === 'VISIT_PLANNING') {
      const whenTe = vdate ? ` ${vdate}${vtime ? ' ' + vtime : ''}కి` : '';
      const whenEn = vdate ? ` on ${vdate}${vtime ? ' at ' + vtime : ''}` : '';
      g = isTe ? `నమస్తే ${nm}. మీ ${col} క్యాంపస్ విజిట్${whenTe} షెడ్యూల్ అయింది. నేను మీకు ఎలా సహాయం చేయగలను?`
        : isHi ? `नमस्ते ${nm}। आपकी ${col} कैंपस विज़िट${whenEn} शेड्यूल है। मैं आपकी कैसे मदद करूँ?`
        : `Hello ${nm}. Your ${col} campus visit${whenEn} is scheduled. How can I help you?`;
    } else if (safeName && inStage === 'POST_VISIT_FEEDBACK') {
      g = isTe ? `నమస్తే ${nm}. మీ ఇటీవలి ${col} విజిట్ గురించి మాట్లాడుతున్నాను. నేను మీకు ఎలా సహాయం చేయగలను?`
        : isHi ? `नमस्ते ${nm}। आपकी हाल की ${col} विज़िट के बारे में। मैं कैसे मदद करूँ?`
        : `Hello ${nm}. This is regarding your recent visit to ${col}. How can I help you?`;
    } else if (safeName && inStage === 'ADMISSION_INTERESTED') {
      g = isTe ? `నమస్తే ${nm}. మీ ${col} అడ్మిషన్ గురించి. నేను మీకు ఎలా సహాయం చేయగలను?`
        : isHi ? `नमस्ते ${nm}। आपके ${col} एडमिशन के बारे में। मैं कैसे मदद करूँ?`
        : `Hello ${nm}. Regarding your ${col} admission. How can I help you?`;
    } else if (safeName) {
      g = isTe ? `నమస్తే ${nm}. అడ్మిషన్ సపోర్ట్‌కి కాల్ చేసినందుకు ధన్యవాదాలు. నేను మీకు ఎలా సహాయం చేయగలను?`
        : isHi ? `नमस्ते ${nm}। एडमिशन सपोर्ट को कॉल करने के लिए धन्यवाद। मैं कैसे मदद करूँ?`
        : `Hello ${nm}. Thank you for calling admissions support. How can I help you?`;
    } else {
      g = isTe ? `నమస్తే! అడ్మిషన్ సపోర్ట్‌కి ధన్యవాదాలు. మీకు బీటెక్ అడ్మిషన్ వివరాలు కావాలా?`
        : isHi ? `नमस्ते! एडमिशन सपोर्ट में आपका स्वागत है। क्या आपको बी.टेक एडमिशन की जानकारी चाहिए?`
        : `Hello! Thank you for calling admissions support. Are you looking for B.Tech admission details?`;
    }
    if (g) {
      if (session.conversationId) await appendMessage(session.conversationId, session.tenantId, 'assistant', g);
      session.history.push({ role: 'assistant', content: g });
      logger.info({ callSid: session.callSid, inboundStage: inStage, named: !!safeName }, 'Greeting: inbound stage-aware opener');
      await playText(plivoWs, session, g);
      return;
    }
  }

  // ── Stage-aware greeting override ──────────────────────────────────────────
  // For FOLLOW_UP / VISIT_PLANNING / POST_VISIT_FEEDBACK calls the lead ALREADY
  // exists, so the opening line must state the call's purpose (brochure review /
  // visit planning / feedback) — NOT the generic cold-call greeting template,
  // which on this agent asks "have you completed Intermediate?" and pushes the
  // whole call into the capture flow (re-asking known details). We seed the
  // opener via the LLM in the call's language; the stage prompt is already in
  // context. On any failure we fall through to the normal greeting below.
  const stageForGreeting = session.campaignContext.stage;
  if (stageForGreeting && stageForGreeting !== 'BULK_CALL' && !session.isInbound) {
    const gCollege = String(session.campaignContext.variables?.college || session.campaignContext.variables?.interested_university || '').trim() || 'your preferred college';
    const gCourse = String(session.campaignContext.variables?.course || session.campaignContext.variables?.interested_course || '').trim();
    // Deterministic per-language stage opener — NO LLM round-trip (seeding it via
    // the LLM added 30s+ of dead air on pickup when the provider was throttled).
    // Built instantly by string interpolation, mirroring LANG_GREETING_TEMPLATES.
    // Falls back to en-IN for languages without an explicit template; if no
    // opener is produced we fall through to the normal greeting below.
    const enName = safeName ? `${safeName} garu` : 'sir';
    const teName = safeName ? `${safeName} గారు` : 'గారు';
    const hiName = safeName ? `${safeName} जी` : 'जी';
    const enCourse = gCourse ? ` for ${gCourse}` : '';
    const STAGE_GREETINGS: Record<string, Record<string, string>> = {
      FOLLOW_UP: {
        'en-IN': `Hello ${enName}. Previously our admissions team spoke with you regarding ${gCollege}${enCourse}. I am calling to check whether you had a chance to review the information we shared.`,
        'te-IN': `నమస్తే ${teName}. గతంలో మా అడ్మిషన్స్ టీం మీతో ${gCollege} గురించి మాట్లాడింది. మేము పంపిన సమాచారాన్ని మీరు చూడగలిగారా అని అడగడానికి కాల్ చేస్తున్నాను.`,
        'hi-IN': `नमस्ते ${hiName}। पहले हमारी एडमिशन टीम ने आपसे ${gCollege} के बारे में बात की थी। मैं यह जानने के लिए कॉल कर रही हूँ कि क्या आपने हमारी भेजी जानकारी देखी।`,
      },
      VISIT_PLANNING: {
        'en-IN': `Hello ${enName}. Previously our admissions team connected with you regarding admission to ${gCollege}${enCourse}. I am calling to help plan your campus visit. Are you still interested in visiting ${gCollege}?`,
        'te-IN': `నమస్తే ${teName}. గతంలో మా అడ్మిషన్స్ టీం మీతో ${gCollege} అడ్మిషన్ గురించి మాట్లాడింది. మీ క్యాంపస్ విజిట్ ప్లాన్ చేయడంలో సహాయం చేయడానికి కాల్ చేస్తున్నాను. మీరు ఇంకా ${gCollege} సందర్శించాలనుకుంటున్నారా?`,
        'hi-IN': `नमस्ते ${hiName}। पहले हमारी एडमिशन टीम ने आपसे ${gCollege} एडमिशन के बारे में बात की थी। मैं आपकी कैंपस विज़िट प्लान करने में मदद के लिए कॉल कर रही हूँ। क्या आप अब भी ${gCollege} देखने में रुचि रखते हैं?`,
      },
      POST_VISIT_FEEDBACK: {
        'en-IN': `Hello ${enName}. This call is regarding your recent visit to ${gCollege}. I would like to understand your experience and help with the next steps. How was your visit?`,
        'te-IN': `నమస్తే ${teName}. మీరు ఇటీవల ${gCollege} సందర్శించిన విషయంలో ఈ కాల్ చేస్తున్నాను. మీ అనుభవం తెలుసుకుని తదుపరి దశల్లో సహాయం చేయాలనుకుంటున్నాను. మీ విజిట్ ఎలా జరిగింది?`,
        'hi-IN': `नमस्ते ${hiName}। यह कॉल आपकी हाल की ${gCollege} विज़िट के बारे में है। मैं आपका अनुभव समझकर अगले कदमों में मदद करना चाहती हूँ। आपकी विज़िट कैसी रही?`,
      },
    };
    const stageMap = STAGE_GREETINGS[stageForGreeting];
    const lk = String(session.language || 'en-IN');
    const stageGreeting = stageMap && (stageMap[lk] || stageMap[lk.slice(0, 2) + '-IN'] || stageMap['en-IN']);
    if (stageGreeting && stageGreeting.trim()) {
      const g = stageGreeting.trim();
      if (session.conversationId) await appendMessage(session.conversationId, session.tenantId, 'assistant', g);
      session.history.push({ role: 'assistant', content: g });
      logger.info({ callSid: session.callSid, stage: stageForGreeting, lang: lk }, 'Greeting: stage-aware opener (deterministic)');
      await playText(plivoWs, session, g);
      return;
    }
  }

  // Per-language fallback greeting templates. Used when the agent has either
  // (a) no greeting_message at all, or (b) a greeting_message whose script
  // doesn't match the call's language (e.g. English template on a Telugu
  // call). Each template:
  //   - Greets by name (interpolated from {{name}}).
  //   - Asks ONE casual "is this a good time?" question.
  //   - Does NOT ask any qualification question (no "have you completed
  //     intermediate?" / "what's your name?" on turn 1) — those caused
  //     callers to hang up early.
  const LANG_GREETING_TEMPLATES: Record<string, string> = {
    'te-IN': 'నమస్తే {{name}} గారు, MyLeadX నుండి మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి సమయం ఉందా?',
    te: 'నమస్తే {{name}} గారు, MyLeadX నుండి మాట్లాడుతున్నాను. ఇప్పుడు మాట్లాడటానికి సమయం ఉందా?',
    'hi-IN': 'नमस्ते {{name}} जी, MyLeadX से बात कर रही हूँ। क्या अभी बात करने का समय है?',
    hi: 'नमस्ते {{name}} जी, MyLeadX से बात कर रही हूँ। क्या अभी बात करने का समय है?',
    'ta-IN': 'வணக்கம் {{name}}, MyLeadX-இலிருந்து பேசுகிறேன். இப்போது பேசுவதற்கு நேரம் இருக்கிறதா?',
    ta: 'வணக்கம் {{name}}, MyLeadX-இலிருந்து பேசுகிறேன். இப்போது பேசுவதற்கு நேரம் இருக்கிறதா?',
    'kn-IN': 'ನಮಸ್ಕಾರ {{name}} ಅವರೇ, MyLeadX ನಿಂದ ಮಾತಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಸಮಯವಿದೆಯೇ?',
    kn: 'ನಮಸ್ಕಾರ {{name}} ಅವರೇ, MyLeadX ನಿಂದ ಮಾತಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಸಮಯವಿದೆಯೇ?',
    'ml-IN': 'നമസ്കാരം {{name}}, MyLeadX-ൽ നിന്ന് വിളിക്കുന്നു. ഇപ്പോൾ സംസാരിക്കാൻ സമയം ഉണ്ടോ?',
    ml: 'നമസ്കാരം {{name}}, MyLeadX-ൽ നിന്ന് വിളിക്കുന്നു. ഇപ്പോൾ സംസാരിക്കാൻ സമയം ഉണ്ടോ?',
    'mr-IN': 'नमस्कार {{name}}, MyLeadX वरून बोलत आहे. आत्ता बोलण्यासाठी वेळ आहे का?',
    mr: 'नमस्कार {{name}}, MyLeadX वरून बोलत आहे. आत्ता बोलण्यासाठी वेळ आहे का?',
    'bn-IN': 'নমস্কার {{name}}, MyLeadX থেকে কথা বলছি। এখন কথা বলার সময় আছে?',
    bn: 'নমস্কার {{name}}, MyLeadX থেকে কথা বলছি। এখন কথা বলার সময় আছে?',
    'gu-IN': 'નમસ્તે {{name}}, MyLeadX થી વાત કરી રહી છું. શું હમણાં વાત કરવાનો સમય છે?',
    gu: 'નમસ્તે {{name}}, MyLeadX થી વાત કરી રહી છું. શું હમણાં વાત કરવાનો સમય છે?',
    'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{name}}, MyLeadX ਤੋਂ ਗੱਲ ਕਰ ਰਹੀ ਹਾਂ। ਕੀ ਹੁਣ ਗੱਲ ਕਰਨ ਦਾ ਸਮਾਂ ਹੈ?',
    pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{name}}, MyLeadX ਤੋਂ ਗੱਲ ਕਰ ਰਹੀ ਹਾਂ। ਕੀ ਹੁਣ ਗੱਲ ਕਰਨ ਦਾ ਸਮਾਂ ਹੈ?',
    en: 'Hi {{name}}, this is calling from MyLeadX. Is this a good time to talk?',
    'en-IN': 'Hi {{name}}, this is calling from MyLeadX. Is this a good time to talk?',
    'en-US': 'Hi {{name}}, this is calling from MyLeadX. Is this a good time to talk?',
  };

  // Decide whether the agent's stored greeting_message matches the call's
  // language. Strategy:
  //  - If session language is Indic but the template is pure Latin (no Indic
  //    script), the template is mis-aligned — replace with the per-language
  //    fallback so callers don't hear "Hello sir, this is calling..." on a
  //    Telugu line.
  //  - If session language is English-ish but the template contains heavy
  //    Indic script, also replace (rare; only triggers if someone configured
  //    a Telugu template but the contact's preferred language is English).
  const langForGreeting = String(session.language || 'en').toLowerCase();
  const isIndicCallForGreeting = !/^en/.test(langForGreeting) && /^(te|hi|ta|kn|ml|mr|bn|gu|pa|or|as|ur|ne)/.test(langForGreeting);
  const rawTemplateInitial = (session.agent.greeting_message || '').toString();
  const templateIsLatinOnly = !!rawTemplateInitial.trim() && !hasIndicScript(rawTemplateInitial);
  const templateIsIndic = !!rawTemplateInitial.trim() && hasIndicScript(rawTemplateInitial);
  const templateMismatch =
    (isIndicCallForGreeting && templateIsLatinOnly) ||
    (!isIndicCallForGreeting && templateIsIndic && /^en/.test(langForGreeting));

  let rawTemplate = rawTemplateInitial;
  if (templateMismatch || !rawTemplate.trim()) {
    const builtin =
      LANG_GREETING_TEMPLATES[langForGreeting] ||
      LANG_GREETING_TEMPLATES[langForGreeting.slice(0, 2)] ||
      LANG_GREETING_TEMPLATES.en;
    logger.info(
      { callSid: session.callSid, sessionLang: session.language, replaced: templateMismatch },
      templateMismatch
        ? 'Greeting: agent template language mismatch — using per-language built-in'
        : 'Greeting: no stored template — using per-language built-in',
    );
    rawTemplate = builtin;
  }
  const hasTemplatePlaceholders = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(rawTemplate);
  let greeting = '';
  if (hasTemplatePlaceholders && rawTemplate.trim()) {
    greeting = interpolateVars(rawTemplate, greetingVars);
    logger.info({ callSid: session.callSid }, 'Greeting: interpolated from greeting template');
  } else {
    // Greeting prompt MUST be in the call's language so Sarvam/Gemini doesn't
    // default to English when the call is Telugu/Hindi/Tamil. Also tightened
    // to ONE short sentence + ONE casual "is this a good time?" — no premature
    // qualification questions about education / course / fees etc. (callers
    // hung up when the agent jumped into "have you completed Intermediate?"
    // on turn 1).
    const outboundGreetingByLang: Record<string, string> = {
      'te-IN': 'కాల్ ఇప్పుడే కనెక్ట్ అయింది. తెలుగులో ఒక చిన్న వాక్యంలో మిమ్మల్ని పరిచయం చేసుకుని, "ఇప్పుడు మాట్లాడటానికి సమయం ఉందా?" అని మాత్రమే అడగండి. చదువు / కోర్సు / ఫీజు గురించి ఇంకా అడగవద్దు. 12 పదాలకు మించి కాదు.',
      'hi-IN': 'कॉल अभी कनेक्ट हुई है। हिंदी में एक छोटे वाक्य में अपना परिचय दें और सिर्फ "क्या अभी बात करने का समय है?" पूछें। शिक्षा/कोर्स/फीस के बारे में अभी मत पूछें। 12 शब्दों से ज़्यादा नहीं।',
      'ta-IN': 'அழைப்பு இப்போதே இணைக்கப்பட்டது. தமிழில் ஒரே வாக்கியத்தில் உங்களை அறிமுகப்படுத்தி, "இப்போது பேசுவதற்கு நேரம் இருக்கிறதா?" என்று மட்டும் கேளுங்கள். கல்வி/பாடம்/கட்டணம் பற்றி இப்போது கேட்க வேண்டாம். 12 சொற்களுக்கு மேல் வேண்டாம்.',
      'kn-IN': 'ಕರೆ ಈಗ ಸಂಪರ್ಕವಾಯಿತು. ಕನ್ನಡದಲ್ಲಿ ಒಂದು ಚಿಕ್ಕ ವಾಕ್ಯದಲ್ಲಿ ಪರಿಚಯ ಮಾಡಿಕೊಂಡು "ಈಗ ಮಾತನಾಡಲು ಸಮಯವಿದೆಯೇ?" ಎಂದು ಮಾತ್ರ ಕೇಳಿ. ವಿದ್ಯಾಭ್ಯಾಸ/ಕೋರ್ಸ್/ಶುಲ್ಕ ಬಗ್ಗೆ ಈಗ ಕೇಳಬೇಡಿ. 12 ಪದಗಳಿಗಿಂತ ಹೆಚ್ಚಿಲ್ಲ.',
      'ml-IN': 'കാൾ ഇപ്പോൾ കണക്റ്റ് ആയിട്ടേയുള്ളൂ. മലയാളത്തിൽ ഒറ്റ വാക്യത്തിൽ പരിചയപ്പെടുത്തി "ഇപ്പോൾ സംസാരിക്കാൻ സമയം ഉണ്ടോ?" എന്ന് മാത്രം ചോദിക്കുക. വിദ്യാഭ്യാസം/കോഴ്സ്/ഫീസ് ഇപ്പോൾ ചോദിക്കരുത്. 12 വാക്കിൽ കൂടരുത്.',
      'mr-IN': 'कॉल आत्ता कनेक्ट झाला आहे. मराठीत एका लहान वाक्यात स्वतःची ओळख करून द्या आणि फक्त "आत्ता बोलण्यासाठी वेळ आहे का?" विचारा. शिक्षण/कोर्स/फी बद्दल आत्ता विचारू नका. 12 शब्दांपेक्षा जास्त नको.',
      en: 'The call just connected. In ONE short sentence introduce yourself by first name only, then ask casually "is this a good time to talk?". DO NOT ask about education, course, fees, or any qualification question yet. Maximum 15 words total. Sound like a real human, not a script.',
    };
    const inboundGreetingByLang: Record<string, string> = {
      'te-IN': 'కస్టమర్ మీ నంబర్‌కి కాల్ చేశారు. తెలుగులో కాల్ చేసినందుకు ధన్యవాదాలు, మిమ్మల్ని పరిచయం చేసుకుని "ఎలా సహాయం చేయగలను?" అని మాత్రమే అడగండి. 15 పదాలకు మించి కాదు.',
      'hi-IN': 'ग्राहक ने आपके नंबर पर कॉल किया है। हिंदी में कॉल करने के लिए धन्यवाद कहें, अपना परिचय दें और सिर्फ "मैं कैसे मदद कर सकती हूँ?" पूछें। 15 शब्दों से ज़्यादा नहीं।',
      'ta-IN': 'வாடிக்கையாளர் உங்கள் எண்ணை அழைத்துள்ளார். தமிழில் அழைப்பிற்கு நன்றி தெரிவித்து, உங்களை அறிமுகப்படுத்தி "எவ்வாறு உதவ முடியும்?" என்று மட்டும் கேளுங்கள். 15 சொற்களுக்கு மேல் வேண்டாம்.',
      'kn-IN': 'ಗ್ರಾಹಕರು ನಿಮ್ಮ ನಂಬರ್‌ಗೆ ಕರೆ ಮಾಡಿದ್ದಾರೆ. ಕನ್ನಡದಲ್ಲಿ ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ, ಪರಿಚಯ ಮಾಡಿಕೊಂಡು "ಏನು ಸಹಾಯ ಮಾಡಬಹುದು?" ಎಂದು ಮಾತ್ರ ಕೇಳಿ. 15 ಪದಗಳಿಗಿಂತ ಹೆಚ್ಚಿಲ್ಲ.',
      'ml-IN': 'ഉപഭോക്താവ് നിങ്ങളുടെ നമ്പറിലേക്ക് വിളിച്ചു. മലയാളത്തിൽ വിളിച്ചതിന് നന്ദി പറഞ്ഞ്, പരിചയപ്പെടുത്തി "എങ്ങനെ സഹായിക്കാം?" എന്ന് മാത്രം ചോദിക്കുക. 15 വാക്കിൽ കൂടരുത്.',
      'mr-IN': 'ग्राहकाने तुमच्या नंबरवर कॉल केला आहे. मराठीत कॉल केल्याबद्दल धन्यवाद सांगा, ओळख करून द्या आणि फक्त "मी कसा मदत करू शकतो?" विचारा. 15 शब्दांपेक्षा जास्त नको.',
      en: 'A customer is calling YOUR number. Thank them for calling, introduce yourself by first name, and ask "How can I help you today?". Sound warm and welcoming. Maximum 15 words. Do NOT ask if it is a good time — they called you.',
    };
    const greetingInstructionByLang = session.isInbound ? inboundGreetingByLang : outboundGreetingByLang;
    const langKeyForGreeting = String(session.language || 'en').toLowerCase();
    const greetingInstruction =
      greetingInstructionByLang[langKeyForGreeting] ||
      greetingInstructionByLang[langKeyForGreeting.slice(0, 2)] ||
      greetingInstructionByLang.en;
    const seeded = await callLLM(
      session.agent,
      [
        {
          role: 'user',
          content: greetingInstruction,
        },
      ],
      session.campaignContext.targetName,
      session.isInbound ? 'inbound' : 'outbound',
      session.language,
      session.campaignContext,
    );
    greeting = (seeded && seeded.trim())
      || (rawTemplate ? interpolateVars(rawTemplate, greetingVars) : '')
      || 'Hey there — how can I help you today?';
  }
  if (session.conversationId) {
    await appendMessage(session.conversationId, session.tenantId, 'assistant', greeting);
  }
  session.history.push({ role: 'assistant', content: greeting });
  await playText(plivoWs, session, greeting);
}

async function onStop(session: StreamSession): Promise<void> {
  if (session.closed) return;
  session.closed = true;
  setCallState(session, 'ENDED', 'on_stop');
  emit(session, 'CALL_ENDED', { history_turns: session.history.length });
  if (session.dgKeepaliveTimer) { clearInterval(session.dgKeepaliveTimer); session.dgKeepaliveTimer = null; }
  // Clear any pending LLM watchdog so it doesn't fire after teardown.
  if (session.inFlightWatchdog) { clearTimeout(session.inFlightWatchdog); session.inFlightWatchdog = null; }
  // Close the persistent streaming-TTS WebSocket (if opened) on call end.
  if (session.ttsStream) {
    try { (session.ttsStream as SarvamTtsStream).close(); } catch { /* ignore */ }
    session.ttsStream = null;
  }
  if (session.dgWs && session.dgWs.readyState === WebSocket.OPEN) {
    try { session.dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
    try { session.dgWs.close(1000, 'session-end'); } catch { /* ignore */ }
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
  if (session.whisperStt) {
    try { session.whisperStt.close(); } catch { /* ignore */ }
    session.whisperStt = null;
  }

  // Bridge the in-memory slot store → conversations.metadata so the
  // post-call analyzer has access to caller-CONFIRMED captures (name,
  // mobile, email, course, university, etc.). Without this, the analyzer
  // re-extracts from the raw transcript via LLM and routinely returns
  // empty strings for fields the caller had already verbally confirmed —
  // the slot store's values are higher-confidence because they passed
  // through readback + yes-confirmation gates during the call.
  //
  // Persist captured_slots directly via SQL (bypasses the PUT handler
  // which can overwrite metadata with live_state). Uses jsonb || merge
  // so captured_slots coexists with live_state.
  if (session.conversationId && Object.keys(session.collectedFields).length > 0) {
    try {
      await pool.query(
        `UPDATE conversations
         SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{captured_slots}',
           $1::jsonb
         )
         WHERE id = $2 AND tenant_id = $3`,
        [
          JSON.stringify(session.collectedFields),
          session.conversationId,
          session.tenantId,
        ],
      );
      logger.info(
        {
          callSid: session.callSid,
          conv: session.conversationId,
          slots: Object.keys(session.collectedFields),
          values: Object.fromEntries(Object.entries(session.collectedFields).map(([k, v]: [string, any]) => [k, v?.value])),
        },
        'onStop: persisted slot store to conversations.metadata.captured_slots',
      );
    } catch (err: any) {
      logger.warn(
        { callSid: session.callSid, err: err?.message },
        'onStop: failed to persist slot store',
      );
    }
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
  session.dgLang = dgLang;
  await openDeepgramSocket(session, apiKey);
}

/**
 * Open (or re-open) a Deepgram WS for an existing session. Self-contained so
 * the reconnect path can call it directly. Wires:
 *   - 8s keepalive ping to stop carrier-side idle disconnects
 *   - SpeechStarted VAD event → early barge-in onset timestamp
 *   - Final-results handler that forwards to dispatchUserUtterance
 *   - Close/error handlers that schedule exponential-backoff reconnect
 *
 * Replay buffer: if we have queued mulaw frames from a brief disconnect
 * window, replay them as soon as the new socket is open so we don't lose
 * the caller's mid-disconnect speech.
 */
async function openDeepgramSocket(session: StreamSession, apiKey: string): Promise<void> {
  const lang = session.dgLang || 'en-IN';
  const qs = new URLSearchParams({
    model: 'nova-2',
    encoding: 'mulaw',
    sample_rate: '8000',
    // Interim results ON — partials are emitted as STT_PARTIAL events for
    // live transcript visibility AND used to enrich early-barge-in decisions
    // mid-TTS. Dispatch into the conversation history stays gated on
    // `is_final:true` so we never trigger duplicate LLM turns from partials.
    interim_results: 'true',
    smart_format: 'true',
    // Balanced latency tuning: 400ms endpointing finalises a turn faster than
    // the old 600ms (snappier replies) while still tolerating natural pauses.
    // Indic callers' longer pauses are protected separately by the barge-in
    // grace window, not by endpointing. Override via DEEPGRAM_ENDPOINTING_MS.
    endpointing: String(Number(process.env.DEEPGRAM_ENDPOINTING_MS) || 400),
    // NOTE: Deepgram REQUIRES utterance_end_ms >= 1000 — values below 1000
    // (e.g. the spec's 800) make the WS handshake fail with HTTP 400 and STT
    // goes dead. 1000 is the floor; endpointing (400ms above) is what actually
    // controls turn-finalisation latency, so this doesn't slow responses.
    utterance_end_ms: String(Math.max(1000, Number(process.env.DEEPGRAM_UTTERANCE_END_MS) || 1000)),
    vad_events: 'true',         // emit SpeechStarted — used for early barge-in detection
    language: lang,
    punctuate: 'true',
  });
  const dgUrl = `wss://api.deepgram.com/v1/listen?${qs.toString()}`;
  const dg = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  // Keepalive: Deepgram closes idle sockets after ~12s. Sending a 1-byte
  // "KeepAlive" message every 8s keeps the carrier path warm without
  // burning bandwidth. Clear on close to avoid orphan timers.
  const startKeepalive = () => {
    if (session.dgKeepaliveTimer) clearInterval(session.dgKeepaliveTimer);
    session.dgKeepaliveTimer = setInterval(() => {
      try {
        if (dg.readyState === WebSocket.OPEN) {
          dg.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      } catch { /* swallow — close handler will reconnect */ }
    }, 8000);
  };
  const stopKeepalive = () => {
    if (session.dgKeepaliveTimer) {
      clearInterval(session.dgKeepaliveTimer);
      session.dgKeepaliveTimer = null;
    }
  };

  dg.on('open', () => {
    logger.info({ callSid: session.callSid, lang, attempt: session.dgReconnectAttempts }, '[STT_STREAM_CONNECTED] Deepgram STT WS opened');
    if (session.dgReconnectAttempts > 0) {
      emit(session, 'WEBSOCKET_RECONNECTED', { provider: 'deepgram', attempts: session.dgReconnectAttempts });
    } else {
      emit(session, 'STT_STARTED', { provider: 'deepgram', lang });
    }
    session.dgReconnectAttempts = 0;
    session.dgDead = false;
    session.lastSttEventAt = Date.now();
    startKeepalive();
    armDeepgramSilentFailureWatchdog(session);

    // Replay any frames buffered during the disconnect window. Frame-by-frame
    // so the upstream encoding/VAD sees a continuous stream.
    if (session.dgReplayBuffer.length > 0) {
      const replay = session.dgReplayBuffer.splice(0, session.dgReplayBuffer.length);
      logger.info({ callSid: session.callSid, frames: replay.length }, 'Deepgram: replaying buffered frames');
      for (const frame of replay) {
        try { dg.send(frame); } catch { break; }
      }
    }
  });

  dg.on('message', async (raw: RawData) => {
    try {
      const data = JSON.parse(raw.toString());

      // SpeechStarted VAD event → record onset so dispatchUserUtterance can
      // do early-interrupt before waiting for a full final transcript. Also
      // logs the event for live-monitor visibility.
      if (data.type === 'SpeechStarted') {
        session.userSpeechStartedAt = Date.now();
        // NOTE: do NOT update lastSttEventAt here. SpeechStarted is a
        // VAD-only event — Deepgram emits it even when it can't transcribe
        // the audio (e.g. Telugu speech against the en-IN model). If we
        // counted it as STT activity, the silent-failure watchdog would
        // never fire on Indic calls (caller keeps speaking → SpeechStarted
        // keeps firing → idleMs stays at 0). Only real partials/finals
        // prove the transcription pipeline is healthy.
        emit(session, 'SPEECH_STARTED', {});
        if (!session.isAgentSpeaking) setCallState(session, 'USER_SPEAKING', 'vad_speech_started');
        // Early barge-in on RAW VAD is DISABLED by default. On a PSTN line the
        // agent's own TTS echoes back through the carrier and Deepgram emits a
        // SpeechStarted for it — with no transcript to echo-reject against, a
        // raw-VAD barge-in cuts the agent off mid-sentence (incomplete +
        // choppy/"breaking" audio from the repeated clearAudio flush). So we do
        // NOT barge in here; genuine interrupts are handled by the
        // transcript-based path in dispatchUserUtterance, which DOES echo-reject
        // (tokenOverlapRatio) and requires real words / a question. Opt back in
        // with VAD_BARGE_IN=1 on a clean (echo-cancelled) line if ever desired.
        if (
          process.env.VAD_BARGE_IN === '1' &&
          session.isAgentSpeaking &&
          !session.bargeInRequested &&
          Date.now() >= session.bargeInAllowedAt
        ) {
          session.bargeInRequested = true;
          emit(session, 'INTERRUPT_DETECTED', { trigger: 'vad_speech_started' });
        }
        return;
      }

      if (data.type === 'UtteranceEnd') {
        emit(session, 'UTTERANCE_END', {});
        return;
      }

      if (data.type !== 'Results') return;
      const alt = data.channel?.alternatives?.[0];
      const text = (alt?.transcript || '').trim();
      const confidence = typeof alt?.confidence === 'number' ? alt.confidence : 1;
      const isFinal = !!data.is_final;

      if (!text) {
        // Empty transcript — Deepgram thinks it heard speech but couldn't
        // resolve any words. On a non-supported language (e.g. Telugu hitting
        // the en-IN model) we get a burst of these. Track the burst; trip
        // the fallback when 3 land in a 3s window.
        if (session.enableAutoFallback && session.sttBackend === 'deepgram') {
          const now = Date.now();
          session.dgEmptyPartials = (session.dgEmptyPartials || []).filter(
            (t) => now - t < EMPTY_PARTIAL_BURST_WINDOW_MS,
          );
          session.dgEmptyPartials.push(now);
          if (session.dgEmptyPartials.length >= EMPTY_PARTIAL_BURST_COUNT) {
            const voiceCfg: any = session.agent?.voice_config || session.agent?.voiceConfig || {};
            const target = String(voiceCfg.fallback_provider || 'sarvam').toLowerCase();
            emit(session, 'SARVAM_FALLBACK_TRIGGERED', {
              reason: 'empty_partial_burst',
              empty_count: session.dgEmptyPartials.length,
              target,
            });
            clearSttSilenceWatchdog(session);
            session.dgEmptyPartials = [];
            void switchToFallbackMidCall(session);
          }
        }
        return;
      }

      // Low-confidence final → treat as silent (don't pollute history with
      // misheard noise) AND nudge the watchdog by not updating lastSttEventAt.
      if (isFinal && confidence < LOW_CONFIDENCE_THRESHOLD) {
        emit(session, 'STT_FINAL', { len: text.length, preview: text.slice(0, 60), confidence, dropped: true });
        return;
      }

      if (!isFinal) {
        // Real partial — Deepgram IS transcribing, reset the empty-burst
        // counter and update the silence watchdog reference.
        session.dgEmptyPartials = [];
        session.lastSttEventAt = Date.now();
        emit(session, 'STT_PARTIAL', { len: text.length, preview: text.slice(0, 60) });
        logger.debug({ callSid: session.callSid, preview: text.slice(0, 40) }, '[STT_PARTIAL_RECEIVED]');

        // Mid-TTS escalation: a long substantive partial (≥4 words OR a
        // question-mark) means the caller is clearly speaking over the
        // agent — stop the agent NOW instead of waiting for endpointing
        // (600ms more silence) to produce a final. Past the grace window
        // only; the early-onset SpeechStarted handler already covers the
        // first-word case.
        if (
          session.isAgentSpeaking &&
          !session.bargeInRequested &&
          Date.now() >= session.bargeInAllowedAt
        ) {
          // Echo guard: on PSTN the agent's own reply leaks back and Deepgram
          // transcribes it as a multi-word partial. If this partial overlaps
          // heavily with what the agent is currently saying, it's echo — do NOT
          // barge in (that's what was clipping replies + breaking up the audio).
          const echoOverlap = session.currentAgentText
            ? tokenOverlapRatio(text, session.currentAgentText)
            : 0;
          const wordCount = text.split(/\s+/).filter(Boolean).length;
          const isQuestion = /[?]\s*$/.test(text);
          if (echoOverlap < 0.5 && (wordCount >= 4 || isQuestion)) {
            session.bargeInRequested = true;
            emit(session, 'INTERRUPT_DETECTED', { trigger: 'partial_substantive', word_count: wordCount });
          }
        }
        return;
      }

      // Final: stamp the latency timestamp, log the event, and dispatch into
      // the conversation history. ALWAYS persist the utterance even if the
      // agent is mid-reply so the recording↔transcript alignment is complete.
      session.turn.sttFinalAt = Date.now();
      session.lastSttEventAt = Date.now();
      emit(session, 'STT_FINAL', { len: text.length, preview: text.slice(0, 60) });
      logger.info({ callSid: session.callSid, preview: text.slice(0, 40) }, '[STT_FINAL_RECEIVED]');
      await dispatchUserUtterance(session, text);
    } catch {
      /* ignore malformed frames */
    }
  });

  dg.on('close', (code, reason) => {
    stopKeepalive();
    logger.info({ callSid: session.callSid, code, reason: reason?.toString().slice(0, 80) }, 'Deepgram STT WS closed');
    // Only attempt reconnect if the session is still live and the close
    // wasn't requested by us (e.g., onStop). 1000 = normal closure (us).
    if (session.closed || session.callEnded || code === 1000) return;

    // If the agent has auto-fallback armed, prefer skipping the 3-attempt
    // reconnect ladder entirely — every reconnect delay is dead air for the
    // caller. Go straight to Whisper/Sarvam so the conversation continues.
    if (session.enableAutoFallback && session.sttBackend === 'deepgram') {
      const voiceCfg: any = session.agent?.voice_config || session.agent?.voiceConfig || {};
      const target = String(voiceCfg.fallback_provider || 'sarvam').toLowerCase();
      emit(session, 'SARVAM_FALLBACK_TRIGGERED', {
        reason: 'websocket_error',
        ws_close_code: code,
        target,
      });
      clearSttSilenceWatchdog(session);
      void switchToFallbackMidCall(session);
      return;
    }
    scheduleDeepgramReconnect(session, apiKey);
  });

  dg.on('error', (err) => {
    logger.warn({ callSid: session.callSid, err: err.message }, 'Deepgram STT WS error');
    // Don't reconnect here — 'close' fires right after 'error' and that's
    // where the reconnect ladder lives. Two reconnects would race.
  });

  session.dgWs = dg;
}

/**
 * Push a mulaw frame into the per-session batch. Flushes when the batch hits
 * 3 frames (~60ms) OR after a 60ms timer fires (so trailing single frames
 * don't get stuck in the buffer when the caller goes silent).
 */
function pushDeepgramFrame(session: StreamSession, frame: Buffer): void {
  if (!session.dgWs || session.dgWs.readyState !== WebSocket.OPEN) return;
  session.dgFrameBatch.push(frame);
  // Flush eagerly at 3 frames — keeps Deepgram fed in the 60ms cadence its
  // streaming pipeline expects.
  if (session.dgFrameBatch.length >= 3) {
    flushDeepgramBatch(session);
    return;
  }
  // Otherwise, schedule a deferred flush so a lone trailing frame still
  // arrives within ~60ms (e.g., end of an utterance with no follow-up).
  if (!session.dgBatchFlushTimer) {
    session.dgBatchFlushTimer = setTimeout(() => {
      session.dgBatchFlushTimer = null;
      flushDeepgramBatch(session);
    }, 60);
  }
}

function flushDeepgramBatch(session: StreamSession): void {
  if (session.dgBatchFlushTimer) {
    clearTimeout(session.dgBatchFlushTimer);
    session.dgBatchFlushTimer = null;
  }
  if (session.dgFrameBatch.length === 0) return;
  if (!session.dgWs || session.dgWs.readyState !== WebSocket.OPEN) {
    session.dgFrameBatch.length = 0;
    return;
  }
  const merged = Buffer.concat(session.dgFrameBatch);
  session.dgFrameBatch.length = 0;
  try { session.dgWs.send(merged); } catch { /* close handler will reconnect */ }
}

/**
 * Exponential-backoff reconnect ladder. 1s → 2s → 4s; cap at 3 attempts.
 * On exhaustion, mark dgDead and let the session keep running (Plivo path
 * still works for outbound TTS; STT just goes silent until call ends).
 */
function scheduleDeepgramReconnect(session: StreamSession, apiKey: string): void {
  if (session.dgDead) return;
  const attempt = session.dgReconnectAttempts + 1;
  if (attempt > 3) {
    session.dgDead = true;
    logger.warn({ callSid: session.callSid }, 'Deepgram STT WS dead after 3 reconnect attempts');
    emit(session, 'WEBSOCKET_DEAD', { provider: 'deepgram' });
    return;
  }
  session.dgReconnectAttempts = attempt;
  const delayMs = Math.pow(2, attempt - 1) * 1000;  // 1s, 2s, 4s
  logger.info({ callSid: session.callSid, attempt, delayMs }, 'Deepgram STT: scheduling reconnect');
  setTimeout(() => {
    if (session.closed || session.callEnded) return;
    void openDeepgramSocket(session, apiKey);
  }, delayMs);
}

/**
 * Silent-failure watchdog. Polls every 2s; if voice_config.enable_auto_fallback
 * is on AND we've sent caller audio but Deepgram has emitted no STT events
 * (no partials, no SpeechStarted, no finals) for 8s, swap STT/TTS to Sarvam
 * for the rest of the call. Common trigger: nova-2's Telugu/Tamil approximation
 * produces only empty transcripts → user is talking but nothing comes back.
 *
 * Only one watchdog per session — arming is idempotent.
 */
// Lowered from 8s → 5s per spec section 3. Whisper round-trip ~1s, so total
// time from "Deepgram failing" → "Whisper producing transcripts" stays under
// 6s — within the conversational tolerance for "still feels responsive".
const SILENT_FAILURE_THRESHOLD_MS = 5000;
// If Deepgram emits 3+ empty partials in a 3s window it's "talking" but
// producing nothing usable — common when the language isn't supported.
const EMPTY_PARTIAL_BURST_WINDOW_MS = 3000;
const EMPTY_PARTIAL_BURST_COUNT = 3;
// Final transcripts below this confidence score are treated as silent —
// Deepgram occasionally emits low-confidence finals for noise that pollute
// the conversation history if forwarded to the LLM.
const LOW_CONFIDENCE_THRESHOLD = 0.3;
function armDeepgramSilentFailureWatchdog(session: StreamSession): void {
  if (!session.enableAutoFallback) return;
  if (session.sttSilenceWatchdog) return;  // already armed
  session.sttSilenceWatchdog = setInterval(() => {
    if (session.closed || session.callEnded) {
      clearSttSilenceWatchdog(session);
      return;
    }
    // Only consider switching when DG is the active STT AND we've received
    // some caller audio (callerBytes grows as Plivo streams). If the caller
    // hasn't talked at all yet, silence is expected, not a failure.
    if (session.sttBackend !== 'deepgram') {
      clearSttSilenceWatchdog(session);
      return;
    }
    const since = session.lastSttEventAt || 0;
    const idleMs = since ? Date.now() - since : 0;
    const hasAudio = session.callerBytes > 8000; // ≈1s of caller speech
    if (hasAudio && idleMs > SILENT_FAILURE_THRESHOLD_MS) {
      logger.warn(
        { callSid: session.callSid, idleMs, callerBytes: session.callerBytes },
        'Deepgram STT silent for >8s with audio — falling back to Sarvam',
      );
      const voiceCfg: any = session.agent?.voice_config || session.agent?.voiceConfig || {};
      const target = String(voiceCfg.fallback_provider || 'sarvam').toLowerCase();
      emit(session, 'SARVAM_FALLBACK_TRIGGERED', {
        reason: 'deepgram_silent_failure',
        idle_ms: idleMs,
        target,
      });
      clearSttSilenceWatchdog(session);
      void switchToFallbackMidCall(session);
    }
  }, 2000);
}

function clearSttSilenceWatchdog(session: StreamSession): void {
  if (session.sttSilenceWatchdog) {
    clearInterval(session.sttSilenceWatchdog);
    session.sttSilenceWatchdog = null;
  }
}

/**
 * Swap the active STT off Deepgram to the configured fallback (Whisper or
 * Sarvam) on a live call. Reads voice_config.fallback_provider — defaults to
 * 'sarvam' for back-compat with the original auto-fallback behaviour. When
 * the fallback target's API key isn't set, no-ops (Deepgram stays dead and
 * the call continues without STT until end — better than crashing).
 *
 * For Indic languages where Deepgram Aura also doesn't produce native TTS,
 * we additionally flip ttsBackend → 'sarvam' so the caller hears proper
 * Telugu/Tamil/Hindi instead of English-accented Aura. Whisper is STT-only;
 * TTS stays on Sarvam (or Aura for non-Indic).
 */
async function switchToFallbackMidCall(session: StreamSession): Promise<void> {
  const voiceCfg: any = session.agent?.voice_config || session.agent?.voiceConfig || {};
  const target = String(voiceCfg.fallback_provider || 'sarvam').toLowerCase();

  // Tear down Deepgram cleanly regardless of target.
  try {
    if (session.dgKeepaliveTimer) { clearInterval(session.dgKeepaliveTimer); session.dgKeepaliveTimer = null; }
    if (session.dgWs && session.dgWs.readyState === WebSocket.OPEN) {
      try { session.dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
      try { session.dgWs.close(1000, `switching-to-${target}`); } catch { /* ignore */ }
    }
  } catch { /* non-fatal */ }
  session.dgDead = true;

  const lang = session.language || 'en-IN';
  const isIndic = /^(hi|te|ta|kn|ml|mr|bn|gu|pa|or|as|ur|ne)/i.test(lang);

  const onFinal = async (text: string, provider: string) => {
    session.lastSttEventAt = Date.now();
    session.turn.sttFinalAt = Date.now();
    emit(session, 'STT_FINAL', { len: text.length, preview: text.slice(0, 60), provider });
    await dispatchUserUtterance(session, text);
  };

  try {
    if (target === 'whisper') {
      if (!whisperConfigured()) {
        logger.warn({ callSid: session.callSid }, 'Whisper fallback requested but OPENAI_API_KEY not set');
        return;
      }
      session.whisperStt = startWhisperStt({
        language: lang,
        onFinal: (text) => onFinal(text, 'whisper'),
      });
      session.sttBackend = 'whisper';
      // For Indic langs, also switch TTS to Sarvam so the agent's reply
      // sounds native — Deepgram Aura has no Telugu/Tamil voices.
      if (isIndic && sarvamConfigured()) session.ttsBackend = 'sarvam';
      emit(session, 'STT_STARTED', { provider: 'whisper', lang, source: 'fallback' });
      logger.info({ callSid: session.callSid, lang, isIndic }, 'Switched STT to Whisper mid-call');
      return;
    }

    // Default / 'sarvam' branch.
    if (!sarvamConfigured()) {
      logger.warn({ callSid: session.callSid }, 'Sarvam fallback requested but SARVAM_API_KEY not set');
      return;
    }
    session.sarvamStt = startSarvamStt({
      language: lang,
      onFinal: (text) => onFinal(text, 'sarvam'),
    });
    session.sttBackend = 'sarvam';
    session.ttsBackend = 'sarvam';
    emit(session, 'STT_STARTED', { provider: 'sarvam', lang, source: 'fallback' });
    logger.info({ callSid: session.callSid, lang }, 'Switched STT to Sarvam mid-call');
  } catch (err: any) {
    logger.warn({ callSid: session.callSid, target, err: err?.message }, 'Fallback open failed');
  }
}

/** Back-compat alias — older callers refer to switchToSarvamMidCall. */
const switchToSarvamMidCall = switchToFallbackMidCall;

// ---- turn handling ---------------------------------------------------------

/**
 * Route a final STT result into the transcript. ALWAYS persists the
 * caller's words (so we never lose a turn from the recording → transcript
 * alignment even if the agent is mid-reply). If the agent is idle, fire
 * a new LLM turn; otherwise the utterance stays in history + messages
 * and gets picked up when the current reply finishes.
 */
/**
 * STT artifact filter — phrases that Plivo / carrier / voicemail systems
 * inject into the audio stream and STT happily transcribes as "user
 * speech". These are not the caller — they're the carrier itself. Dropping
 * them before they ever hit the LLM keeps the agent from replying to
 * "this call will be recorded" with a confused acknowledgement.
 *
 * Real-world examples observed in /campaigns/3ea28e56 call recordings:
 *   - "This call will be recorded."
 *   - "This message has been transcribed. One moment while I notify the caller."
 *   - Indic-transliterated versions where Sarvam STT heard the English
 *     voicemail prompt through a low-bitrate codec.
 */
const STT_ARTIFACT_PATTERNS: RegExp[] = [
  /\bthis\s+call\s+(is\s+|will\s+|may\s+)?(be\s+|being\s+)?(recorded|monitored)\b/i,
  /\b(this|the)\s+(call|conversation)\s+(is|will|may)\s+be\s+recorded\b/i,
  /\bmessage\s+(has\s+been\s+|is\s+being\s+)?transcribed\b/i,
  /\bone\s+moment\s+while\s+i\s+notify\s+(the\s+)?caller\b/i,
  /\b(your\s+)?call\s+(is\s+being\s+|will\s+be\s+|may\s+be\s+)?recorded\s+for\s+(quality|training)/i,
  /\bplease\s+leave\s+(a\s+|your\s+)?message\s+(after\s+the\s+(beep|tone))?\b/i,
  /\bthe\s+(number|person)\s+you('?ve)?\s+(have\s+)?dial(l?ed)?\s+is\s+(not\s+available|unavailable|busy)\b/i,
  /\bthe\s+subscriber\s+you\s+are\s+trying\s+to\s+(call|reach)\b/i,
  // Indic-script paraphrases of "this call will be recorded" that Sarvam
  // sometimes produces when the carrier disclaimer leaks in.
  /(మెసేజ్|మెసేజి|మెసేజ్ ట్రాన్స్క్రైబ్|మెసేజి ట్రాన్స్క్రైబ్|నోటిఫై ద కాలర్|నోటిఫై చేస్తాను)/,
  /(रिकॉर्ड किया जा रहा|रिकॉर्डिंग|कॉल रिकॉर्ड)/,
];

function isSttArtifact(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t || t.length < 6) return false;
  return STT_ARTIFACT_PATTERNS.some((re) => re.test(t));
}

// Common acknowledgement-only utterances across the languages we support.
// When the caller responds with one of these RIGHT after the agent answered
// (and the agent's last turn was not a question), it's a back-channel
// acknowledgement — NOT a new request — and re-firing the LLM on it makes
// the agent re-explain what it just said. We still persist these to the
// transcript for fidelity, but skip the LLM call.
const FILLER_PATTERNS: RegExp[] = [
  // English — acks + continuation cues ("go on", "tell me", "continue")
  /^(ok|okay|kk?|yes|yeah|yep|yup|right|sure|alright|fine|got it|i see|uh|uh-huh|mm|mmhmm|hmm|hm|nope|no problem|cool|nice|great|true|correct|hello|hi|hey|continue|go on|tell me|please|carry on|keep going)\b/i,
  // Telugu — adds హలో (hello), చెప్పు/చెప్పండి (tell), కంటిన్యూ (continue), మన ఇష్టం (as you wish)
  /^(సరే|ఓకే|అవును|హా|ఉమ్|ఆ|హ్మ్|హ్మ|ఉ|హుం|హ|ఎస్|ఓ|హాయ్|హలో|హలో హలో|చెప్పు|చెప్పండి|చెప్పగలరా|కంటిన్యూ|అలాగే|మన ఇష్టం)/,
  // Hindi — adds हैलो / हलो (hello), बोलो/बताओ (tell), जारी रखो (continue)
  /^(हाँ|हां|ठीक|ठीक है|अच्छा|अच्छी|हम्म|जी|जी हाँ|हम|हू|हैलो|हलो|बोलो|बताओ|जारी रखो|कंटिन्यू)/,
  // Tamil
  /^(சரி|ஆமா|ஆம்|ம்|ஓகே|ஓகே சரி|ஹா|ஹலோ|சொல்லு|தொடரு)/,
  // Kannada
  /^(ಸರಿ|ಹೌದು|ಹಾಂ|ಆಯ್ತು|ಹಾ|ಹಲೋ|ಹೇಳಿ|ಮುಂದುವರಿಸಿ)/,
  // Malayalam
  /^(ശരി|അതെ|ഉം|ഹം|ഹലോ|പറയൂ|തുടരൂ)/,
  // Marathi
  /^(ठीक|बरं|हो|बरोबर|हॅलो|बोला|पुढे)/,
  // Bengali / Gujarati / Punjabi (basic acks)
  /^(হ্যাঁ|ঠিক|হ্যালো|બોલો|હા|ઠીક|હેલો|ਹਾਂ|ਠੀਕ|ਹੈਲੋ)/,
];

/**
 * Stop / interrupt keywords. If a short utterance contains one of these the
 * caller really IS trying to interrupt the agent — let the barge-in through
 * even if it's only 1-2 words. Without this list the substantive-utterance
 * gate below would swallow legitimate "stop" / "ఆగండి" requests.
 */
const STOP_KEYWORDS: RegExp[] = [
  /\b(stop|wait|hold on|pause|shut up|enough|quiet)\b/i,
  /(ఆగు|ఆగండి|ఆపు|ఆపండి|చాలు)/, // Telugu: stop/enough
  /(रुको|रुकिए|रोको|रोकिए|बंद|बस|चुप)/,      // Hindi
  /(நிறுத்து|போதும்)/,              // Tamil
  /(ನಿಲ್ಲಿಸಿ|ಸಾಕು)/,                // Kannada
  /(നിർത്തൂ|മതി)/,                  // Malayalam
  /(थांबा|पुरे)/,                    // Marathi
];

/**
 * Voice-mode brevity guard: keep at most 4 sentences AND ≤ 90 words. The
 * earlier 2/45 cap made content agents (movies, courses, product specs)
 * sound truncated mid-thought — caller would hear the opening of a story
 * and the line just stopped. 4/90 is roughly 30 seconds of speech, enough
 * to deliver a meaningful answer (cast + plot + director, or steps in a
 * how-to) but not so long that a sales/qualification agent rambles. If a
 * specific agent needs to be more terse, the prompt itself should ask for
 * it — this cap is a hard ceiling, not a floor.
 *
 * If the reply contains a question, prefer to keep that question even if
 * it's the 5th sentence — callers should hear "answer + one question", not
 * five paragraphs of encyclopaedia followed by a question that gets cut.
 */
export function trimReplyForVoice(text: string, maxSentences = 2, maxWords = 50): string {
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

  // Word cap: drop WHOLE sentences off the tail until we're under maxWords,
  // never slice mid-sentence. Slicing at word N left half-formed thoughts
  // ("...the fee structure is forty-five thou.") that sounded broken to
  // the caller. Always preserve at least the first sentence even if it's
  // over the cap by itself — clipping the opener is worse than running long.
  const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
  while (pick.length > 1 && countWords(pick.join(' ')) > maxWords) {
    pick.pop();
  }
  out = pick.join(' ').trim();
  if (!/[.!?।॥]$/u.test(out)) out += '.';
  return out;
}

/**
 * Lightweight token-set similarity. Lowercases, strips punctuation/diacritics
 * for the latin parts only, splits into ≥2-char tokens. Returns Jaccard ratio
 * of the token sets — high score = the two replies say essentially the same
 * thing. Cross-script tokens (Devanagari/Telugu/etc) are compared as-is so
 * we still detect repeats in Indic-script answers.
 */
function tokenSimilarity(a: string, b: string): number {
  const toks = (s: string): Set<string> => {
    const cleaned = (s || '')
      .toLowerCase()
      .replace(/[.,!?;:।॥"'()\[\]{}*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const set = new Set<string>();
    for (const t of cleaned.split(' ')) {
      if (t.length >= 2) set.add(t);
    }
    return set;
  };
  const A = toks(a);
  const B = toks(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

const NO_REPEAT_FOLLOWUP: Record<string, string> = {
  // Map common language tags → "anything else?" phrased natively.
  en: 'Anything else I can help with?',
  'en-IN': 'Anything else I can help with?',
  'en-US': 'Anything else I can help with?',
  hi: 'क्या और कुछ जानना चाहेंगे?',
  'hi-IN': 'क्या और कुछ जानना चाहेंगे?',
  te: 'ఇంకేమైనా అడగాలనుకుంటున్నారా?',
  'te-IN': 'ఇంకేమైనా అడగాలనుకుంటున్నారా?',
  ta: 'வேறு ஏதாவது தெரிந்துகொள்ள வேண்டுமா?',
  'ta-IN': 'வேறு ஏதாவது தெரிந்துகொள்ள வேண்டுமா?',
  kn: 'ಇನ್ನೇನಾದರೂ ಕೇಳಬೇಕೆ?',
  'kn-IN': 'ಇನ್ನೇನಾದರೂ ಕೇಳಬೇಕೆ?',
  ml: 'വേറെ എന്തെങ്കിലും അറിയണോ?',
  'ml-IN': 'വേറെ എന്തെങ്കിലും അറിയണോ?',
  mr: 'आणखी काही विचारायचंय का?',
  'mr-IN': 'आणखी काही विचारायचंय का?',
  bn: 'আর কিছু জানতে চান?',
  'bn-IN': 'আর কিছু জানতে চান?',
  gu: 'બીજું કંઈ પૂછવું છે?',
  'gu-IN': 'બીજું કંઈ પૂછવું છે?',
  pa: 'ਹੋਰ ਕੁਝ ਪੁੱਛਣਾ ਚਾਹੁੰਦੇ ਹੋ?',
  'pa-IN': 'ਹੋਰ ਕੁਝ ਪੁੱਛਣਾ ਚਾਹੁੰਦੇ ਹੋ?',
};

/**
 * If `candidate` is too similar to any of the last few assistant turns,
 * replace it with a short "anything else?" close. Compares against the most
 * recent 3 assistant turns — that's enough to catch the typical repeat
 * pattern (caller says "thanks", LLM re-emits its previous fact-dump).
 *
 * Threshold 0.55 was picked by eyeballing the live Money-Heist transcript
 * where verbatim repeats hit ~0.85+ Jaccard and lightly-rephrased repeats
 * sat at 0.55-0.7. New-content replies score <0.4.
 */
function dedupeReply(
  candidate: string,
  history: Array<{ role: string; content: string }>,
  language: string,
): string {
  const cand = (candidate || '').trim();
  if (!cand) return cand;
  const recentAssistant: string[] = [];
  for (let i = history.length - 1; i >= 0 && recentAssistant.length < 3; i--) {
    if (history[i].role === 'assistant') recentAssistant.push(history[i].content || '');
  }
  for (const prev of recentAssistant) {
    const sim = tokenSimilarity(cand, prev);
    if (sim >= 0.55) {
      const lang = (language || 'en').toLowerCase();
      const followUp = NO_REPEAT_FOLLOWUP[lang]
        || NO_REPEAT_FOLLOWUP[lang.slice(0, 2)]
        || NO_REPEAT_FOLLOWUP.en;
      logger.info(
        { sim: sim.toFixed(2), candidatePreview: cand.slice(0, 80), prevPreview: prev.slice(0, 80) },
        'Reply: near-duplicate detected — replacing with follow-up',
      );
      return followUp;
    }
  }
  return cand;
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
      session.isInbound ? 'inbound' : 'outbound',
      session.language,
    );
    const cleaned = trimReplyForVoice((reply || '').replace(/\[END_CALL\]/gi, '').trim(), 1, 15);
    return cleaned || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fraction of `a`'s tokens that also appear in `b`. Used to spot when an
 * inbound STT result is just the agent's own TTS echoed back from the
 * carrier. Tokens are stripped of punctuation + lowercased so "Hello." and
 * "hello" match. Token-set membership not multi-set, so a 3-word ack like
 * "yes, that's right" doesn't score 100% against a long agent sentence
 * just because each word happened to appear somewhere in it — we require
 * at least 3 distinct shared tokens before declaring echo, so short
 * confirmations aren't misclassified.
 */
function tokenOverlapRatio(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[.,!?;:।॥"'`()\-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
  const ta = norm(a);
  const tb = new Set(norm(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  let shared = 0;
  const seen = new Set<string>();
  for (const w of ta) {
    if (tb.has(w) && !seen.has(w)) {
      shared++;
      seen.add(w);
    }
  }
  if (shared < 3) return 0; // not enough signal to call it echo
  return shared / ta.length;
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

  // Dedup guard: when both Deepgram and Sarvam STT are active (fallback
  // path), both can return the same final transcript within a short window.
  // Drop the duplicate so the LLM doesn't see the same user turn twice.
  const now = Date.now();
  const lastU = (session as any)._lastUserUtterance as { text: string; ts: number } | undefined;
  if (lastU && lastU.text === text && now - lastU.ts < 3000) {
    logger.info({ callSid: session.callSid, userText: text.slice(0, 60) }, 'Stream: dropped duplicate STT utterance');
    return;
  }
  (session as any)._lastUserUtterance = { text, ts: now };

  // STT-artifact guard: the carrier (voicemail prompts, "this call is being
  // recorded" disclaimers, transcription confirmations) bleeds into the STT
  // stream and gets recognised as caller speech. Drop it — never persist,
  // never add to history, never fire the LLM. Without this the agent ends
  // up replying to ITS OWN system disclaimer with confused acks.
  if (isSttArtifact(text)) {
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 80) },
      'Stream: dropped STT artifact (carrier/voicemail/system phrase)',
    );
    return;
  }

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
        .then(() => new Promise((r) => setTimeout(r, estimatedPlayoutMs(farewell))))
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

  // Only skip filler acks if the agent JUST spoke (within 5s). If it's been
  // longer, the user is trying to get attention ("హలో? హలో?") — always respond.
  const secsSinceLastReply = session.turn.ttsStartAt > 0 ? (Date.now() - session.turn.ttsStartAt) / 1000 : 999;
  const isAttentionCall = /హలో|hello|hi|hey|हैलो|हलो|ஹலோ|ಹಲೋ/i.test(text);
  const skipThisFiller = filler && lastWasAssistant && !lastAssistantAskedQuestion && secsSinceLastReply < 5 && !isAttentionCall;
  if (skipThisFiller) {
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 60) },
      'Stream: skipped back-channel ack (no LLM trigger, would cause repeat)',
    );
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'user', text);
    }
    return;
  }

  // ACK-DEBOUNCE: when the customer says a SINGLE short ack word like
  // "ఓకే", "OK", "సరే", "yes" in response to a question, wait briefly to see
  // if they continue speaking. Multi-word sentences are NEVER debounced.
  // Tuned 1500→900ms for snappier turns (balanced latency); still long enough
  // to catch a continuation. The _ackBypass flag prevents infinite re-entry.
  const ackBypass = (session as any)._ackBypass === true;
  if (!ackBypass) {
    const ackWordCount = text.split(/\s+/).filter(Boolean).length;
    const isShortAck = ackWordCount === 1 && /^(ok(ay)?|yes|yeah|yep|haa|ha|hmm|hm|ఓకే|సరే|అవును|ఊ|ఆ|हाँ|हां|ठीक|अच्छा|हा|ஓகே|சரி|ಸರಿ|ശരി)[\s.!]*$/i.test(text.trim());
    if (isShortAck && lastAssistantAskedQuestion && !session.isAgentSpeaking) {
      const debounceMs = Number(process.env.ACK_DEBOUNCE_MS) || 900;
      const pending = (session as any)._ackDebounce as { text: string; timer: any } | undefined;
      if (pending?.timer) clearTimeout(pending.timer);
      (session as any)._ackDebounce = {
        text,
        timer: setTimeout(() => {
          (session as any)._ackDebounce = undefined;
          (session as any)._ackBypass = true;
          dispatchUserUtterance(session, text).finally(() => { (session as any)._ackBypass = false; });
        }, debounceMs),
      };
      logger.info({ callSid: session.callSid, userText: text.slice(0, 40), debounceMs }, 'Stream: ack-debounce started — waiting for continuation');
      return;
    }
    // If a real utterance arrives while an ack is pending, merge them.
    const pendingAck = (session as any)._ackDebounce as { text: string; timer: any } | undefined;
    if (pendingAck?.timer) {
      clearTimeout(pendingAck.timer);
      (session as any)._ackDebounce = undefined;
      const merged = `${pendingAck.text} ${text}`.trim();
      logger.info({ callSid: session.callSid, merged: merged.slice(0, 80) }, 'Stream: ack-debounce merged with continuation');
      (session as any)._ackBypass = true;
      return dispatchUserUtterance(session, merged).finally(() => { (session as any)._ackBypass = false; });
    }
  } else {
    (session as any)._ackBypass = false;
  }

  // ECHO REJECTION: while the agent is speaking, Plivo's PSTN echo
  // cancellation sometimes lets the agent's own TTS leak back into the
  // caller channel. STT transcribes it as a "user utterance" that looks
  // substantive (≥4 words), which then fires barge-in and triggers a
  // duplicate LLM reply — the caller hears two overlapping voices ("double
  // voice"). If the incoming user text shares a high fraction of tokens
  // with the audio we're CURRENTLY playing, treat it as echo: drop it
  // silently — don't persist, don't add to history, don't barge in.
  if (session.isAgentSpeaking && session.currentAgentText) {
    const overlap = tokenOverlapRatio(text, session.currentAgentText);
    if (overlap >= 0.5) {
      logger.info(
        { callSid: session.callSid, overlap, userText: text.slice(0, 60), agentText: session.currentAgentText.slice(0, 60) },
        'Stream: dropped utterance as carrier echo of current agent reply',
      );
      return;
    }
  }

  // BARGE-IN: caller is speaking substantively while the agent is mid-reply.
  // Flag the playback loop to stop streaming TTS chunks and flush Plivo's
  // queue so the agent shuts up immediately and listens to what was said.
  //
  // Gate it on three conditions to stop trivial echoes / continuation-cues
  // from chopping every agent reply at 5-30% completion:
  //   1. Grace period: ignore barge-in for the first ~1.5s of agent speech.
  //      Short interjections at the start ("హలో") are usually echo or the
  //      caller acknowledging the start, not a real interruption.
  //   2. Substantive utterance: ≥4 words OR ≥25 chars OR contains a stop
  //      keyword. Below that the utterance is treated as a back-channel
  //      and the agent keeps speaking. The transcript still records it.
  //   3. Already past the agent's reply tail: if 80%+ of the audio has
  //      been sent, just let it finish — interrupting now only saves
  //      <1s and leaves the caller hearing a half-cut sentence.
  if (session.isAgentSpeaking) {
    const isStop = STOP_KEYWORDS.some((re) => re.test(text));
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const charCount = text.length;
    // Caller-question bypass: any utterance that's clearly a question
    // (contains "?" or an interrogative word in any supported language)
    // ALWAYS barges in, regardless of word count or grace period. This
    // is the most important signal — if the caller is mid-asking
    // something, the agent must stop and listen so it can answer that
    // specific question, not whatever it was about to say.
    const isQuestion = /[?？]/.test(text) || /\b(what|how|why|when|where|who|which|can you|could you|do you|is it|are you|will you)\b/i.test(text)
      || /(ఏమి|ఎక్కడ|ఎప్పుడు|ఎందుకు|ఎవరు|ఎలా|ఏది|ఏం)/.test(text)        // Telugu
      || /(क्या|कहाँ|कब|क्यों|कौन|कैसे|कौनसा)/.test(text)               // Hindi
      || /(என்ன|எங்கே|எப்போது|ஏன்|யார்|எப்படி|எது)/.test(text)         // Tamil
      || /(ಏನು|ಎಲ್ಲಿ|ಯಾವಾಗ|ಏಕೆ|ಯಾರು|ಹೇಗೆ|ಯಾವುದು)/.test(text)        // Kannada
      || /(എന്ത്|എവിടെ|എപ്പോൾ|എന്തിന്|ആര്|എങ്ങനെ)/.test(text);       // Malayalam
    // Substantive threshold: 3 words / 15 chars (down from 6/35).
    // Combined with the question bypass above, genuine interruptions
    // cut the agent off immediately while pure backchannel echoes
    // ("hmm", "ఆ", "हाँ") still don't fire — those are 1-2 chars max.
    const substantive = isStop || isQuestion || wordCount >= 3 || charCount >= 15;
    const inGrace = Date.now() < session.bargeInAllowedAt;

    if (!substantive) {
      logger.info(
        { callSid: session.callSid, userText: text.slice(0, 60), wordCount, charCount },
        'Stream: barge-in suppressed — utterance too short to interrupt',
      );
    } else if (inGrace && !isStop && !isQuestion) {
      logger.info(
        { callSid: session.callSid, userText: text.slice(0, 60), msUntilAllowed: session.bargeInAllowedAt - Date.now() },
        'Stream: barge-in suppressed — within grace period at start of agent reply',
      );
    } else {
      session.bargeInRequested = true;
      logger.info(
        { callSid: session.callSid, userText: text.slice(0, 60), wordCount, charCount, isStop },
        'Stream: barge-in requested — caller spoke during agent reply',
      );
    }
  }

  logger.info({ callSid: session.callSid, userText: text.slice(0, 100), inFlight: session.inFlightReply }, 'Stream: user utterance');

  // Indic-letter spelling decoder: when the caller spells an email/phone in
  // their language ("వి ఏ జె ఐ at gmail dot com"), Sarvam STT returns the
  // raw Telugu syllables which look like nonsense to the LLM. Decode them
  // into ASCII and attach as a HINT — we keep the caller's exact words for
  // the transcript but pass a side-channel candidate to the LLM so it can
  // read back the value for confirmation instead of inventing a wrong one.
  let historyText = text;
  const spellingHint = decodeIndicSpelling(text, session.language);
  if (spellingHint) {
    logger.info(
      { callSid: session.callSid, userText: text.slice(0, 80), hint: spellingHint },
      'Stream: detected spelling — attached parsed-spelling hint to LLM turn',
    );
    historyText = `${text}\n[SPELLED VALUE PARSED FROM CALLER'S LETTERS: ${spellingHint} — ALWAYS read this back to the caller letter-by-letter or digit-by-digit and ask if it's correct before storing.]`;
  }

  // Slot extraction: run on EVERY user turn to populate session.collectedFields
  // with structured (value, confidence, confirmed, source) for each lead field.
  // Drives two things:
  //   1. The CAPTURED-SO-FAR hint appended below so the LLM never re-asks
  //      a confirmed field.
  //   2. createLeadFromAnalysis (in conversation-service) uses these slots
  //      as the source of truth for CRM persistence, overriding the analyzer's
  //      LLM extraction when the caller explicitly confirmed a value.
  const slotsUpdated = extractSlotsFromUtterance(text, spellingHint, session.collectedFields);
  if (slotsUpdated.length > 0) {
    logger.info(
      { callSid: session.callSid, updated: slotsUpdated, slots: session.collectedFields },
      'Stream: slot store updated',
    );
  }

  // Confirmation handling: if the user just said "yes / correct / సరి",
  // flip the most-recently-mentioned unconfirmed slot to confirmed. The
  // agent's previous turn was the read-back; we infer which slot the user
  // is confirming from the slot recency. If no obvious slot is awaiting
  // confirmation, this is a noop.
  if (isAffirmative(text)) {
    // Find newest (highest-confidence, unconfirmed) slot and confirm it.
    const cf = session.collectedFields;
    const order: SlotName[] = ['email', 'mobile', 'name', 'university', 'city', 'course', 'callback_time'];
    for (const k of order) {
      const s = cf[k];
      if (s && !s.confirmed) {
        s.confirmed = true;
        logger.info({ callSid: session.callSid, slot: k, value: s.value }, 'Stream: slot CONFIRMED by caller');
        break;
      }
    }
  } else if (isNegative(text)) {
    // Find newest unconfirmed slot and clear it (caller said the read-back
    // was wrong — agent will re-ask, decoder/regex will pick up the next
    // utterance and write a fresh slot value).
    const cf = session.collectedFields;
    const order: SlotName[] = ['email', 'mobile', 'name', 'university', 'city', 'course', 'callback_time'];
    for (const k of order) {
      const s = cf[k];
      if (s && !s.confirmed) {
        logger.info({ callSid: session.callSid, slot: k, rejectedValue: s.value }, 'Stream: slot REJECTED by caller — clearing');
        delete cf[k];
        break;
      }
    }
  }

  // Append the "[CAPTURED SO FAR: …]" hint so the LLM sees the structured
  // state on EVERY turn. The agent uses this to skip re-asking confirmed
  // fields and to read back unconfirmed ones letter-by-letter.
  const slotHint = buildSlotHint(session.collectedFields);
  if (slotHint) {
    historyText = `${historyText}${slotHint}`;
  }

  // Persist the utterance to BOTH the in-memory conversation history
  // (so the next LLM call sees it) and the messages table (so the Call
  // Detail transcript reflects every word from the recording). The
  // transcript gets the caller's ORIGINAL words; only the LLM context
  // gets the spelling hint appended.
  session.history.push({ role: 'user', content: historyText });
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
  // Max-turns safety: if conversation exceeds 40 turns, auto-close to
  // prevent infinite loops when LLMs keep failing with "say-again".
  if (session.history.length > 40 && !session.callEnded) {
    session.callEnded = true;
    const lang = String(session.language || '').slice(0, 2);
    const autoClose = lang === 'te' ? 'ధన్యవాదాలు, మా టీమ్ మీకు త్వరలో కాల్ చేస్తారు. శుభదినం!'
      : lang === 'hi' ? 'धन्यवाद, हमारी टीम जल्द आपसे संपर्क करेगी। शुभ दिन!'
      : 'Thank you! Our team will contact you shortly. Have a great day!';
    logger.warn({ callSid: session.callSid, turns: session.history.length }, 'Stream: max-turns safety — auto-closing call');
    if (session.plivoWs) {
      playText(session.plivoWs, session, autoClose).catch(() => {}).then(() => new Promise(r => setTimeout(r, estimatedPlayoutMs(autoClose)))).then(async () => {
        try { await plivoProvider.endCall(session.callSid); } catch {}
      });
    }
    return;
  }

  session.inFlightReply = true;
  session.turn.llmStartAt = Date.now();
  setCallState(session, 'THINKING', 'llm_dispatch');
  // Compute ttft (time-to-first-token) once the LLM kicks off — measures
  // how long Deepgram→dispatch took to hand off.
  const ttftFromStt = session.turn.sttFinalAt ? Date.now() - session.turn.sttFinalAt : null;
  logger.info({ callSid: session.callSid }, '[LLM_STREAM_STARTED]');
  emit(session, 'LLM_RESPONSE_STARTED', {
    history_len: session.history.length,
    ttft_from_stt_ms: ttftFromStt,
  });

  // Watchdog: clear inFlightReply if LLM hangs for >15s so the next user
  // utterance can still fire a fresh turn. Without this a hung Gemini /
  // Sarvam request silently kills the conversation.
  if (session.inFlightWatchdog) clearTimeout(session.inFlightWatchdog);
  // 15s, not 8s: the Indic LLM (Sarvam-M) legitimately takes 8-11s per turn,
  // so an 8s watchdog fired mid-reply and cleared the in-flight flag, making
  // the agent look unresponsive. 15s still catches a truly hung request.
  const INFLIGHT_WATCHDOG_MS = 15000;
  session.inFlightWatchdog = setTimeout(() => {
    if (!session.inFlightReply) return;  // completed normally before timeout
    session.inFlightReply = false;
    session.inFlightWatchdog = null;
    emit(session, 'INFLIGHT_WATCHDOG_FIRED', { elapsed_ms: INFLIGHT_WATCHDOG_MS });
    logger.warn({ callSid: session.callSid }, 'inFlightReply watchdog fired — clearing stuck flag');
  }, INFLIGHT_WATCHDOG_MS);

  handleUserUtterance(session).finally(() => {
    session.inFlightReply = false;
    if (session.inFlightWatchdog) {
      clearTimeout(session.inFlightWatchdog);
      session.inFlightWatchdog = null;
    }
    const totalMs = session.turn.llmStartAt ? Date.now() - session.turn.llmStartAt : null;
    emit(session, 'LLM_RESPONSE_COMPLETED', { total_ms: totalMs });
  });
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
    // Streaming path: kick off the LLM + per-sentence synth + playback as one
    // pipeline. First audio reaches the caller ~500ms after the user's final
    // (vs ~1300ms with the buffered callLLM + playText flow), because we don't
    // wait for the whole reply before TTS starts. The Indic / Sarvam branch
    // inside streamLLMReply still buffers Sarvam-M's full output (its
    // <think>…</think> block forces it), but the sentences are still split
    // and synthesised in parallel so the downstream pipeline matches.
    //
    // Fallback strings MUST be in the call's language. A literal English
    // "Sorry, could you repeat that?" played on a Telugu call sounded like
    // a hard provider failure to the caller and broke immersion.
    const sayAgainLang = String(session.language || '').toLowerCase();
    const fallbackSayAgain =
      SAY_AGAIN[sayAgainLang] ||
      SAY_AGAIN[sayAgainLang.slice(0, 2)] ||
      'Sorry, could you repeat that?';
    // Voice-mode brevity caps — tighter for Indic where Sarvam-M tends to
    // emit 4-5 sentence paragraphs. Callers complained the agent was
    // "lecturing"; the prompt asks for 1-2 short sentences but Sarvam
    // ignores that, so we enforce it post-LLM.
    const isIndicCall = !/^en/i.test(String(session.language || ''));
    // Indic replies were running 7-11s of TTS (long monologues) which sounded
    // choppy and made callers hang up. Cap tighter: 2 short sentences but ~26
    // words so a reply is ~3-4s of speech. English stays roomy.
    const maxSent = isIndicCall ? 2 : 4;
    const maxWords = isIndicCall ? 26 : 130;
    let spoken = '';
    if (session.plivoWs) {
      const full = await streamAndPlayReply(session.plivoWs, session);
      const raw = (full && full.trim()) || fallbackSayAgain;
      const cleaned = raw.replace(/\[END_CALL\]/gi, '').trim() || fallbackSayAgain;
      const trimmed = trimReplyForVoice(cleaned, maxSent, maxWords);
      spoken = dedupeReply(trimmed, session.history, session.language);
    } else {
      // Defensive fallback for when the WS is gone before this loop tick —
      // mirrors the buffered path so messages still land in the transcript.
      const reply = await callLLM(
        session.agent,
        session.history,
        session.campaignContext.targetName,
        session.isInbound ? 'inbound' : 'outbound',
        session.language,
        session.campaignContext,
      );
      const raw = (reply && reply.trim()) || fallbackSayAgain;
      const cleaned = raw.replace(/\[END_CALL\]/gi, '').trim() || fallbackSayAgain;
      spoken = dedupeReply(trimReplyForVoice(cleaned), session.history, session.language);
    }

    session.history.push({ role: 'assistant', content: spoken });
    if (session.conversationId) {
      await appendMessage(session.conversationId, session.tenantId, 'assistant', spoken);
    }

    // AUTO-CLOSE: if the agent's reply is a closing/farewell message
    // (contains "24 hours", "have a great day", "good day", "శుభదినం",
    // "ధన్యవాదాలు", "शुभ दिन"), latch callEnded and schedule hangup
    // after a short delay so the caller hears the full farewell.
    const closingPattern = /24\s*hours|have a great day|good\s*day|శుభదినం|శుభ\s*దినం|ధన్యవాదాలు.*బ్రోచర్|brochure.*send|team will connect|our team|మా టీమ్/i;
    if (!session.callEnded && closingPattern.test(spoken)) {
      session.callEnded = true;
      const farewellMs = estimatedPlayoutMs(spoken);
      logger.info({ callSid: session.callSid, spoken: spoken.slice(0, 80), farewellMs }, 'Stream: auto-close detected — hanging up after full farewell');
      setTimeout(async () => {
        if (!session.callSid) return;
        try { await plivoProvider.endCall(session.callSid); }
        catch (e: any) { logger.warn({ callSid: session.callSid, err: e?.message }, 'Auto-hangup failed'); }
      }, farewellMs);
    }

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

/**
 * Streaming-LLM + parallel-TTS driver for the main turn loop.
 *
 * Pipelines three stages so first-audio arrives ~500–700ms after the user
 * finishes speaking instead of the ~1200–1500ms of the buffered path:
 *
 *   LLM (streaming) ──sentence──> synth (parallel) ──audio──> playback (in order)
 *
 * Each sentence emitted by the LLM is sanitized then handed straight to the
 * configured TTS backend; results are awaited in arrival order so the caller
 * hears them in the right sequence. Barge-in is honored at every await point.
 *
 * Returns the full reply text (post-sanitize) so the caller can persist it to
 * the transcript / apply dedupeReply / etc. Returns '' if the LLM produced no
 * usable content — caller should fall back to a "could you repeat" line.
 */
/** True when this call should use the Sarvam streaming-TTS WebSocket transport
 *  (provider-locked: only when the pinned TTS backend is Sarvam). Set
 *  SARVAM_TTS_STREAM=0 to force the legacy HTTP path. */
function shouldStreamTts(session: StreamSession): boolean {
  return (
    process.env.SARVAM_TTS_STREAM !== '0' &&
    session.ttsBackend === 'sarvam' &&
    sarvamStreamConfigured() &&
    !session.ttsStreamFailed
  );
}

/** Get-or-open the persistent per-call Sarvam TTS stream. Returns null (and
 *  latches HTTP fallback) on failure. Callbacks push into per-turn scratch
 *  state on the session so one socket serves every turn. */
async function getTtsStream(session: StreamSession): Promise<any | null> {
  if (session.ttsStreamFailed) return null;
  if (session.ttsStream && (session.ttsStream as SarvamTtsStream).connected) return session.ttsStream;
  if (session.ttsStream) return session.ttsStream; // connecting/known-open instance
  const stream = new SarvamTtsStream({
    language: session.language,
    voiceId: session.ttsVoiceId,
    onChunk: (buf: Buffer) => { (session.ttsChunkQueue ||= []).push(buf); },
    onTurnEnd: () => { session.ttsTurnDone = true; },
    onError: (m: string) => { session.ttsStreamError = m; },
  });
  try {
    await stream.connect();
    session.ttsStream = stream;
    logger.info({ callSid: session.callSid, voice: session.ttsVoiceId }, '[STT/TTS] Sarvam TTS stream connected');
    return stream;
  } catch (err: any) {
    session.ttsStreamFailed = true;
    emit(session, 'SARVAM_FALLBACK_TRIGGERED', { stage: 'tts_stream_connect', reason: err?.message || 'connect failed' });
    logger.warn({ callSid: session.callSid, err: err?.message }, '[STREAM_FALLBACK_TRIGGERED] TTS stream connect failed — using HTTP TTS');
    return null;
  }
}

/**
 * Streaming-TTS turn handler. Mirrors streamAndPlayReply's state/barge-in/
 * playout semantics but pipes the LLM's sentences into the persistent Sarvam
 * TTS WebSocket and forwards the returned mulaw chunks to Plivo paced at
 * ~real-time (no 5x blast). Returns the full reply text. On any streaming
 * failure it returns the sentinel null so the caller falls back to the HTTP
 * path for this turn.
 */
async function streamReplyViaSarvamStream(
  plivoWs: WebSocket,
  session: StreamSession,
  stream: SarvamTtsStream,
): Promise<string | null> {
  // ~real-time pacing: mulaw 8k = 8 bytes/ms. Send 800-byte (100ms) frames and
  // sleep slightly LESS than 100ms so Plivo keeps a small jitter buffer without
  // being flooded — the fix for tunnel-induced "breaking".
  const FRAME_BYTES = 800;
  const FRAME_SLEEP_MS = Number(process.env.TTS_FRAME_SLEEP_MS) || 85;
  const BACKPRESSURE_BYTES = 256 * 1024;

  // Reset per-turn scratch state (the stream is persistent across turns).
  session.ttsChunkQueue = [];
  session.ttsTurnDone = false;
  session.ttsStreamError = null;
  (stream as any)._flushed = false;
  stream.cancelTurn();

  const BARGE_IN_GRACE_MS = bargeInGraceMs(session);
  session.isAgentSpeaking = true;
  session.bargeInRequested = false;
  session.bargeInAllowedAt = Date.now() + BARGE_IN_GRACE_MS;
  session.currentAgentText = '';
  session.turn.ttsStartAt = Date.now();
  setCallState(session, 'AGENT_SPEAKING', 'tts_start');
  const ttsFromLlm = session.turn.llmStartAt ? Date.now() - session.turn.llmStartAt : null;
  emit(session, 'TTS_STARTED', { mode: 'stream_ws', ttsFromLlm_ms: ttsFromLlm });
  logger.info({ callSid: session.callSid }, '[TTS_STREAM_STARTED]');

  const agentSpeakingWatchdog = setTimeout(() => {
    if (!session.isAgentSpeaking) return;
    logger.warn({ callSid: session.callSid }, 'AGENT_SPEAKING stuck >15s — forcing recovery');
    emit(session, 'STATE_FORCED_RECOVERY', { from: 'AGENT_SPEAKING', reason: 'tts_stuck' });
    session.isAgentSpeaking = false;
    session.bargeInRequested = false;
    setCallState(session, 'LISTENING', 'stuck_state_recovery');
  }, 15000);

  const sentencesEmitted: string[] = [];
  let llmDone = false;
  let spokeAny = false;

  // Producer: stream the LLM; push each completed sentence into the TTS stream.
  const llmPromise = streamLLMReply(
    session.agent,
    session.history,
    session.campaignContext.targetName,
    session.isInbound ? 'inbound' : 'outbound',
    session.language,
    session.campaignContext,
    (sentence: string) => {
      if (session.bargeInRequested) return;
      const clean = normalizePronunciation(sanitizeForTts(sentence), session.language);
      if (!clean) return;
      sentencesEmitted.push(clean);
      session.currentAgentText = sentencesEmitted.join(' ');
      spokeAny = true;
      stream.speak(clean);
    },
  ).then((full) => { llmDone = true; return full; }).catch(() => { llmDone = true; return ''; });

  let totalAudioBytes = 0;
  let firstChunkLogged = false;
  let leftover: Buffer | null = null;
  try {
    // Drain loop: forward queued mulaw chunks to Plivo, paced ~real-time, until
    // the LLM is done AND the stream signalled turn-end AND the queue is empty.
    while (true) {
      if (session.bargeInRequested) break;
      if (session.ttsStreamError) break; // stream errored mid-turn → fall back

      // Once the LLM has produced all sentences, flush the TTS stream so it
      // renders the tail and emits turn-end.
      if (llmDone && !(stream as any)._flushed) {
        (stream as any)._flushed = true;
        if (spokeAny) stream.flush(); else session.ttsTurnDone = true;
      }

      const q = session.ttsChunkQueue || [];
      let buf: Buffer | null = leftover;
      leftover = null;
      if (!buf && q.length > 0) buf = q.shift() as Buffer;

      if (!buf) {
        // Nothing to send yet. Done if LLM finished, stream said done, queue empty.
        if (llmDone && session.ttsTurnDone && q.length === 0) break;
        await new Promise((r) => setTimeout(r, 10));
        continue;
      }

      if (!firstChunkLogged) {
        firstChunkLogged = true;
        session.turn.audioFirstByteAt = Date.now();
        emit(session, 'TTS_FIRST_AUDIO', { ms_from_tts_start: Date.now() - (session.turn.ttsStartAt || Date.now()) });
        logger.info({ callSid: session.callSid }, '[TTS_FIRST_AUDIO_CHUNK]');
      }
      // Capture for the stereo recording at the current caller-timeline offset.
      session.agentMulawEvents.push({ offsetBytes: session.callerBytes, mulaw: buf });

      // Forward this buffer to Plivo in real-time-paced FRAME_BYTES slices.
      let off = 0;
      let aborted = false;
      for (; off < buf.length; off += FRAME_BYTES) {
        if (session.bargeInRequested) { aborted = true; break; }
        const slice = buf.subarray(off, Math.min(off + FRAME_BYTES, buf.length));
        while ((plivoWs as any).bufferedAmount > BACKPRESSURE_BYTES) {
          await new Promise((r) => setTimeout(r, 20));
          if (session.bargeInRequested || plivoWs.readyState !== WebSocket.OPEN) break;
        }
        try {
          plivoWs.send(JSON.stringify({ event: 'playAudio', media: { contentType: 'audio/x-mulaw', sampleRate: '8000', payload: slice.toString('base64') } }));
          totalAudioBytes += slice.length;
        } catch (err: any) {
          logger.warn({ callSid: session.callSid, err: err.message }, 'streamReplyViaSarvamStream: send failed');
          aborted = true; break;
        }
        // Pace ~real-time (slightly ahead) so Plivo's buffer stays healthy
        // without flooding the tunnel.
        await new Promise((r) => setTimeout(r, FRAME_SLEEP_MS));
      }
      if (aborted) {
        if (session.bargeInRequested) {
          try { plivoWs.send(JSON.stringify({ event: 'clearAudio' })); } catch { /* socket gone */ }
          emit(session, 'INTERRUPT_DETECTED', { trigger: 'barge_in_during_stream' });
          logger.info({ callSid: session.callSid }, '[INTERRUPTION_DETECTED] [TTS_STREAM_CANCELLED]');
        }
        break;
      }
    }
  } finally {
    clearTimeout(agentSpeakingWatchdog);
    stream.cancelTurn();
    // Real-time pacing means Plivo has played most audio already; a short
    // residual wait covers the last in-flight frame, with barge-in still cutting.
    if (!session.bargeInRequested && !session.callEnded && totalAudioBytes > 0) {
      const playoutDeadline = Date.now() + 250;
      while (Date.now() < playoutDeadline && !session.bargeInRequested && !session.callEnded && plivoWs.readyState === WebSocket.OPEN) {
        await new Promise((r) => setTimeout(r, 60));
      }
      if (session.bargeInRequested) { try { plivoWs.send(JSON.stringify({ event: 'clearAudio' })); } catch {} }
    }
    const wasInterrupted = session.bargeInRequested;
    session.isAgentSpeaking = false;
    session.currentAgentText = '';
    if (wasInterrupted) emit(session, 'TTS_CANCELLED', { duration_ms: Date.now() - session.turn.ttsStartAt });
    emit(session, 'TTS_STOPPED', { reason: wasInterrupted ? 'interrupted' : 'completed', duration_ms: session.turn.ttsStartAt ? Date.now() - session.turn.ttsStartAt : null });
    if (!wasInterrupted) logger.info({ callSid: session.callSid }, '[TTS_STREAM_COMPLETED] [AUDIO_PLAYBACK_COMPLETED]');
    if (!session.callEnded) {
      setCallState(session, 'LISTENING', wasInterrupted ? 'tts_interrupted' : 'tts_completed');
      emit(session, 'LISTENING_RESUMED', { after: wasInterrupted ? 'interrupt' : 'reply' });
    }
  }

  const full = await llmPromise.catch(() => '');
  // If the stream errored before producing any audio, signal fallback to caller.
  if (session.ttsStreamError && totalAudioBytes === 0) {
    emit(session, 'SARVAM_FALLBACK_TRIGGERED', { stage: 'tts_stream_turn', reason: session.ttsStreamError });
    logger.warn({ callSid: session.callSid, reason: session.ttsStreamError }, '[STREAM_FALLBACK_TRIGGERED] TTS stream produced no audio — HTTP fallback');
    return null;
  }
  return (full || sentencesEmitted.join(' ')).trim();
}

async function streamAndPlayReply(
  plivoWs: WebSocket,
  session: StreamSession,
): Promise<string> {
  session.plivoWs = plivoWs;
  if (plivoWs.readyState !== WebSocket.OPEN) return '';

  // Streaming-TTS transport (Sarvam WebSocket). When active, pipe LLM sentences
  // straight into the stream and forward mulaw chunks to Plivo paced real-time.
  // On any streaming failure we fall through to the legacy HTTP path below so
  // the call never goes silent. Provider is locked per shouldStreamTts().
  if (shouldStreamTts(session)) {
    const stream = await getTtsStream(session);
    if (stream) {
      const streamed = await streamReplyViaSarvamStream(plivoWs, session, stream);
      if (streamed !== null) return streamed;
      // null → stream failed mid-turn; latch HTTP fallback for the rest of call.
      session.ttsStreamFailed = true;
    }
    // else: connect failed → ttsStreamFailed latched in getTtsStream; fall through.
  }

  // 800 bytes = 100ms of mulaw 8kHz. Doubled from 400 (50ms) after callers
  // reported voice "breaking" mid-sentence — smaller chunks paid too much
  // per-chunk WebSocket-send overhead under network jitter, leading to
  // micro-gaps. 100ms is still fine-grained enough for barge-in (caller
  // utterances that trigger barge-in are ≥3 words / ≥15 chars, so at most
  // ~100ms of agent audio plays past the interrupt — imperceptible).
  const CHUNK_BYTES = 800;        // 100ms mulaw 8kHz
  const BARGE_IN_GRACE_MS = bargeInGraceMs(session);
  // Grace tuned per language (1500ms English / 2000ms Indic by default;
  // overridable via env or agent.voice_config.barge_in_grace_ms). Protects
                                  // against the start-of-reply echo loop on Plivo's
                                  // carrier path. Real barge-ins and stop
                                  // keywords still bypass.
  const BACKPRESSURE_BYTES = 256 * 1024;

  session.isAgentSpeaking = true;
  session.bargeInRequested = false;
  session.bargeInAllowedAt = Date.now() + BARGE_IN_GRACE_MS;
  session.currentAgentText = '';
  session.turn.ttsStartAt = Date.now();
  setCallState(session, 'AGENT_SPEAKING', 'tts_start');
  // ttfa here measures STT-final → first TTS byte. We don't have the first
  // byte yet (still synthesising) — record start so playback can compute it.
  const ttsFromLlm = session.turn.llmStartAt ? Date.now() - session.turn.llmStartAt : null;
  emit(session, 'TTS_STARTED', { mode: 'stream', ttsFromLlm_ms: ttsFromLlm });

  // Stuck-state recovery: if AGENT_SPEAKING for >15s, force back to LISTENING.
  const agentSpeakingWatchdog = setTimeout(() => {
    if (!session.isAgentSpeaking) return;
    logger.warn({ callSid: session.callSid }, 'AGENT_SPEAKING stuck >15s — forcing recovery');
    emit(session, 'STATE_FORCED_RECOVERY', { from: 'AGENT_SPEAKING', reason: 'tts_stuck' });
    session.isAgentSpeaking = false;
    session.bargeInRequested = false;
    setCallState(session, 'LISTENING', 'stuck_state_recovery');
  }, 15000);

  // For each sentence we kick off synthesis immediately and keep the promise
  // in `synthPromises`. The playback loop awaits them in order so audio
  // arrives in the right sequence even though syntheses overlap.
  const synthPromises: Array<Promise<string | null>> = [];
  const sentencesEmitted: string[] = [];
  let llmDone = false;

  // Pinned single voice (set in onStart) wins for Sarvam; agent voice_config
  // is the legacy fallback. Deepgram/Azure are last-resort only (Sarvam down).
  const sarvamVoice = session.ttsVoiceId || session.agent?.voice_config?.voice_id;
  const synthOne = async (s: string): Promise<string | null> => {
    if (session.ttsBackend === 'sarvam') {
      const b = await synthesizeSarvamTtsMulaw(s, session.language, sarvamVoice);
      if (b) return b;
      return ttsDeepgramMulaw(s, session.agent?.voice_config?.voice_id);
    }
    if (session.ttsBackend === 'azure') {
      const b = await synthesizeAzureTtsMulaw(s, session.language, session.agent?.voice_config?.voice_id);
      if (b) return b;
      return ttsDeepgramMulaw(s, session.agent?.voice_config?.voice_id);
    }
    return ttsDeepgramMulaw(s, session.agent?.voice_config?.voice_id);
  };

  // Producer: stream the LLM and kick off synthesis per sentence as soon as
  // each one terminates. Runs concurrently with the consumer below.
  const llmPromise = streamLLMReply(
    session.agent,
    session.history,
    session.campaignContext.targetName,
    session.isInbound ? 'inbound' : 'outbound',
    session.language,
    session.campaignContext,
    (sentence: string) => {
      if (session.bargeInRequested) return;
      // Sanitize markdown/emoji, then deterministically spell college acronyms
      // (SRM → "S R M") + apply name pronunciation overrides so the voice never
      // garbles them regardless of how the LLM wrote them.
      const clean = normalizePronunciation(sanitizeForTts(sentence), session.language);
      if (!clean) return;
      sentencesEmitted.push(clean);
      session.currentAgentText = sentencesEmitted.join(' ');
      synthPromises.push(synthOne(clean));
    },
  ).then((full) => {
    llmDone = true;
    return full;
  });

  // Consumer: walks synthPromises in order. Plays each as its audio resolves,
  // pausing for newly-arriving promises until the LLM signals done.
  let playIdx = 0;
  let totalAudioBytes = 0;  // mulaw bytes pushed to Plivo — used to wait for real playout
  try {
    while (true) {
      if (session.bargeInRequested) break;
      if (playIdx >= synthPromises.length) {
        if (llmDone) break;
        // Wait briefly for the next sentence to arrive. We don't want to
        // hot-spin; 25ms is short enough that first-audio latency isn't
        // impacted (synth itself takes 200–400ms).
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      const b64 = await synthPromises[playIdx];
      playIdx++;
      if (!b64) {
        logger.warn({ callSid: session.callSid, idx: playIdx - 1 }, 'streamAndPlayReply: TTS empty — skipping');
        continue;
      }
      if (session.bargeInRequested) break;

      const fullBytes = Buffer.from(b64, 'base64');
      totalAudioBytes += fullBytes.length;
      session.agentMulawEvents.push({ offsetBytes: session.callerBytes, mulaw: fullBytes });

      let aborted = false;
      for (let off = 0; off < fullBytes.length; off += CHUNK_BYTES) {
        if (session.bargeInRequested) {
          try { plivoWs.send(JSON.stringify({ event: 'clearAudio' })); } catch { /* socket may be gone */ }
          logger.info({ callSid: session.callSid, idx: playIdx - 1 }, 'streamAndPlayReply: barge-in — aborted');
          aborted = true;
          break;
        }
        const slice = fullBytes.subarray(off, Math.min(off + CHUNK_BYTES, fullBytes.length));
        const playEvent = {
          event: 'playAudio',
          media: { contentType: 'audio/x-mulaw', sampleRate: '8000', payload: slice.toString('base64') },
        };
        while ((plivoWs as any).bufferedAmount > BACKPRESSURE_BYTES) {
          await new Promise((r) => setTimeout(r, 20));
          if (session.bargeInRequested || plivoWs.readyState !== WebSocket.OPEN) break;
        }
        try {
          plivoWs.send(JSON.stringify(playEvent));
        } catch (err: any) {
          logger.warn({ callSid: session.callSid, err: err.message }, 'streamAndPlayReply: send failed');
          aborted = true;
          break;
        }
        if (off + CHUNK_BYTES < fullBytes.length) {
          await new Promise((r) => setImmediate(r));
        }
      }
      if (aborted) break;
    }
  } finally {
    clearTimeout(agentSpeakingWatchdog);
    // The send loop pushes mulaw to Plivo ~5x faster than real-time, so Plivo
    // is STILL PLAYING the buffered audio when we reach here. If we flip to
    // LISTENING now, the caller hears the sentence cut off mid-way and the
    // agent's own tail/echo (or a caller "uh-huh") starts a new turn. So stay
    // in AGENT_SPEAKING and wait for the audio to actually finish playing at
    // the caller's ear. mulaw @ 8kHz = 8 bytes/ms. Barge-in still cuts it: we
    // poll session.bargeInRequested and clear Plivo's buffer if the caller
    // genuinely interrupts.
    if (!session.bargeInRequested && !session.callEnded && totalAudioBytes > 0) {
      const playoutDeadline = (session.turn.ttsStartAt || Date.now()) + Math.min(15000, Math.round(totalAudioBytes / 8));
      while (Date.now() < playoutDeadline && !session.bargeInRequested && !session.callEnded && plivoWs.readyState === WebSocket.OPEN) {
        await new Promise((r) => setTimeout(r, 80));
      }
      if (session.bargeInRequested) {
        try { plivoWs.send(JSON.stringify({ event: 'clearAudio' })); } catch { /* socket may be gone */ }
      }
    }
    const wasInterrupted = session.bargeInRequested;
    session.isAgentSpeaking = false;
    session.currentAgentText = '';
    if (wasInterrupted) emit(session, 'TTS_CANCELLED', { duration_ms: Date.now() - session.turn.ttsStartAt });
    emit(session, 'TTS_STOPPED', {
      reason: wasInterrupted ? 'interrupted' : 'completed',
      duration_ms: session.turn.ttsStartAt ? Date.now() - session.turn.ttsStartAt : null,
    });
    if (!session.callEnded) {
      setCallState(session, 'LISTENING', wasInterrupted ? 'tts_interrupted' : 'tts_completed');
      emit(session, 'LISTENING_RESUMED', { after: wasInterrupted ? 'interrupt' : 'reply' });
    }
    // Drain any remaining synth promises so we don't leave dangling fetches.
    if (wasInterrupted) {
      Promise.allSettled(synthPromises).catch(() => {});
    }
  }

  const full = await llmPromise.catch(() => '');
  return (full || sentencesEmitted.join(' ')).trim();
}

/**
 * Estimate how long synthesized speech actually plays out at the caller's ear.
 * The TTS send loops push mulaw chunks ~5x faster than real-time (20ms sleep
 * per 100ms chunk), so Plivo keeps playing buffered audio for roughly the full
 * clip duration AFTER playText/streamAndPlayReply resolve. Farewell hang-ups
 * must wait this long or they cut the goodbye off mid-sentence (the original
 * fixed 1.8-3s delays were far too short for a ~6s Telugu farewell). Errs
 * slightly long (safe — a complete goodbye matters more than a little dead
 * air) and is capped so a stuck case can't hold the line open forever.
 */
function estimatedPlayoutMs(text: string): number {
  const t = (text || '').trim();
  if (!t) return 2000;
  return Math.min(16000, Math.max(4000, Math.round(t.length * 50) + 1800));
}

async function playText(plivoWs: WebSocket, session: StreamSession, text: string): Promise<void> {
  session.plivoWs = plivoWs;
  if (plivoWs.readyState !== WebSocket.OPEN) return;

  // Sentence-pipelined TTS:
  //   - Split the reply into sentences.
  //   - Kick off TTS for ALL sentences in parallel (Sarvam → Azure → Aura
  //     fallback per backend choice).
  //   - As soon as sentence-1's audio resolves, start streaming it to Plivo.
  //     By the time sentence-1's playback finishes, sentences 2..N are
  //     almost always already synthesised → near-zero inter-sentence gap.
  //
  // For a 4-sentence reply this drops first-audio latency from
  //   ~1.0s (whole-reply Sarvam synth)
  // to
  //   ~0.3s (first-sentence Sarvam synth).
  //
  // Sarvam handles 4 concurrent TTS requests fine. Falls back to a single
  // synthesis path if the split produces only one sentence.
  // Sanitize once at the top so every sentence handed to a TTS provider is
  // free of markdown/emoji/multi-punctuation. KB chunks + LLM occasionally
  // produce `**bold**` or 🎯 which some voices read aloud literally.
  const cleanText = normalizePronunciation(sanitizeForTts(text), session.language);
  if (!cleanText) {
    logger.warn({ callSid: session.callSid, preview: (text || '').slice(0, 60) }, 'playText: empty after sanitize, skipping');
    return;
  }
  const sentences = cleanText
    .split(/(?<=[.!?।॥])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveSentences = sentences.length > 0 ? sentences : [cleanText];

  // 800 bytes = 100ms of mulaw 8kHz. See streamAndPlayReply for the
  // rationale on chunk size — kept in sync between both playback paths.
  const CHUNK_BYTES = 800;        // 100ms of mulaw 8kHz
  const BARGE_IN_GRACE_MS = bargeInGraceMs(session);
  // Grace tuned per language (1500ms English / 2000ms Indic by default).
                                  // Only protects against the
                                  // start-of-reply echo loop (carrier
                                  // playback of agent's own audio leaking
                                  // into caller channel). Real interrupts
                                  // and question-words bypass this entirely.
  const BACKPRESSURE_BYTES = 256 * 1024;

  session.isAgentSpeaking = true;
  session.bargeInRequested = false;
  session.bargeInAllowedAt = Date.now() + BARGE_IN_GRACE_MS;
  session.currentAgentText = cleanText;

  // Pinned single voice (set in onStart) wins for Sarvam; agent voice_config
  // is the legacy fallback. Deepgram/Azure are last-resort only (Sarvam down).
  const sarvamVoice = session.ttsVoiceId || session.agent?.voice_config?.voice_id;
  const synthOne = async (s: string): Promise<string | null> => {
    if (session.ttsBackend === 'sarvam') {
      const b = await synthesizeSarvamTtsMulaw(s, session.language, sarvamVoice);
      if (b) return b;
      logger.warn({ callSid: session.callSid, lang: session.language }, 'Sarvam TTS failed — falling back to Deepgram Aura');
      return ttsDeepgramMulaw(s, session.agent?.voice_config?.voice_id);
    }
    if (session.ttsBackend === 'azure') {
      const b = await synthesizeAzureTtsMulaw(s, session.language, session.agent?.voice_config?.voice_id);
      if (b) return b;
      logger.warn({ callSid: session.callSid, lang: session.language }, 'Azure TTS failed — falling back to Deepgram Aura');
      return ttsDeepgramMulaw(s, session.agent?.voice_config?.voice_id);
    }
    return ttsDeepgramMulaw(s, session.agent?.voice_config?.voice_id);
  };

  // Kick all syntheses off immediately so they overlap with playback.
  const synthPromises = effectiveSentences.map((s) => synthOne(s));

  // Track total bytes streamed + when playback started so the finally block
  // can wait for Plivo to actually render the audio before flipping to
  // LISTENING (anti-clip guarantee — see finally below).
  let totalAudioBytes = 0;
  const ttsPlayStartAt = Date.now();

  try {
    for (let i = 0; i < effectiveSentences.length; i++) {
      if (session.bargeInRequested) break;
      const b64 = await synthPromises[i];
      if (!b64) {
        // Skip this sentence on TTS failure, continue with the next so the
        // caller still hears the rest of the reply.
        logger.warn(
          { callSid: session.callSid, sentenceIdx: i, preview: effectiveSentences[i].slice(0, 60) },
          'TTS produced no audio for sentence — skipping',
        );
        continue;
      }

      const fullBytes = Buffer.from(b64, 'base64');
      // Capture audio for the stereo recording, positioned at the current
      // caller-timeline offset, so the agent's speech lines up with where
      // the caller was "listening" at send-time.
      session.agentMulawEvents.push({
        offsetBytes: session.callerBytes,
        mulaw: fullBytes,
      });

      let sentBytes = 0;
      let aborted = false;
      for (let off = 0; off < fullBytes.length; off += CHUNK_BYTES) {
        if (session.bargeInRequested) {
          try { plivoWs.send(JSON.stringify({ event: 'clearAudio' })); } catch { /* socket may be gone */ }
          logger.info(
            { callSid: session.callSid, sentenceIdx: i, sentBytes, totalBytes: fullBytes.length },
            'Stream: barge-in — playback aborted',
          );
          aborted = true;
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
        while ((plivoWs as any).bufferedAmount > BACKPRESSURE_BYTES) {
          await new Promise((r) => setTimeout(r, 20));
          if (session.bargeInRequested || plivoWs.readyState !== WebSocket.OPEN) break;
        }
        try {
          plivoWs.send(JSON.stringify(playEvent));
          sentBytes += slice.length;
        } catch (err: any) {
          logger.warn({ callSid: session.callSid, err: err.message }, 'Failed to send playAudio chunk');
          aborted = true;
          break;
        }
        if (off + CHUNK_BYTES < fullBytes.length) {
          await new Promise((r) => setImmediate(r));
        }
      }
      totalAudioBytes += sentBytes;
      if (aborted) break;
    }
  } finally {
    // Anti-clip: the send loop pushes mulaw ~5x faster than real-time, so
    // Plivo is STILL PLAYING the tail when we get here. Flipping to LISTENING
    // immediately makes the caller hear the last word/number/college cut off
    // (and risks the agent's own tail re-triggering a turn). Mirror
    // streamAndPlayReply: hold AGENT_SPEAKING until Plivo has had time to
    // render every byte (1 byte = 1/8 ms at 8kHz mulaw), unless the caller
    // barged in or the call ended. Capped at 15s as a safety bound.
    if (!session.bargeInRequested && !session.callEnded && totalAudioBytes > 0) {
      const playoutDeadline = ttsPlayStartAt + Math.min(15000, Math.round(totalAudioBytes / 8));
      while (
        Date.now() < playoutDeadline &&
        !session.bargeInRequested &&
        !session.callEnded &&
        plivoWs.readyState === WebSocket.OPEN
      ) {
        await new Promise((r) => setTimeout(r, 80));
      }
      if (session.bargeInRequested) {
        try { plivoWs.send(JSON.stringify({ event: 'clearAudio' })); } catch { /* socket may be gone */ }
      }
    }
    session.isAgentSpeaking = false;
    session.currentAgentText = '';
    // Drain any still-in-flight syntheses so we don't leave dangling
    // promises on a barged-in reply. Errors are swallowed — we're just
    // making sure the HTTP responses are consumed.
    if (session.bargeInRequested) {
      Promise.allSettled(synthPromises).catch(() => { /* ignore */ });
    }
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
 * Bring a channel up to a consistent perceived loudness.
 *
 * Plivo's inbound carrier path delivers caller audio at ~-30 to -45 dBFS RMS
 * while our outbound Aura TTS is near -16 dBFS — so without normalization the
 * caller side of the recording sounds like quiet bursts surrounded by
 * silence, which listeners hear as "breaking" audio. We compute RMS over the
 * voiced portion of the channel (samples above the noise floor) and scale
 * the whole channel to hit a target RMS, with a hard cap on gain so a near-
 * silent channel can't be amplified to pure noise.
 *
 * Mutates `samples` in place. Uses soft-clip to keep transients below int16
 * limits without audible distortion.
 */
function normalizeChannelPcm16(samples: Int16Array, opts?: { targetRmsDbfs?: number; maxGainDb?: number }): void {
  if (samples.length === 0) return;
  const targetRmsDbfs = opts?.targetRmsDbfs ?? -16;
  const maxGainDb = opts?.maxGainDb ?? 24;
  const NOISE_FLOOR = 200; // |sample| below this is treated as silence
  let sumSquares = 0;
  let voicedCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (Math.abs(s) >= NOISE_FLOOR) {
      sumSquares += s * s;
      voicedCount++;
    }
  }
  if (voicedCount === 0) return; // channel is silent — leave it alone
  const rms = Math.sqrt(sumSquares / voicedCount);
  const targetRms = 32767 * Math.pow(10, targetRmsDbfs / 20);
  let gain = targetRms / rms;
  const maxGain = Math.pow(10, maxGainDb / 20);
  if (gain > maxGain) gain = maxGain;
  if (gain <= 1) return; // already at or above target — don't attenuate, just leave it
  // Soft-clip (tanh-style) above a knee so transients above the limit get
  // squashed gently instead of hard-clipping into buzz.
  const KNEE = 28000;
  const ROOM = 32767 - KNEE;
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i] * gain;
    if (v > KNEE) v = KNEE + ROOM * Math.tanh((v - KNEE) / ROOM);
    else if (v < -KNEE) v = -KNEE + ROOM * Math.tanh((v + KNEE) / ROOM);
    samples[i] = v | 0;
  }
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
  // Normalize caller side aggressively (Plivo inbound is quiet); agent side
  // is already near target so it'll usually no-op unless TTS provider drift
  // drops the level.
  normalizeChannelPcm16(left, { targetRmsDbfs: -16, maxGainDb: 24 });
  normalizeChannelPcm16(right, { targetRmsDbfs: -16, maxGainDb: 6 });
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

    // Campaign target sync. Plivo <Stream> calls don't fire the hangup status
    // webhook reliably, so without this the runner leaves the target row at
    // IN_PROGRESS forever — the detail page can't surface audio + transcript
    // because campaign_targets.conversation_id is never linked. The webhook
    // path also calls updateTargetFromCallEnd; if both fire, the second is a
    // safe no-op against COMPLETED rows.
    if (session.callSid && session.campaignContext?.campaignId) {
      try {
        await updateTargetFromCallEnd(
          session.callSid,
          'COMPLETED',
          session.conversationId,
        );
      } catch (err: any) {
        logger.warn({ err: err.message, callSid: session.callSid }, 'updateTargetFromCallEnd failed');
      }
    }
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
  // Indic family (Sarvam-native) — list of words for "<lang>" in every
  // script the caller might use to ASK for that language. The first set is
  // Latin transliterations + the native-script word; we then add the
  // language name as it appears IN OTHER INDIC SCRIPTS too, because Sarvam
  // STT transcribes "English" said in Telugu as "ఇంగ్లీష్", and the
  // detector has to match that.
  'te-IN': ['telugu', 'తెలుగు', 'तेलुगु', 'டெலுங்கு', 'ತೆಲುಗು', 'തെലുങ്ക്'],
  'hi-IN': ['hindi', 'हिंदी', 'हिन्दी', 'హిందీ', 'இந்தி', 'ಹಿಂದಿ', 'ഹിന്ദി'],
  'ta-IN': ['tamil', 'தமிழ்', 'తమిళం', 'तमिल', 'ತಮಿಳು', 'തമിഴ്'],
  'kn-IN': ['kannada', 'ಕನ್ನಡ', 'కన్నడ', 'कन्नड़', 'கன்னடம்', 'കന്നഡ'],
  'ml-IN': ['malayalam', 'മലയാളം', 'మలయాళం', 'मलयालम', 'மலையாளம்', 'ಮಲಯಾಳಂ'],
  'mr-IN': ['marathi', 'मराठी', 'మరాఠీ', 'மராத்தி'],
  'bn-IN': ['bengali', 'bangla', 'বাংলা', 'बंगाली', 'বাংলা', 'బెంగాలీ'],
  'gu-IN': ['gujarati', 'ગુજરાતી', 'गुजराती'],
  'pa-IN': ['punjabi', 'ਪੰਜਾਬੀ', 'पंजाबी'],
  'or-IN': ['odia', 'oriya', 'ଓଡ଼ିଆ'],
  'as-IN': ['assamese', 'অসমীয়া'],
  'ur-IN': ['urdu', 'اردو', 'उर्दू'],
  // English: critical — caller often asks for English while STT is still in
  // Indic mode, so the word "English" comes back in Telugu/Hindi/Tamil
  // script. Include every Indic-script spelling of the word.
  'en-IN': [
    'english', 'inglish', 'angrezi',
    'ఇంగ్లీష్', 'ఆంగ్ల', 'ఆంగ్లం', 'ఇంగ్లిష్',
    'इंग्लिश', 'इंग्लिश', 'अंग्रेज़ी', 'अंग्रेजी', 'इंग्लिश में',
    'ஆங்கிலம்', 'இங்கிலீஷ்',
    'ಇಂಗ್ಲಿಷ್', 'ಆಂಗ್ಲ',
    'ഇംഗ്ലീഷ്', 'ഇംഗ്ളീഷ്',
    'ইংরেজি', 'ઇંગ્લિશ', 'ਅੰਗਰੇਜ਼ੀ',
  ],
  'es':    ['spanish', 'español', 'castellano'],
  'fr':    ['french', 'français', 'francais'],
  'de':    ['german', 'deutsch'],
  'it':    ['italian', 'italiano'],
  'pt':    ['portuguese', 'português', 'portugues'],
  'nl':    ['dutch', 'nederlands'],
  'ru':    ['russian', 'русский'],
  'pl':    ['polish', 'polski'],
  'tr':    ['turkish', 'türkçe'],
  'ar':    ['arabic', 'العربية'],
  'zh':    ['mandarin', 'chinese', '中文', '普通话'],
  'ja':    ['japanese', '日本語'],
  'ko':    ['korean', '한국어'],
  'th':    ['thai', 'ไทย'],
  'vi':    ['vietnamese', 'tiếng việt'],
  'id':    ['indonesian', 'bahasa'],
};

const SCRIPT_TO_LANG: Array<{ re: RegExp; lang: string }> = [
  // Indic scripts
  { re: /[ఀ-౿]/, lang: 'te-IN' }, // Telugu
  { re: /[஀-௿]/, lang: 'ta-IN' }, // Tamil
  { re: /[ಀ-೿]/, lang: 'kn-IN' }, // Kannada
  { re: /[ഀ-ൿ]/, lang: 'ml-IN' }, // Malayalam
  { re: /[ঀ-৿]/, lang: 'bn-IN' }, // Bengali
  { re: /[઀-૿]/, lang: 'gu-IN' }, // Gujarati
  { re: /[਀-੿]/, lang: 'pa-IN' }, // Gurmukhi (Punjabi)
  { re: /[଀-୿]/, lang: 'or-IN' }, // Odia
  { re: /[ऀ-ॿ]/, lang: 'hi-IN' }, // Devanagari — Hindi/Marathi (default Hindi)
  // Non-Indic scripts (Deepgram / Azure handle STT+TTS)
  { re: /[؀-ۿ]/, lang: 'ar' }, // Arabic
  { re: /[Ѐ-ӿ]/, lang: 'ru' }, // Cyrillic — default Russian
  { re: /[一-鿿]/, lang: 'zh' }, // CJK Unified Ideographs
  { re: /[぀-ゟ゠-ヿ]/, lang: 'ja' }, // Hiragana + Katakana
  { re: /[가-힯]/, lang: 'ko' }, // Hangul
  { re: /[฀-๿]/, lang: 'th' }, // Thai
];

const FRIENDLY: Record<string, string> = {
  'en-IN': 'English', 'te-IN': 'Telugu', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil',
  'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'mr-IN': 'Marathi', 'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati', 'pa-IN': 'Punjabi', 'or-IN': 'Odia', 'as-IN': 'Assamese',
  'ur-IN': 'Urdu',
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', ru: 'Russian', pl: 'Polish', tr: 'Turkish', ar: 'Arabic',
  zh: 'Mandarin', ja: 'Japanese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian',
};

const SWITCH_VERB_RE = /\b(speak|talk|switch|change|continue|reply|respond|converse|chat)\s+(in|to)\b/i;
const INDIC_ASK_HINTS_RE = /\b(lo|mein|me|la|il|para|please|kindly|matladu|matladandi|baat|karo|karein|karo na|pesu|pesungal|maatadi|kannadalli)\b/i;

// "Switch language" intent expressed in Indic scripts. When STT is locked
// to Telugu/Hindi/etc., the caller's "speak in English" request comes back
// transcribed in the SAME Indic script — so the Latin patterns above never
// fire. These cover the common ways callers ask in their own script:
//   Telugu: "ఇంగ్లీష్ లో మాట్లాడు" / "మాట్లాడగలుగుతారా" / "మాట్లాడుదాం"
//   Hindi:  "हिंदी में बोलो"      / "बात करो"        / "बोलिए"
//   Tamil:  "ஆங்கிலம் ல பேசு"      / "பேசலாமா"
//   Kannada/Malayalam: similar
const INDIC_SWITCH_INTENT_RE = /(మాట్లాడ|మాట్లాడుతున్నాను|మాట్లాడుదాం|మాట్లాడగలుగుతారా|లో|గా|बोल|बातच|बात\s*करो|पेश|बोलिए|பேசு|பேசலாமா|பேசுங்கள்|ಮಾತಾಡು|ಮಾತನಾಡಿ|പറയൂ|പറയാമോ|بات|بولو)/;

function detectLanguageRequest(text: string, currentLang: string): string | null {
  const raw = text || '';
  const lower = raw.toLowerCase();
  if (!lower) return null;

  // 1. Explicit English ask: "speak in Telugu", "switch to Hindi"
  if (SWITCH_VERB_RE.test(lower)) {
    for (const lang of Object.keys(LANG_KEYWORDS)) {
      const kws = LANG_KEYWORDS[lang];
      if (kws.some((k) => lower.includes(k.toLowerCase()) || raw.includes(k))) {
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

  // 2b. Cross-script switch request: STT is producing Indic script, but the
  // caller is asking for a different language. We look for ANY language
  // keyword from LANG_KEYWORDS (which now includes Indic-script spellings
  // of "English", "Hindi", etc.) combined with an Indic switch-intent
  // word ("మాట్లాడు" / "बोलो" / "பேசு" / etc.). This is the path that
  // catches "ఇంగ్లీష్ లో మాట్లాడగలుగుతారా" (Telugu STT of "can you speak in English").
  if (INDIC_SWITCH_INTENT_RE.test(raw)) {
    for (const lang of Object.keys(LANG_KEYWORDS)) {
      for (const kw of LANG_KEYWORDS[lang]) {
        if (kw && (raw.includes(kw) || lower.includes(kw.toLowerCase()))) {
          if (lang !== currentLang) return lang;
        }
      }
    }
  }

  // 2c. Bare language name with no surrounding intent verb — caller says
  // "English." or "हिंदी।" as a one-word turn. Treat as a switch request
  // unless they're already in that language.
  if (raw.trim().split(/\s+/).length <= 3) {
    for (const lang of Object.keys(LANG_KEYWORDS)) {
      for (const kw of LANG_KEYWORDS[lang]) {
        if (kw.length >= 4 && (raw.includes(kw) || lower.includes(kw.toLowerCase()))) {
          if (lang !== currentLang) return lang;
        }
      }
    }
  }

  // 3. Script detection — caller is suddenly speaking in a different script.
  // Even one non-Latin glyph is a strong signal in a phone-call context:
  // STT for a single Indic word like "ఆ" or "हाँ" only produces script in
  // that language, never accidentally. Previously we required ≥3 chars,
  // which missed every short acknowledgement and let the agent slide back
  // to English mid-Telugu call.
  for (const s of SCRIPT_TO_LANG) {
    if (s.re.test(text) && s.lang !== currentLang) {
      return s.lang;
    }
  }

  return null;
}

async function switchLanguage(plivoWs: WebSocket, session: StreamSession, newLang: string): Promise<void> {
  const oldLang = session.language;
  if (oldLang === newLang || session.closed) return;

  // Pick STT backend for the new language using the same priority as onStart:
  // any Indic language → Sarvam (native accent), else Deepgram for English.
  const isIndicLang = sarvamCanHandle(newLang) && !/^en/i.test(newLang);
  let stt: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  let tts: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  if (isIndicLang && sarvamConfigured()) {
    stt = 'sarvam'; tts = 'sarvam';
  } else if (!deepgramCanHandle(newLang)) {
    if (sarvamConfigured() && sarvamCanHandle(newLang)) {
      stt = 'sarvam'; tts = 'sarvam';
    } else if (azureSpeechConfigured()) {
      stt = 'azure'; tts = 'azure';
    }
  }

  // SINGLE PREMIUM VOICE: the language may change, but the VOICE must not.
  // When a premium voice is pinned (set in onStart), keep TTS on Sarvam with
  // the same locked speaker — Sarvam bulbul:v2 renders the new language in the
  // identical voice, so the caller never hears a mid-call voice switch.
  if (session.ttsVoiceId && sarvamConfigured()) {
    tts = 'sarvam';
  }

  logger.info({ callSid: session.callSid, oldLang, newLang, stt, tts, voice: session.ttsVoiceId || null }, 'Stream: switching language mid-call');

  // Tear down whichever STT was active.
  if (session.dgBatchFlushTimer) { clearTimeout(session.dgBatchFlushTimer); session.dgBatchFlushTimer = null; }
  if (session.dgKeepaliveTimer) { clearInterval(session.dgKeepaliveTimer); session.dgKeepaliveTimer = null; }
  clearSttSilenceWatchdog(session);
  if (session.dgWs && session.dgWs.readyState === WebSocket.OPEN) {
    // Flush any pending frames before closing so a trailing utterance isn't lost.
    flushDeepgramBatch(session);
    try { session.dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
    try { session.dgWs.close(1000, 'session-end'); } catch { /* ignore */ }
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
  if (session.whisperStt) {
    try { session.whisperStt.close(); } catch { /* ignore */ }
    session.whisperStt = null;
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
