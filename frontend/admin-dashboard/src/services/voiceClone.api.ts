import api from './api';
import { API_URL } from '@/utils/constants';

export interface ClonedVoice {
  id: string;
  tenant_id: string;
  name: string;
  gender: string | null;
  language: string | null;
  description: string | null;
  provider: string;
  provider_voice_id: string | null;
  sample_mime: string | null;
  status: 'ready' | 'error' | string;
  error_message: string | null;
  created_at: string;
  updated_at?: string;
}

export interface VoiceCloneQuota {
  used: number;
  limit: number;
  remaining: number | null; // null when has_unlimited is true
  has_unlimited: boolean;
  exhausted: boolean;
}

export const voiceCloneApi = {
  list: async (): Promise<ClonedVoice[]> => {
    const response = await api.get('/voice-clones');
    return response.data.data ?? response.data;
  },

  quota: async (): Promise<VoiceCloneQuota> => {
    const response = await api.get('/voice-clones/quota');
    return response.data;
  },

  create: async (payload: {
    audio: Blob;
    name: string;
    gender: string;
    language: string;
    description?: string;
  }): Promise<ClonedVoice> => {
    const form = new FormData();
    form.append('audio', payload.audio, 'sample.webm');
    form.append('name', payload.name);
    form.append('gender', payload.gender);
    form.append('language', payload.language);
    if (payload.description) form.append('description', payload.description);
    const response = await api.post('/voice-clones', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data ?? response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/voice-clones/${id}`);
  },

  retry: async (id: string): Promise<ClonedVoice> => {
    const response = await api.post(`/voice-clones/${id}/retry`);
    return response.data.data ?? response.data;
  },

  sampleUrl: (id: string): string => {
    // Browser will send the auth cookie / include headers via <audio> only if same-origin;
    // since the token is in Authorization header, we fetch as blob instead.
    return `${API_URL}/voice-clones/${id}/sample`;
  },

  fetchSample: async (id: string): Promise<Blob> => {
    const response = await api.get(`/voice-clones/${id}/sample`, { responseType: 'blob' });
    return response.data;
  },

  // Generate speech from arbitrary text using the cloned voice. Returns an
  // MP3 blob the caller plays through a Blob URL.
  test: async (
    id: string,
    payload: { text: string; speed?: number; stability?: number; similarity?: number }
  ): Promise<Blob> => {
    const response = await api.post(`/voice-clones/${id}/test`, payload, { responseType: 'blob' });
    return response.data;
  },

  // Attach this cloned voice to a specific agent. Backend updates
  // agents.voice_config so the call paths use the cloned voice for synthesis.
  assignToAgent: async (
    id: string,
    payload: { agent_id: string; language?: string; speed?: number; tone?: string }
  ): Promise<{ ok: true; voice_config: Record<string, unknown> }> => {
    const response = await api.post(`/voice-clones/${id}/assign-to-agent`, payload);
    return response.data;
  },
};
