import { Router, Request, Response } from 'express';

/**
 * Voice-preview route (additive, read-only). Synthesizes a short sample phrase
 * with a chosen provider + voice and returns a WAV the browser can play. Used
 * by the Super Admin → Voices page so an operator can audition every Sarvam
 * Bulbul v2 speaker and Deepgram Aura voice without placing a call.
 *
 * GET /api/v1/voice-preview?provider=sarvam|deepgram&voice=<name>&lang=<code>&text=<optional>
 *   → 200 audio/wav  |  502 when the provider key is missing/failed.
 *
 * Does NOT touch the live-call TTS path — it calls the provider HTTP APIs
 * directly with the same keys, so nothing in the call pipeline is affected.
 */
export const voicePreviewRouter = Router();

// Allow-lists mirror the voices surfaced on the Voices page. Guard against
// arbitrary speaker/model strings reaching the providers.
const SARVAM_VOICES = new Set(['anushka', 'abhilash', 'manisha', 'vidya', 'arya', 'karun', 'hitesh']);
const DEEPGRAM_AURA = new Set([
  'asteria', 'luna', 'stella', 'hera', 'athena', 'orion',
  'arcas', 'zeus', 'perseus', 'angus', 'orpheus', 'helios',
]);

const SARVAM_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'bn-IN', 'gu-IN', 'pa-IN', 'od-IN', 'as-IN']);

// Default sample text per language (kept short so previews are snappy).
const SAMPLE_BY_LANG: Record<string, string> = {
  'te-IN': 'నమస్తే! ఇది నా వాయిస్ ప్రివ్యూ. మీ అడ్మిషన్ సందేహాలకు నేను సహాయం చేస్తాను.',
  'hi-IN': 'नमस्ते! यह मेरी आवाज़ का प्रीव्यू है। मैं आपके दाखिले से जुड़े सवालों में मदद कर सकता हूँ।',
  'en-IN': 'Hi! This is a preview of my voice. I can help your callers with admissions enquiries.',
};

voicePreviewRouter.get('/', async (req: Request, res: Response) => {
  const provider = String(req.query.provider || '').toLowerCase();
  const voice = String(req.query.voice || '').toLowerCase();
  const lang = String(req.query.lang || 'te-IN');
  const customText = typeof req.query.text === 'string' ? req.query.text.slice(0, 400) : '';

  try {
    if (provider === 'sarvam') {
      if (!SARVAM_VOICES.has(voice)) return res.status(400).json({ error: 'Unknown Sarvam voice' });
      const apiKey = process.env.SARVAM_API_KEY;
      if (!apiKey) return res.status(502).json({ error: 'SARVAM_API_KEY not configured' });
      const targetLang = SARVAM_LANGS.has(lang) ? lang : 'te-IN';
      const text = customText || SAMPLE_BY_LANG[targetLang] || SAMPLE_BY_LANG['en-IN'];
      const r = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [text],
          target_language_code: targetLang,
          speaker: voice,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model: 'bulbul:v2',
          pace: 0.95,
          pitch: 0,
        }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        return res.status(502).json({ error: 'Sarvam TTS failed', status: r.status, detail: body.slice(0, 200) });
      }
      const data: any = await r.json().catch(() => null);
      const b64 = Array.isArray(data?.audios) ? data.audios[0] : null;
      if (!b64) return res.status(502).json({ error: 'Sarvam returned no audio' });
      const wav = Buffer.from(b64, 'base64'); // Sarvam returns a WAV container
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(wav);
    }

    if (provider === 'deepgram') {
      if (!DEEPGRAM_AURA.has(voice)) return res.status(400).json({ error: 'Unknown Deepgram voice' });
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) return res.status(502).json({ error: 'DEEPGRAM_API_KEY not configured' });
      const text = customText || SAMPLE_BY_LANG['en-IN'];
      const model = `aura-${voice}-en`;
      const r = await fetch(
        `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=linear16&container=wav&sample_rate=24000`,
        {
          method: 'POST',
          headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 1900) }),
        },
      );
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        return res.status(502).json({ error: 'Deepgram TTS failed', status: r.status, detail: body.slice(0, 200) });
      }
      const wav = Buffer.from(await r.arrayBuffer());
      if (wav.length < 200) return res.status(502).json({ error: 'Deepgram returned empty audio' });
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(wav);
    }

    return res.status(400).json({ error: 'provider must be sarvam or deepgram' });
  } catch (err: any) {
    return res.status(502).json({ error: 'Preview failed', detail: String(err?.message || err).slice(0, 200) });
  }
});
