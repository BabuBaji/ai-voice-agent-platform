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
  { value: 'azure', label: 'Azure TTS' },
  { value: 'google', label: 'Google Cloud TTS' },
  { value: 'aws', label: 'Amazon Polly' },
];

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
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
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
