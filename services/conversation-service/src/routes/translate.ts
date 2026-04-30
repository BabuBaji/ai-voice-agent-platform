import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../index';

export const translateRouter = Router();

const AI_RUNTIME_URL = process.env.AI_RUNTIME_URL || 'http://localhost:8000';

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  ur: 'Urdu',
  or: 'Odia',
  as: 'Assamese',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  zh: 'Chinese (Mandarin)',
  ar: 'Arabic',
  ru: 'Russian',
};

translateRouter.get('/conversations/_translate/languages', (_req, res) => {
  res.json({
    languages: Object.entries(LANG_NAMES).map(([code, name]) => ({ code, name })),
  });
});

translateRouter.post(
  '/conversations/:id/translate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) {
        res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
        return;
      }
      const { id } = req.params;
      const target = String(req.body?.target_language || '').toLowerCase().trim();
      const force = req.body?.force === true;

      if (!target || !LANG_NAMES[target]) {
        res
          .status(400)
          .json({ error: 'unknown target_language', supported: Object.keys(LANG_NAMES) });
        return;
      }

      const conv = await pool.query(
        'SELECT id, metadata FROM conversations WHERE id = $1 AND tenant_id = $2',
        [id, tenantId],
      );
      if (conv.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
        return;
      }

      const cached = conv.rows[0].metadata?.translations?.[target];
      if (cached && !force) {
        res.json({ ...cached, cached: true });
        return;
      }

      const msgRows = await pool.query(
        `SELECT role, content
           FROM messages
          WHERE conversation_id = $1 AND role IN ('user','assistant')
       ORDER BY created_at ASC`,
        [id],
      );
      const sourceMessages: Array<{ role: 'user' | 'assistant'; content: string }> = msgRows.rows;
      if (sourceMessages.length === 0) {
        res
          .status(400)
          .json({ error: 'no transcript', message: 'No messages on this conversation to translate' });
        return;
      }

      const targetName = LANG_NAMES[target];
      // Plain numbered lines — no role tags. Gemini reliably preserves numbering
      // but often drops bracketed role tags, which used to make ~80% of lines
      // get parsed as "no match" and silently dropped. We zip back to source
      // roles by index after parsing.
      const numbered = sourceMessages
        .map((m, i) => `${i + 1}. ${m.content.replace(/\s+/g, ' ').trim()}`)
        .join('\n');

      const userPrompt =
        `Translate every numbered line below into ${targetName}. ` +
        `Lightly correct obvious speech-to-text errors. ` +
        `You MUST output exactly ${sourceMessages.length} numbered lines (1 to ${sourceMessages.length}), one per source line, in the same order. ` +
        `Do not merge, split, or skip lines. ` +
        `Output ONLY the numbered translated lines — no preamble, no commentary, no closing remarks.\n\n` +
        `Source lines:\n${numbered}`;

      const llmRes = await fetch(`${AI_RUNTIME_URL}/chat/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt:
            'You are a faithful call-transcript translator and copy-editor. You output only the requested translated lines.',
          messages: [{ role: 'user', content: userPrompt }],
          provider: 'google',
          model: 'gemini-2.5-flash',
          temperature: 0,
          // Indic scripts use ~3× more tokens per character than English; 8k
          // gives headroom for ~50-message transcripts in any script.
          max_tokens: 8192,
        }),
      });

      if (!llmRes.ok) {
        const txt = await llmRes.text().catch(() => '');
        res.status(502).json({
          error: 'translation_failed',
          message: `ai-runtime returned ${llmRes.status}`,
          detail: txt.slice(0, 400),
        });
        return;
      }

      const llmJson = (await llmRes.json()) as { reply?: string; provider?: string; mock?: boolean };
      const reply = String(llmJson.reply || '').trim();

      // Parse `12. translated text` → keyed by line number, then zip to source
      // roles by index. We key on the explicit number (instead of order in the
      // reply) so the result survives the LLM emitting blank lines between
      // entries or wrapping a long entry across two visual lines.
      const byNum = new Map<number, string>();
      let lastNum = -1;
      // Numbered line, optionally with a leftover [user]/[assistant] tag — we
      // no longer ask for the tag in the prompt but tolerate it if Gemini
      // emits one. Role tag wrapper is the whole `(?:\[?(?:user|assistant)\]?\s*[:\-]?\s*)?`
      // — the trailing `?` makes the entire tag block optional.
      const lineRe = /^\s*(\d+)[.)]\s*(?:\[?(?:user|assistant)\]?\s*[:\-]?\s*)?["“]?(.*?)["”]?$/i;
      for (const rawLine of reply.split(/\r?\n+/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const m = line.match(lineRe);
        if (m) {
          const num = Number(m[1]);
          byNum.set(num, m[2].trim());
          lastNum = num;
        } else if (lastNum > 0 && byNum.has(lastNum)) {
          // Continuation of the previous line (LLM hard-wrapped mid-thought).
          byNum.set(lastNum, (byNum.get(lastNum) || '') + ' ' + line);
        }
      }

      const translated: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      for (let i = 0; i < sourceMessages.length; i++) {
        const fromLLM = byNum.get(i + 1);
        translated.push({
          role: sourceMessages[i].role,
          // If the LLM dropped this specific line, fall back to the source so
          // the user still sees the message instead of a hole in the transcript.
          content: fromLLM && fromLLM.length > 0 ? fromLLM : sourceMessages[i].content,
        });
      }

      const droppedLines = translated.filter((t, i) => t.content === sourceMessages[i].content).length;

      const payload = {
        target_language: target,
        target_name: targetName,
        translated_at: new Date().toISOString(),
        provider: llmJson.mock ? 'mock' : llmJson.provider || 'gemini',
        messages: translated,
        dropped_lines: droppedLines,
      };

      // Cache under metadata.translations[<target>] so re-loading the page is instant.
      await pool.query(
        `UPDATE conversations
            SET metadata = jsonb_set(
                  jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{translations}',
                    COALESCE(metadata->'translations', '{}'::jsonb),
                    true
                  ),
                  ARRAY['translations', $1::text],
                  $2::jsonb,
                  true
                )
          WHERE id = $3 AND tenant_id = $4`,
        [target, JSON.stringify(payload), id, tenantId],
      );

      res.json({ ...payload, cached: false });
    } catch (err) {
      next(err);
    }
  },
);
