import { Pool } from 'pg';

/**
 * Initial content for the /docs hub. Idempotent: upserts by slug so editing
 * an article here and re-running the service will push the update.
 *
 * `link_to` — if present, the card/sidebar entry links directly to the given
 *    internal app path instead of opening the article detail page. Used for
 *    "Manage your agents" → /agents style shortcuts.
 * `is_featured` — shows the article in the grid on /docs home.
 */

type SeedArticle = {
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  icon: string;
  color: string;
  link_to?: string | null;
  is_new?: boolean;
  is_featured?: boolean;
  sort_order?: number;
};

type SeedSection = {
  slug: string;
  title: string;
  sort_order: number;
  articles: SeedArticle[];
};

const SECTIONS: SeedSection[] = [
  {
    slug: 'introduction',
    title: 'Introduction',
    sort_order: 10,
    articles: [
      {
        slug: 'overview',
        title: 'Overview',
        excerpt: 'A quick tour of the VoiceAgent platform and what you can build with it.',
        icon: 'BookOpen',
        color: 'sky',
        is_featured: false,
        sort_order: 10,
        body_md: `# VoiceAgent Overview

VoiceAgent is an end-to-end platform for building, launching, and operating AI voice agents. Use it to:

- Create AI agents that take inbound or outbound calls.
- Upload a knowledge base so agents can answer domain questions with RAG.
- Run bulk outbound campaigns over uploaded contact lists.
- Plug into your CRM, calendar, and helpdesk through integrations.
- Inspect call recordings, transcripts, and analytics dashboards.

The platform is polyglot under the hood — Node services for identity, agents, telephony, and notifications; Python for AI runtime, RAG, and voice.`,
      },
      {
        slug: 'getting-started',
        title: 'Getting Started',
        excerpt: 'Spin up your first voice agent in under five minutes.',
        icon: 'Rocket',
        color: 'sky',
        is_featured: true,
        sort_order: 20,
        body_md: `# Getting Started

1. **Create an agent.** Go to Agents → New Agent and follow the wizard.
2. **Buy a phone number.** Settings → Phone Numbers → Browse numbers and purchase one.
3. **Assign the number** to your agent and hit Publish.
4. **Test it** — call the number from your phone or use the web Test Call button.

That's the minimum path to a working voice agent. From there you can add a knowledge base, configure post-call actions, and wire up integrations.`,
      },
      {
        slug: 'platform-tour',
        title: 'Platform Tour',
        excerpt: 'Walk through every section of the dashboard so you know where things live.',
        icon: 'Sparkles',
        color: 'sky',
        sort_order: 30,
        body_md: `# Platform Tour

The sidebar is organized into five groups:

- **Voice AI Setup** — Agents, Knowledge Base, Voice Cloning.
- **Operations & Monitoring** — Calls, Campaigns, Workflows, CRM, Analytics.
- **Chat** — WhatsApp connectivity.
- **Account & Billing** — Phone numbers, integrations, team, billing, API keys.
- **Resources** — Documentation (you are here), support.`,
      },
      {
        slug: 'voices-languages',
        title: 'Voices & Languages',
        excerpt: 'Browse the 1000+ voices and 90+ languages available on the platform.',
        icon: 'Mic2',
        color: 'sky',
        sort_order: 40,
        body_md: `# Voices & Languages

Out of the box VoiceAgent supports:

- **Voices:** 1000+ via ElevenLabs + OpenAI TTS, including cloned voices you create yourself.
- **Languages:** 90+ languages and regional variants. The agent picks up the caller's language from the first utterance or from the campaign setting.

To browse the voice catalog, open any agent → Voice tab.`,
      },
    ],
  },

  {
    slug: 'core-features',
    title: 'Core Features',
    sort_order: 20,
    articles: [
      {
        slug: 'agents',
        title: 'Agents',
        excerpt: 'Create, configure, and publish AI agents for voice + chat.',
        icon: 'Bot',
        color: 'violet',
        link_to: '/agents',
        is_featured: true,
        sort_order: 10,
        body_md: `# Agents

Agents are the core unit. Each agent has:

- A system prompt describing its persona and objective.
- A voice (from the catalog or cloned).
- A model (GPT-4o, Claude, Llama, or a mock for demos).
- An optional knowledge base for RAG.
- Tools it can call during the conversation.

Create one at Agents → New Agent. Publish when ready — unpublished agents can only be tested from the dashboard.`,
      },
      {
        slug: 'calls',
        title: 'Calls',
        excerpt: 'Dial out, review recordings, and audit the transcript trail.',
        icon: 'PhoneCall',
        color: 'emerald',
        link_to: '/calls',
        is_featured: true,
        sort_order: 20,
        body_md: `# Calls

Every call — inbound or outbound — is logged with recording, transcript, and an AI summary. Filters let you slice by agent, phone number, outcome, or date range. Click any row for the detail view with inline recording playback, transcript turns, and the post-call AI analysis.`,
      },
      {
        slug: 'campaigns',
        title: 'Campaigns',
        excerpt: 'Upload contact lists and launch bulk outbound calling.',
        icon: 'Layers',
        color: 'amber',
        link_to: '/campaigns',
        is_featured: true,
        sort_order: 30,
        body_md: `# Campaigns

The campaign wizard walks you through:

1. Pick an agent and a phone number.
2. Upload a CSV of contacts (name, phone, optional custom fields).
3. Configure pacing, business hours, retry policy.
4. Review and launch.

Live campaigns show progress, success rate, and per-contact status.`,
      },
      {
        slug: 'knowledge-base',
        title: 'Knowledge Base',
        excerpt: 'Upload PDFs, docs, and URLs so agents can answer with RAG.',
        icon: 'Brain',
        color: 'pink',
        link_to: '/knowledge',
        is_featured: true,
        sort_order: 40,
        body_md: `# Knowledge Base

Upload PDFs, Word docs, plaintext, Markdown, or scrape a URL. The platform chunks and embeds the content so agents can ground their answers in your documentation.

A single tenant can have multiple knowledge bases — attach one per agent depending on what that agent needs to know.`,
      },
      {
        slug: 'voice-cloning',
        title: 'Voice Cloning',
        excerpt: 'Clone a voice from a short recording with ElevenLabs.',
        icon: 'Mic2',
        color: 'rose',
        link_to: '/voice-cloning',
        is_featured: true,
        sort_order: 50,
        body_md: `# Voice Cloning

Record or upload a 30-second sample; the platform fine-tunes an ElevenLabs voice model. The clone becomes selectable in any agent's voice picker. Cloning quality depends on audio quality — prefer a quiet room, consistent volume, no background music.`,
      },
      {
        slug: 'workflows',
        title: 'Workflows',
        excerpt: 'Visual builder for routing, tool calls, and escalations.',
        icon: 'Workflow',
        color: 'indigo',
        link_to: '/workflows',
        is_featured: true,
        sort_order: 60,
        body_md: `# Workflows

The workflow builder is a drag-and-drop canvas. Nodes include: AI turn, condition, tool call, human handoff, end. Use it to model complex conversations where the order of steps matters — KYC flows, collections, diagnostics.`,
      },
      {
        slug: 'analytics',
        title: 'Analytics',
        excerpt: 'Call volume, AHT, containment, and channel breakdowns.',
        icon: 'ScrollText',
        color: 'cyan',
        link_to: '/analytics',
        is_featured: true,
        sort_order: 70,
        body_md: `# Analytics

Track call volume and total duration over time, by channel (phone vs. chatbot). Filter by date presets (7/30/90 days) or a custom range. Drill down by agent to see per-agent KPIs.`,
      },
    ],
  },

  {
    slug: 'api-reference',
    title: 'API Reference',
    sort_order: 30,
    articles: [
      {
        slug: 'authentication',
        title: 'Authentication',
        excerpt: 'Mint a platform API key and authenticate your requests.',
        icon: 'KeyRound',
        color: 'yellow',
        is_featured: false,
        sort_order: 10,
        body_md: `# Authentication

Create a key at Settings → API. Keys are shown **once** at create time — store them in your secret manager.

\`\`\`bash
curl https://your-domain/api/v1/agents \\
  -H "Authorization: Bearer vk_your_api_key_here"
\`\`\`

Revoke a key from the same page; revocation is immediate.`,
      },
      {
        slug: 'api-agents',
        title: 'Agents API',
        excerpt: 'Programmatic CRUD for agents.',
        icon: 'Bot',
        color: 'violet',
        sort_order: 20,
        body_md: `# Agents API

\`\`\`
GET    /api/v1/agents          # list
POST   /api/v1/agents          # create
GET    /api/v1/agents/:id      # get
PUT    /api/v1/agents/:id      # update
DELETE /api/v1/agents/:id      # delete
POST   /api/v1/agents/:id/publish
\`\`\`

Request/response schemas live in the OpenAPI spec.`,
      },
      {
        slug: 'api-calls',
        title: 'Calls API',
        excerpt: 'Initiate outbound calls, pull recordings, list logs.',
        icon: 'PhoneCall',
        color: 'emerald',
        sort_order: 30,
        body_md: `# Calls API

\`\`\`
POST /api/v1/calls/initiate       # start an outbound call
GET  /api/v1/calls                # list call logs
GET  /api/v1/calls/:id            # detail with transcript
GET  /api/v1/calls/:id/recording  # signed recording URL
\`\`\``,
      },
      {
        slug: 'api-campaigns',
        title: 'Campaigns API',
        excerpt: 'Create and run campaigns programmatically.',
        icon: 'Layers',
        color: 'amber',
        sort_order: 40,
        body_md: `# Campaigns API

\`\`\`
POST /api/v1/campaigns            # create a campaign
POST /api/v1/campaigns/:id/start  # start dialing
POST /api/v1/campaigns/:id/pause  # pause
GET  /api/v1/campaigns/:id/stats  # progress
\`\`\``,
      },
      {
        slug: 'api-knowledge',
        title: 'Knowledge API',
        excerpt: 'Upload documents and trigger reindexing.',
        icon: 'Brain',
        color: 'pink',
        sort_order: 50,
        body_md: `# Knowledge API

\`\`\`
POST   /api/v1/knowledge/knowledge-bases
POST   /api/v1/knowledge/knowledge-bases/:id/documents
GET    /api/v1/knowledge/knowledge-bases/:id/documents
DELETE /api/v1/knowledge/knowledge-bases/:id/documents/:docId
\`\`\``,
      },
      {
        slug: 'webhooks',
        title: 'Webhooks',
        excerpt: 'Receive platform events (call.completed, campaign.finished, etc.).',
        icon: 'Webhook',
        color: 'orange',
        sort_order: 60,
        body_md: `# Webhooks

Register a URL at Settings → Integrations → Custom Webhook. The platform POSTs JSON events such as:

- \`call.completed\` — after every call
- \`campaign.finished\` — when a campaign run wraps
- \`voice_clone.ready\` — when a voice clone finishes processing

Each request is signed with an HMAC in the \`X-VA-Signature\` header. Verify it before trusting the payload.`,
      },
    ],
  },

  {
    slug: 'guides',
    title: 'Guides',
    sort_order: 40,
    articles: [
      {
        slug: 'numbers-shop',
        title: 'Numbers Shop',
        excerpt: 'Buy phone numbers from Plivo and Twilio without leaving the app.',
        icon: 'ShoppingBag',
        color: 'teal',
        link_to: '/settings/phone-numbers',
        is_new: true,
        is_featured: true,
        sort_order: 10,
        body_md: `# Numbers Shop

Pick a country, pick a provider (Plivo or Twilio), search for available numbers, click Buy. The number is provisioned directly into your account and ready to assign to an agent.

Indian numbers require KYC — the app will walk you through Plivo's compliance flow if needed.`,
      },
      {
        slug: 'conversational-flow',
        title: 'Conversational Flow',
        excerpt: 'Design multi-turn conversations with branching and tools.',
        icon: 'Workflow',
        color: 'indigo',
        sort_order: 20,
        body_md: `# Conversational Flow

Most of the time a system prompt + RAG is enough. When you need explicit ordering — e.g. a KYC flow that must ask for name, then DOB, then address — use the Workflow builder instead.`,
      },
      {
        slug: 'post-call-actions',
        title: 'Post-Call Actions',
        excerpt: 'Send SMS, book a meeting, or push to CRM after every call.',
        icon: 'Zap',
        color: 'amber',
        sort_order: 30,
        body_md: `# Post-Call Actions

Configure actions per agent. Supported actions include SMS confirmation, calendar invite via Cal.com, lead push into the CRM, and custom webhook. Actions run after the call.completed event fires.`,
      },
      {
        slug: 'web-chat-widget',
        title: 'Web Chat Widget',
        excerpt: 'Drop an embeddable chat widget on any website.',
        icon: 'MessageSquare',
        color: 'green',
        sort_order: 40,
        body_md: `# Web Chat Widget

Copy the script tag from Settings → Widget and paste it before \`</body>\`. Configure the agent, theme color, and greeting from the widget settings panel. Supports voice and text input.`,
      },
      {
        slug: 'custom-api',
        title: 'Custom API Tools',
        excerpt: 'Let an agent call your own HTTP API as a function tool.',
        icon: 'FileCode2',
        color: 'orange',
        sort_order: 50,
        body_md: `# Custom API Tools

Register a tool in the agent with name, description, JSON schema for arguments, and the target URL. The platform forwards the arguments as POST JSON and feeds the response back into the conversation.`,
      },
      {
        slug: 'excel-import',
        title: 'Excel Import',
        excerpt: 'Bulk-import contacts from Excel or CSV.',
        icon: 'FolderOpen',
        color: 'emerald',
        sort_order: 60,
        body_md: `# Excel Import

Supported columns: name, phone (E.164), email, plus any custom field. The importer previews the first rows so you can confirm column mapping before committing.`,
      },
      {
        slug: 'sip-trunking',
        title: 'SIP Trunking',
        excerpt: 'Bring your own SIP trunk for higher-volume or regional routing.',
        icon: 'Phone',
        color: 'teal',
        sort_order: 70,
        body_md: `# SIP Trunking

For production deployments you'll usually want your own trunk. Contact support to configure credentials and allowlist media IPs.`,
      },
      {
        slug: 'whatsapp',
        title: 'WhatsApp',
        excerpt: 'Connect an agent to WhatsApp via Cloud API or QR login.',
        icon: 'MessageSquare',
        color: 'green',
        link_to: '/chat/whatsapp',
        sort_order: 80,
        body_md: `# WhatsApp

Two options:

- **Cloud API** — official Meta Business, production-grade. Requires a verified business phone number.
- **QR login** — scan a QR with your phone to use WhatsApp Web. Great for demos; not recommended for production.`,
      },
      {
        slug: 'best-practices',
        title: 'Best Practices',
        excerpt: 'Tips learned the hard way running voice agents in production.',
        icon: 'LifeBuoy',
        color: 'pink',
        sort_order: 90,
        body_md: `# Best Practices

- Keep system prompts under 500 tokens; anything longer slows first-response latency.
- Put edge cases in the knowledge base, not the prompt.
- Set an explicit no-answer policy so the agent can gracefully escalate.
- Always enable recording; you'll need it for QA.
- Test with real accents and noisy phone lines before launch.`,
      },
    ],
  },

  {
    slug: 'integrations',
    title: 'Integrations',
    sort_order: 50,
    articles: [
      {
        slug: 'cal-com',
        title: 'Cal.com',
        excerpt: 'Book meetings directly from a call using Cal.com v2 API.',
        icon: 'Calendar',
        color: 'sky',
        link_to: '/settings/integrations',
        sort_order: 10,
        body_md: `# Cal.com

Connect at Settings → Integrations → Cal.com. Paste your Cal.com API key and pick an event type. Agents can then book time on that event type as a tool call.`,
      },
      {
        slug: 'google-calendar',
        title: 'Google Calendar',
        excerpt: 'OAuth into Google and let agents schedule to your calendar.',
        icon: 'Calendar',
        color: 'sky',
        link_to: '/settings/integrations',
        sort_order: 20,
        body_md: '# Google Calendar\n\nOAuth flow grants the platform scoped calendar.events permission. Tokens are encrypted at rest.',
      },
      {
        slug: 'slack',
        title: 'Slack',
        excerpt: 'Post call summaries into a Slack channel after every call.',
        icon: 'MessageSquare',
        color: 'violet',
        link_to: '/settings/integrations',
        sort_order: 30,
        body_md: '# Slack\n\nPaste an incoming webhook URL at Settings → Integrations → Slack. Choose which events trigger a post.',
      },
      {
        slug: 'hubspot',
        title: 'HubSpot',
        excerpt: 'Push call outcomes and transcripts into HubSpot CRM.',
        icon: 'Database',
        color: 'orange',
        link_to: '/settings/integrations',
        sort_order: 40,
        body_md: '# HubSpot\n\nUses the HubSpot private app token. Each call becomes a HubSpot Engagement on the matching contact.',
      },
      {
        slug: 'zapier',
        title: 'Zapier',
        excerpt: 'Hook VoiceAgent events into 6000+ apps via Zapier.',
        icon: 'Puzzle',
        color: 'orange',
        link_to: '/settings/integrations',
        sort_order: 50,
        body_md: '# Zapier\n\nUse the Webhooks by Zapier trigger with our custom webhook URL, or install the official VoiceAgent Zapier app (beta).',
      },
      {
        slug: 'custom-webhook',
        title: 'Custom Webhook',
        excerpt: 'Send every event to any HTTPS endpoint.',
        icon: 'Webhook',
        color: 'orange',
        sort_order: 60,
        body_md: '# Custom Webhook\n\nFall-back option when there is no built-in integration for your stack. See the Webhooks API reference for the payload schema.',
      },
    ],
  },
];

