/**
 * Sarvam AI speech provider — STT + TTS for Indic languages (Telugu, Tamil,
 * Hindi, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia,
 * Assamese). Used when the agent's configured language isn't one Deepgram
 * handles natively.
 *
 * Sarvam's STT is REST-only (no streaming WebSocket in their public API as
 * of writing), so we do energy-based VAD on the incoming mulaw frames,
 * batch each utterance into a WAV, and POST to /speech-to-text. TTS is a
 * one-shot POST to /text-to-speech which returns a base64 WAV — we strip
 * the WAV header, encode PCM16 → mulaw, and hand it to Plivo.
 *
 * Requires SARVAM_API_KEY in env.
 */
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

const API_BASE = 'https://api.sarvam.ai';
// Sarvam's STT model name. `saarika:v2.5` (v2 is deprecated).
const STT_MODEL = 'saarika:v2.5';
// Sarvam's TTS model. `bulbul:v2` is the latest stable at time of writing.
const TTS_MODEL = 'bulbul:v2';
// Hard cap enforced by Sarvam's starter-tier subscription on sarvam-m.
// Requests with max_tokens above this return HTTP 400 "exceeds the maximum
// allowed". Override via env when on a paid plan with a higher cap.
const SARVAM_MAX_TOKENS_CAP = Number(process.env.SARVAM_MAX_TOKENS_CAP) || 2048;

export function sarvamConfigured(): boolean {
  return !!process.env.SARVAM_API_KEY;
}

/** Default Sarvam voice per language — all female neural voices. */
// Default Sarvam voice per language. Switched from `anushka` to `manisha`
// after callers reported the agent sounded "robotic / monotone" — manisha
// has a noticeably warmer, more conversational delivery (the Sarvam team's
// own demo also uses it for natural-conversation flows). All `anushka`
// voices remain selectable per-agent via agent.voice_config.voice_id; this
// default just changes what an unspecified voice resolves to.
// Sarvam speaker defaults. 'manisha' is a warm, friendly, conversational
// female voice with clear Telugu pronunciation and natural code-mixed
// Telugu+English delivery — chosen for the admissions-counselor experience.
// NOTE: bulbul:v2 ONLY accepts anushka, abhilash, manisha, vidya, arya,
// karun, hitesh. Older names (e.g. 'kavya') return HTTP 400 on v2 and must
// not be used as a default here.
const SARVAM_VOICE_DEFAULTS: Record<string, string> = {
  'te-in': 'manisha',
  'hi-in': 'manisha',
  'ta-in': 'manisha',
  'kn-in': 'manisha',
  'ml-in': 'manisha',
  'mr-in': 'manisha',
  'bn-in': 'manisha',
  'gu-in': 'manisha',
  'pa-in': 'manisha',
  'or-in': 'manisha',
  'as-in': 'manisha',
  'en-in': 'manisha',
};

// Sarvam's bulbul:v2 speaker catalog — ONLY these seven are accepted by the
// model. Any voice_id from another provider (ElevenLabs, OpenAI, cartesia,
// etc.) or a deprecated bulbul:v1 name is ignored; we fall back to the
// language default so the call doesn't 400 out.
const SARVAM_SPEAKERS = new Set([
  'anushka', 'abhilash', 'manisha', 'vidya', 'arya', 'karun', 'hitesh',
]);

function normalizeLang(raw: string | undefined | null): string {
  const s = (raw || 'te-IN').trim();
  if (s.includes('-')) return s;
  const map: Record<string, string> = {
    te: 'te-IN', hi: 'hi-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN',
    mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN', or: 'or-IN',
    as: 'as-IN', en: 'en-IN',
  };
  return map[s.toLowerCase()] || `${s}-IN`;
}

// ---- Languages Sarvam supports -------------------------------------------

const SARVAM_SUPPORTED = new Set([
  'bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN',
  'mr-IN', 'or-IN', 'pa-IN', 'ta-IN', 'te-IN',
]);

