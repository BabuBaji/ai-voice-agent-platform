import { Router, Request, Response } from 'express';

export const landingRouter = Router();

const LANGUAGES = [
  'English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu', 'Odia',
];

const FEATURES = [
  { id: 'voice-agents', icon: 'Bot',           title: 'AI Voice Agents',  description: 'Spin up an inbound or outbound agent in minutes. Pick a template, customize the prompt, deploy.', href: '/agents' },
  { id: 'real-calls',   icon: 'PhoneCall',     title: 'Real Phone Calls', description: 'Plivo, Twilio, Exotel — your numbers, your minutes. Full call recording and AI analysis included.', href: '/settings/phone-numbers' },
  { id: 'chatbots',     icon: 'MessageSquare', title: 'Chatbot Widgets',  description: 'Embeddable text chatbot for any website. Same brain as your voice agent — lead capture, multi-language.', href: '/chatbots' },
  { id: 'knowledge',    icon: 'BookOpen',      title: 'Knowledge Base',   description: 'Upload PDFs, docs, and URLs. Your agent answers grounded in your content with inline citations.', href: '/knowledge' },
  { id: 'crm',          icon: 'Users',         title: 'Built-in CRM',     description: 'Every call lands in CRM with sentiment, lead score, and next-best-action — no integration needed.', href: '/crm/leads' },
  { id: 'analytics',    icon: 'BarChart3',     title: 'Deep Analytics',   description: 'Per-call sentiment, transcript, AI summary, and team-level dashboards out of the box.', href: '/analytics' },
];

const HOW_STEPS = [
  { id: 'describe',  icon: 'PenLine', title: 'Describe your agent',         description: 'Write a prompt or pick a starter template. Tone, opening line, and goals — all configurable.' },
  { id: 'configure', icon: 'Globe2',  title: 'Configure language & voice',  description: 'Pick from 14+ Indian languages and 50+ voices. Or clone your own brand voice in seconds.' },
  { id: 'deploy',    icon: 'Rocket',  title: 'Deploy & connect',            description: 'Get a phone number, embed a chat widget, or wire it to WhatsApp. Live in minutes.' },
];

const USE_CASES = [
  { id: 'sales',       icon: 'Briefcase',     title: 'Sales & Lead Qualification', description: 'Outbound calling, qualification, and warm hand-off to humans.' },
  { id: 'support',     icon: 'Headphones',    title: 'Customer Support',           description: '24×7 inbound support with knowledge-grounded answers.' },
  { id: 'bookings',    icon: 'CalendarPlus',  title: 'Appointments & Bookings',    description: 'Slot suggestions, confirmations, reminders, and reschedules.' },
  { id: 'orders',      icon: 'Package',       title: 'Order & Delivery Updates',   description: 'Status pings, OTP delivery, and exception handling at scale.' },
  { id: 'healthcare',  icon: 'Stethoscope',   title: 'Healthcare Triage',          description: 'Symptom intake, doctor matching, and follow-up reminders.' },
  { id: 'education',   icon: 'GraduationCap', title: 'Education & Coaching',       description: 'Admissions calls, course discovery, and student check-ins.' },
  { id: 'real-estate', icon: 'Landmark',      title: 'Real Estate & Loans',        description: 'Lead screening, KYC pre-checks, and document collection.' },
  { id: 'surveys',     icon: 'FileSignature', title: 'Surveys & Feedback',         description: 'NPS, CSAT, and post-call surveys with sentiment scoring.' },
];

const STATS = [
  { id: 'languages', value: '14+',    label: 'Indian Languages' },
  { id: 'latency',   value: '<500ms', label: 'Voice Latency' },
  { id: 'uptime',    value: '99.9%',  label: 'Uptime SLA' },
  { id: 'clones',    value: '50',     label: 'Free Voice Clones' },
];

