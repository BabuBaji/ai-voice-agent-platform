import api from './api';

export const voiceApi = {
  /**
   * Synthesize text to speech via voice-service (ElevenLabs).
   * Returns an object URL you can set as <audio src>.
   */
  synthesize: async (text: string, voiceId?: string): Promise<string> => {
    const res = await api.post(
      '/voice/synthesize',
      { text, voice_id: voiceId, output_format: 'mp3' },
      { responseType: 'blob' }
    );
    const blob = new Blob([res.data], { type: 'audio/mpeg' });
    // Empty body = TTS provider refused (e.g. missing permission / voice not found).
    // Throw so callers can fall back to browser TTS instead of a silent blob URL.
    if (blob.size < 100) {
      throw new Error('voice-service returned empty audio');
    }
    return URL.createObjectURL(blob);
  },

  /**
   * Transcribe an audio blob via voice-service (Deepgram).
   * Language should be a Deepgram code like "en", "te", "hi", "ta", "kn", "ml", "bn", "mr".
   */
  transcribe: async (
    audio: Blob,
    language: string = 'en'
  ): Promise<{ text: string; confidence: number; language: string; duration_seconds: number }> => {
    const form = new FormData();
    // Ensure a filename + correct MIME so FastAPI picks it up as UploadFile
    const ext = (audio.type.includes('ogg') ? 'ogg' : 'webm');
    const named = new File([audio], `chunk.${ext}`, { type: audio.type || 'audio/webm' });
    form.append('audio', named);
    form.append('language', language);
    // Let the browser set the multipart boundary automatically by explicitly clearing
    // the axios default JSON Content-Type header.
    const res = await api.post('/voice/transcribe', form, {
      headers: { 'Content-Type': undefined as any },
      transformRequest: (d) => d,
    });
    return res.data;
  },
};

// Convert our BCP-47 language codes to Deepgram codes
export function toDeepgramLang(bcp47: string): string {
  const base = bcp47.split('-')[0].toLowerCase();
  // Deepgram expects locale codes for some; base codes for others
  const map: Record<string, string> = {
    en: 'en',
    te: 'te',
    hi: 'hi',
    ta: 'ta',
    kn: 'kn',
    ml: 'ml',
    mr: 'mr',
    bn: 'bn',
    es: 'es',
    fr: 'fr',
    de: 'de',
    ja: 'ja',
    pt: 'pt',
  };
  return map[base] || 'en';
}