export function sarvamCanHandle(language: string | undefined | null): boolean {
  return SARVAM_SUPPORTED.has(normalizeLang(language));
}

// ---- WAV + mulaw helpers -------------------------------------------------

function mulawToPcm16Sample(u: number): number {
  u = (~u) & 0xff;
  const sign = (u & 0x80) ? -1 : 1;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  return sign * magnitude;
}

function pcm16ToMulawSample(pcm: number): number {
  // Standard G.711 mu-law encode. Clamp to 16-bit signed then map.
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (pcm >> 8) & 0x80;
  if (sign !== 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Wrap mulaw-8kHz bytes into a complete WAV file (PCM16) for Sarvam STT.
 *  Exported so Whisper (and any future REST-batch STT) can reuse it. */
export function mulawToWav(mulaw: Buffer): Buffer {
  const sampleCount = mulaw.length;
  const dataBytes = sampleCount * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);              // PCM
  header.writeUInt16LE(1, 22);              // mono
  header.writeUInt32LE(8000, 24);           // 8 kHz
  header.writeUInt32LE(8000 * 2, 28);       // byteRate
  header.writeUInt16LE(2, 32);              // blockAlign
  header.writeUInt16LE(16, 34);             // bitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < sampleCount; i++) {
    body.writeInt16LE(mulawToPcm16Sample(mulaw[i]), i * 2);
  }
  return Buffer.concat([header, body]);
}

/**
 * Parse a WAV buffer that Sarvam TTS returns, extract PCM16 samples at
 * whatever sample rate the header says, resample to 8 kHz, then encode to
 * mulaw and return the raw mulaw bytes ready for Plivo playAudio. Returns a
 * Buffer so multiple TTS segments can be concatenated before base64-encoding.
 */
function wavToMulaw8k(wav: Buffer): Buffer | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  // Walk the chunks to find `fmt ` and `data`. WAVs from Sarvam sometimes
  // include a `fact` or `LIST` chunk between fmt and data.
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: wav.readUInt16LE(off + 8 + 2),
        sampleRate: wav.readUInt32LE(off + 8 + 4),
        bitsPerSample: wav.readUInt16LE(off + 8 + 14),
      };
    } else if (id === 'data') {
      dataOffset = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) return null;
  if (fmt.bitsPerSample !== 16) return null;

  // Decode PCM16 mono. If stereo, mix to mono by averaging.
  const inSampleCount = Math.floor(dataLen / (2 * fmt.channels));
  const pcm = new Int16Array(inSampleCount);
  for (let i = 0; i < inSampleCount; i++) {
    if (fmt.channels === 1) {
      pcm[i] = wav.readInt16LE(dataOffset + i * 2);
    } else {
      let sum = 0;
      for (let c = 0; c < fmt.channels; c++) {
        sum += wav.readInt16LE(dataOffset + (i * fmt.channels + c) * 2);
      }
      pcm[i] = Math.round(sum / fmt.channels);
    }
  }

  // Resample to 8 kHz using linear interpolation. Good enough for speech
  // being piped down an 8 kHz PSTN channel anyway.
  const inRate = fmt.sampleRate;
  const outRate = 8000;
  let resampled: Int16Array;
  if (inRate === outRate) {
    resampled = pcm;
  } else {
    const ratio = inRate / outRate;
    const outLen = Math.floor(pcm.length / ratio);
    resampled = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const i0 = Math.floor(srcIdx);
      const i1 = Math.min(i0 + 1, pcm.length - 1);
      const frac = srcIdx - i0;
      resampled[i] = Math.round(pcm[i0] * (1 - frac) + pcm[i1] * frac);
    }
  }

  // Encode PCM16 → mulaw (1 byte per sample).
  const mulaw = Buffer.alloc(resampled.length);
  for (let i = 0; i < resampled.length; i++) mulaw[i] = pcm16ToMulawSample(resampled[i]);
  return mulaw;
}

