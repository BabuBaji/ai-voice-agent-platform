/**
 * Azure Speech provider — STT + TTS for languages Deepgram doesn't support
 * (Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi,
 * and many others with native neural voices).
 *
 * STT: streaming recognition via a PushAudioInputStream fed from Plivo mulaw
 *      frames. Emits final transcripts via an on('final') callback — same
 *      contract the Deepgram path uses, so the WS handler can swap backends.
 *
 * TTS: one-shot synthesis request that returns base64 mulaw-8kHz audio
 *      ready to drop into a Plivo playAudio event.
 *
 * Requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in env.
 */
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export function azureSpeechConfigured(): boolean {
  return !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

/**
 * Languages Azure supports with high-quality neural TTS voices that we map
 * to below. Keys are normalised lower-case BCP-47 tags. For each we pin a
 * default voice (female neural) — callers can override with agent config.
 */
const AZURE_VOICE_DEFAULTS: Record<string, string> = {
  // Indian languages
  'te-in': 'te-IN-ShrutiNeural',    // Telugu female
  'hi-in': 'hi-IN-SwaraNeural',     // Hindi female
  'ta-in': 'ta-IN-PallaviNeural',   // Tamil female
  'kn-in': 'kn-IN-SapnaNeural',     // Kannada female
  'ml-in': 'ml-IN-SobhanaNeural',   // Malayalam female
  'mr-in': 'mr-IN-AarohiNeural',    // Marathi female
  'bn-in': 'bn-IN-TanishaaNeural',  // Bengali female
  'gu-in': 'gu-IN-DhwaniNeural',    // Gujarati female
  'pa-in': 'pa-IN-OjasNeural',      // Punjabi
  // English variants (used as fallback when TTS requests these)
  'en-in': 'en-IN-NeerjaNeural',
  'en-us': 'en-US-JennyNeural',
  'en-gb': 'en-GB-SoniaNeural',
};

/** BCP-47 tag normalisation: 'te-IN' → 'te-in', 'te' → 'te-in'. */
function normalizeLang(raw: string | undefined | null): string {
  const s = (raw || 'en-IN').trim().toLowerCase();
  if (s.includes('-')) return s;
  // Expand 2-letter code to a reasonable default region.
  const map: Record<string, string> = {
    te: 'te-in', hi: 'hi-in', ta: 'ta-in', kn: 'kn-in', ml: 'ml-in',
    mr: 'mr-in', bn: 'bn-in', gu: 'gu-in', pa: 'pa-in', en: 'en-in',
  };
  return map[s] || `${s}-in`;
}

function azureLangTag(raw: string | undefined | null): string {
  const norm = normalizeLang(raw);
  // Azure expects canonical BCP-47 with upper-case region (e.g. te-IN).
  return norm.split('-').map((p, i) => i === 0 ? p : p.toUpperCase()).join('-');
}

// ---- STT -------------------------------------------------------------------

export interface AzureSttHandle {
  /** Feed mulaw 8kHz audio bytes into the recognizer. */
  push(audio: Buffer): void;
  /** Stop recognition and close the underlying stream. */
  close(): void;
}

export interface AzureSttOptions {
  language: string;                          // e.g. "te-IN"
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
}

/**
 * Open a streaming Azure STT session. Returns a handle whose `push` you call
 * on every inbound Plivo media frame. `onFinal` fires on each recognised
 * utterance. No interim/partial events are emitted (keeps parity with the
 * Deepgram branch which also runs finals-only).
 */
export function startAzureStt(opts: AzureSttOptions): AzureSttHandle {
  const key = process.env.AZURE_SPEECH_KEY!;
  const region = process.env.AZURE_SPEECH_REGION!;

  // Plivo frames are mulaw 8kHz mono. Azure's PushAudioInputStream accepts
  // PCM by default, but we can declare the container/format via AudioStreamFormat.
  // Azure has a helper for mulaw: AudioStreamFormat.getWaveFormatPCM(8000,8,1)
  // is for PCM; for mulaw we use getCompressedFormat with MULAW.
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);

  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = azureLangTag(opts.language);
  // Better endpointing: wait 600ms of silence after speech to finalise.
  speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '600');

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognized = (_sender: any, event: sdk.SpeechRecognitionEventArgs) => {
    if (event.result.reason === sdk.ResultReason.RecognizedSpeech) {
      const text = (event.result.text || '').trim();
      if (text) opts.onFinal(text);
    }
  };
  recognizer.canceled = (_sender: any, event: sdk.SpeechRecognitionCanceledEventArgs) => {
    if (event.reason === sdk.CancellationReason.Error) {
      const msg = `Azure STT cancelled: ${event.errorDetails || event.errorCode}`;
      logger.warn({ errorCode: event.errorCode, errorDetails: event.errorDetails }, 'Azure STT cancelled');
      opts.onError?.(msg);
    }
  };

  recognizer.startContinuousRecognitionAsync(
    () => logger.info({ language: speechConfig.speechRecognitionLanguage }, 'Azure STT started'),
    (err: any) => {
      logger.warn({ err: String(err) }, 'Azure STT startContinuousRecognitionAsync error');
      opts.onError?.(String(err));
    }
  );

  return {
    push(audio: Buffer) {
      try {
        // Azure PushAudioInputStream was configured for PCM16 above — but
        // Plivo gives us mulaw. We decode on the fly. (mulawToPcm16 lives
        // in plivoAudioStream; duplicating it here to keep this module
        // self-contained.)
        const pcm16 = mulawToPcm16Buffer(audio);
        pushStream.write(pcm16);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Azure STT push error');
      }
    },
    close() {
      try { pushStream.close(); } catch { /* ignore */ }
      recognizer.stopContinuousRecognitionAsync(
        () => { try { recognizer.close(); } catch { /* ignore */ } },
        () => { try { recognizer.close(); } catch { /* ignore */ } }
      );
    },
  };
}

