import { pool } from '../index';
import { config } from '../config';
import { recordCallBilling } from './billing.client';

export interface AnalysisResult {
  // Legacy fields (kept for backwards compat with existing UI + columns).
  summary: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
  interest_level: number;
  topics: string[];
  follow_ups: string[];
  key_points: string[];
  outcome: string;

  // Richer CALL_RESULT / POST_CALL_ANALYSIS fields (stored in the
  // `conversations.analysis` JSONB so the UI can progressively surface them).
  short_summary?: string;
  detailed_summary?: string;
  customer_intent?: string;
  secondary_intents?: string[];
  objections?: string[];
  key_entities?: {
    budget?: string;
    timeline?: string;
    city?: string;
    product_interest?: string;
    appointment_time?: string;
    customer_name?: string;
    // Added so post-call auto-lead creation can fill the CRM row when the
    // caller volunteered these during the conversation.
    email?: string;
    alt_phone?: string;
    company?: string;
    // Specific to education / admissions campaigns: the university or
    // college the caller named as their preferred choice. Surfaces in the
    // CRM lead so the team knows which institution to follow up about.
    interested_university?: string;
  };
  lead_score?: string;
  conversion_probability?: string;
  next_best_action?: string;
  call_outcome?: string;
  follow_up_required?: boolean;
  follow_up_reason?: string;
  recommended_follow_up_time?: string;
  human_handoff_needed?: boolean;
  compliance_flags?: string[];
  qa_score?: string;
  agent_performance_notes?: string[];
  quality_risks?: string[];

  // Per-speaker conversation-quality scores (from the LLM analyzing the
  // transcript). Acoustic clarity + pitch stats live on analysis.voice_quality.
  conversation_quality?: {
    customer?: {
      understanding_score?: number;   // 0-100 how well customer understood agent
      engagement_score?: number;      // 0-100 how engaged/interested they were
      emotion?: string;               // calm | curious | frustrated | angry | confused | satisfied
      frustration_level?: string;     // none | mild | moderate | high
      pitch_impression?: string;      // one short phrase e.g. "steady and calm"
      notes?: string;
    };
    agent?: {
      clarity_score?: number;         // 0-100 how clear the agent's explanations were
      tone_score?: number;            // 0-100 how warm/appropriate the tone was
      pacing?: string;                // slow | natural | rushed
      pitch_impression?: string;      // e.g. "warm and even"
      notes?: string;
    };
    overall_note?: string;            // one-sentence verdict on how the conversation went
  };
}

function buildTranscript(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n');
}