// G.711 mu-law silence byte (PCM 0 encodes to 0xFF). A short run of these,
// appended after the speech, guarantees the final word/syllable is fully
// rendered before Plivo stops playback — prevents end-of-sentence clipping.
const MULAW_SILENCE_BYTE = 0xff;
// Kept deliberately small: this is appended to EACH sentence chunk, so a large
// value creates audible gaps between sentences (choppy "breaking"). 60ms stays
// at/just-below the pause-perception threshold — enough extra tail to keep the
// final word/number/college from clipping on jittery PSTN paths, without
// breaking conversational flow. The HARD anti-clip guarantee is the
// playout-deadline wait in plivoAudioStream (streamAndPlayReply + playText),
// which holds the turn open until Plivo has had time to render every byte;
// this tail is the secondary belt-and-braces. Override via env if needed.
const TTS_TRAILING_SILENCE_MS = Number(process.env.TTS_TRAILING_SILENCE_MS) || 60;

/**
 * Split text into chunks no longer than Sarvam's hard 500-char per-input
 * limit. Breaks at the last whitespace before the limit so a word, name,
 * number, email or college name is never cut across two chunks. The chunks
 * are sent together in the TTS `inputs[]` array and their audio is
 * concatenated, so no text is ever dropped (the old `.slice(0,500)` silently
 * discarded everything past 500 chars → truncated speech).
 */