const INTEGRATIONS = [
  { id: 'openai',     name: 'OpenAI',     kind: 'GPT · Whisper',    initials: 'AI', gradient: 'from-emerald-500 to-teal-600' },
  { id: 'gemini',     name: 'Gemini',     kind: 'Google AI · LLM',  initials: 'GG', gradient: 'from-blue-500 to-indigo-600' },
  { id: 'claude',     name: 'Claude',     kind: 'Anthropic · LLM',  initials: 'AC', gradient: 'from-orange-500 to-amber-600' },
  { id: 'sarvam',     name: 'Sarvam AI',  kind: 'Indic LLM/TTS',    initials: 'SA', gradient: 'from-purple-500 to-fuchsia-600' },
  { id: 'deepgram',   name: 'Deepgram',   kind: 'STT · TTS',        initials: 'DG', gradient: 'from-cyan-500 to-sky-600' },
  { id: 'elevenlabs', name: 'ElevenLabs', kind: 'Voice Cloning',    initials: '11', gradient: 'from-rose-500 to-pink-600' },
  { id: 'plivo',      name: 'Plivo',      kind: 'Telephony',        initials: 'PL', gradient: 'from-amber-500 to-orange-600' },
  { id: 'twilio',     name: 'Twilio',     kind: 'Telephony',        initials: 'TW', gradient: 'from-red-500 to-rose-600' },
];

const TESTIMONIALS = [
  { id: 't1', quote: 'We replaced our outbound calling team with a voice agent in two weeks. Same conversion, fraction of the cost.', author: 'Priya R.',   role: 'Founder, Lendly',         initials: 'PR', gradient: 'from-amber-500 to-rose-500' },
  { id: 't2', quote: "The Telugu and Tamil support was the dealbreaker for us. Customers feel like they're talking to a local.",     author: 'Karthik V.', role: 'Head of Ops, MetroCare',  initials: 'KV', gradient: 'from-blue-500 to-indigo-600' },
  { id: 't3', quote: 'Connected to our CRM in five minutes. Lead scores started flowing the same day. Felt like cheating.',          author: 'Anjali M.',  role: 'GTM Lead, Brewx',         initials: 'AM', gradient: 'from-emerald-500 to-teal-600' },
];

const NAV = {
  topProducts: [
    { label: 'Voice Agents',  href: '/agents' },
    { label: 'Chatbots',      href: '/chatbots' },
    { label: 'Phone Numbers', href: '/settings/phone-numbers' },
    { label: 'Knowledge',     href: '/knowledge' },
    { label: 'CRM',           href: '/crm/leads' },
    { label: 'Analytics',     href: '/analytics' },
  ],
  productMenu: [
    { label: 'Features',   href: '#features' },
    { label: 'Pricing',    href: '/pricing' },
    { label: 'Platform',   href: '#integrations' },
    { label: 'Customers',  href: '#testimonials' },
    { label: 'Resources',  href: '/docs' },
    { label: 'Free Tools', href: '/voice-cloning' },
  ],
};

