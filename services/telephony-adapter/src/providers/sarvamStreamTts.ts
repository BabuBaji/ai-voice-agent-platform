/**
 * Sarvam streaming TTS over WebSocket.
 *
 * Replaces the HTTP request/response TTS (synthesizeSarvamTtsMulaw) for the
 * live-call path with a PERSISTENT per-call WebSocket so:
 *   - first audio byte arrives ~250ms after a sentence is sent (vs ~550ms HTTP),
 *   - audio arrives as a continuous stream of small chunks we forward to Plivo
 *     immediately (paced ~real-time) instead of one big blob blasted 5x-realtime,
 *   - the same `abhilash` Telugu/Hindi/English voice is kept (bulbul:v2).
 *
 * Protocol (https://docs.sarvam.ai/api-reference-docs/text-to-speech/stream):
 *   wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v2
 *   header  Api-Subscription-Key: <key>
 *   →  {type:'config', data:{ target_language_code, speaker, output_audio_codec:'mulaw',
 *                             speech_sample_rate:'8000', pace, enable_preprocessing:true }}
 *   →  {type:'text',  data:{ text }}            (one per sentence)
 *   →  {type:'flush'}                            (force-render buffered text)
 *   →  {type:'ping'}                             (keepalive; idle closes after ~60s)
 *   ←  {type:'audio', data:{ content_type:'audio/mulaw', audio:<base64> }}
 *   ←  {type:'event', data:{ event_type:'final' }}   (when send_completion_event)
 *   ←  {type:'error', data:{ message, code }}
 *
 * Output is mulaw/8000 — exactly Plivo's playAudio format, so NO resampling.
 *
 * This module is intentionally self-contained and additive: the HTTP path
 * (synthesizeSarvamTtsMulaw) remains the emergency fallback in plivoAudioStream.
 */
import { WebSocket } from 'ws';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

const WS_BASE = 'wss://api.sarvam.ai/text-to-speech/ws';
const TTS_MODEL = 'bulbul:v2';
// bulbul:v2 speaker catalog (mirror of sarvamSpeech.ts).
const SARVAM_SPEAKERS = new Set(['anushka', 'abhilash', 'manisha', 'vidya', 'arya', 'karun', 'hitesh']);
// Idle window after flush with no new audio chunk before we treat the turn as
// finished — belt-and-braces for the `final` event (whose timing is provider-
// dependent). 350ms is long enough to bridge inter-chunk jitter, short enough
// to not add perceptible end-of-turn lag.
const TURN_IDLE_MS = Number(process.env.SARVAM_TTS_IDLE_MS) || 350;

export function sarvamStreamConfigured(): boolean {
  return !!process.env.SARVAM_API_KEY;
}

/** Normalize a free-form language hint to one of Sarvam's BCP-47 codes. */
function normLang(language: string | null | undefined): string {
  const s = String(language || 'te-IN').toLowerCase();
  const two = s.slice(0, 2);
  const map: Record<string, string> = {
    te: 'te-IN', hi: 'hi-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN',
    bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN', od: 'od-IN', or: 'od-IN', en: 'en-IN',
  };
  return map[two] || 'te-IN';
}

export interface SarvamStreamOpts {
  language: string;
  voiceId?: string | null;
  pace?: number;
  /** Invoked with each decoded mulaw 8k Buffer as it arrives. */
  onChunk: (mulaw: Buffer) => void;
  /** Invoked once per turn when synthesis for the flushed text is complete. */
  onTurnEnd?: () => void;
  /** Invoked on a fatal stream error (caller should fall back to HTTP TTS). */
  onError?: (msg: string) => void;
}

/**
 * Persistent Sarvam TTS stream. One instance per call; `speak()`/`flush()` reused
 * across turns. `connect()` resolves when the socket is open and configured.
 */
export class SarvamTtsStream {
  private ws: WebSocket | null = null;
  private opts: SarvamStreamOpts;
  private speaker: string;
  private lang: string;
  private pace: number;
  private keepalive: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private turnActive = false;       // true between first speak() and turn-end
  private gotFirstChunk = false;
  public closed = false;
  public connected = false;

  constructor(opts: SarvamStreamOpts) {
    this.opts = opts;
    this.lang = normLang(opts.language);
    const v = (opts.voiceId || '').toLowerCase();
    this.speaker = SARVAM_SPEAKERS.has(v) ? v : (process.env.PREMIUM_VOICE_ID || 'abhilash');
    this.pace = opts.pace ?? (Number(process.env.SARVAM_TTS_PACE) || 0.95);
  }

