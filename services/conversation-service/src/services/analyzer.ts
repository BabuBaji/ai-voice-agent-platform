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
    "customer_name": "" | extracted
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

export async function analyzeConversation(conversationId: string, tenantId: string): Promise<AnalysisResult> {
  const convRes = await pool.query(
    `SELECT id, agent_id, language, channel,
            COALESCE(duration_seconds,
                     EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::int,
                     0) AS duration_sec
     FROM conversations WHERE id = $1 AND tenant_id = $2`,
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

  await pool.query(
    `UPDATE conversations
     SET analysis = $1, summary = $2, sentiment = $3, interest_level = $4,
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

  return result;
}
