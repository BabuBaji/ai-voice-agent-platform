import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../index';
import { config } from '../config';

export const recordingRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

function ensureDir() {
  const abs = path.resolve(config.recordingsDir);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * Split a 16-bit PCM WAV (typically stereo 8kHz from the phone-call path,
 * L=caller / R=agent) into mono-caller WAV chunks of ~secondsPerChunk each,
 * so each chunk fits under Sarvam's 30-second sync STT cap.
 *
 * Returns an array of complete WAV buffers (44-byte header + PCM data),
 * each encoded as mono PCM16 at the source sample rate. Returns null if
 * the input can't be parsed as WAV.
 */
export function splitWavIntoMonoChunks(wav: Buffer, secondsPerChunk: number): Buffer[] | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  // Walk chunks for fmt + data.
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (off + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', off, off + 4);
    const chunkSize = wav.readUInt32LE(off + 4);
    if (chunkId === 'fmt ') {
      fmt = {
        channels: wav.readUInt16LE(off + 8 + 2),
        sampleRate: wav.readUInt32LE(off + 8 + 4),
        bitsPerSample: wav.readUInt16LE(off + 8 + 14),
      };
    } else if (chunkId === 'data') {
      dataOffset = off + 8;
      dataLen = chunkSize;
      break;
    }
    off += 8 + chunkSize + (chunkSize % 2);
  }
  if (!fmt || dataOffset < 0 || fmt.bitsPerSample !== 16) return null;

  // Decode PCM16 frames, taking only channel 0 (caller on phone-call WAVs).
  const frameBytes = fmt.channels * 2;
  const frameCount = Math.floor(dataLen / frameBytes);
  const caller = Buffer.alloc(frameCount * 2);
  for (let i = 0; i < frameCount; i++) {
    const sample = wav.readInt16LE(dataOffset + i * frameBytes);
    caller.writeInt16LE(sample, i * 2);
  }

  const samplesPerChunk = fmt.sampleRate * secondsPerChunk;
  const chunks: Buffer[] = [];
  for (let start = 0; start < frameCount; start += samplesPerChunk) {
    const end = Math.min(start + samplesPerChunk, frameCount);
    const body = caller.slice(start * 2, end * 2);
    chunks.push(wrapMonoPcm16Wav(body, fmt.sampleRate));
  }
  return chunks;
}

function wrapMonoPcm16Wav(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataBytes = pcmData.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);              // fmt chunk size
  header.writeUInt16LE(1, 20);               // PCM
  header.writeUInt16LE(1, 22);               // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);  // byteRate
  header.writeUInt16LE(2, 32);               // blockAlign
  header.writeUInt16LE(16, 34);              // bitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, pcmData]);
}

function extFromMime(mime: string): string {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('mpeg')) return 'mp4';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

// POST /conversations/:id/recording — raw audio upload
recordingRouter.post(
  '/conversations/:id/recording',
  (req: Request, _res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      (req as any).rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', next);
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = getTenantId(req, res);
      if (!tenantId) return;

      const { id } = req.params;
      const body: Buffer = (req as any).rawBody;
      if (!body || body.length === 0) {
        res.status(400).json({ error: 'Bad Request', message: 'Empty audio body' });
        return;
      }

      const check = await pool.query(
        'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
      if (check.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
        return;
      }

      const contentType = (req.headers['content-type'] as string) || 'audio/webm';
      const ext = extFromMime(contentType);
      const dir = ensureDir();
      const filePath = path.join(dir, `${id}.${ext}`);
      fs.writeFileSync(filePath, body);

      const relativeUrl = `/api/v1/conversations/${id}/recording`;
      await pool.query(
        'UPDATE conversations SET recording_url = $1 WHERE id = $2 AND tenant_id = $3',
        [relativeUrl, id, tenantId]
      );

      res.status(201).json({ recording_url: relativeUrl, size: body.length, mime: contentType });
    } catch (err) {
      next(err);
    }
  }
);

