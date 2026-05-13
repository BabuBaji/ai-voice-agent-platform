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
import { buildVoiceAgentPrompt, buildVoiceAgentPromptSlim } from '../prompts/voiceAgent';
import { recordingsDir } from '../routes/recordings';
import { startAzureStt, synthesizeAzureTtsMulaw, deepgramCanHandle, azureSpeechConfigured, AzureSttHandle } from '../providers/azureSpeech';
import { startSarvamStt, synthesizeSarvamTtsMulaw, sarvamCanHandle, sarvamConfigured, callSarvamLLM, SarvamSttHandle } from '../providers/sarvamSpeech';
import { plivoProvider } from '../providers/plivo.provider';
import { resolveDeployedAgent } from '../services/deployedAgentResolver';
import { updateTargetFromCallEnd } from '../routes/campaigns';

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
  // Telugu
  'హలో', 'హా', 'మంచిది', 'బాగుంది', 'థాంక్యూ', 'ధన్యవాదాలు', 'సరే', 'ఓకే', 'ఉమ్', 'అవును', 'అచ్ఛా',
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
  });

  // Latency optimization 2: trim history to the last 14 turns. Sarvam-M is
  // sensitive to abrupt history cuts — when we tried 10 the model started
  // returning empty replies (its <think> block ate the response slot) and
  // the agent fell back to "say-again" on every turn. 14 preserves enough
  // dialogue tail without blowing context. Do NOT lower this again.
  const trimmedHistory = history.length > 14 ? history.slice(-14) : history;

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
    });
    const sarvamHistory = trimmedHistory.length > 10 ? trimmedHistory.slice(-10) : trimmedHistory;
    let sarvamReply = await callSarvamLLM({
      systemPrompt: slimPrompt,
      messages: sarvamHistory,
      maxTokens: 500,
      temperature: parseFloat(agent.temperature) || 0.7,
    });
    if (!sarvamReply && sarvamHistory.length > 4) {
      sarvamReply = await callSarvamLLM({
        systemPrompt: slimPrompt,
        messages: sarvamHistory.slice(-4),
        maxTokens: 800,
        temperature: parseFloat(agent.temperature) || 0.7,
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
        temperature: parseFloat(agent.temperature) || 0.7,
        // Latency optimization 3: cap reply at 180 tokens. The system prompt
        // already mandates 2–4 sentences; this hard limit shaves 50–200ms off
        // generation when the model would otherwise meander.
        max_tokens: 180,
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
        temperature: parseFloat(agent.temperature) || 0.7,
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
    return buf.toString('base64');
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
      campaignContext: { instruction: null, variables: {}, targetName: null, campaignId: null },
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
      bargeInAllowedAt: 0,
      currentAgentText: '',
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
        session.campaignContext = {
          campaignId: md.campaign_id || null,
          instruction: typeof md.campaign_instruction === 'string' && md.campaign_instruction.trim()
            ? md.campaign_instruction.trim() : null,
          variables: (md.vars && typeof md.vars === 'object') ? md.vars : {},
          targetName: md.target_name || null,
        };
        logger.info(
          { callSid: session.callSid, campaignId: session.campaignContext.campaignId, hasInstruction: !!session.campaignContext.instruction, varKeys: Object.keys(session.campaignContext.variables) },
          'Stream handler: campaign overlay loaded',
        );
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load campaign overlay from calls.metadata');
    }
  }

  const lang = firstNonEmpty(session.agent.voice_config?.language, session.agent.voiceConfig?.language) || 'en-IN';
  session.language = lang;
  // Backend selection priority:
  //   - English / non-Indic           → Deepgram (Aura is English-trained)
  //   - Indic (hi/te/ta/kn/ml/mr/bn/gu/pa/or/as) → Sarvam if configured
  //                                                 (bulbul:v2 has native Indic voices,
  //                                                 Aura sounds English-accented in Hindi)
  //   - Indic without Sarvam          → Azure if configured, else Deepgram fallback
  // We do NOT defer to Deepgram just because it nominally supports Hindi —
  // its Hindi TTS is markedly worse than Sarvam's, and that's the symptom
  // callers complain about ("aapka accent achha nahi hai").
  const isIndicLang = sarvamCanHandle(lang) && !/^en/i.test(lang);
  let stt: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  let tts: 'deepgram' | 'azure' | 'sarvam' = 'deepgram';
  if (isIndicLang && sarvamConfigured()) {
    stt = 'sarvam'; tts = 'sarvam';
  } else if (!deepgramCanHandle(lang)) {
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
  const rawTemplate = (session.agent.greeting_message || '').toString();
  const hasTemplatePlaceholders = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(rawTemplate);
  let greeting = '';
  if (hasTemplatePlaceholders && rawTemplate.trim()) {
    greeting = interpolateVars(rawTemplate, greetingVars);
    logger.info({ callSid: session.callSid }, 'Greeting: interpolated from agent.greeting_message template');
  } else {
    const seeded = await callLLM(
      session.agent,
      [
        {
          role: 'user',
          content:
            'The call has just connected. Greet the caller briefly (one short sentence), introduce yourself by your first name only and what you help with, then ask ONE short opening question. Sound like a real human on the phone — no "I am an AI", no lists, one or two sentences max.',
        },
      ],
      session.campaignContext.targetName,
      'outbound',
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
export function trimReplyForVoice(text: string, maxSentences = 4, maxWords = 130): string {
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
      'outbound',
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
    const reply = await callLLM(
      session.agent,
      session.history,
      session.campaignContext.targetName,
      'outbound',
      session.language,
      session.campaignContext,
    );
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
    const trimmed = trimReplyForVoice(cleaned);

    // Hard anti-repetition guard: if the LLM is about to repeat content it
    // already said in the previous 3 assistant turns, replace with a short
    // "anything else?" close. Sarvam-M ignores the NO-REPEAT prompt rule and
    // happily re-emits "5 sezns 50 epis 33 hours…" 4 turns in a row when the
    // caller is just acking. Per-turn deterministic check catches it.
    const spoken = dedupeReply(trimmed, session.history, session.language);

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
  const sentences = (text || '')
    .split(/(?<=[.!?।॥])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveSentences = sentences.length > 0 ? sentences : [text];

  const CHUNK_BYTES = 400;        // 50ms of mulaw 8kHz
  const BARGE_IN_GRACE_MS = 1200; // 1.2s grace — only protects against the
                                  // start-of-reply echo loop (carrier
                                  // playback of agent's own audio leaking
                                  // into caller channel). Real interrupts
                                  // and question-words bypass this entirely.
  const BACKPRESSURE_BYTES = 256 * 1024;

  session.isAgentSpeaking = true;
  session.bargeInRequested = false;
  session.bargeInAllowedAt = Date.now() + BARGE_IN_GRACE_MS;
  session.currentAgentText = text;

  const synthOne = async (s: string): Promise<string | null> => {
    if (session.ttsBackend === 'sarvam') {
      const b = await synthesizeSarvamTtsMulaw(s, session.language, session.agent?.voice_config?.voice_id);
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
      if (aborted) break;
    }
  } finally {
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

  // Pick backends for the new language using the same priority as onStart:
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