function mulawToPcm16Sample(u: number): number {
  u = (~u) & 0xff;
  const sign = (u & 0x80) ? -1 : 1;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  return sign * magnitude;
}
function mulawToPcm16Buffer(mulaw: Buffer): ArrayBuffer {
  // Output is interleaved little-endian 16-bit PCM, 2 bytes per input byte.
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(mulawToPcm16Sample(mulaw[i]), i * 2);
  }
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

// ---- TTS -------------------------------------------------------------------

/**
 * Synthesize text to base64 mulaw-8kHz using Azure Neural TTS.
 * Returns null on failure (caller falls back to Deepgram Aura).
 *
 * Works entirely via the REST TTS endpoint so we don't need the SDK's
 * internal WebSocket wiring. The key bit: the output format header tells
 * Azure to give us the exact wire format Plivo expects.
 */
export async function synthesizeAzureTtsMulaw(
  text: string,
  language: string,
  voiceOverride?: string
): Promise<string | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) return null;

  const clean = (text || '').trim();
  if (!clean) return null;

  const lang = azureLangTag(language);
  const voice = voiceOverride || AZURE_VOICE_DEFAULTS[normalizeLang(language)] || 'en-IN-NeerjaNeural';

  const ssml = `<speak version="1.0" xml:lang="${lang}"><voice xml:lang="${lang}" name="${voice}"><prosody rate="0%">${escapeXml(clean.slice(0, 1900))}</prosody></voice></speak>`;

  try {
    const resp = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        // This is the magic line: raw mulaw 8kHz, no wav/riff header, ready
        // for Plivo's playAudio event.
        'X-Microsoft-OutputFormat': 'raw-8khz-8bit-mono-mulaw',
        'User-Agent': 'ai-voice-agent/1.0',
      },
      body: ssml,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: body.slice(0, 200), voice, lang }, 'Azure TTS failed');
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 200) {
      logger.warn({ size: buf.length }, 'Azure TTS returned tiny buffer');
      return null;
    }
    return buf.toString('base64');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Azure TTS error');
    return null;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---- Language routing ------------------------------------------------------

const DEEPGRAM_NATIVE = new Set([
  'en', 'en-us', 'en-gb', 'en-au', 'en-nz', 'en-in',
  'es', 'fr', 'de', 'hi', 'it', 'ja', 'ko', 'nl', 'pt', 'ru', 'sv', 'tr', 'uk', 'zh',
]);

/**
 * True when Deepgram handles this language natively (nova-2). For anything
 * else (Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati,
 * Punjabi, …) we route to Azure if configured.
 */
export function deepgramCanHandle(language: string | undefined | null): boolean {
  const s = (language || '').toLowerCase();
  return DEEPGRAM_NATIVE.has(s) || DEEPGRAM_NATIVE.has(s.slice(0, 2));
}