  /** Open the WS and send the config message. Resolves on open, rejects on failure. */
  connect(timeoutMs = 4000): Promise<void> {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) return Promise.reject(new Error('SARVAM_API_KEY not set'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(`${WS_BASE}?model=${encodeURIComponent(TTS_MODEL)}`, {
        headers: { 'Api-Subscription-Key': apiKey },
      });
      this.ws = ws;
      const to = setTimeout(() => {
        if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('sarvam tts ws open timeout')); }
      }, timeoutMs);

      ws.on('open', () => {
        try {
          ws.send(JSON.stringify({
            type: 'config',
            data: {
              target_language_code: this.lang,
              speaker: this.speaker,
              output_audio_codec: 'mulaw',
              speech_sample_rate: '8000',
              pace: this.pace,
              enable_preprocessing: true,
            },
          }));
        } catch (e: any) {
          if (!settled) { settled = true; clearTimeout(to); reject(e); }
          return;
        }
        this.connected = true;
        this.startKeepalive();
        if (!settled) { settled = true; clearTimeout(to); resolve(); }
      });

      ws.on('message', (raw: any) => this.onMessage(raw));

      ws.on('error', (err: any) => {
        const msg = err?.message || String(err);
        if (!settled) { settled = true; clearTimeout(to); reject(new Error(msg)); }
        else this.opts.onError?.(msg);
      });

      ws.on('close', () => {
        this.connected = false;
        this.stopKeepalive();
        // If a turn was mid-flight when the socket dropped, end it so the caller
        // isn't stuck waiting on onTurnEnd.
        if (this.turnActive) this.finishTurn();
      });
    });
  }

  private onMessage(raw: any): void {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'audio' && m.data?.audio) {
      const buf = Buffer.from(m.data.audio, 'base64');
      if (buf.length === 0) return;
      this.gotFirstChunk = true;
      this.armIdleTimer();        // reset the post-flush idle countdown on each chunk
      try { this.opts.onChunk(buf); } catch { /* consumer error — non-fatal */ }
    } else if (m.type === 'event' && m.data?.event_type === 'final') {
      this.finishTurn();
    } else if (m.type === 'error') {
      const msg = m.data?.message || 'sarvam tts stream error';
      logger.warn({ code: m.data?.code, msg }, 'SarvamTtsStream: error message');
      this.opts.onError?.(msg);
      this.finishTurn();
    }
  }

  /** Send one sentence for synthesis. Marks a turn active. */
  speak(text: string): void {
    const t = (text || '').trim();
    if (!t || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.turnActive = true;
    try { this.ws.send(JSON.stringify({ type: 'text', data: { text: t } })); } catch { /* ignore */ }
  }

  /** Force-render whatever text is buffered and begin the turn-end watch. */
  flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.finishTurn(); return; }
    try { this.ws.send(JSON.stringify({ type: 'flush' })); } catch { /* ignore */ }
    // Before any audio has arrived we must wait LONGER (first byte is ~300ms
    // post-flush) — the short inter-chunk idle timer would otherwise end the
    // turn before the first chunk lands. Once chunks start flowing, each one
    // re-arms the short idle timer in onMessage to detect the real end-of-audio.
    if (!this.gotFirstChunk) this.armFirstAudioTimeout();
    else this.armIdleTimer();
  }

  /** Reset turn state on barge-in / cancel (drops any pending audio expectation). */
  cancelTurn(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.turnActive = false;
    this.gotFirstChunk = false;
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // No new audio for TURN_IDLE_MS while chunks were flowing → synthesis done.
      if (this.turnActive) this.finishTurn();
    }, TURN_IDLE_MS);
  }

  /** Longer grace after flush before the FIRST chunk arrives. If nothing comes,
   *  the turn ends empty so the caller can fall back to HTTP TTS. */
  private armFirstAudioTimeout(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const ms = Number(process.env.SARVAM_TTS_FIRST_AUDIO_MS) || 4000;
    this.idleTimer = setTimeout(() => {
      if (this.turnActive) this.finishTurn();
    }, ms);
  }

  private finishTurn(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (!this.turnActive && !this.gotFirstChunk) { /* nothing to end */ }
    const was = this.turnActive;
    this.turnActive = false;
    this.gotFirstChunk = false;
    if (was) { try { this.opts.onTurnEnd?.(); } catch { /* ignore */ } }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
      }
    }, 20000);
  }

  private stopKeepalive(): void {
    if (this.keepalive) { clearInterval(this.keepalive); this.keepalive = null; }
  }

  close(): void {
    this.closed = true;
    this.cancelTurn();
    this.stopKeepalive();
    if (this.ws) {
      try { this.ws.close(1000, 'call-end'); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}