function heuristicAnalyze(transcript: string, messages: Array<{ role: string; content: string }>): AnalysisResult {
  const allText = transcript.toLowerCase();
  const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const userText = userMessages.join(' ').toLowerCase();

  const positiveWords = ['great', 'good', 'thanks', 'thank you', 'awesome', 'perfect', 'love', 'excellent', 'happy', 'wonderful', 'yes', 'sure', 'absolutely', 'interested'];
  const negativeWords = ['bad', 'terrible', 'hate', 'awful', 'never', 'worst', 'problem', 'complaint', 'frustrated', 'angry', 'disappointed', 'not interested'];

  let pos = 0;
  let neg = 0;
  for (const w of positiveWords) if (userText.includes(w)) pos++;
  for (const w of negativeWords) if (userText.includes(w)) neg++;

  const sentiment: AnalysisResult['sentiment'] =
    pos > neg + 1 ? 'POSITIVE' : neg > pos + 1 ? 'NEGATIVE' : pos > 0 && neg > 0 ? 'MIXED' : 'NEUTRAL';

  const interestKeywords = ['pricing', 'demo', 'features', 'schedule', 'appointment', 'interested', 'sign up', 'buy', 'purchase'];
  let interestScore = 30;
  interestScore += userMessages.length * 8;
  for (const kw of interestKeywords) if (userText.includes(kw)) interestScore += 10;
  if (sentiment === 'POSITIVE') interestScore += 15;
  if (sentiment === 'NEGATIVE') interestScore -= 20;
  interestScore = Math.max(0, Math.min(100, interestScore));

  const topicKeywords: Record<string, string> = {
    pricing: 'Pricing',
    demo: 'Demo',
    features: 'Features',
    support: 'Support',
    billing: 'Billing',
    account: 'Account',
    integration: 'Integration',
    schedule: 'Scheduling',
    appointment: 'Appointment',
    product: 'Product',
    service: 'Service',
    healthcare: 'Healthcare',
    'real estate': 'Real Estate',
  };
  const topics: string[] = [];
  for (const [k, v] of Object.entries(topicKeywords)) {
    if (allText.includes(k)) topics.push(v);
  }
  if (topics.length === 0) topics.push('General Inquiry');

  const follow_ups: string[] = [];
  if (allText.includes('schedule') || allText.includes('appointment')) follow_ups.push('Confirm scheduled appointment via email/SMS');
  if (allText.includes('pricing') || allText.includes('price')) follow_ups.push('Send detailed pricing information');
  if (allText.includes('demo')) follow_ups.push('Prepare and send demo invite');
  if (allText.includes('email') || allText.includes('contact')) follow_ups.push('Add contact to CRM');
  if (sentiment === 'POSITIVE' && follow_ups.length === 0) follow_ups.push('Follow up within 24 hours while interest is warm');
  if (sentiment === 'NEGATIVE') follow_ups.push('Review transcript to identify friction point');
  if (follow_ups.length === 0) follow_ups.push('No immediate follow-up required');

  const key_points = userMessages.slice(0, 4).map((m) => m.length > 120 ? m.slice(0, 120) + '…' : m);

  const outcome = sentiment === 'POSITIVE' && interestScore >= 60
    ? 'Qualified Lead'
    : sentiment === 'NEGATIVE'
    ? 'Not Interested'
    : interestScore >= 40
    ? 'Needs Follow-up'
    : 'Information Inquiry';

  const summary = messages.length <= 1
    ? 'Brief call with minimal conversation.'
    : `${messages.length} message exchange. User discussed ${topics.join(', ')}. Overall sentiment was ${sentiment.toLowerCase()} with ${interestScore}% interest.`;

  return { summary, sentiment, interest_level: interestScore, topics, follow_ups, key_points, outcome };
}

/**
 * Ask Sarvam-M to emit the CALL_RESULT analysis JSON. Used when the agent's
 * configured LLM (via ai-runtime) is unavailable — Sarvam handles Indic +
 * English transcripts and always produces a real JSON object rather than the
 * keyword-heuristic fallback.
 */
async function callSarvamForAnalysis(systemPrompt: string, transcript: string): Promise<any | null> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript:\n${transcript}` },
        ],
        max_tokens: 1800,
        temperature: 0.2,
      }),
    });
    if (!resp.ok) return null;
    const body = await resp.json() as any;
    let raw = body?.choices?.[0]?.message?.content || '';
    if (!raw) return null;

    // Strip sarvam-m thinking blocks + JSON code fences.
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
    const openIdx = raw.toLowerCase().lastIndexOf('<think>');
    if (openIdx >= 0) raw = raw.slice(0, openIdx);
    raw = raw.trim();
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function llmAnalyze(transcript: string, language: string, agentId: string): Promise<AnalysisResult | null> {
  try {
    const systemPrompt = `You are the POST_CALL_ANALYSIS_MODE of an AI voice-agent platform. You analyze a completed phone-call transcript between the AI agent and a customer.

Return a STRICT JSON object — no prose, no code fences — with exactly these keys:

{
  // Legacy (must be present)
  "summary": "2-3 sentence summary in ${language}",
  "sentiment": "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED",
  "interest_level": integer 0-100,
  "topics": [1-6 short strings],
  "follow_ups": [1-5 concrete action items for the team],
  "key_points": [1-5 notable customer statements or facts],
  "outcome": "Qualified Lead" | "Demo Scheduled" | "Appointment Booked" | "Callback Requested" | "Not Interested" | "Voicemail" | "Wrong Number" | "Support Escalation" | "Transferred" | "Needs Follow-up" | "Information Inquiry",

  // Richer CALL_RESULT fields
  "short_summary": "1 sentence",
  "detailed_summary": "4-6 sentences",
  "customer_intent": "primary reason the customer called/was called",
  "secondary_intents": [0-3 secondary reasons],
  "objections": [e.g. "too expensive", "busy now", "not decision maker"],
  "key_entities": {
    "budget": "" | extracted,
    "timeline": "" | extracted,
    "city": "" | extracted,
    "product_interest": "" | extracted,
    "appointment_time": "" | extracted ISO or natural-language,
    "customer_name": "" | extracted,
    "email": "" | extracted (only if explicitly stated, must contain @),
    "alt_phone": "" | extracted (E.164 if possible, only if explicitly stated as alternate/secondary contact),
    "company": "" | extracted (employer or organization name only if stated),
    "interested_university": "" | extracted (the specific university/college the caller named as their preferred choice — e.g. "Joy University", "SRM Chennai", "Marwadi University". Empty string if they didn't name one or said "any" / "I don't know yet")
  },
  "lead_score": "HOT" | "WARM" | "COLD" | "UNQUALIFIED",
  "conversion_probability": "HIGH" | "MEDIUM" | "LOW",
  "next_best_action": "book_appointment" | "save_lead" | "schedule_callback" | "transfer_to_human" | "send_info" | "close_no_action" | "retry_later",
  "call_outcome": "same set as 'outcome' above",
  "follow_up_required": true | false,
  "follow_up_reason": "short reason or empty",
  "recommended_follow_up_time": "e.g. 'within 24h', 'next Monday 10am', or empty",
  "human_handoff_needed": true | false,
  "compliance_flags": [e.g. "caller_asked_dnd", "minor_on_call", "promised_unapproved_discount"] — empty array if none,
  "qa_score": "A" | "B" | "C" | "D",
  "agent_performance_notes": [0-3 short observations on what the AI did well / poorly],
  "quality_risks": [0-3 risks, e.g. "caller sounded frustrated", "agent repeated the same question"],
  "conversation_quality": {
    "customer": {
      "understanding_score": 0-100 — how well the customer understood the agent, inferred from their answers (clear relevant replies = high; "what?", "can you repeat?", "I don't understand" = low),
      "engagement_score": 0-100 — how engaged and interested the customer sounded (asked questions + stayed on topic = high; short one-word dismissive answers = low),
      "emotion": "calm" | "curious" | "frustrated" | "angry" | "confused" | "satisfied",
      "frustration_level": "none" | "mild" | "moderate" | "high",
      "pitch_impression": one short phrase describing how the customer's voice came across (e.g. "steady and curious", "tired and short-answered"),
      "notes": one short sentence with the main observation about the customer's voice/state
    },
    "agent": {
      "clarity_score": 0-100 — how clearly the agent explained things (on-topic, concise replies = high; rambling or repeating same question = low),
      "tone_score": 0-100 — warmth and appropriateness of the agent's tone,
      "pacing": "slow" | "natural" | "rushed",
      "pitch_impression": one short phrase describing the agent's delivery (e.g. "warm and even", "flat and robotic"),
      "notes": one short sentence about how the agent performed vocally
    },
    "overall_note": one sentence summarising how the conversation went between them
  }
}

Rules:
- Leave key_entities fields as empty string "" if not clearly stated — do not guess.
- If there's too little transcript to judge a field, use a conservative default (COLD lead, LOW probability, "close_no_action").
- Summaries must be in ${language}.
- Return ONLY the JSON object.`;

    // Try ai-runtime first (respects the agent's configured provider). If
    // that returns anything that looks like the heuristic fallback OR the
    // response is missing the rich fields (meaning the LLM is down and
    // ai-runtime degraded to _heuristic_analysis), ask Sarvam directly.
    let data: any = null;
    try {
      const res = await fetch(`${config.aiRuntimeUrl}/chat/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          language,
          agent_id: agentId,
          system_prompt: systemPrompt,
        }),
      });
      if (res.ok) data = await res.json();
    } catch { /* fall through to Sarvam */ }

    const looksLikeHeuristic = (d: any) =>
      !d || !d.summary ||
      // _heuristic_analysis doesn't produce the rich CALL_RESULT keys
      (d.short_summary === undefined && d.detailed_summary === undefined && d.lead_score === undefined);

    if (looksLikeHeuristic(data) && process.env.SARVAM_API_KEY) {
      const sarvamData = await callSarvamForAnalysis(systemPrompt, transcript);
      if (sarvamData) data = sarvamData;
    }

    if (!data || !data.summary) return null;

    const asStrArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    const asStr = (v: unknown, fallback = ''): string =>
      v === null || v === undefined ? fallback : String(v);

    return {
      // Legacy
      summary: asStr(data.summary),
      sentiment: (asStr(data.sentiment, 'NEUTRAL')).toUpperCase() as AnalysisResult['sentiment'],
      interest_level: Math.max(0, Math.min(100, parseInt(String(data.interest_level), 10) || 50)),
      topics: asStrArr(data.topics),
      follow_ups: asStrArr(data.follow_ups),
      key_points: asStrArr(data.key_points),
      outcome: asStr(data.outcome, 'Information Inquiry'),
      // Rich
      short_summary: asStr(data.short_summary),
      detailed_summary: asStr(data.detailed_summary),
      customer_intent: asStr(data.customer_intent),
      secondary_intents: asStrArr(data.secondary_intents),
      objections: asStrArr(data.objections),
      key_entities: {
        budget: asStr(data?.key_entities?.budget),
        timeline: asStr(data?.key_entities?.timeline),
        city: asStr(data?.key_entities?.city),
        product_interest: asStr(data?.key_entities?.product_interest),
        appointment_time: asStr(data?.key_entities?.appointment_time),
        customer_name: asStr(data?.key_entities?.customer_name),
        email: asStr(data?.key_entities?.email),
        alt_phone: asStr(data?.key_entities?.alt_phone),
        company: asStr(data?.key_entities?.company),
        interested_university: asStr(data?.key_entities?.interested_university),
      },
      lead_score: asStr(data.lead_score),
      conversion_probability: asStr(data.conversion_probability),
      next_best_action: asStr(data.next_best_action),
      call_outcome: asStr(data.call_outcome || data.outcome),
      follow_up_required: data.follow_up_required !== false,
      follow_up_reason: asStr(data.follow_up_reason),
      recommended_follow_up_time: asStr(data.recommended_follow_up_time),
      human_handoff_needed: data.human_handoff_needed === true,
      compliance_flags: asStrArr(data.compliance_flags),
      qa_score: asStr(data.qa_score),
      agent_performance_notes: asStrArr(data.agent_performance_notes),
      quality_risks: asStrArr(data.quality_risks),
      conversation_quality: {
        customer: {
          understanding_score: parseInt(String(data?.conversation_quality?.customer?.understanding_score), 10) || 0,
          engagement_score: parseInt(String(data?.conversation_quality?.customer?.engagement_score), 10) || 0,
          emotion: asStr(data?.conversation_quality?.customer?.emotion, 'calm'),
          frustration_level: asStr(data?.conversation_quality?.customer?.frustration_level, 'none'),
          pitch_impression: asStr(data?.conversation_quality?.customer?.pitch_impression),
          notes: asStr(data?.conversation_quality?.customer?.notes),
        },
        agent: {
          clarity_score: parseInt(String(data?.conversation_quality?.agent?.clarity_score), 10) || 0,
          tone_score: parseInt(String(data?.conversation_quality?.agent?.tone_score), 10) || 0,
          pacing: asStr(data?.conversation_quality?.agent?.pacing, 'natural'),
          pitch_impression: asStr(data?.conversation_quality?.agent?.pitch_impression),
          notes: asStr(data?.conversation_quality?.agent?.notes),
        },
        overall_note: asStr(data?.conversation_quality?.overall_note),
      },
    };
  } catch (_e) {
    return null;
  }
}

