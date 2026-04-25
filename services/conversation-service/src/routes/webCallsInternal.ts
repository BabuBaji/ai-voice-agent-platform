/**
 * Internal web-call routes — called by ai-runtime WS handler during a live call.
 *
 * Trust model: these routes are mounted at /internal/* which is NOT proxied by
 * api-gateway. In dev they are localhost-only. In production we'd additionally
 * require a shared X-Internal-Secret header; for now a light header check gives
 * a defence-in-depth warning if anything external tries to hit them.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../index';
import { runWebCallAnalysis } from './webCalls';

export const webCallInternalRouter = Router();

function internalGuard(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_SHARED_SECRET;
  if (expected) {
    const provided = req.headers['x-internal-secret'] as string | undefined;
    if (provided !== expected) {
      res.status(403).json({ error: 'Forbidden', message: 'Invalid internal secret' });
      return;
    }
  }
  next();
}
webCallInternalRouter.use(internalGuard);

// GET /internal/web-calls/:id — tenant-less lookup (returns the full session)
webCallInternalRouter.get('/web-calls/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const row = await pool.query('SELECT * FROM web_call_sessions WHERE id = $1', [id]);
    if (row.rows.length === 0) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /internal/web-calls/:id — partial update (status, recording_url, etc.)
webCallInternalRouter.patch('/web-calls/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const patch = req.body || {};
    const allowed = [
      'status', 'conversation_id', 'voice_provider', 'voice_name',
      'recording_url', 'transcript_status', 'analysis_status',
      'duration_seconds', 'end_reason', 'error_message', 'metadata',
    ];
    const sets: string[] = [];
    const params: any[] = [];
    for (const k of allowed) {
      if (k in patch) {
        params.push(patch[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if ('ended_at' in patch) {
      sets.push(`ended_at = NOW()`);
    }
    if (sets.length === 0) {
      res.json({ ok: true, noop: true });
      return;
    }
    params.push(id);
    const q = `UPDATE web_call_sessions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`;
    const row = await pool.query(q, params);
    if (row.rows.length === 0) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /internal/web-calls/:id/transcripts — append a transcript utterance
webCallInternalRouter.post('/web-calls/:id/transcripts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { sequence, speaker, text, language, confidence, started_at_ms, ended_at_ms } = req.body || {};
    if (!speaker || !text) {
      res.status(400).json({ error: 'Bad Request', message: 'speaker and text are required' });
      return;
    }
    const row = await pool.query(
      `INSERT INTO web_call_transcripts
         (call_id, sequence, speaker, text, language, confidence, started_at_ms, ended_at_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [id, sequence || 0, speaker, text, language || null, confidence ?? null, started_at_ms ?? null, ended_at_ms ?? null]
    );
    res.status(201).json({ id: row.rows[0].id });
  } catch (err) {
    next(err);
  }
});

// POST /internal/web-calls/:id/recordings — register a saved audio file
webCallInternalRouter.post('/web-calls/:id/recordings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { kind, file_path, public_url, mime_type, size_bytes, duration_seconds } = req.body || {};
    if (!kind || !file_path) {
      res.status(400).json({ error: 'Bad Request', message: 'kind and file_path are required' });
      return;
    }
    const row = await pool.query(
      `INSERT INTO web_call_recordings
         (call_id, kind, file_path, public_url, mime_type, size_bytes, duration_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [id, kind, file_path, public_url || null, mime_type || null, size_bytes || null, duration_seconds || null]
    );
    // If this is the 'mixed' or 'user' primary, also set session.recording_url
    if (kind === 'mixed' || kind === 'user') {
      await pool.query(
        'UPDATE web_call_sessions SET recording_url = COALESCE(recording_url, $1), updated_at = NOW() WHERE id = $2',
        [public_url, id]
      );
    }
    res.status(201).json({ id: row.rows[0].id });
  } catch (err) {
    next(err);
  }
});

// POST /internal/web-calls/:id/events — append a lifecycle event row
webCallInternalRouter.post('/web-calls/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { event_type, direction, payload } = req.body || {};
    if (!event_type || !direction) {
      res.status(400).json({ error: 'Bad Request', message: 'event_type and direction are required' });
      return;
    }
    await pool.query(
      `INSERT INTO web_call_events (call_id, event_type, direction, payload) VALUES ($1, $2, $3, $4)`,
      [id, String(event_type).slice(0, 40), String(direction).slice(0, 10), payload ? JSON.stringify(payload) : null]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /internal/web-calls/:id/analyze — trigger analysis (no tenant scope)
webCallInternalRouter.post('/web-calls/:id/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const row = await pool.query('SELECT * FROM web_call_sessions WHERE id = $1', [id]);
    if (row.rows.length === 0) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    const result = await runWebCallAnalysis(id, row.rows[0]);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
