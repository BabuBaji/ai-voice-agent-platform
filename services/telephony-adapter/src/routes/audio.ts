import { Router, Request, Response } from 'express';

// In-memory MP3 cache — keyed by short id, expires after 10 minutes.
// Twilio fetches these URLs while the call is live; entries are cheap to hold briefly.
const CACHE = new Map<string, { buf: Buffer; ts: number }>();
const TTL_MS = 10 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [k, v] of CACHE.entries()) {
    if (now - v.ts > TTL_MS) CACHE.delete(k);
  }
}

export function cacheAudio(id: string, buf: Buffer): void {
  gc();
  CACHE.set(id, { buf, ts: Date.now() });
}

export const audioRouter = Router();

audioRouter.get('/:id.mp3', (req: Request, res: Response) => {
  const entry = CACHE.get(req.params.id);
  if (!entry) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', String(entry.buf.length));
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.send(entry.buf);
});