/**
 * Parse "within 24h" / "next Monday 10am" / "tomorrow afternoon" / ISO date
 * into an absolute Date. Best-effort — falls back to (now + 24h) when the
 * string is ambiguous. We avoid pulling in a heavy parser; the analyzer's
 * `recommended_follow_up_time` is short and from a finite set of phrasings.
 */
function parseFollowUpTime(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().toLowerCase();
  // ISO date / RFC3339
  const isoTry = new Date(raw);
  if (!isNaN(isoTry.getTime()) && /\d{4}-\d{2}-\d{2}/.test(raw)) return isoTry;
  const now = new Date();
  // "within N hours" / "in N hours" / "Nh"
  const m1 = s.match(/(?:within|in)\s+(\d+)\s*(h|hr|hours?|m|min|minutes?|d|days?)/);
  if (m1) {
    const n = parseInt(m1[1], 10);
    const unit = m1[2][0];
    const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
    return new Date(now.getTime() + ms);
  }
  // "tomorrow", "next week"
  if (s.includes('tomorrow')) {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    if (s.includes('afternoon')) d.setHours(15, 0, 0, 0);
    else if (s.includes('evening')) d.setHours(18, 0, 0, 0);
    return d;
  }
  if (s.includes('next week')) {
    const d = new Date(now); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0);
    return d;
  }
  // Default: +24h
  return new Date(now.getTime() + 24 * 3600000);
}