function splitTextForSarvam(text: string, maxLen = 500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(' ', maxLen);
    if (cut < maxLen * 0.6) cut = maxLen; // no decent break point — hard cut
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// ---- STT with energy-based VAD -------------------------------------------

/** Per-frame RMS of mulaw bytes, normalised 0..1. Exported for reuse. */
export function frameEnergy(mulaw: Buffer): number {
  if (mulaw.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < mulaw.length; i++) {
    const s = mulawToPcm16Sample(mulaw[i]);
    sum += Math.abs(s);
  }
  return sum / mulaw.length / 32768;
}

export interface SarvamSttHandle {
  push(audio: Buffer): void;
  close(): void;
}

export interface SarvamSttOptions {
  language: string;
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
}

/**
 * Open a "streaming" STT session by running energy VAD on mulaw frames from
 * Plivo. When we detect >600ms of silence after speech, we batch the buffered
 * mulaw into a WAV and POST it to Sarvam /speech-to-text. The transcript
 * fires onFinal — same contract as the Deepgram/Azure branches.
 */
export function startSarvamStt(opts: SarvamSttOptions): SarvamSttHandle {
  const apiKey = process.env.SARVAM_API_KEY!;
  const language = normalizeLang(opts.language);

  // Tuning: each Plivo frame is ~20ms / 160 bytes. Silence threshold is
  // empirical; 0.008 catches the quiet floor of a typical mobile line.
  const SILENCE_THRESHOLD = 0.008;
  // Lowered 8 → 4 (160ms → 80ms) so short Indic affirmations like "ha",
  // "avunu", "haan", "okay" — typically 100-200ms — aren't dropped as noise.
  const MIN_SPEECH_FRAMES = 4;
  // 22 frames ≈ 440ms of silence (down from 30/600ms) — finalises utterances
  // faster for snappier turns, while still long enough to ride over the brief
  // gaps inside a sentence. Override via SARVAM_SILENCE_FRAMES if needed.
  const SILENCE_FRAMES_TO_FINALIZE = Number(process.env.SARVAM_SILENCE_FRAMES) || 22;
  const MAX_BUFFER_BYTES = 8000 * 20;    // safety cap: 20s of audio per utterance

  let buffer: Buffer[] = [];
  let bufferBytes = 0;
  let speechFrames = 0;
  let trailingSilenceFrames = 0;
  let pendingFlight: Promise<void> | null = null;
  let closed = false;

  async function flushUtterance(): Promise<void> {
    if (closed || buffer.length === 0) return;
    const utterance = Buffer.concat(buffer);
    buffer = [];
    bufferBytes = 0;
    speechFrames = 0;
    trailingSilenceFrames = 0;
    if (utterance.length < 8000 * 0.3) return; // <300ms = almost certainly noise
    try {
      const wav = mulawToWav(utterance);
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
      form.append('model', STT_MODEL);
      form.append('language_code', language);
      const resp = await fetch(`${API_BASE}/speech-to-text`, {
        method: 'POST',
        headers: { 'api-subscription-key': apiKey },
        body: form,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        logger.warn({ status: resp.status, body: body.slice(0, 200), language }, 'Sarvam STT failed');
        opts.onError?.(`Sarvam STT ${resp.status}`);
        return;
      }
      const data = await resp.json().catch(() => null) as any;
      const text = (data?.transcript || '').trim();
      if (text) opts.onFinal(text);
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Sarvam STT error');
      opts.onError?.(err.message);
    }
  }

  return {
    push(audio: Buffer) {
      if (closed) return;
      const energy = frameEnergy(audio);
      const isSpeech = energy >= SILENCE_THRESHOLD;

      buffer.push(audio);
      bufferBytes += audio.length;

      if (isSpeech) {
        speechFrames++;
        trailingSilenceFrames = 0;
      } else if (speechFrames >= MIN_SPEECH_FRAMES) {
        trailingSilenceFrames++;
        if (trailingSilenceFrames >= SILENCE_FRAMES_TO_FINALIZE) {
          // Don't overlap flights — if one is in progress, skip this tail
          // (next silence will trigger again).
          if (!pendingFlight) {
            pendingFlight = flushUtterance().finally(() => { pendingFlight = null; });
          }
        }
      } else {
        // Still in pre-speech silence — don't grow buffer unbounded.
        // Keep only the trailing ~200ms so the next utterance has lead-in.
        const keep = 8000 * 0.2;
        while (bufferBytes > keep && buffer.length > 1) {
          bufferBytes -= buffer[0].length;
          buffer.shift();
        }
      }

      if (bufferBytes >= MAX_BUFFER_BYTES && !pendingFlight) {
        pendingFlight = flushUtterance().finally(() => { pendingFlight = null; });
      }
    },
    close() {
      closed = true;
      // Flush whatever's still buffered on close.
      if (buffer.length > 0 && speechFrames >= MIN_SPEECH_FRAMES) {
        flushUtterance().catch(() => { /* ignore */ });
      }
    },
  };
}

// ---- LLM (sarvam-m, OpenAI-compatible /v1/chat/completions) --------------

/**
 * Call Sarvam's chat LLM (sarvam-m). Returns the assistant reply text.
 * sarvam-m is an "extended thinking" model — replies come back with
 * `<think>…</think>` blocks we strip out before returning.
 *
 * Returns null on failure so the caller can fall back to ai-runtime.
 */
export async function callSarvamLLM(opts: {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
}): Promise<string | null> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;
  try {
    // Sarvam-M requires strict alternation starting with "user", AND
    // rejects any system message that appears mid-conversation with
    // "System message must appear only once". Our internal history pushes
    // a `role: 'system'` note when language switching mid-call — those
    // are runtime hints, NEVER for the API. We must:
    //   1. Drop all system messages (the API's system message is passed
    //      separately as opts.systemPrompt).
    //   2. Merge any "system" guidance into the next user turn as a hint
    //      so the model still sees it.
    //   3. Skip leading non-user turns and collapse consecutive same-role.
    let pendingSystemHint = '';
    const cleaned: Array<{ role: string; content: string }> = [];
    for (const m of opts.messages) {
      if (!m || !m.content) continue;
      if (m.role === 'system') {
        // Capture for the NEXT user turn; never pass to Sarvam as 'system'.
        pendingSystemHint = pendingSystemHint
          ? pendingSystemHint + '\n' + m.content
          : m.content;
        continue;
      }
      if (cleaned.length === 0 && m.role !== 'user') continue;
      let content = m.content;
      if (m.role === 'user' && pendingSystemHint) {
        content = `[CONTEXT: ${pendingSystemHint}]\n${content}`;
        pendingSystemHint = '';
      }
      if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === m.role) {
        cleaned[cleaned.length - 1].content += '\n' + content;
      } else {
        cleaned.push({ role: m.role, content });
      }
    }
    if (cleaned.length === 0) return null; // nothing to send

    const resp = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [
          { role: 'system', content: opts.systemPrompt },
          ...cleaned,
        ],
        // Latency: try to disable the <think>…</think> reasoning block.
        // `enable_thinking: false` is the Sarvam-M flag (silently ignored
        // by older API versions). `reasoning_effort: 'low'` is the
        // belt-and-braces fallback — the API enum ONLY accepts
        // 'low' | 'medium' | 'high', so any other value (e.g. 'minimal')
        // returns HTTP 400 and silently breaks every call. Do not change
        // this string. max_tokens=1000 leaves headroom for cases where
        // the API ignores enable_thinking and still emits <think>.
        // stripThinkBlocks() runs on the response so any leftover think
        // never reaches the caller.
        max_tokens: Math.min(opts.maxTokens ?? 1000, SARVAM_MAX_TOKENS_CAP),
        temperature: opts.temperature ?? 0.6,
        enable_thinking: false,
        reasoning_effort: 'low',
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: body.slice(0, 200) }, 'Sarvam LLM failed');
      return null;
    }
    const data = await resp.json().catch(() => null) as any;
    const raw = data?.choices?.[0]?.message?.content || '';
    const finishReason = data?.choices?.[0]?.finish_reason;
    // Strip extended-thinking blocks. Sarvam-m emits:
    //   <think> internal reasoning here </think> actual reply here
    // The part we want is everything AFTER the last </think>.
    const stripped = stripThinkBlocks(raw).trim();
    if (!stripped) {
      logger.warn(
        { finishReason, rawLen: raw.length, rawPreview: raw.slice(0, 80) },
        'Sarvam LLM returned think-only / empty reply — bump maxTokens',
      );
      return null;
    }
    // Truncation guard: when finish_reason === 'length' AND the reply doesn't
    // end with a sentence terminator (. ? ! । ॥ — covers Latin + Devanagari +
    // Telugu danda), Sarvam ran out of tokens MID-SENTENCE. Sending that to
    // TTS produces the "voice breaking, sentence incomplete" issue callers
    // were reporting. Return null so the caller's retry chain (smaller
    // history, larger budget) can land a complete reply.
    if (finishReason === 'length') {
      const TERMINATORS = /[.?!।॥]\s*["'’”)\]]*\s*$/u;
      if (!TERMINATORS.test(stripped)) {
        logger.warn(
          { finishReason, rawLen: raw.length, replyLen: stripped.length, tailPreview: stripped.slice(-60) },
          'Sarvam LLM reply truncated mid-sentence — discarding for retry',
        );
        return null;
      }
    }
    return stripped;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Sarvam LLM error');
    return null;
  }
}