// ── Per-feature detail records — shown in the info modal when a user
//    clicks a product entry in the landing-page header.
const FEATURE_DETAILS: Record<string, any> = {
  'voice-agents': {
    id: 'voice-agents',
    icon: 'Bot',
    title: 'AI Voice Agents',
    tagline: 'AI that picks up the phone — in 14 languages.',
    description:
      'Build inbound or outbound voice agents in minutes. Pick a template, customize the prompt, and deploy — agents handle qualification, support, bookings, and follow-ups end-to-end.',
    capabilities: [
      'Multi-language: English + 13 Indian languages out of the box',
      'Streaming TTS · <500 ms first-byte voice latency',
      'Inbound and outbound calling, both via the same agent',
      'Plivo, Twilio, Exotel telephony — your numbers, your minutes',
      'Stereo recording, transcript, and AI summary on every call',
      'Lead score + sentiment auto-attached to your CRM',
    ],
    metrics: [
      { value: '14+',    label: 'Languages' },
      { value: '<500ms', label: 'Voice latency' },
      { value: '99.9%',  label: 'Uptime' },
    ],
    primary_cta:   { label: 'Build my voice agent', href: '/register' },
    secondary_cta: { label: 'See live demo',         href: '/agents' },
    accent: 'from-amber-500 to-rose-500',
  },
  'chatbots': {
    id: 'chatbots',
    icon: 'MessageSquare',
    title: 'Chatbots',
    tagline: 'Embeddable text bot — same brain as your voice agent.',
    description:
      'Drop a chat widget on any website. Same prompt, same knowledge, same lead capture — deployable to web, WhatsApp, and your support email in minutes.',
    capabilities: [
      'One-line embed snippet — works on any website',
      'RAG-grounded answers from your knowledge base',
      'Lead-capture forms with custom fields',
      'Multi-language replies — auto-detects user language',
      'Hand-off to human agent with full conversation context',
      'Same agent definition for voice and chat',
    ],
    metrics: [
      { value: '<200ms', label: 'First token' },
      { value: '14+',    label: 'Languages' },
      { value: '1 line', label: 'To embed' },
    ],
    primary_cta:   { label: 'Build my chatbot', href: '/register' },
    secondary_cta: { label: 'See live demo',     href: '/chatbots' },
    accent: 'from-rose-500 to-pink-600',
  },
  'phone-numbers': {
    id: 'phone-numbers',
    icon: 'Phone',
    title: 'Phone Numbers',
    tagline: 'Bring your own numbers. Or rent ours.',
    description:
      'Connect Plivo, Twilio, or Exotel and assign numbers per agent. Inbound webhook, outbound dial, and full call recording — all wired up automatically.',
    capabilities: [
      'Plivo, Twilio, Exotel integrations — pick your provider',
      'India + US numbers; international support on request',
      'Per-agent number routing and answer-XML',
      'Inbound + outbound on the same number',
      'Stereo call recordings with caller / agent split',
      'Webhook events for ringing, answered, completed',
    ],
    metrics: [
      { value: '3',     label: 'Telcos supported' },
      { value: 'IN/US', label: 'Number coverage' },
      { value: '100%',  label: 'Recordings stored' },
    ],
    primary_cta:   { label: 'Connect a number',  href: '/register' },
    secondary_cta: { label: 'Provider docs',      href: '/docs' },
    accent: 'from-orange-500 to-amber-600',
  },
  'knowledge': {
    id: 'knowledge',
    icon: 'BookOpen',
    title: 'Knowledge Base',
    tagline: 'Upload your docs. Your agent reads them.',
    description:
      'PDFs, web pages, CSVs — your agent answers grounded in your content with inline citations. No prompt engineering required, no retraining, no vector-DB plumbing.',
    capabilities: [
      'PDF, DOCX, URL, CSV, plain-text ingestion',
      'Auto-chunked, embedded, and indexed',
      'Citation-backed answers in voice + chat',
      'Per-agent collections — share or isolate by tenant',
      'Real-time sync — re-ingest on document update',
      'Hybrid search (vector + keyword) under the hood',
    ],
    metrics: [
      { value: '5',      label: 'Source formats' },
      { value: '<2s',    label: 'Re-ingest' },
      { value: 'inline', label: 'Citations' },
    ],
    primary_cta:   { label: 'Upload my docs', href: '/register' },
    secondary_cta: { label: 'See knowledge UI', href: '/knowledge' },
    accent: 'from-emerald-500 to-teal-600',
  },
  'crm': {
    id: 'crm',
    icon: 'Users',
    title: 'Built-in CRM',
    tagline: 'Every conversation lands in CRM, scored and ready.',
    description:
      'Built-in lead pipeline that gets every call\'s sentiment, lead score, and next-best-action — with zero integration work. Bring your existing CRM later if you want.',
    capabilities: [
      'Auto-create lead per inbound or outbound call',
      'Kanban pipeline with custom stages',
      'Hot / warm / cold scoring from call sentiment',
      'Custom fields and tags per tenant',
      'Push to HubSpot, Zoho, Salesforce, Pipedrive',
      'Per-rep activity feed and follow-up reminders',
    ],
    metrics: [
      { value: 'auto',  label: 'Lead capture' },
      { value: '0',     label: 'Setup steps' },
      { value: '4+',    label: 'CRM exports' },
    ],
    primary_cta:   { label: 'Open my pipeline', href: '/register' },
    secondary_cta: { label: 'See CRM',          href: '/crm/leads' },
    accent: 'from-blue-500 to-indigo-600',
  },
  'analytics': {
    id: 'analytics',
    icon: 'BarChart3',
    title: 'Analytics',
    tagline: 'Per-call AI analysis, team-level dashboards.',
    description:
      'Sentiment, lead score, transcript, AI summary, and team-level performance — automatically computed and surfaced in dashboards out of the box.',
    capabilities: [
      'Per-call sentiment, summary, and follow-up actions',
      'Agent performance: handle time, conversion, QA score',
      'Conversion funnel from first call to closed lead',
      'Cost per call (LLM + voice + telephony combined)',
      'Recording playback with synced transcript',
      'Custom date ranges and CSV export',
    ],
    metrics: [
      { value: 'auto',   label: 'AI summary' },
      { value: '4+',     label: 'Dashboards' },
      { value: 'export', label: 'CSV ready' },
    ],
    primary_cta:   { label: 'See analytics live', href: '/register' },
    secondary_cta: { label: 'Dashboard preview',   href: '/analytics' },
    accent: 'from-purple-500 to-fuchsia-600',
  },
  'voice-cloning': {
    id: 'voice-cloning',
    icon: 'Mic',
    title: 'Voice Cloning',
    tagline: 'Clone your brand voice in 30 seconds.',
    description:
      'Upload a 30-second sample, get a custom voice your agent uses across every call. 50 free clones included with every account.',
    capabilities: [
      '30-second voice sample is enough',
      '50 free clones per tenant',
      'Streaming synthesis at <500ms',
      'Use the same voice across voice + chat (TTS)',
      'Multi-language cross-lingual cloning',
    ],
    metrics: [
      { value: '30s',  label: 'Sample needed' },
      { value: '50',   label: 'Free clones' },
      { value: '14+',  label: 'Languages' },
    ],
    primary_cta:   { label: 'Clone my voice', href: '/register' },
    secondary_cta: { label: 'Voice library',   href: '/voice-cloning' },
    accent: 'from-fuchsia-500 to-rose-500',
  },
  'workflows': {
    id: 'workflows',
    icon: 'Workflow',
    title: 'Workflows',
    tagline: 'Multi-step automations beyond a single call.',
    description:
      'Chain calls, SMS, email, and webhooks into automated flows — like "missed call → SMS → callback in 30 min". Visual builder, JSON-exportable.',
    capabilities: [
      'Visual node-based builder',
      'Triggers: call ended, lead created, time-based',
      'Actions: call, SMS, email, webhook, branch',
      'Per-tenant workflow library',
      'JSON-exportable definitions',
    ],
    metrics: [
      { value: '5+',    label: 'Trigger types' },
      { value: 'JSON',  label: 'Exportable' },
    ],
    primary_cta:   { label: 'Build a workflow', href: '/register' },
    secondary_cta: { label: 'See builder',       href: '/workflows' },
    accent: 'from-cyan-500 to-sky-600',
  },
  'campaigns': {
    id: 'campaigns',
    icon: 'Megaphone',
    title: 'Campaigns',
    tagline: 'Bulk outbound calling that actually scales.',
    description:
      'Upload a CSV of phone numbers, pick an agent, hit start. Per-call status, retry policy, and live progress all built in.',
    capabilities: [
      'CSV upload — up to 100k rows',
      'Concurrency limits per tenant + provider',
      'Retry policy: backoff + max attempts',
      'Live progress + per-call status',
      'Pause / resume / cancel mid-campaign',
    ],
    metrics: [
      { value: '100k',  label: 'Rows per CSV' },
      { value: 'live',  label: 'Progress' },
    ],
    primary_cta:   { label: 'Launch a campaign', href: '/register' },
    secondary_cta: { label: 'Campaigns UI',      href: '/campaigns' },
    accent: 'from-amber-500 to-orange-600',
  },
};

