export const API_URL = import.meta.env.VITE_API_URL || '/api/v1';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3003/ws';

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: 'LayoutDashboard' },
  { label: 'Agents', path: '/agents', icon: 'Bot' },
  { label: 'Calls', path: '/calls', icon: 'Phone' },
  {
    label: 'CRM',
    icon: 'Users',
    children: [
      { label: 'Leads', path: '/crm/leads' },
      { label: 'Contacts', path: '/crm/contacts' },
      { label: 'Pipeline', path: '/crm/pipeline' },
    ],
  },
  { label: 'Knowledge', path: '/knowledge', icon: 'BookOpen' },
  { label: 'Voice Cloning', path: '/voice-cloning', icon: 'Mic' },
  { label: 'Workflows', path: '/workflows', icon: 'Workflow' },
  { label: 'Analytics', path: '/analytics', icon: 'BarChart3' },
  { label: 'Settings', path: '/settings', icon: 'Settings' },
] as const;

export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success-100 text-success-700',
  inactive: 'bg-gray-100 text-gray-600',
  draft: 'bg-warning-100 text-warning-700',
  new: 'bg-primary-100 text-primary-700',
  contacted: 'bg-blue-100 text-blue-700',
  qualified: 'bg-purple-100 text-purple-700',
  proposal: 'bg-warning-100 text-warning-700',
  won: 'bg-success-100 text-success-700',
  lost: 'bg-danger-100 text-danger-700',
  completed: 'bg-success-100 text-success-700',
  transferred: 'bg-blue-100 text-blue-700',
  voicemail: 'bg-warning-100 text-warning-700',
  dropped: 'bg-danger-100 text-danger-700',
  'no-answer': 'bg-gray-100 text-gray-600',
  positive: 'bg-success-100 text-success-700',
  neutral: 'bg-gray-100 text-gray-600',
  negative: 'bg-danger-100 text-danger-700',
  ready: 'bg-success-100 text-success-700',
  processing: 'bg-warning-100 text-warning-700',
  error: 'bg-danger-100 text-danger-700',
  processed: 'bg-success-100 text-success-700',
  failed: 'bg-danger-100 text-danger-700',
  invited: 'bg-warning-100 text-warning-700',
  disabled: 'bg-gray-100 text-gray-600',
};

export const VOICE_PROVIDERS = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'sarvam', label: 'Sarvam' },
  { value: 'cartesia', label: 'Cartesia' },
  { value: 'azure', label: 'Azure TTS' },
  { value: 'google', label: 'Google Cloud TTS' },
  { value: 'aws', label: 'Amazon Polly' },
];

export const STT_PROVIDERS = [
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'azure', label: 'Azure' },
  { value: 'whisper', label: 'OpenAI Whisper' },
  { value: 'google', label: 'Google Cloud STT' },
];

export const STT_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram: [
    { value: 'nova-2', label: 'Nova 2' },
    { value: 'nova-2-phonecall', label: 'Nova 2 Phonecall' },
    { value: 'enhanced', label: 'Enhanced' },
  ],
  azure: [{ value: 'default', label: 'Default' }],
  whisper: [
    { value: 'whisper-1', label: 'Whisper-1' },
    { value: 'whisper-large-v3', label: 'Whisper Large v3' },
  ],
  google: [{ value: 'latest_long', label: 'Latest Long' }],
};

export const VOICES: Record<string, { value: string; label: string }[]> = {
  elevenlabs: [
    { value: 'rachel', label: 'Rachel (Female)' },
    { value: 'adam', label: 'Adam (Male)' },
    { value: 'bella', label: 'Bella (Female)' },
    { value: 'josh', label: 'Josh (Male)' },
  ],
  azure: [
    { value: 'en-US-JennyNeural', label: 'Jenny (Female)' },
    { value: 'en-US-GuyNeural', label: 'Guy (Male)' },
  ],
  google: [
    { value: 'en-US-Neural2-C', label: 'Neural2-C (Female)' },
    { value: 'en-US-Neural2-D', label: 'Neural2-D (Male)' },
  ],
  aws: [
    { value: 'Joanna', label: 'Joanna (Female)' },
    { value: 'Matthew', label: 'Matthew (Male)' },
  ],
};

export const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'kn-IN', label: 'Kannada' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'mr-IN', label: 'Marathi' },
  { value: 'bn-IN', label: 'Bengali' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
];