/**
 * Map LLM-emitted lead_score string to a 0-100 numeric score for the CRM
 * leads table. Falls back to interest_level if lead_score isn't set.
 */
function leadScoreToInt(leadScore: string | undefined, interestLevel: number): number {
  const ls = String(leadScore || '').toUpperCase();
  if (ls === 'HOT') return 85;
  if (ls === 'WARM') return 65;
  if (ls === 'COLD') return 35;
  if (ls === 'UNQUALIFIED') return 10;
  return Math.min(100, Math.max(0, Math.round(interestLevel) || 30));
}

/**
 * Map analyzer outcome → CRM lead status. Keeps the status meaningful for the
 * sales team's filtering (NEW → CONTACTED → QUALIFIED / UNQUALIFIED → WON / LOST).
 */
function outcomeToStatus(outcome: string | undefined): string {
  const o = String(outcome || '').toLowerCase();
  if (o.includes('not interested') || o.includes('wrong number')) return 'UNQUALIFIED';
  if (o.includes('voicemail')) return 'NEW';
  if (o.includes('callback')) return 'CONTACTED';
  if (o.includes('demo') || o.includes('appointment') || o.includes('booked')) return 'QUALIFIED';
  if (o.includes('qualified')) return 'QUALIFIED';
  if (o.includes('transferred')) return 'CONTACTED';
  if (o.includes('escalation')) return 'CONTACTED';
  return 'NEW';
}

/**
 * Auto-create a CRM Lead row from the analyzer's extracted key_entities. We
 * skip flat-out misfires (wrong-number / voicemail with no useful content)
 * and we link the call back via custom_fields.conversation_id. If the
 * analyzer also signalled follow_up_required, we schedule an Appointment
 * row in the CRM at recommended_follow_up_time so the team has a calendar
 * trigger instead of relying on someone to read the analysis.
 *
 * Best-effort — errors are logged but never propagate up. The analyzer
 * must continue to succeed even when CRM is down.
 */