function stripThinkBlocks(text: string): string {
  if (!text) return '';
  // Remove any complete <think>…</think> blocks (non-greedy, dot-matches-newline).
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // If an unclosed <think> got through (truncation), drop from it to end.
  const openIdx = out.toLowerCase().lastIndexOf('<think>');
  if (openIdx >= 0) out = out.slice(0, openIdx);
  return out.trim();
}

/**
 * Streaming variant of callSarvamLLM. Yields complete sentences via
 * `onSentence` as Sarvam-M generates them, then returns the full
 * (think-stripped) reply text. Cuts ~2s off first-audio latency on Indic
 * calls because TTS synthesis can start before the LLM has finished
 * generating the whole reply.
 *
 * Sarvam-M's <think>…</think> reasoning block (emitted even with
 * enable_thinking:false on some prompt sizes) breaks naive token-streaming
 * — we'd hear the model "thinking out loud" if those chunks reached TTS.
 * Solution: hold sentences back until we observe </think> in the buffer,
 * then start emitting. If <think> never appears, we emit from the start.
 *
 * Returns null when the request fails entirely. Always finishes the
 * underlying stream before returning so the caller's full-text return
 * value is consistent.
 */
export async function callSarvamLLMStream(opts: {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
}, onSentence: (sentence: string) => void): Promise<string | null> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;

  // Same "clean messages for Sarvam-M's strict-alternation API" pass as
  // the buffered callSarvamLLM. Drops system messages mid-thread, merges
  // them into the next user turn, collapses consecutive same-role.
  let pendingSystemHint = '';
  const cleaned: Array<{ role: string; content: string }> = [];
  for (const m of opts.messages) {
    if (!m || !m.content) continue;
    if (m.role === 'system') {
      pendingSystemHint = pendingSystemHint ? pendingSystemHint + '\n' + m.content : m.content;
      continue;
    }
    if (cleaned.length === 0 && m.role !== 'user') continue;
    let content = m.content;
    if (m.role === 'user' && pendingSystemHint) {
      content = `[CONTEXT: ${pendingSystemHint}]\n${content}`;
      pendingSystemHint = '';
    }
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === m.role) {
      cleaned[cleaned.length - 1].content += '\n' + content;
    } else {
      cleaned.push({ role: m.role, content });
    }
  }
  if (cleaned.length === 0) return null;

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [
          { role: 'system', content: opts.systemPrompt },
          ...cleaned,
        ],
        max_tokens: Math.min(opts.maxTokens ?? 1000, SARVAM_MAX_TOKENS_CAP),
        temperature: opts.temperature ?? 0.6,
        enable_thinking: false,
        reasoning_effort: 'low',
        stream: true,
      }),
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Sarvam LLM stream fetch failed');
    return null;
  }
  if (!resp.ok || !resp.body) {
    const errBody = await resp.text().catch(() => '');
    logger.warn({ status: resp.status, body: errBody.slice(0, 200) }, 'Sarvam LLM stream non-200');
    return null;
  }

  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let sseAccum = '';        // raw SSE chunks not yet event-split
  let fullText = '';        // ALL content tokens seen (pre-strip)
  let cleanBuffer = '';     // text that's already past any </think>
  let thinkBlocked = false; // true between <think> and </think>
  let thinkEverSeen = false;

  // Emit complete sentences from cleanBuffer as we accumulate. Latin .!?
  // + Devanagari ।॥ + optional trailing space/quote.
  const SENT_BOUNDARY = /^[\s\S]*?[.!?।॥](?=\s|$|["')\]])/u;
  const flushSentences = (forceFinal: boolean) => {
    while (true) {
      const m = cleanBuffer.match(SENT_BOUNDARY);
      if (!m) break;
      const sentence = m[0].trim();
      cleanBuffer = cleanBuffer.slice(m[0].length).replace(/^\s+/, '');
      if (sentence) onSentence(sentence);
    }
    if (forceFinal && cleanBuffer.trim()) {
      onSentence(cleanBuffer.trim());
      cleanBuffer = '';
    }
  };

  // Whenever new raw text arrives, route it into cleanBuffer accounting
  // for any open/close <think> markers.
  const ingest = (delta: string) => {
    fullText += delta;
    let s = delta;
    while (s.length > 0) {
      if (thinkBlocked) {
        const closeIdx = s.indexOf('</think>');
        if (closeIdx === -1) { s = ''; break; }     // still inside think
        s = s.slice(closeIdx + '</think>'.length);
        thinkBlocked = false;
        continue;
      }
      const openIdx = s.indexOf('<think>');
      if (openIdx === -1) {
        cleanBuffer += s;
        s = '';
      } else {
        // Anything before <think> is clean output.
        cleanBuffer += s.slice(0, openIdx);
        s = s.slice(openIdx + '<think>'.length);
        thinkBlocked = true;
        thinkEverSeen = true;
      }
    }
    flushSentences(false);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseAccum += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = sseAccum.indexOf('\n\n')) >= 0) {
        const evRaw = sseAccum.slice(0, idx);
        sseAccum = sseAccum.slice(idx + 2);
        for (const line of evRaw.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload) as any;
            const delta = obj?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              ingest(delta);
            }
          } catch { /* malformed SSE — skip */ }
        }
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Sarvam LLM stream read error');
  }

  // Final flush of any remaining content not terminated by punctuation.
  flushSentences(true);

  // Build the return value: same shape as the buffered callSarvamLLM
  // (think-blocks stripped, trimmed). Caller may compare against this.
  const stripped = thinkEverSeen ? stripThinkBlocks(fullText).trim() : fullText.trim();
  return stripped || null;
}