export const WIZARD_VOICE_PROVIDERS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'cloned', label: 'Cloned Voices' },
  { id: 'elevenlabs', label: 'Eleven Labs' },
  { id: 'cartesia', label: 'Cartesia' },
  { id: 'google', label: 'Google' },
  { id: 'sarvam', label: 'Sarvam' },
];

export type WizardVoice = {
  id: string;
  name: string;
  provider: 'elevenlabs' | 'cartesia' | 'google' | 'sarvam' | 'cloned';
  gender: 'Feminine' | 'Masculine';
  languages: string[];
};

export const WIZARD_VOICES: WizardVoice[] = [
  { id: 'ramya', name: 'Ramya', provider: 'cartesia', gender: 'Feminine', languages: ['te-IN', 'hi-IN'] },
  { id: 'pavan', name: 'Pavan', provider: 'cartesia', gender: 'Masculine', languages: ['te-IN', 'hi-IN'] },
  { id: 'meera', name: 'Meera', provider: 'sarvam', gender: 'Feminine', languages: ['hi-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'bn-IN'] },
  { id: 'arjun', name: 'Arjun', provider: 'sarvam', gender: 'Masculine', languages: ['hi-IN', 'ta-IN', 'te-IN', 'kn-IN'] },
  { id: 'rachel', name: 'Rachel', provider: 'elevenlabs', gender: 'Feminine', languages: ['en-US', 'en-GB'] },
  { id: 'adam', name: 'Adam', provider: 'elevenlabs', gender: 'Masculine', languages: ['en-US', 'en-GB'] },
  { id: 'bella', name: 'Bella', provider: 'elevenlabs', gender: 'Feminine', languages: ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE'] },
  { id: 'josh', name: 'Josh', provider: 'elevenlabs', gender: 'Masculine', languages: ['en-US', 'en-GB'] },
  { id: 'en-US-Neural2-C', name: 'Neural2-C', provider: 'google', gender: 'Feminine', languages: ['en-US'] },
  { id: 'en-US-Neural2-D', name: 'Neural2-D', provider: 'google', gender: 'Masculine', languages: ['en-US'] },
  { id: 'hi-IN-Neural2-A', name: 'Neural2-A (Hindi)', provider: 'google', gender: 'Feminine', languages: ['hi-IN'] },
];

export const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳', label: 'India' },
  { code: '+1', flag: '🇺🇸', label: 'United States' },
  { code: '+44', flag: '🇬🇧', label: 'United Kingdom' },
  { code: '+61', flag: '🇦🇺', label: 'Australia' },
  { code: '+65', flag: '🇸🇬', label: 'Singapore' },
  { code: '+971', flag: '🇦🇪', label: 'UAE' },
  { code: '+49', flag: '🇩🇪', label: 'Germany' },
  { code: '+33', flag: '🇫🇷', label: 'France' },
  { code: '+81', flag: '🇯🇵', label: 'Japan' },
  { code: '+55', flag: '🇧🇷', label: 'Brazil' },
];

export const AGENT_TONES = [
  { value: 'professional', label: 'Professional & Friendly' },
  { value: 'warm', label: 'Warm & Empathetic' },
  { value: 'casual', label: 'Casual & Conversational' },
  { value: 'formal', label: 'Formal & Courteous' },
  { value: 'energetic', label: 'Energetic & Upbeat' },
];

export const AVAILABLE_TOOLS = [
  { id: 'calendar', name: 'Calendar Booking', description: 'Book appointments and manage calendar' },
  { id: 'crm_lookup', name: 'CRM Lookup', description: 'Search and update CRM records' },
  { id: 'knowledge_search', name: 'Knowledge Search', description: 'Search knowledge base documents' },
  { id: 'transfer', name: 'Call Transfer', description: 'Transfer call to human agent' },
  { id: 'sms', name: 'Send SMS', description: 'Send text messages to caller' },
  { id: 'email', name: 'Send Email', description: 'Send follow-up emails' },
  { id: 'webhook', name: 'Webhook', description: 'Trigger external webhooks' },
  { id: 'payment', name: 'Payment Collection', description: 'Collect payments via phone' },
];

export const PIPELINE_STAGES = [
  { id: 'discovery', name: 'Discovery', order: 0 },
  { id: 'qualification', name: 'Qualification', order: 1 },
  { id: 'proposal', name: 'Proposal', order: 2 },
  { id: 'negotiation', name: 'Negotiation', order: 3 },
  { id: 'closed_won', name: 'Closed Won', order: 4 },
];
