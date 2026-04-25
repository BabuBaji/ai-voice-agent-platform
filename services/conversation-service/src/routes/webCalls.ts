import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { pool } from '../index';
import { config } from '../config';

export const webCallRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

function getUserId(req: Request): string | null {
  return (req.headers['x-user-id'] as string) || null;
}

function webCallRecordingsDir(): string {
  const abs = path.resolve(config.recordingsDir, 'web-calls');
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  return abs;
}

const startSchema = z.object({
  agent_id: z.string().uuid(),
  primary_language: z.string().min(2).max(10).default('en-IN'),
  auto_detect_language: z.boolean().default(false),
  mixed_language_allowed: z.boolean().default(false),
  voice_provider: z.string().max(30).optional(),
  voice_name: z.string().max(80).optional(),
  voice_gender: z.string().max(10).optional(),
  voice_accent: z.string().max(30).optional(),
  voice_speed: z.number().min(0.5).max(2.0).default(1.0),
  voice_tone: z.string().max(30).optional(),
  recording_enabled: z.boolean().default(true),
  transcript_enabled: z.boolean().default(true),
  metadata: z.any().default({}),
});

const endSchema = z.object({
  end_reason: z.string().max(50).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
});

// POST /web-calls/start — create a new call session, return id + ws url hint
webCallRouter.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation', message: parsed.error.message });
      return;
    }
    const body = parsed.data;
    const userId = getUserId(req);

    // Fail fast if the agent doesn't exist under this tenant — otherwise the
    // session creates fine and the WS handshake silently 404s later.
    try {
      const agentUrl = (process.env.AGENT_SERVICE_URL || 'http://localhost:3001/api/v1').replace(/\/+$/, '');
      const check = await fetch(`${agentUrl}/agents/${body.agent_id}`, {
        headers: { 'x-tenant-id': tenantId },
      });
      if (check.status === 404) {
        res.status(404).json({ error: 'Not Found', message: 'Agent not found in this tenant' });
        return;
      }
      if (!check.ok) {
        res.status(502).json({ error: 'Upstream', message: `Agent lookup failed: ${check.status}` });
        return;
      }
    } catch (e: any) {
      res.status(502).json({ error: 'Upstream', message: `Agent lookup error: ${e?.message || 'unknown'}` });
      return;
    }

    const row = await pool.query(
      `INSERT INTO web_call_sessions (
         tenant_id, user_id, agent_id, status,
         primary_language, auto_detect_language, mixed_language_allowed,
         voice_provider, voice_name, voice_gender, voice_accent, voice_speed, voice_tone,
         recording_enabled, transcript_enabled, metadata, started_at
       ) VALUES ($1,$2,$3,'PENDING',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       RETURNING *`,
      [
        tenantId, userId, body.agent_id,
        body.primary_language, body.auto_detect_language, body.mixed_language_allowed,
        body.voice_provider || null, body.voice_name || null, body.voice_gender || null,
        body.voice_accent || null, body.voice_speed, body.voice_tone || null,
        body.recording_enabled, body.transcript_enabled, body.metadata,
      ]
    );

    res.status(201).json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /web-calls/:id/end — mark session ended (WS handler also does this on disconnect)