// POST /conversations/:id/transcribe — run OpenAI Whisper on the stored recording
// and persist the result in conversations.metadata.whisper_transcript.
recordingRouter.post('/conversations/:id/transcribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    const convRow = await pool.query(
      'SELECT id, metadata, recording_url FROM conversations WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (convRow.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    // Locate the audio. Two flavours:
    //  1. Web-widget recordings — uploaded via POST on this service; live
    //     on local disk at logs/recordings/<id>.{webm,ogg,mp4,wav}.
    //  2. Phone-call recordings — written by telephony-adapter's Plivo WS
    //     handler; served via a public HTTPS URL stored in
    //     conversations.recording_url.
    const dir = ensureDir();
    const candidates = ['webm', 'ogg', 'mp4', 'wav'];
    let filePath: string | null = null;
    let ext = '';
    for (const e of candidates) {
      const p = path.join(dir, `${id}.${e}`);
      if (fs.existsSync(p)) { filePath = p; ext = e; break; }
    }

    let audioBuf: Buffer | null = null;
    let mime = '';
    let fetchedFromUrl = false;

    if (filePath) {
      audioBuf = fs.readFileSync(filePath);
      mime = ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : ext === 'mp4' ? 'audio/mp4' : 'audio/wav';
    } else if (convRow.rows[0].recording_url) {
      // Fall back to fetching the remote URL (ngrok-tunneled telephony-adapter WAV).
      // `ngrok-skip-browser-warning` bypasses ngrok free-tier's interstitial.
      try {
        const url = String(convRow.rows[0].recording_url);
        const r = await fetch(url, { headers: { 'ngrok-skip-browser-warning': '1' } });
        if (!r.ok) {
          res.status(502).json({ error: 'Upstream', message: `Recording fetch failed: ${r.status}` });
          return;
        }
        const ab = await r.arrayBuffer();
        audioBuf = Buffer.from(ab);
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        mime = ct.includes('webm') ? 'audio/webm'
          : ct.includes('ogg') ? 'audio/ogg'
          : ct.includes('mp4') ? 'audio/mp4'
          : 'audio/wav';
        ext = mime.split('/')[1] === 'mpeg' ? 'mp3' : (mime.split('/')[1] || 'wav');
        fetchedFromUrl = true;
      } catch (err: any) {
        res.status(502).json({ error: 'Upstream', message: `Recording fetch error: ${err.message}` });
        return;
      }
    }

    if (!audioBuf) {
      res.status(404).json({ error: 'Not Found', message: 'Recording file not found on disk and no recording_url set' });
      return;
    }

    void fetchedFromUrl; // satisfy noUnusedLocals without altering behaviour

    // Try OpenAI Whisper first (gives verbose segment timing). Fall back to
    // Sarvam /speech-to-text (no segment timing, but works on an Indic-tuned
    // model and on accounts where the OpenAI key is dead / quota-exhausted).
    type Transcript = {
      text: string;
      language: string | null;
      duration: number | null;
      segments: Array<{ start: number; end: number; text: string }>;
      transcribed_at: string;
    };

    let transcript: Transcript | null = null;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audioBuf)], { type: mime }), `${id}.${ext}`);
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form as any,
      });
      if (resp.ok) {
        const result = (await resp.json()) as {
          text?: string; language?: string; duration?: number;
          segments?: Array<{ id: number; start: number; end: number; text: string }>;
        };
        transcript = {
          text: result.text || '',
          language: result.language || null,
          duration: result.duration || null,
          segments: (result.segments || []).map((s) => ({
            start: s.start, end: s.end, text: s.text.trim(),
          })),
          transcribed_at: new Date().toISOString(),
        };
      }
      // Non-2xx (quota exhausted, invalid key, etc.) — silently fall through
      // to Sarvam. We log and tell the user what happened only if *both* fail.
    }

    if (!transcript) {
      const sarvamKey = process.env.SARVAM_API_KEY;
      if (!sarvamKey) {
        res.status(502).json({
          error: 'Transcription Failed',
          message: 'No working STT backend — OpenAI key missing/exhausted and SARVAM_API_KEY not set.',
        });
        return;
      }
      // Sarvam wants the conversation's language if known; otherwise it
      // auto-detects with "unknown".
      const langRow = await pool.query(
        'SELECT language FROM conversations WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
      const rawLang = String(langRow.rows[0]?.language || '').trim();
      // Sarvam only accepts this specific set of BCP-47 codes. Anything else
      // (e.g. en-US, en-GB, fr-FR) we send as "unknown" for auto-detect.
      const SARVAM_LANGS = new Set([
        'unknown', 'hi-IN', 'bn-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN',
        'ta-IN', 'te-IN', 'en-IN', 'gu-IN', 'as-IN', 'ur-IN', 'ne-IN', 'kok-IN',
        'mai-IN', 'doi-IN', 'brx-IN', 'sat-IN', 'mni-IN', 'sd-IN', 'ks-IN',
      ]);
      const normalized = rawLang && !rawLang.includes('-') ? `${rawLang}-IN` : rawLang;
      const sarvamLang = SARVAM_LANGS.has(normalized) ? normalized : 'unknown';

      // Sarvam's sync /speech-to-text caps at 30s per request. Our WAVs can
      // be 2–5 min. Split into ~25s chunks of the caller-only (left) channel,
      // transcribe each, concatenate. For non-WAV inputs (web-widget webm
      // uploads) we fall through to a single-shot call and let Sarvam 400
      // for long audio — those are rarely > 30s anyway.
      const chunks = ext === 'wav' ? splitWavIntoMonoChunks(audioBuf, 25) : null;
      const segments: Array<{ start: number; end: number; text: string }> = [];
      const SECONDS_PER_CHUNK = 25;

      const runSarvamOnBuffer = async (buf: Buffer, chunkMime: string): Promise<string | null> => {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(buf)], { type: chunkMime }), `${id}.wav`);
        form.append('model', 'saarika:v2.5');
        form.append('language_code', sarvamLang);
        const resp = await fetch('https://api.sarvam.ai/speech-to-text', {
          method: 'POST',
          headers: { 'api-subscription-key': sarvamKey },
          body: form as any,
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.warn(`[recordings] Sarvam STT chunk failed: ${resp.status} ${body.slice(0, 200)}`);
          return null;
        }
        const data = await resp.json() as { transcript?: string };
        return (data.transcript || '').trim();
      };

      if (chunks && chunks.length > 0) {
        for (let i = 0; i < chunks.length; i++) {
          const txt = await runSarvamOnBuffer(chunks[i], 'audio/wav');
          if (txt) {
            segments.push({
              start: i * SECONDS_PER_CHUNK,
              end: (i + 1) * SECONDS_PER_CHUNK,
              text: txt,
            });
          }
        }
      } else {
        const txt = await runSarvamOnBuffer(audioBuf, mime);
        if (txt) segments.push({ start: 0, end: 0, text: txt });
      }

      if (segments.length === 0) {
        res.status(502).json({
          error: 'Transcription Failed',
          message: 'Sarvam STT returned no text for any chunk',
        });
        return;
      }

      transcript = {
        text: segments.map((s) => s.text).join(' ').trim(),
        language: sarvamLang,
        duration: null,
        segments,
        transcribed_at: new Date().toISOString(),
      };
    }

    const existing = convRow.rows[0].metadata || {};
    const nextMeta = { ...existing, whisper_transcript: transcript };
    await pool.query(
      'UPDATE conversations SET metadata = $1 WHERE id = $2 AND tenant_id = $3',
      [nextMeta, id, tenantId]
    );

    res.json(transcript);
  } catch (err) {
    next(err);
  }
});

// GET /conversations/:id/recording — stream audio file
recordingRouter.get('/conversations/:id/recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    // Tenant check is optional here to allow <audio src> tags without headers,
    // but we still require a matching conversation exists.
    const tenantId = (req.headers['x-tenant-id'] as string) || null;

    const check = await pool.query(
      tenantId
        ? 'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2'
        : 'SELECT id FROM conversations WHERE id = $1',
      tenantId ? [id, tenantId] : [id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const dir = ensureDir();
    const candidates = ['webm', 'ogg', 'mp4', 'wav'];
    let filePath: string | null = null;
    let ext = '';
    for (const e of candidates) {
      const p = path.join(dir, `${id}.${e}`);
      if (fs.existsSync(p)) {
        filePath = p;
        ext = e;
        break;
      }
    }
    if (!filePath) {
      res.status(404).json({ error: 'Not Found', message: 'Recording file not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    res.setHeader(
      'Content-Type',
      ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : ext === 'mp4' ? 'audio/mp4' : 'audio/wav'
    );
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});