async function createLeadFromAnalysis(
  conversationId: string,
  tenantId: string,
  conv: { agent_id?: string | null; channel?: string | null; direction?: string | null },
  result: AnalysisResult,
): Promise<void> {
  try {
    // Idempotency: if this conversation already has a CRM lead recorded on
    // its analysis blob, don't create a duplicate. The user can still
    // re-analyze to refresh the analysis JSON without spawning new leads.
    const existing = await pool.query(
      `SELECT analysis->>'crm_lead_id' AS lead_id FROM conversations WHERE id = $1`,
      [conversationId],
    );
    if (existing.rows[0]?.lead_id) return;

    // Skip leads with no extractable signal — wrong number, voicemail with empty transcript.
    const outcome = String(result.call_outcome || result.outcome || '').toLowerCase();
    if (outcome.includes('wrong number')) return;

    // Pull the prospect's phone number. For outbound, that's called_number;
    // for inbound, caller_number. We try both and prefer the non-business one.
    const phoneRes = await pool.query(
      `SELECT caller_number, called_number FROM conversations WHERE id = $1 LIMIT 1`,
      [conversationId],
    );
    const phones = phoneRes.rows[0] || {};
    const isOutbound = String(conv.direction || '').toUpperCase() === 'OUTBOUND';
    const prospectPhone = (isOutbound ? phones.called_number : phones.caller_number)
      || phones.called_number
      || phones.caller_number
      || null;

    const ke = result.key_entities || {};

    // Auto-lead gate: only create a CRM lead when the caller actually showed
    // interest AND volunteered the three pieces of identifying info — name,
    // email, mobile. Prevents the CRM from filling up with empty "Caller 1234"
    // placeholder rows for hang-ups and not-interested calls.
    const rawName = (ke.customer_name || '').trim();
    const rawEmail = (ke.email || '').trim();
    const rawAltPhone = (ke.alt_phone || '').trim();
    const validEmail = rawEmail.includes('@') && rawEmail.includes('.');
    const mobile = rawAltPhone || prospectPhone || '';
    const interested =
      ['HOT', 'WARM'].includes(String(result.lead_score || '').toUpperCase()) ||
      (typeof result.interest_level === 'number' && result.interest_level >= 50) ||
      outcome.includes('qualified') ||
      outcome.includes('appointment') ||
      outcome.includes('demo');
    if (!interested) {
      console.info(`[analyzer] auto-lead skipped — caller not interested (conv=${conversationId})`);
      return;
    }
    if (!rawName || !validEmail || !mobile) {
      console.info(
        `[analyzer] auto-lead skipped — incomplete contact info (conv=${conversationId}, name=${!!rawName}, email=${validEmail}, phone=${!!mobile})`,
      );
      return;
    }

    const parts = rawName.split(/\s+/);
    const first_name = parts[0];
    const last_name = parts.slice(1).join(' ') || '-';

    // Validation: check the captured contact fields against strict regex
    // patterns. Anything that doesn't match flags the lead for human review
    // instead of being saved as QUALIFIED — better that the sales team sees
    // a flagged row than a confident-but-wrong CRM entry.
    const STRICT_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    const STRICT_INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;
    // Normalise mobile to 10 digits by stripping common prefixes/punct.
    const mobileDigits = String(mobile).replace(/[^\d]/g, '');
    const mobileFor10 = mobileDigits.length === 12 && mobileDigits.startsWith('91')
      ? mobileDigits.slice(2)
      : mobileDigits;
    const reviewReasons: string[] = [];
    if (!STRICT_EMAIL_RE.test(rawEmail)) reviewReasons.push('email_format_invalid');
    if (!STRICT_INDIAN_MOBILE_RE.test(mobileFor10)) reviewReasons.push('mobile_format_invalid');
    if (first_name.length < 2) reviewReasons.push('name_too_short');
    // Confidence inferred from the analyzer's own signals — if the LLM
    // wasn't sure about lead score / interest_level it likely wasn't sure
    // about the other extractions either.
    if (typeof result.interest_level === 'number' && result.interest_level < 35) reviewReasons.push('low_interest_signal');
    if (String(result.conversion_probability || '').toUpperCase() === 'LOW') reviewReasons.push('low_conversion_probability');

    const needsReview = reviewReasons.length > 0;
    const baseStatus = outcomeToStatus(result.call_outcome || result.outcome);
    // CRM lead status: if any review reason fired, flag as NEEDS_REVIEW so the
    // sales team triages before treating it as a hot lead. The lead is still
    // created (don't lose data) — but it doesn't enter the QUALIFIED pipeline.
    const status = needsReview ? 'NEEDS_REVIEW' : baseStatus;
    const score = needsReview ? Math.min(50, leadScoreToInt(result.lead_score, result.interest_level || 0)) : leadScoreToInt(result.lead_score, result.interest_level || 0);

    if (needsReview) {
      console.info(
        `[analyzer] auto-lead flagged for human review (conv=${conversationId}, reasons=${reviewReasons.join(',')})`,
      );
    }

    const source = isOutbound
      ? 'outbound-call'
      : (String(conv.channel || '').toLowerCase() === 'web' ? 'web-call' : 'inbound-call');

    const tags: string[] = [];
    if (status === 'QUALIFIED') tags.push('interested');
    if (status === 'UNQUALIFIED') tags.push('not_interested');
    if (status === 'CONTACTED' && outcome.includes('callback')) tags.push('callback_requested');
    if (needsReview) tags.push('needs_review');

    const leadPayload = {
      first_name,
      last_name,
      email: rawEmail,
      // Use the normalised 10-digit form when valid; otherwise pass through
      // what we have so the team can still see what was heard.
      phone: STRICT_INDIAN_MOBILE_RE.test(mobileFor10) ? mobileFor10 : mobile,
      company: ke.company || null,
      source,
      status,
      score,
      tags,
      custom_fields: {
        conversation_id: conversationId,
        agent_id: conv.agent_id || null,
        alt_phone: ke.alt_phone || null,
        city: ke.city || null,
        budget: ke.budget || null,
        timeline: ke.timeline || null,
        product_interest: ke.product_interest || null,
        // Campaign capture: which specific university/college the caller named.
        // Surfaces in the CRM lead's View modal so the team knows what to
        // pitch in the follow-up.
        interested_university: ke.interested_university || null,
        appointment_time: ke.appointment_time || null,
        objections: result.objections || [],
        call_outcome: result.call_outcome || result.outcome,
        interest_level: result.interest_level,
        conversion_probability: result.conversion_probability,
        next_best_action: result.next_best_action,
        recommended_follow_up_time: result.recommended_follow_up_time,
        follow_up_reason: result.follow_up_reason,
        // Surfaces flagged-row triage signals to the sales team. Empty array
        // for clean leads.
        review_reasons: reviewReasons,
        needs_review: needsReview,
      },
    };

    let leadId: string | null = null;
    let leadCreateFailed = false;
    let leadCreateStatus = 0;
    let leadCreateError = '';
    try {
      const leadRes = await fetch(`${config.crmServiceUrl}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(leadPayload),
      });
      leadCreateStatus = leadRes.status;
      if (!leadRes.ok) {
        leadCreateError = (await leadRes.text().catch(() => '')).slice(0, 500);
        leadCreateFailed = true;
        console.warn(`[analyzer] auto-lead POST failed (${leadRes.status}): ${leadCreateError.slice(0, 200)}`);
      } else {
        const lead: any = await leadRes.json();
        leadId = lead?.id || lead?.data?.id || null;
      }
    } catch (err: any) {
      leadCreateFailed = true;
      leadCreateError = String(err?.message || err);
      console.warn(`[analyzer] auto-lead POST threw: ${leadCreateError.slice(0, 200)}`);
    }

    // On CRM POST failure, enqueue for the background retry sweeper. This
    // guarantees the lead survives a CRM outage — the sweeper retries with
    // exponential backoff up to max_attempts. Without this, leads from
    // calls that ended during a CRM hiccup were lost permanently.
    if (leadCreateFailed) {
      try {
        await pool.query(
          `INSERT INTO crm_lead_retry_queue
             (tenant_id, conversation_id, payload, kind, status, attempts, next_attempt_at, last_error, last_status_code)
           VALUES ($1, $2, $3::jsonb, 'lead', 'PENDING', 1, NOW() + INTERVAL '60 seconds', $4, $5)`,
          [tenantId, conversationId, JSON.stringify(leadPayload), leadCreateError, leadCreateStatus || null],
        );
        console.info(`[analyzer] auto-lead enqueued for retry (conv=${conversationId}, status=${leadCreateStatus})`);
      } catch (qe: any) {
        console.warn(`[analyzer] failed to enqueue lead retry: ${qe.message}`);
      }
      return;
    }

    if (!leadId) return;

    // Persist the lead id on the analysis JSONB so the next re-analyze
    // doesn't create a duplicate. Best-effort.
    try {
      await pool.query(
        `UPDATE conversations
         SET analysis = COALESCE(analysis, '{}'::jsonb) || $1::jsonb
         WHERE id = $2 AND tenant_id = $3`,
        [JSON.stringify({ crm_lead_id: leadId }), conversationId, tenantId],
      );
    } catch (_e) { /* non-fatal */ }

    // Schedule callback appointment for every interested lead. The interest
    // gate above already ran (we only reach this code for HOT/WARM / 50+
    // interest), so by definition we want a follow-up scheduled. The LLM
    // may or may not have set follow_up_required — if it didn't, we still
    // book the callback at a sensible default time. The agent never decides
    // "skip the follow-up for this interested caller"; that's a CRM-side
    // decision the team can override after the fact.
    const followTimeRaw = result.recommended_follow_up_time || ke.appointment_time || 'tomorrow 10:00 AM';
    const when = parseFollowUpTime(followTimeRaw) || (() => {
      // Hard default: next business day at 10am local.
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      return d;
    })();
    const apptPayload = {
      lead_id: leadId,
      title: 'Callback (auto-scheduled from interested caller)',
      scheduled_at: when.toISOString(),
      duration_minutes: 15,
      notes: result.follow_up_reason || result.next_best_action || result.short_summary || '',
      conversation_id: conversationId,
    };
    try {
      const apptRes = await fetch(`${config.crmServiceUrl}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(apptPayload),
      });
      if (!apptRes.ok) {
        const apptBody = (await apptRes.text().catch(() => '')).slice(0, 500);
        console.warn(`[analyzer] appointment POST failed (${apptRes.status}): ${apptBody.slice(0, 200)} — enqueuing retry`);
        await pool.query(
          `INSERT INTO crm_lead_retry_queue
             (tenant_id, conversation_id, payload, kind, related_lead_id, status, attempts, next_attempt_at, last_error, last_status_code)
           VALUES ($1, $2, $3::jsonb, 'appointment', $4, 'PENDING', 1, NOW() + INTERVAL '60 seconds', $5, $6)`,
          [tenantId, conversationId, JSON.stringify(apptPayload), leadId, apptBody, apptRes.status],
        );
      }
    } catch (apptErr: any) {
      console.warn(`[analyzer] appointment POST threw: ${apptErr.message} — enqueuing retry`);
      try {
        await pool.query(
          `INSERT INTO crm_lead_retry_queue
             (tenant_id, conversation_id, payload, kind, related_lead_id, status, attempts, next_attempt_at, last_error)
           VALUES ($1, $2, $3::jsonb, 'appointment', $4, 'PENDING', 1, NOW() + INTERVAL '60 seconds', $5)`,
          [tenantId, conversationId, JSON.stringify(apptPayload), leadId, String(apptErr?.message || apptErr)],
        );
      } catch (qe: any) {
        console.warn(`[analyzer] failed to enqueue appointment retry: ${qe.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[analyzer] createLeadFromAnalysis error: ${err.message}`);
  }
}

export async function analyzeConversation(conversationId: string, tenantId: string): Promise<AnalysisResult> {
  // conversations doesn't have a direction column — pull it from the
  // linked calls row (LEFT JOIN so web/chat conversations still work).
  const convRes = await pool.query(
    `SELECT c.id, c.agent_id, c.language, c.channel,
            ca.direction,
            COALESCE(c.duration_seconds,
                     EXTRACT(EPOCH FROM (COALESCE(c.ended_at, now()) - c.started_at))::int,
                     0) AS duration_sec
     FROM conversations c
     LEFT JOIN calls ca ON ca.conversation_id = c.id
     WHERE c.id = $1 AND c.tenant_id = $2
     LIMIT 1`,
    [conversationId, tenantId]
  );
  if (convRes.rows.length === 0) {
    throw new Error('Conversation not found');
  }
  const conv = convRes.rows[0];

  const msgRes = await pool.query(
    'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  );
  const messages = msgRes.rows as Array<{ role: string; content: string }>;
  const transcript = buildTranscript(messages);
  const language = conv.language || 'en-US';

  let result = transcript.trim()
    ? await llmAnalyze(transcript, language, conv.agent_id)
    : null;

  if (!result) {
    result = heuristicAnalyze(transcript, messages);
  }

  // JSONB merge instead of overwrite — preserves keys added by sibling
  // hooks (crm_lead_id, voice_quality, etc.) across re-analyze runs.
  await pool.query(
    `UPDATE conversations
     SET analysis = COALESCE(analysis, '{}'::jsonb) || $1::jsonb,
         summary = $2, sentiment = $3, interest_level = $4,
         topics = $5, follow_ups = $6, key_points = $7, outcome = $8
     WHERE id = $9 AND tenant_id = $10`,
    [
      JSON.stringify(result),
      result.summary,
      result.sentiment,
      result.interest_level,
      JSON.stringify(result.topics),
      JSON.stringify(result.follow_ups),
      JSON.stringify(result.key_points),
      result.outcome,
      conversationId,
      tenantId,
    ]
  );

  // Record billing for the call. Idempotent on (tenant_id, call_id) so
  // re-running analysis won't double-charge. Best-effort — any error is
  // swallowed inside recordCallBilling.
  const durationSec = Math.max(0, Number(conv.duration_sec) || 0);
  if (durationSec > 0) {
    const channelRaw = String(conv.channel || 'PHONE').toLowerCase();
    const channel: 'voice' | 'web' | 'chat' | 'whatsapp' =
      channelRaw === 'phone' ? 'voice'
      : channelRaw === 'web' ? 'web'
      : channelRaw === 'chat' ? 'chat'
      : channelRaw === 'whatsapp' ? 'whatsapp'
      : 'voice';
    void recordCallBilling({
      tenant_id: tenantId,
      call_id: conversationId,
      duration_sec: durationSec,
      agent_id: conv.agent_id || null,
      channel,
    });
  }

  // Fire-and-forget: convert the analysis into a CRM lead + optional
  // follow-up appointment. Failure is logged inside the helper so the
  // analyzer keeps returning to the caller normally.
  void createLeadFromAnalysis(
    conversationId,
    tenantId,
    {
      agent_id: conv.agent_id,
      channel: conv.channel,
      direction: (conv as any).direction || null,
    },
    result,
  );

  return result;
}