landingRouter.get('/api/v1/landing/features/:id', (req: Request, res: Response) => {
  const id = String(req.params.id || '').toLowerCase();
  const detail = FEATURE_DETAILS[id];
  if (!detail) {
    return res.status(404).json({ error: 'feature_not_found', id });
  }
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.json(detail);
});

// Public marketing data — used by /landing for the hero, features grid,
// testimonials, etc. Static for now; backed by an endpoint so the page can
// be CMS-driven later without further frontend changes.
landingRouter.get('/api/v1/landing/sections', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.json({
    languages: LANGUAGES,
    features: FEATURES,
    how_steps: HOW_STEPS,
    use_cases: USE_CASES,
    stats: STATS,
    integrations: INTEGRATIONS,
    testimonials: TESTIMONIALS,
    nav: NAV,
    updated_at: new Date().toISOString(),
  });
});

// Per-section endpoints — useful when a single section needs a refresh.
landingRouter.get('/api/v1/landing/features',     (_req, res) => res.json(FEATURES));
landingRouter.get('/api/v1/landing/how-steps',    (_req, res) => res.json(HOW_STEPS));
landingRouter.get('/api/v1/landing/use-cases',    (_req, res) => res.json(USE_CASES));
landingRouter.get('/api/v1/landing/stats',        (_req, res) => res.json(STATS));
landingRouter.get('/api/v1/landing/integrations', (_req, res) => res.json(INTEGRATIONS));
landingRouter.get('/api/v1/landing/testimonials', (_req, res) => res.json(TESTIMONIALS));
landingRouter.get('/api/v1/landing/languages',    (_req, res) => res.json(LANGUAGES));
landingRouter.get('/api/v1/landing/nav',          (_req, res) => res.json(NAV));