webCallRouter.post('/:id/end', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const parsed = endSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation', message: parsed.error.message });
      return;
    }

    const result = await pool.query(
      `UPDATE web_call_sessions
         SET status = 'ENDED',
             ended_at = COALESCE(ended_at, NOW()),
             end_reason = COALESCE(end_reason, $3),
             duration_seconds = COALESCE(duration_seconds, $4),
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
      [id, tenantId, parsed.data.end_reason || 'client_ended', parsed.data.duration_seconds ?? null]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Web call not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /web-calls/:id — session record + counts
webCallRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const row = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM web_call_transcripts t WHERE t.call_id = s.id) AS transcript_count,
              (SELECT COUNT(*) FROM web_call_recordings r WHERE r.call_id = s.id) AS recording_count
         FROM web_call_sessions s
         WHERE s.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );
    if (row.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Web call not found' });
      return;
    }
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /web-calls/:id/transcript — ordered utterance list in spec shape
webCallRouter.get('/:id/transcript', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const session = await pool.query(
      'SELECT id, started_at FROM web_call_sessions WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (session.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Web call not found' });
      return;
    }

    const rows = await pool.query(
      `SELECT sequence, speaker, text, language, confidence,
              started_at_ms, ended_at_ms, created_at
         FROM web_call_transcripts
         WHERE call_id = $1
         ORDER BY sequence ASC`,
      [id]
    );

    // Shape to spec: {speaker, time "mm:ss", text, language}
    const items = rows.rows.map((r: any) => {
      const ms = r.started_at_ms ?? 0;
      const totalSeconds = Math.floor(ms / 1000);
      const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const ss = String(totalSeconds % 60).padStart(2, '0');
      return {
        speaker: r.speaker,
        time: `${mm}:${ss}`,
        text: r.text,
        language: r.language,
        confidence: r.confidence,
      };
    });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /web-calls/:id/recording — stream the stored audio (mixed, caller, or agent)
// Query param `kind` selects channel (default: mixed). Tenant header optional so
// <audio src> tags without Authorization can still play the file.
webCallRouter.get('/:id/recording', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const tenantId = (req.headers['x-tenant-id'] as string) || null;
    const kind = (req.query.kind as string) || 'mixed';

    const check = await pool.query(
      tenantId
        ? 'SELECT id FROM web_call_sessions WHERE id = $1 AND tenant_id = $2'
        : 'SELECT id FROM web_call_sessions WHERE id = $1',
      tenantId ? [id, tenantId] : [id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Web call not found' });
      return;
    }

    const rec = await pool.query(
      'SELECT file_path, mime_type FROM web_call_recordings WHERE call_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1',
      [id, kind]
    );
    if (rec.rows.length === 0 || !rec.rows[0].file_path || !fs.existsSync(rec.rows[0].file_path)) {
      res.status(404).json({ error: 'Not Found', message: 'Recording file not found' });
      return;
    }

    const filePath = rec.rows[0].file_path as string;
    const mime = (rec.rows[0].mime_type as string) || 'audio/wav';
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// GET /web-calls/:id/analysis — return stored analysis, or trigger it if missing
webCallRouter.get('/:id/analysis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const session = await pool.query(
      'SELECT id, analysis_status FROM web_call_sessions WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (session.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Web call not found' });
      return;
    }

    const existing = await pool.query(
      'SELECT * FROM web_call_analysis WHERE call_id = $1',
      [id]
    );
    if (existing.rows.length > 0) {
      res.json(shapeAnalysis(existing.rows[0]));
      return;
    }

    // Not generated yet — return 202 with status
    res.status(202).json({
      status: session.rows[0].analysis_status || 'PENDING',
      message: 'Analysis not yet generated',
    });
  } catch (err) {
    next(err);
  }
});

// POST /web-calls/:id/analyze — build analysis from stored transcripts now
webCallRouter.post('/:id/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const sessionRow = await pool.query(
      'SELECT * FROM web_call_sessions WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (sessionRow.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Web call not found' });
      return;
    }

    const result = await runWebCallAnalysis(id, sessionRow.rows[0]);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------- Analysis helpers ----------
function shapeAnalysis(row: any) {
  return {
    summary: row.summary || '',
    detailed_summary: row.detailed_summary || '',
    customerIntent: row.customer_intent || '',
    sentiment: row.sentiment || '',
    interestLevel: row.interest_level || '',
    leadScore: row.lead_score != null ? String(row.lead_score) : '',
    objections: row.objections || [],
    extractedFields: row.extracted_fields || {},
    nextBestAction: row.next_best_action || '',
    followUpRequired: !!row.follow_up_required,
    recommendedCallbackTime: row.recommended_callback_time
      ? new Date(row.recommended_callback_time).toISOString()
      : '',
    agentPerformanceScore: row.agent_performance_score != null ? String(row.agent_performance_score) : '',
  };
}

/**
 * Runs analysis for a web call by building a transcript from web_call_transcripts
 * and asking ai-runtime /chat/analyze for a rich JSON payload. Falls through to
 * a keyword-heuristic if the LLM is unavailable so the UI is never empty.
 */
export async function runWebCallAnalysis(callId: string, session: any): Promise<any> {
  await pool.query(
    `UPDATE web_call_sessions SET analysis_status = 'RUNNING', updated_at = NOW() WHERE id = $1`,
    [callId]
  );

  const rows = await pool.query(
    'SELECT speaker, text, language FROM web_call_transcripts WHERE call_id = $1 ORDER BY sequence ASC',
    [callId]
  );
  const transcript = rows.rows
    .map((r: any) => `${r.speaker === 'agent' ? 'Agent' : 'User'}: ${r.text}`)
    .join('\n');

  let analysis: any = null;
  const aiUrl = process.env.AI_RUNTIME_URL || 'http://localhost:8000';
  try {
    const resp = await fetch(`${aiUrl}/chat/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        agent_id: session.agent_id,
        language: session.primary_language,
      }),
    });
    if (resp.ok) {
      analysis = await resp.json();
    }
  } catch (_err) {
    // fall through to heuristic
  }

  if (!analysis || typeof analysis !== 'object') {
    analysis = heuristicAnalysis(transcript);
  }

  const extractedFields = analysis.key_entities || analysis.extracted_fields || {};
  const saved = await pool.query(
    `INSERT INTO web_call_analysis (
        call_id, summary, detailed_summary, customer_intent, sentiment, interest_level,
        lead_score, objections, extracted_fields, next_best_action, follow_up_required,
        recommended_callback_time, agent_performance_score, raw_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (call_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        detailed_summary = EXCLUDED.detailed_summary,
        customer_intent = EXCLUDED.customer_intent,
        sentiment = EXCLUDED.sentiment,
        interest_level = EXCLUDED.interest_level,
        lead_score = EXCLUDED.lead_score,
        objections = EXCLUDED.objections,
        extracted_fields = EXCLUDED.extracted_fields,
        next_best_action = EXCLUDED.next_best_action,
        follow_up_required = EXCLUDED.follow_up_required,
        recommended_callback_time = EXCLUDED.recommended_callback_time,
        agent_performance_score = EXCLUDED.agent_performance_score,
        raw_payload = EXCLUDED.raw_payload
     RETURNING *`,
    [
      callId,
      analysis.short_summary || analysis.summary || '',
      analysis.detailed_summary || '',
      analysis.customer_intent || '',
      (typeof analysis.sentiment === 'string' ? analysis.sentiment.toUpperCase() : null),
      (typeof analysis.interest_level === 'string'
        ? analysis.interest_level.toUpperCase()
        : typeof analysis.interest_level === 'number'
          ? (analysis.interest_level >= 70 ? 'HIGH' : analysis.interest_level >= 40 ? 'MEDIUM' : 'LOW')
          : null),
      typeof analysis.lead_score === 'number' ? Math.round(analysis.lead_score) : null,
      Array.isArray(analysis.objections) ? JSON.stringify(analysis.objections) : '[]',
      JSON.stringify(extractedFields || {}),
      analysis.next_best_action || '',
      typeof analysis.follow_up_required === 'boolean' ? analysis.follow_up_required : null,
      analysis.recommended_callback_time || null,
      typeof analysis.qa_score === 'number'
        ? Math.round(analysis.qa_score)
        : typeof analysis.agent_performance_score === 'number'
          ? Math.round(analysis.agent_performance_score)
          : null,
      JSON.stringify(analysis),
    ]
  );

  await pool.query(
    `UPDATE web_call_sessions SET analysis_status = 'DONE', updated_at = NOW() WHERE id = $1`,
    [callId]
  );

  return shapeAnalysis(saved.rows[0]);
}

