import { Request, Response, NextFunction } from 'express';
import { pool } from '../index';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || 'http://localhost:8080';

// Best-effort feature lookup against identity-service. Returns:
//   true  → feature is allowed (or lookup failed in a way that fails open)
//   false → identity-service confirmed the feature is gated for this tenant
// We pass through the caller's auth header so identity-service can resolve
// the subscription for the right tenant. Cached responses come back fast,
// so a per-call lookup is cheap (<10ms in normal conditions).
async function tenantHasFeature(_tenantId: string, flag: string, auth: string | undefined): Promise<boolean> {
  if (!auth) return true;          // can't authenticate the lookup → fail open
  try {
    const r = await fetch(`${IDENTITY_SERVICE_URL}/billing/features`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return true;        // identity outage → fail open
    const data = await r.json() as { flags?: Record<string, boolean> };
    return !!data.flags?.[flag];
  } catch {
    return true;                   // network blip → fail open
  }
}

/**
 * Upload audio sample → ElevenLabs voice cloning → persist metadata.
 *
 * Request: multipart/form-data
 *   - audio: the voice sample file (required)
 *   - name, gender, language, description: form fields
 *
 * ElevenLabs Instant Voice Cloning (IVC) works on free tier (3 voices max).
 * The cloned voice_id returned is usable via their API for TTS.
 */
export async function createClonedVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const userId = req.headers['x-user-id'] as string | undefined;
    if (!tenantId) {
      res.status(400).json({ error: 'Bad Request', message: 'tenant required' });
      return;
    }

    // Plan-feature gate. Hits identity-service /billing/features and aborts
    // with 402 if the tenant's plan doesn't include voice_cloning. Falls
    // open if the lookup itself errors so a billing outage doesn't block
    // tenants that already have the feature.
    const allowed = await tenantHasFeature(tenantId, 'voice_cloning', req.headers['authorization'] as string | undefined);
    if (allowed === false) {
      res.status(402).json({
        error: 'Plan upgrade required',
        message: 'Voice cloning is part of the Pro plan. Upgrade to unlock.',
        feature: 'voice_cloning',
        required_plan: 'pro',
        upgrade_url: '/settings/pricing',
      });
      return;
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    const name = ((req.body.name as string) || '').trim();
    const gender = ((req.body.gender as string) || '').trim();
    const language = ((req.body.language as string) || '').trim();
    const description = ((req.body.description as string) || '').trim();

    if (!file) {
      res.status(400).json({ error: 'Bad Request', message: 'audio file is required' });
      return;
    }
    if (!name) {
      res.status(400).json({ error: 'Bad Request', message: 'name is required' });
      return;
    }
    if (file.size < 1000) {
      res.status(400).json({ error: 'Bad Request', message: 'audio file is too small (must be at least 1KB)' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      res.status(400).json({ error: 'Bad Request', message: 'audio file is too large (max 10MB)' });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    let providerVoiceId: string | null = null;
    let status = 'ready';
    let errorMessage: string | null = null;

    if (!apiKey) {
      status = 'error';
      errorMessage = 'ELEVENLABS_API_KEY not set; voice stored but not cloned remotely.';
    } else {
      // Forward to ElevenLabs /v1/voices/add
      try {
        const form = new FormData();
        const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'audio/mpeg' });
        form.append('name', name);
        if (description) form.append('description', description);
        if (language) form.append('labels', JSON.stringify({ language, gender }));
        form.append('files', blob, file.originalname || 'sample.mp3');

        const resp = await fetch(`${ELEVENLABS_API_URL}/voices/add`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: form as any,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          status = 'error';
          errorMessage = `ElevenLabs ${resp.status}: ${errText.slice(0, 300)}`;
        } else {
          const data = (await resp.json()) as { voice_id?: string };
          providerVoiceId = data.voice_id || null;
          if (!providerVoiceId) {
            status = 'error';
            errorMessage = 'ElevenLabs returned no voice_id';
          }
        }
      } catch (err: any) {
        status = 'error';
        errorMessage = `ElevenLabs call failed: ${err.message}`;
      }
    }

    const insert = await pool.query(
      `INSERT INTO cloned_voices (
        tenant_id, name, gender, language, description,
        provider, provider_voice_id, sample_audio, sample_mime,
        status, error_message, created_by
      ) VALUES ($1, $2, $3, $4, $5, 'elevenlabs', $6, $7, $8, $9, $10, $11)
      RETURNING id, tenant_id, name, gender, language, description,
                provider, provider_voice_id, sample_mime, status, error_message, created_at`,
      [
        tenantId,
        name,
        gender || null,
        language || null,
        description || null,
        providerVoiceId,
        file.buffer,
        file.mimetype || null,
        status,
        errorMessage,
        userId || null,
      ]
    );

    const row = insert.rows[0];
    const httpStatus = status === 'error' ? 502 : 201;
    if (status === 'error') {
      res.status(httpStatus).json({
        error: 'Voice Clone Failed',
        message: errorMessage || 'Cloning failed',
        ...row,
      });
    } else {
      res.status(httpStatus).json(row);
    }
  } catch (err) {
    next(err);
  }
}

export async function listClonedVoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const result = await pool.query(
      `SELECT id, tenant_id, name, gender, language, description,
              provider, provider_voice_id, sample_mime, status, error_message,
              created_at, updated_at
       FROM cloned_voices WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getClonedVoiceSample(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT sample_audio, sample_mime FROM cloned_voices WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (result.rows.length === 0 || !result.rows[0].sample_audio) {
      res.status(404).send('Not found');
      return;
    }
    const row = result.rows[0];
    res.setHeader('Content-Type', row.sample_mime || 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(row.sample_audio);
  } catch (err) {
    next(err);
  }
}

/**
 * Retry cloning a voice that previously failed (typically because the
 * ELEVENLABS_API_KEY wasn't loaded when the original sample was uploaded).
 * Reuses the stored sample_audio blob so the user doesn't have to re-record.
 */
export async function retryClonedVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    if (!tenantId) {
      res.status(400).json({ error: 'Bad Request', message: 'tenant required' });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      res.status(400).json({
        error: 'Missing Credentials',
        message: 'ELEVENLABS_API_KEY is not set on the server. Add it to .env and restart the agent service.',
      });
      return;
    }

    const found = await pool.query(
      `SELECT name, gender, language, description, sample_audio, sample_mime
         FROM cloned_voices
        WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (found.rows.length === 0) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    const row = found.rows[0];
    if (!row.sample_audio) {
      res.status(400).json({ error: 'Bad Request', message: 'No original sample audio on file; please re-upload.' });
      return;
    }

    // Call ElevenLabs /v1/voices/add with the stored sample
    const form = new FormData();
    const blob = new Blob([new Uint8Array(row.sample_audio)], { type: row.sample_mime || 'audio/mpeg' });
    form.append('name', row.name);
    if (row.description) form.append('description', row.description);
    if (row.language) form.append('labels', JSON.stringify({ language: row.language, gender: row.gender || '' }));
    form.append('files', blob, 'sample.mp3');

    let providerVoiceId: string | null = null;
    let status = 'ready';
    let errorMessage: string | null = null;
    try {
      const resp = await fetch(`${ELEVENLABS_API_URL}/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form as any,
      });
      if (!resp.ok) {
        status = 'error';
        errorMessage = `ElevenLabs ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 300)}`;
      } else {
        const data = (await resp.json()) as { voice_id?: string };
        providerVoiceId = data.voice_id || null;
        if (!providerVoiceId) { status = 'error'; errorMessage = 'ElevenLabs returned no voice_id'; }
      }
    } catch (err: any) {
      status = 'error';
      errorMessage = `ElevenLabs call failed: ${err.message}`;
    }

    const upd = await pool.query(
      `UPDATE cloned_voices
          SET provider_voice_id = $1,
              status            = $2,
              error_message     = $3,
              updated_at        = now()
        WHERE id = $4 AND tenant_id = $5
      RETURNING id, tenant_id, name, gender, language, description,
                provider, provider_voice_id, sample_mime, status, error_message,
                created_at, updated_at`,
      [providerVoiceId, status, errorMessage, id, tenantId],
    );

    if (status === 'error') {
      res.status(502).json({ error: 'Voice Clone Failed', message: errorMessage, ...upd.rows[0] });
    } else {
      res.status(200).json(upd.rows[0]);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Generate speech from arbitrary text using the cloned voice. Streams back
 * MP3 audio. The browser plays it through a Blob URL to preview the voice.
 *
 * Request body:
 *   { text: string, stability?: number, similarity?: number, speed?: number }
 *
 * Response: audio/mpeg bytes (or a JSON error).
 */
export async function testClonedVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    const body = (req.body || {}) as {
      text?: string;
      stability?: number;
      similarity?: number;
      speed?: number;
    };

    const text = String(body.text || '').trim();
    if (!text) {
      res.status(400).json({ error: 'Bad Request', message: 'text is required' });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: 'Bad Request', message: 'text too long (max 2000 chars)' });
      return;
    }

    const found = await pool.query(
      `SELECT provider, provider_voice_id, status FROM cloned_voices WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (found.rows.length === 0) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    const { provider, provider_voice_id, status } = found.rows[0];
    if (status !== 'ready' || !provider_voice_id) {
      res.status(409).json({ error: 'Voice not ready', message: 'Clone is not ready for synthesis yet' });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey || provider !== 'elevenlabs') {
      res.status(503).json({ error: 'Unavailable', message: 'Voice synthesis backend not configured' });
      return;
    }

    // Map our 0.5–2.0 speed slider onto ElevenLabs' `speed` voice setting
    // (accepted range 0.25–4.0; default 1.0). Stability / similarity_boost
    // map to the "tone" slider — higher stability = more consistent + less
    // expressive; higher similarity = closer to the original voice.
    const voiceSettings: Record<string, number | boolean> = {};
    if (typeof body.stability === 'number') voiceSettings.stability = Math.max(0, Math.min(1, body.stability));
    if (typeof body.similarity === 'number') voiceSettings.similarity_boost = Math.max(0, Math.min(1, body.similarity));
    if (typeof body.speed === 'number') voiceSettings.speed = Math.max(0.5, Math.min(2.0, body.speed));

    const resp = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${encodeURIComponent(provider_voice_id)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: Object.keys(voiceSettings).length > 0 ? voiceSettings : undefined,
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      res.status(502).json({
        error: 'Upstream TTS error',
        status: resp.status,
        message: err.slice(0, 400),
      });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    const buf = Buffer.from(await resp.arrayBuffer());
    res.send(buf);
  } catch (err) {
    next(err);
  }
}

/**
 * Attach this cloned voice to an agent. Updates agents.voice_config to set
 * voice_type='cloned' + the cloned voice id so the live-call and phone paths
 * use it during synthesis.
 */
export async function assignClonedVoiceToAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;
    const { agent_id, language, speed, tone } = (req.body || {}) as {
      agent_id?: string;
      language?: string;
      speed?: number;
      tone?: string;
    };

    if (!agent_id) {
      res.status(400).json({ error: 'Bad Request', message: 'agent_id required' });
      return;
    }

    const voice = await pool.query(
      `SELECT id, provider, provider_voice_id, name, language FROM cloned_voices WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (voice.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Voice not found' });
      return;
    }
    const v = voice.rows[0];

    const agent = await pool.query(
      `SELECT id, voice_config FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agent_id, tenantId]
    );
    if (agent.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
      return;
    }

    const current = agent.rows[0].voice_config || {};
    const nextConfig = {
      ...current,
      voice_type: 'cloned',
      provider: v.provider,
      cloned_voice_id: v.id,
      voice_id: v.provider_voice_id,
      voice_name: v.name,
      language: language || current.language || v.language || 'en',
      speed: typeof speed === 'number' ? speed : current.speed ?? 1.0,
      tone: tone || current.tone || 'natural',
    };

    await pool.query(
      `UPDATE agents SET voice_config = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(nextConfig), agent_id, tenantId]
    );

    res.json({ ok: true, voice_config: nextConfig });
  } catch (err) {
    next(err);
  }
}

export async function deleteClonedVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { id } = req.params;

    // Fetch voice to get provider_voice_id for remote deletion
    const found = await pool.query(
      `SELECT provider, provider_voice_id FROM cloned_voices WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (found.rows.length === 0) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }

    const { provider, provider_voice_id } = found.rows[0];

    // Delete from ElevenLabs if we have the id
    if (provider === 'elevenlabs' && provider_voice_id && process.env.ELEVENLABS_API_KEY) {
      try {
        await fetch(`${ELEVENLABS_API_URL}/voices/${provider_voice_id}`, {
          method: 'DELETE',
          headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        });
      } catch {
        // Ignore — local deletion still proceeds
      }
    }

    await pool.query(`DELETE FROM cloned_voices WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