// ---- TTS ------------------------------------------------------------------

/**
 * Synthesize `text` via Sarvam TTS and return base64 mulaw-8kHz ready for
 * Plivo's playAudio event. Returns null on failure so the caller can fall
 * back to Deepgram Aura.
 */
export async function synthesizeSarvamTtsMulaw(
  text: string,
  language: string,
  voiceOverride?: string,
): Promise<string | null> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;
  const clean = (text || '').trim();
  if (!clean) return null;

  const lang = normalizeLang(language);
  // Only accept voiceOverride if it's in Sarvam's speaker catalog — otherwise
  // it's a voice_id from a different provider (elevenlabs/openai/cartesia)
  // and Sarvam will 400 with "Speaker not recognized".
  const overrideLower = (voiceOverride || '').toLowerCase();
  // Premium single-voice default: PREMIUM_VOICE_ID (default 'abhilash', a
  // mature warm male counsellor voice) is used for EVERY language when no
  // explicit per-agent voice_id is given, so one consistent voice is heard
  // across Telugu/Hindi/English. Validate against the bulbul:v2 catalog so a
  // typo can't 400 the call.
  const premiumDefault = (process.env.PREMIUM_VOICE_ID || 'abhilash').toLowerCase();
  const fallbackSpeaker = SARVAM_SPEAKERS.has(premiumDefault)
    ? premiumDefault
    : (SARVAM_VOICE_DEFAULTS[lang.toLowerCase()] || 'manisha');
  const speaker = SARVAM_SPEAKERS.has(overrideLower)
    ? overrideLower
    : fallbackSpeaker;

  try {
    const resp = await fetch(`${API_BASE}/text-to-speech`, {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: splitTextForSarvam(clean),
        target_language_code: lang,
        speaker,
        speech_sample_rate: 8000,
        enable_preprocessing: true,
        model: TTS_MODEL,
        // Voice settings for a natural, professional delivery: slightly slower
        // pace (0.9x) so speech isn't rushed and Telugu words stay crisp,
        // neutral pitch. enable_preprocessing above normalizes code-mixed
        // Telugu+English, names and numbers for clearer pronunciation.
        // NOTE: do NOT raise loudness above ~1.1 — 1.5 over-drove the 8kHz
        // mulaw phone audio and caused audible distortion/disturbance.
        pace: 0.9,
        pitch: 0,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: body.slice(0, 200), lang, speaker }, 'Sarvam TTS failed');
      return null;
    }
    const data = await resp.json().catch(() => null) as any;
    const audios: string[] = Array.isArray(data?.audios) ? data.audios : [];
    if (audios.length === 0) {
      logger.warn('Sarvam TTS: empty audios[]');
      return null;
    }
    // Decode every returned segment and concatenate, so multi-chunk inputs
    // (long sentences split across the 500-char limit) play as one continuous
    // utterance with nothing dropped.
    const parts: Buffer[] = [];
    for (const b64wav of audios) {
      const m = wavToMulaw8k(Buffer.from(b64wav, 'base64'));
      if (m) parts.push(m);
    }
    if (parts.length === 0) {
      logger.warn('Sarvam TTS: WAV decode/resample failed for all segments');
      return null;
    }
    // Pad the tail with mu-law silence so Plivo finishes rendering the last
    // word instead of clipping it at the audio boundary.
    parts.push(Buffer.alloc(Math.round(8000 * TTS_TRAILING_SILENCE_MS / 1000), MULAW_SILENCE_BYTE));
    return Buffer.concat(parts).toString('base64');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Sarvam TTS error');
    return null;
  }
}
