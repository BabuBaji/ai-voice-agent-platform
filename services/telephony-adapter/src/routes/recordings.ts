/**
 * Serves locally-saved call recordings as WAV.
 *
 * Files live in `logs/recordings/<callSid>.wav`, written by the Plivo
 * AudioStream handler on stream-stop. The route is public (no auth) because
 * Plivo's recording URLs have historically been public too; agents + UI just
 * link to `${PUBLIC_BASE_URL}/recordings/:id.wav`.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const RECORDINGS_DIR = path.resolve(process.cwd(), 'logs', 'recordings');

// Ensure the directory exists on import so the WS handler can blindly write.
try {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
} catch {
  /* ignore */
}

export function recordingsDir(): string {
  return RECORDINGS_DIR;
}

export const recordingsRouter = Router();

recordingsRouter.get('/:id.wav', (req: Request, res: Response) => {
  // Defensive: only allow simple ids (alphanumeric + dash/underscore).
  if (!/^[\w-]+$/.test(req.params.id)) {
    res.status(400).type('text/plain').send('Bad id');
    return;
  }
  const file = path.join(RECORDINGS_DIR, `${req.params.id}.wav`);
  if (!fs.existsSync(file)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  const stat = fs.statSync(file);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(file).pipe(res);
});
