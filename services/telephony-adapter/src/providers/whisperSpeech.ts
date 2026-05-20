/**
 * OpenAI Whisper STT — energy-VAD streaming wrapper that mirrors the Sarvam
 * interface. Whisper is REST-batch (no WebSocket streaming on OpenAI's
 * /v1/audio/transcriptions endpoint as of writing), so we run the same VAD
 * pattern as Sarvam: accumulate mulaw frames, detect end-of-utterance via
 * trailing silence, batch into a WAV, POST.
 *
 * Why Whisper as a fallback to Deepgram:
 *   - Deepgram nova-2 doesn't support Telugu/Tamil/Kannada/Malayalam/etc.
 *   - Whisper-large-v3 handles every Indian language natively — drop in
 *     replacement when Deepgram returns silent/garbled transcripts.
 *   - One key (OPENAI_API_KEY) covers STT + post-call analyzer + voice clone.
 *
 * Requires OPENAI_API_KEY in env. If the key is missing or quota'd (429),
 * the helper just no-ops (logs + onError) — the caller's existing watchdog
 * pattern handles further escalation.
 */
import pino from 'pino';
import { mulawToWav, frameEnergy } from './sarvamSpeech';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
// Default model — Whisper-1 is the only OpenAI-hosted Whisper STT. Use
// `whisper-1` on the API; OpenAI hasn't exposed large-v3 as a hosted endpoint
// for transcribe yet. Configurable via WHISPER_MODEL env if that changes.
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';

export function whisperConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Whisper supports a long list of ISO-639-1 codes. Strip our locale suffix
 * ("en-IN" → "en", "te-IN" → "te") and validate against the known set.
 * Unknown → return undefined which lets Whisper auto-detect.
 */
const WHISPER_LANGS = new Set([
  'en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'or', 'as',
  'ur', 'ne', 'si',
  'fr', 'de', 'es', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'nl', 'sv', 'tr',
]);
function normalizeWhisperLang(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const short = raw.toLowerCase().split('-')[0];
  return WHISPER_LANGS.has(short) ? short : undefined;
}

export interface WhisperSttHandle {
  push(audio: Buffer): void;
  close(): void;
}

export interface WhisperSttOptions {
  language: string;
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
}

export function startWhisperStt(opts: WhisperSttOptions): WhisperSttHandle {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY missing — Whisper STT cannot start');
    // Return a stub handle so the caller's swap path still works (no crash).
    return { push() {}, close() {} };
  }
  const language = normalizeWhisperLang(opts.language);

  // Same VAD tuning as Sarvam — values were calibrated against Plivo's mulaw
  // 8kHz stream so they apply identically here.
  const SILENCE_THRESHOLD = 0.008;
  // 80ms minimum so short Indic affirmations ("ha", "avunu", "haan") aren't
  // dropped as noise — matches the loosened threshold in sarvamSpeech.ts.
  const MIN_SPEECH_FRAMES = 4;
  const SILENCE_FRAMES_TO_FINALIZE = 30;
  const MAX_BUFFER_BYTES = 8000 * 20;

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
    if (utterance.length < 8000 * 0.3) return; // <300ms = noise

    try {
      const wav = mulawToWav(utterance);
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
      form.append('model', WHISPER_MODEL);
      if (language) form.append('language', language);
      // response_format=text returns just the transcript string — smaller
      // payload than json, and we don't use timing info on live calls.
      form.append('response_format', 'text');
      form.append('temperature', '0');  // deterministic on the same audio

      const resp = await fetch(WHISPER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        logger.warn({ status: resp.status, body: body.slice(0, 200), language }, 'Whisper STT failed');
        opts.onError?.(`Whisper STT ${resp.status}`);
        return;
      }
      // response_format=text returns the transcript as a plain string body.
      const text = (await resp.text().catch(() => '')).trim();
      if (text) opts.onFinal(text);
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Whisper STT error');
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
          if (!pendingFlight) {
            pendingFlight = flushUtterance().finally(() => { pendingFlight = null; });
          }
        }
      } else {
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
      if (buffer.length > 0 && speechFrames >= MIN_SPEECH_FRAMES) {
        flushUtterance().catch(() => { /* ignore */ });
      }
    },
  };
}