export async function seedDocs(pool: Pool): Promise<void> {
  const existing = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM doc_sections');
  const isFirstRun = parseInt(existing.rows[0]?.count || '0', 10) === 0;

  for (const section of SECTIONS) {
    // Upsert section
    const secRes = await pool.query<{ id: number }>(
      `INSERT INTO doc_sections (slug, title, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [section.slug, section.title, section.sort_order],
    );
    const sectionId = secRes.rows[0].id;

    for (const art of section.articles) {
      // On subsequent runs, only overwrite article content when empty in DB —
      // otherwise admins editing via a future CMS would lose their changes.
      // But on first run, we seed everything. We detect first run via the
      // initial section count check above.
      if (isFirstRun) {
        await pool.query(
          `INSERT INTO doc_articles
             (section_id, slug, title, excerpt, body_md, icon, color, link_to,
              is_new, is_featured, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (slug) DO NOTHING`,
          [
            sectionId, art.slug, art.title, art.excerpt, art.body_md,
            art.icon, art.color, art.link_to || null,
            !!art.is_new, !!art.is_featured, art.sort_order || 0,
          ],
        );
      } else {
        // Touch-up: make sure section mapping stays correct if it changed.
        await pool.query(
          `UPDATE doc_articles SET section_id = $1 WHERE slug = $2`,
          [sectionId, art.slug],
        );
      }
    }
  }
}