function heuristicAnalysis(transcript: string): any {
  const text = transcript.toLowerCase();
  const positive = /(great|good|yes|interested|sure|perfect|awesome|thanks|thank you)/.test(text);
  const negative = /(no|not interested|bad|cancel|stop|angry|frustrated)/.test(text);
  const sentiment = positive && !negative ? 'positive' : negative && !positive ? 'negative' : 'neutral';
  const interest = /(interested|more info|tell me|pricing|demo|callback)/.test(text) ? 'HIGH'
                : /(later|maybe|think about)/.test(text) ? 'MEDIUM' : 'LOW';
  return {
    short_summary: transcript.slice(0, 180),
    detailed_summary: transcript.slice(0, 600),
    customer_intent: interest === 'HIGH' ? 'Express interest / request info' : 'General inquiry',
    sentiment,
    interest_level: interest,
    lead_score: interest === 'HIGH' ? 75 : interest === 'MEDIUM' ? 50 : 25,
    objections: [],
    key_entities: {},
    next_best_action: interest === 'HIGH' ? 'Follow up within 24 hours' : 'Add to nurture sequence',
    follow_up_required: interest !== 'LOW',
    recommended_callback_time: null,
    agent_performance_score: 70,
  };
}

// GET /web-calls/ — list calls (paginated, filter by agent_id)
webCallRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const agentId = req.query.agent_id as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const params: any[] = [tenantId];
    let where = 'tenant_id = $1';
    if (agentId) {
      params.push(agentId);
      where += ` AND agent_id = $${params.length}`;
    }
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT * FROM web_call_sessions WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ items: rows.rows, page, limit });
  } catch (err) {
    next(err);
  }
});

export { webCallRecordingsDir };
