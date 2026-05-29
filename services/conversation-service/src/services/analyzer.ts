import { pool } from '../index';
import { config } from '../config';
import { recordCallBilling } from './billing.client';
import { sendWhatsApp, sendSms } from './communications';
import { enqueueLeadRecall } from './recallScheduler';
import { maybeAutoSendBrochure } from './autoBrochure';

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
    // Admissions-specific extractions (post-call lead module v1).
    // All optional — the LLM emits empty strings when the caller didn't
    // volunteer the field, and createLeadFromAnalysis just won't fill
    // those CRM columns.
    interested_course?: string;        // 'BTech', 'BBA', 'Polytechnic', etc.
    interested_branch?: string;        // 'CSE', 'AI&DS', 'ECE', 'Mechanical'
    preferred_location?: string;       // 'Chennai', 'Hyderabad', 'anywhere in south India'
    intermediate_marks?: string;       // raw spoken value (e.g. '950/1000')
    intermediate_percentage?: string;  // e.g. '95%' or '95.5'
    eamcet_rank?: string;
    jee_rank?: string;
    diploma_status?: string;           // 'completed' | 'pursuing' | 'not applicable'
    category?: string;                 // 'OC' | 'BC' | 'SC' | 'ST' | 'EWS' | 'general'
    hostel_required?: string;          // 'yes' | 'no' | 'unsure'
    parent_name?: string;
    parent_mobile?: string;
    // Post-call action signals (booleans the LLM emits as strings sometimes).
    callback_required?: string;        // 'true' | 'false'
    counselor_meeting_required?: string;
    brochure_required?: string;
    whatsapp_required?: string;
    email_required?: string;
  };
  /**
   * Extended lead status enum required by the admissions module spec.
   * Set alongside `lead_score`. Driven by call_outcome + interest_level +
   * extracted entities. The legacy CRM `status` column maps from this.
   */
  lead_status?:
    | 'HOT_INTERESTED'
    | 'INTERESTED'
    | 'FOLLOW_UP_REQUIRED'
    | 'NOT_INTERESTED'
    | 'WRONG_NUMBER'
    | 'NO_ANSWER'
    | 'CALLBACK_SCHEDULED'
    | 'COUNSELOR_MEETING_REQUIRED'
    | 'BROCHURE_SENT';
  /** 0-1 score the LLM emits expressing confidence in the captured fields. */
  confidence_score?: number;
  /** Fields the agent should have captured but didn't (mobile, name, etc.). */
  missing_fields?: string[];
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
  if (!apiKey) {
    console.warn('[analyzer] callSarvamForAnalysis: SARVAM_API_KEY not set');
    return null;
  }
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
        // Disable Sarvam-M's <think> reasoning block — without these flags
        // the model wastes the entire max_tokens budget on internal reasoning
        // and the analysis JSON never makes it out. Same flags we use in the
        // live-call Sarvam path (services/telephony-adapter/.../sarvamSpeech.ts).
        enable_thinking: false,
        reasoning_effort: 'low',
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      console.warn(`[analyzer] callSarvamForAnalysis: HTTP ${resp.status} - ${errBody.slice(0, 200)}`);
      return null;
    }
    const body = await resp.json() as any;
    let raw = body?.choices?.[0]?.message?.content || '';
    if (!raw) {
      console.warn('[analyzer] callSarvamForAnalysis: empty content from Sarvam');
      return null;
    }

    // Strip sarvam-m thinking blocks + JSON code fences.
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
    const openIdx = raw.toLowerCase().lastIndexOf('<think>');
    if (openIdx >= 0) raw = raw.slice(0, openIdx);
    raw = raw.trim();
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      console.warn(`[analyzer] callSarvamForAnalysis: no JSON braces in response (raw preview: ${raw.slice(0, 200)})`);
      return null;
    }
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      console.info(`[analyzer] callSarvamForAnalysis: parsed OK (keys=${Object.keys(parsed).join(',')})`);
      return parsed;
    } catch (parseErr: any) {
      console.warn(`[analyzer] callSarvamForAnalysis: JSON.parse failed: ${parseErr?.message} (raw: ${raw.slice(start, end + 1).slice(0, 200)})`);
      return null;
    }
  } catch (err: any) {
    console.warn(`[analyzer] callSarvamForAnalysis: threw: ${err?.message || err}`);
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
    "interested_university": "" | extracted (the specific university/college the caller named as their preferred choice — e.g. "Joy University", "SRM Chennai", "Marwadi University". Empty string if they didn't name one or said "any" / "I don't know yet"),

    // ===== ADMISSIONS-SPECIFIC FIELDS (post-call lead module v1) =====
    // Extract these for B.Tech/B.E./Polytechnic/diploma admission calls.
    // Empty string when the caller didn't volunteer the value — do NOT
    // guess. These power the CRM lead's structured columns.
    "interested_course": "" | extracted ("BTech" | "BE" | "BBA" | "Polytechnic" | "Diploma" | etc),
    "interested_branch": "" | extracted ("CSE" | "AI&DS" | "ECE" | "Mechanical" | "Civil" | "Biotech" | etc),
    "preferred_location": "" | extracted (city/state — "Chennai", "Hyderabad", "south India", "anywhere"),
    "intermediate_marks": "" | extracted (raw value if caller said marks — e.g. "950 out of 1000", "950/1000"),
    "intermediate_percentage": "" | extracted (e.g. "95%" or "95.5"; convert "ninety five percent" → "95%"),
    "eamcet_rank": "" | extracted (digits only; "21,000" → "21000"),
    "jee_rank": "" | extracted (digits only),
    "diploma_status": "" | "completed" | "pursuing" | "not_applicable",
    "category": "" | "OC" | "BC" | "SC" | "ST" | "EWS" | "general",
    "hostel_required": "" | "yes" | "no" | "unsure",
    "parent_name": "" | extracted (only if the caller explicitly named their parent),
    "parent_mobile": "" | extracted (only if explicitly stated as parent's number),

    // ===== POST-CALL ACTION SIGNALS =====
    // Each is "true" or "false" as a string (NOT boolean — keeps the JSON
    // shape stable). Drive the post-call automation:
    //   callback_required → schedule follow_up_task type='call'
    //   counselor_meeting_required → schedule type='counselor_meeting'
    //   brochure_required → trigger brochure email
    //   whatsapp_required → trigger WhatsApp send
    //   email_required → trigger admission-details email
    "callback_required": "" | "true" | "false",
    "counselor_meeting_required": "" | "true" | "false",
    "brochure_required": "" | "true" | "false",
    "whatsapp_required": "" | "true" | "false",
    "email_required": "" | "true" | "false"
  },
  // Extended lead status — admissions module enum. Set this in addition to
  // lead_score/outcome. The post-call processor maps this to a CRM status
  // and uses it to decide what follow-up tasks to schedule.
  "lead_status": "HOT_INTERESTED" | "INTERESTED" | "FOLLOW_UP_REQUIRED" | "NOT_INTERESTED" | "WRONG_NUMBER" | "NO_ANSWER" | "CALLBACK_SCHEDULED" | "COUNSELOR_MEETING_REQUIRED" | "BROCHURE_SENT",
  // Overall extraction confidence 0.00–1.00 (the LLM's own judgement on
  // how reliably it parsed the caller's intent and details).
  "confidence_score": 0.00 to 1.00 — number,
  // List the critical fields the agent failed to capture, so the team
  // knows what to ask on the follow-up. Valid values: "student_name",
  // "mobile_number", "email", "interested_course", "interested_branch",
  // "interested_college", "intermediate_percentage", "eamcet_rank".
  // Empty array when nothing critical is missing.
  "missing_fields": [],
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

ENGLISH NORMALIZATION (CRITICAL):
- The conversation may be in Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, or any mix with English (Hinglish/Tenglish).
- EVERY value in key_entities MUST be in English / Latin script — never the caller's native script.
  - Transliterate names: "బాజీ బాబు" → "Baji Babu", "रहुल" → "Rahul", "ਪ੍ਰੀਤ" → "Preet"
  - Translate locations to their canonical English name: "హైదరాబాద్" → "Hyderabad", "बेंगलुरु" → "Bengaluru", "சென்னை" → "Chennai"
  - Translate branch/course names to standard English: "సిఎస్ఈ" → "Computer Science Engineering", "ईसीई" → "Electronics and Communication Engineering", "ఎఐడిఎస్" → "Artificial Intelligence and Data Science"
  - Email and phone are already ASCII — keep as-is.
  - If you can't confidently transliterate a name, output the closest phonetic English approximation (do NOT leave a non-Latin name in the field).
- The "summary", "short_summary", "detailed_summary", "customer_intent", "objections", "key_points", "follow_ups", "agent_performance_notes", "quality_risks", "follow_up_reason", "recommended_follow_up_time", and "next_best_action" fields ALSO must be in English regardless of conversation language.
- Only "conversation_quality.*.notes" and "conversation_quality.overall_note" can stay in the conversation's language (those describe HOW the caller spoke, not WHAT they said).

Return ONLY the JSON object.`;

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
        // Admissions-specific
        interested_course: asStr(data?.key_entities?.interested_course),
        interested_branch: asStr(data?.key_entities?.interested_branch),
        preferred_location: asStr(data?.key_entities?.preferred_location),
        intermediate_marks: asStr(data?.key_entities?.intermediate_marks),
        intermediate_percentage: asStr(data?.key_entities?.intermediate_percentage),
        eamcet_rank: asStr(data?.key_entities?.eamcet_rank),
        jee_rank: asStr(data?.key_entities?.jee_rank),
        diploma_status: asStr(data?.key_entities?.diploma_status),
        category: asStr(data?.key_entities?.category),
        hostel_required: asStr(data?.key_entities?.hostel_required),
        parent_name: asStr(data?.key_entities?.parent_name),
        parent_mobile: asStr(data?.key_entities?.parent_mobile),
        callback_required: asStr(data?.key_entities?.callback_required),
        counselor_meeting_required: asStr(data?.key_entities?.counselor_meeting_required),
        brochure_required: asStr(data?.key_entities?.brochure_required),
        whatsapp_required: asStr(data?.key_entities?.whatsapp_required),
        email_required: asStr(data?.key_entities?.email_required),
      },
      lead_status: (asStr(data.lead_status) || '').toUpperCase() as AnalysisResult['lead_status'],
      confidence_score: Math.max(0, Math.min(1, parseFloat(String(data.confidence_score)) || 0)),
      missing_fields: asStrArr(data.missing_fields),
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

/** Extract HH:MM (24h) from a free-text follow-up time. Returns null if unsure. */
function parsePreferredHHmm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  // "6 PM", "6pm", "18:00", "after 6pm"
  let m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (m) {
    const h = Math.min(23, parseInt(m[1], 10));
    const mm = Math.min(59, parseInt(m[2], 10));
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  m = s.match(/(\d{1,2})\s*(am|pm)/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[2] === 'pm' && h < 12) h += 12;
    if (m[2] === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
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
 * Derive the admissions-module extended lead status enum from the analyzer's
 * outputs. The LLM is asked to emit this directly via `lead_status`, but we
 * also compute a fallback from outcome + interest_level + entities so we
 * always have a value even when the LLM omits it. Returns one of:
 *   HOT_INTERESTED / INTERESTED / FOLLOW_UP_REQUIRED / NOT_INTERESTED
 *   / WRONG_NUMBER / NO_ANSWER / CALLBACK_SCHEDULED / COUNSELOR_MEETING_REQUIRED
 *
 * Priority:
 *   1. Explicit LLM-emitted lead_status (when valid)
 *   2. Outcome keywords (wrong number / no answer / qualified / etc.)
 *   3. Action signals in key_entities (counselor_meeting_required, callback_required)
 *   4. Interest level + lead_score
 */
function deriveExtendedLeadStatus(result: AnalysisResult): NonNullable<AnalysisResult['lead_status']> {
  const VALID = new Set([
    'HOT_INTERESTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED',
    'WRONG_NUMBER', 'NO_ANSWER', 'CALLBACK_SCHEDULED', 'COUNSELOR_MEETING_REQUIRED',
    'BROCHURE_SENT',
  ]);
  const direct = String(result.lead_status || '').toUpperCase();
  if (VALID.has(direct)) return direct as NonNullable<AnalysisResult['lead_status']>;

  const outcome = String(result.call_outcome || result.outcome || '').toLowerCase();
  if (outcome.includes('wrong number')) return 'WRONG_NUMBER';
  if (outcome.includes('voicemail') || outcome.includes('no answer')) return 'NO_ANSWER';
  if (outcome.includes('not interested')) return 'NOT_INTERESTED';

  const ke = result.key_entities || {};
  if (String(ke.counselor_meeting_required).toLowerCase() === 'true') return 'COUNSELOR_MEETING_REQUIRED';
  if (String(ke.callback_required).toLowerCase() === 'true' && outcome.includes('callback')) return 'CALLBACK_SCHEDULED';

  const lscore = String(result.lead_score || '').toUpperCase();
  const ilevel = Number(result.interest_level || 0);
  if (lscore === 'HOT' || ilevel >= 75) return 'HOT_INTERESTED';
  if (lscore === 'WARM' || ilevel >= 50) return 'INTERESTED';
  if (lscore === 'UNQUALIFIED') return 'NOT_INTERESTED';
  return 'FOLLOW_UP_REQUIRED';
}

/**
 * Map the admissions-module extended status to the CRM `leads.status` column
 * value. The CRM stores a free-form string, so this is a convenience
 * mapping — keeps the CRM filtering buckets consistent.
 */
function extendedStatusToCrmStatus(extended: string, needsReview: boolean): string {
  if (needsReview) return 'NEEDS_REVIEW';
  switch (extended) {
    case 'HOT_INTERESTED': return 'HOT_LEAD';
    case 'INTERESTED': return 'INTERESTED';
    case 'FOLLOW_UP_REQUIRED': return 'FOLLOW_UP_REQUIRED';
    case 'NOT_INTERESTED': return 'NOT_INTERESTED';
    case 'WRONG_NUMBER': return 'WRONG_NUMBER';
    case 'NO_ANSWER': return 'NO_ANSWER';
    case 'CALLBACK_SCHEDULED': return 'CALLBACK_SCHEDULED';
    case 'COUNSELOR_MEETING_REQUIRED': return 'COUNSELOR_MEETING';
    case 'BROCHURE_SENT': return 'BROCHURE_SENT';
    default: return 'NEW';
  }
}

/**
 * Merge the in-call slot store (caller-CONFIRMED captures from
 * conversations.metadata.captured_slots) into the analyzer's
 * key_entities. The slot store is HIGHER trust than LLM extraction
 * because each value passed through the agent's readback + caller's
 * verbal yes/no confirmation during the live call.
 *
 * Slot precedence:
 *  - confirmed=true slots OVERRIDE the LLM extraction
 *  - unconfirmed slots only FILL empty LLM fields
 *
 * Without this merge the LLM routinely returns empty strings for
 * fields the caller had already confirmed live, and the resulting
 * CRM lead has no name/email/mobile even when the conversation
 * captured them. Mutates `entities` in place.
 */
async function mergeSlotStoreOverEntities(
  conversationId: string,
  entities: AnalysisResult['key_entities'],
): Promise<{ confirmedSlots: string[]; unconfirmedSlots: string[] }> {
  if (!entities) return { confirmedSlots: [], unconfirmedSlots: [] };
  let slots: Record<string, { value: string; confidence: number; confirmed: boolean; source: string } | undefined> = {};
  try {
    const r = await pool.query(
      `SELECT metadata->'captured_slots' AS slots FROM conversations WHERE id = $1`,
      [conversationId],
    );
    slots = (r.rows[0]?.slots || {}) as any;
  } catch {
    return { confirmedSlots: [], unconfirmedSlots: [] };
  }

  // Map slot key → key_entities field name. Slot store names are runtime
  // names; key_entities uses the analyzer's stable column names.
  const MAP: Record<string, keyof NonNullable<AnalysisResult['key_entities']>> = {
    name: 'customer_name',
    email: 'email',
    mobile: 'alt_phone',           // caller-confirmed mobile lands in alt_phone slot;
                                   // primary phone for outbound is already called_number.
    city: 'city',
    course: 'interested_course',
    university: 'interested_university',
    callback_time: 'appointment_time',
  };

  // Slot keys whose values are pure ASCII (digits, email) — safe to override
  // the LLM extraction with the slot store, because there's no language
  // normalization needed and the caller-CONFIRMED value is ground truth.
  const ASCII_SAFE_SLOTS = new Set(['mobile', 'email']);
  // Heuristic: detect non-Latin script text. If the slot value contains
  // Devanagari / Telugu / Tamil / etc., let the LLM's transliterated form
  // win so the CRM stays in English — but only when the LLM actually
  // produced a value. If the LLM left the field empty, fall through to
  // the slot store (better to save the native-script form than nothing).
  const NON_LATIN_RE = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;

  const confirmedSlots: string[] = [];
  const unconfirmedSlots: string[] = [];
  for (const [slotKey, slot] of Object.entries(slots)) {
    if (!slot || !slot.value) continue;
    const field = MAP[slotKey];
    if (!field) continue;
    const isAsciiSafe = ASCII_SAFE_SLOTS.has(slotKey);
    const slotIsNonLatin = NON_LATIN_RE.test(slot.value);
    const llmHasValue = !!entities[field] && String(entities[field]).trim().length > 0;

    if (isAsciiSafe && slot.confirmed) {
      // Confirmed mobile/email — always use the slot store value (ASCII).
      (entities as any)[field] = slot.value;
      confirmedSlots.push(`${slotKey}=${slot.value}`);
    } else if (slot.confirmed && !slotIsNonLatin) {
      // Confirmed text slot in Latin script — slot wins.
      (entities as any)[field] = slot.value;
      confirmedSlots.push(`${slotKey}=${slot.value}`);
    } else if (slot.confirmed && slotIsNonLatin && !llmHasValue) {
      // Slot is non-Latin AND LLM left field empty — better to have the
      // native-script value than nothing. Surfaces in the CRM with the
      // raw text the caller spoke.
      (entities as any)[field] = slot.value;
      confirmedSlots.push(`${slotKey}=${slot.value}(native-fallback)`);
    } else if (slot.confirmed && slotIsNonLatin && llmHasValue) {
      // Slot is non-Latin but LLM produced an English transliteration —
      // the LLM wins (CRM stays English per spec). Slot value is logged
      // for audit only.
      confirmedSlots.push(`${slotKey}_native=${slot.value}|english=${entities[field]}`);
    } else if (!llmHasValue) {
      // Unconfirmed slot, LLM has nothing — fill the gap. Better than empty.
      (entities as any)[field] = slot.value;
      unconfirmedSlots.push(`${slotKey}=${slot.value}`);
    }
  }
  return { confirmedSlots, unconfirmedSlots };
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
/**
 * Recall / linked-lead handler. When a call was placed for an EXISTING lead
 * (recall scheduler threaded its lead_id through call metadata), we:
 *   1. link this conversation to that lead (no duplicate lead is created),
 *   2. refresh the lead's status + recall trace (merge — preserves brochure_*),
 *   3. run the brochure auto-send for THAT lead when interested. The brochure
 *      module's per-lead duplicate guard means an already-brochured lead is
 *      skipped (respect-dedup), so a recall only sends if it never went out.
 * Best-effort; never throws.
 */
async function handleLinkedRecallLead(
  conversationId: string,
  tenantId: string,
  conv: { agent_id?: string | null; direction?: string | null },
  result: AnalysisResult,
  leadId: string,
): Promise<void> {
  try {
    // 1. Link the recall conversation to the existing lead.
    await pool.query(
      `UPDATE conversations SET analysis = COALESCE(analysis, '{}'::jsonb) || $1::jsonb
       WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify({ crm_lead_id: leadId }), conversationId, tenantId],
    );

    const ke = result.key_entities || {};
    const extendedStatus = deriveExtendedLeadStatus(result);
    result.lead_status = extendedStatus;

    // 2. Load the existing lead for name/contact + interest context.
    let lead: any = null;
    try {
      const r = await fetch(`${config.crmServiceUrl}/leads/${leadId}`, { headers: { 'x-tenant-id': tenantId } });
      if (r.ok) lead = await r.json();
    } catch { /* best-effort */ }
    const cf = lead?.custom_fields || {};
    const firstName = (lead?.first_name && lead.first_name !== '-')
      ? lead.first_name
      : (String(ke.customer_name || ke.full_name || '').split(/\s+/)[0] || 'there');

    // 3. Enrich + refresh the existing lead from what the recall captured.
    //    Merge so we never wipe existing values (or brochure_sent_*); only
    //    fill/overwrite a field when the recall actually captured a value.
    try {
      const mergedCf: Record<string, any> = {
        ...cf,
        extended_lead_status: extendedStatus,
        last_recall_status: extendedStatus,
        last_recall_at: new Date().toISOString(),
        interest_level: result.interest_level ?? cf.interest_level,
      };
      const setIf = (key: string, val: any) => {
        const v = val == null ? '' : String(val).trim();
        if (v) mergedCf[key] = v;
      };
      // Admissions detail fields captured/confirmed on this recall.
      setIf('interested_university', ke.interested_university);
      setIf('interested_course', ke.interested_course);
      setIf('interested_branch', ke.interested_branch);
      setIf('preferred_location', ke.preferred_location);
      setIf('intermediate_marks', ke.intermediate_marks);
      setIf('intermediate_percentage', ke.intermediate_percentage);
      setIf('eamcet_rank', ke.eamcet_rank);
      setIf('jee_rank', ke.jee_rank);
      setIf('diploma_status', ke.diploma_status);
      setIf('category', ke.category);
      setIf('hostel_required', ke.hostel_required);
      setIf('parent_name', ke.parent_name);
      setIf('parent_mobile', ke.parent_mobile);
      setIf('city', ke.city);
      setIf('budget', ke.budget);
      setIf('timeline', ke.timeline);
      setIf('conversion_probability', result.conversion_probability);
      setIf('next_best_action', result.next_best_action);

      // Top-level columns: fill email only when the lead has none; upgrade a
      // placeholder name ("Contact 1" / "Caller 4795" / "-") to a real one.
      const body: Record<string, any> = { custom_fields: mergedCf };
      const capturedEmail = String(ke.email || '').trim();
      if (capturedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(capturedEmail) && !lead?.email) {
        body.email = capturedEmail;
      }
      const capturedName = String(ke.customer_name || ke.full_name || '').trim();
      const placeholderName = !lead?.first_name
        || ['contact', 'caller', '-'].some((p) => String(lead.first_name).toLowerCase().startsWith(p));
      if (capturedName && placeholderName) {
        const parts = capturedName.split(/\s+/);
        body.first_name = parts[0];
        body.last_name = parts.slice(1).join(' ') || '-';
      }

      await fetch(`${config.crmServiceUrl}/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(body),
      });
    } catch { /* best-effort */ }

    // 4. Brochure auto-send for the existing lead (interest-gated; deduped).
    const interestedStatuses = ['HOT_INTERESTED', 'INTERESTED', 'COUNSELOR_MEETING_REQUIRED', 'CALLBACK_SCHEDULED', 'BROCHURE_REQUESTED'];
    const interested =
      interestedStatuses.includes(String(extendedStatus || '').toUpperCase()) ||
      String(ke.brochure_required || '').toLowerCase() === 'true' ||
      String(ke.counselor_meeting_required || '').toLowerCase() === 'true' ||
      String(ke.callback_required || '').toLowerCase() === 'true';
    if (interested) {
      const phones = (await pool.query(
        `SELECT called_number, caller_number FROM conversations WHERE id = $1 LIMIT 1`, [conversationId],
      )).rows[0] || {};
      const rawPhone = String(
        (String(conv.direction || '').toUpperCase() === 'OUTBOUND' ? phones.called_number : phones.caller_number) || lead?.phone || '',
      );
      const digits = rawPhone.replace(/[^\d]/g, '');
      const e164 = rawPhone.startsWith('+') ? rawPhone : (digits.length === 10 ? `+91${digits}` : `+${digits}`);
      void maybeAutoSendBrochure({
        tenantId, leadId, conversationId, agentId: conv.agent_id || null,
        firstName, email: lead?.email || ke.email || null, phoneE164: e164,
        extendedStatus,
        brochureRequired: String(ke.brochure_required || '').toLowerCase() === 'true',
        counselorMeetingRequired: String(ke.counselor_meeting_required || '').toLowerCase() === 'true',
        callbackRequired: String(ke.callback_required || '').toLowerCase() === 'true',
        college: ke.interested_university || cf.interested_university || null,
        course: ke.interested_course || cf.interested_course || null,
        branch: ke.interested_branch || cf.interested_branch || null,
        recommendedFollowUpTime: result.recommended_follow_up_time || null,
      });
    }
    console.info(`[analyzer] recall linked to existing lead=${leadId} (conv=${conversationId}, status=${extendedStatus}, interested=${interested})`);
  } catch (err: any) {
    console.warn(`[analyzer] handleLinkedRecallLead error: ${err?.message}`);
  }
}

async function createLeadFromAnalysis(
  conversationId: string,
  tenantId: string,
  conv: { agent_id?: string | null; channel?: string | null; direction?: string | null; linked_lead_id?: string | null },
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

    // Merge live-call slot store (caller-confirmed captures) over LLM
    // extraction. Mutates result.key_entities in place so BOTH the linked-recall
    // path and the normal lead-creation path pick up the higher-confidence values.
    if (!result.key_entities) result.key_entities = {};
    const slotMerge = await mergeSlotStoreOverEntities(conversationId, result.key_entities);
    if (slotMerge.confirmedSlots.length || slotMerge.unconfirmedSlots.length) {
      console.info(
        `[analyzer] slot store merged (conv=${conversationId}, confirmed=[${slotMerge.confirmedSlots.join(',')}], unconfirmed=[${slotMerge.unconfirmedSlots.join(',')}])`,
      );
    }

    // Recall / linked-lead path: this call was placed FOR an existing lead
    // (the recall scheduler threaded its lead_id through call metadata). Link
    // the conversation to that lead and act on it — never create a duplicate.
    // Normal inbound/outbound calls carry no linked_lead_id, so this branch is
    // skipped and the original lead-creation flow below runs unchanged.
    const linkedLeadId = conv.linked_lead_id || null;
    if (linkedLeadId) {
      await handleLinkedRecallLead(conversationId, tenantId, conv, result, linkedLeadId);
      return;
    }

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

    // CSV-name fallback. If the campaign uploaded a contacts CSV, the target
    // row carries the lead's name. The LLM doesn't always elicit a name on
    // the call (caller may volunteer details but not their own name), so we
    // fall back to the CSV-provided name when key_entities.customer_name is
    // empty. Without this, named CSV leads silently fail the auto-lead gate.
    let csvName = '';
    if (prospectPhone) {
      try {
        // Match on digits only — conversations stores called_number without
        // the leading '+', campaign_targets stores it with. Strip both sides.
        const tgt = await pool.query(
          `SELECT name FROM campaign_targets
           WHERE regexp_replace(phone_number, '\\D', '', 'g') = regexp_replace($1::text, '\\D', '', 'g')
             AND campaign_id IN (SELECT id FROM campaigns WHERE tenant_id = $2)
           ORDER BY last_attempt_at DESC NULLS LAST LIMIT 1`,
          [prospectPhone, tenantId],
        );
        csvName = (tgt.rows[0]?.name || '').trim();
      } catch { /* non-fatal — name fallback is best-effort */ }
    }

    // Auto-lead gate (relaxed per admissions-module spec). Critical fields are
    // name + mobile + interested_course/branch/college + interest_level. Email
    // is NOT critical (callers often don't volunteer it on the phone). Missing
    // non-critical fields → lead is still created, but flagged NEEDS_REVIEW
    // so the team can complete it on follow-up.
    const rawName = (ke.customer_name || '').trim() || csvName;
    const rawEmail = (ke.email || '').trim();
    const rawAltPhone = (ke.alt_phone || '').trim();
    // Prefer the number the customer explicitly gave during the call
    // (alt_phone from slot store) over the dialed number. Store both:
    // primary = confirmed mobile, alt = dialed number.
    const mobile = rawAltPhone || prospectPhone || '';
    const dialedNumber = isOutbound ? phones.called_number : phones.caller_number;
    // If alt_phone differs from the dialed number, keep both
    if (rawAltPhone && dialedNumber && rawAltPhone !== String(dialedNumber).replace(/\D/g, '').slice(-10)) {
      ke.alt_phone = '+91' + String(dialedNumber).replace(/\D/g, '').slice(-10);
    }
    const interested =
      ['HOT', 'WARM'].includes(String(result.lead_score || '').toUpperCase()) ||
      (typeof result.interest_level === 'number' && result.interest_level >= 50) ||
      outcome.includes('qualified') ||
      outcome.includes('appointment') ||
      outcome.includes('demo');

    // ── Strict admissions lead gate ───────────────────────────────────────
    // A call becomes a lead ONLY when the counsellor captured EVERY key
    // admissions field on the call: name, mobile, a valid email, the
    // college/course of interest, intermediate (12th) marks, and an entrance
    // exam result. A call that dropped mid-conversation cannot have all of
    // these, so it is naturally excluded. When anything is missing we do NOT
    // create a CRM lead — the post_call_lead_analysis audit row (lead_id null
    // + missing_fields) records it as an incomplete item for manual review,
    // kept out of the converted-leads pipeline.
    const present = (v: any) => String(v ?? '').trim().length > 0;
    const GATE_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    const requiredFieldOk: Record<string, boolean> = {
      name: present(rawName) && rawName.trim().length >= 2,
      mobile: present(mobile),
      email: present(rawEmail) && GATE_EMAIL_RE.test(rawEmail.trim()),
      college_or_course:
        present(ke.interested_university) || present(ke.interested_course) || present(ke.interested_branch),
      intermediate_marks: present(ke.intermediate_marks) || present(ke.intermediate_percentage),
      entrance_exam: present(ke.eamcet_rank) || present(ke.jee_rank),
    };
    const missingForLead = Object.entries(requiredFieldOk)
      .filter(([, ok]) => !ok)
      .map(([field]) => field);

    if (!interested || missingForLead.length > 0) {
      const reasons = [...missingForLead];
      if (!interested) reasons.push('not_interested');
      // Surface the gap on the analysis so the audit row / review queue show
      // exactly why this call did NOT convert to a lead.
      result.missing_fields = Array.from(new Set([...(result.missing_fields || []), ...missingForLead]));
      console.info(
        `[analyzer] strict lead gate: NOT a lead — incomplete call (conv=${conversationId}, missing=[${reasons.join(',')}])`,
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
    // Distinguish "missing" (nothing volunteered) from "format invalid"
    // (something WAS captured but doesn't pass regex).
    if (!rawEmail) reviewReasons.push('email_missing');
    else if (!STRICT_EMAIL_RE.test(rawEmail)) reviewReasons.push('email_format_invalid');
    if (!STRICT_INDIAN_MOBILE_RE.test(mobileFor10)) reviewReasons.push('mobile_format_invalid');
    if (first_name.length < 2) reviewReasons.push('name_too_short');
    // Confidence inferred from the analyzer's own signals — if the LLM
    // wasn't sure about lead score / interest_level it likely wasn't sure
    // about the other extractions either.
    if (typeof result.interest_level === 'number' && result.interest_level < 35) reviewReasons.push('low_interest_signal');
    if (String(result.conversion_probability || '').toUpperCase() === 'LOW') reviewReasons.push('low_conversion_probability');

    const needsReview = reviewReasons.length > 0;
    // Derive the admissions-module extended lead status (HOT_INTERESTED /
    // INTERESTED / etc.) and store BOTH it and the legacy CRM status. This
    // lets the sales UI filter by the new buckets while existing tooling
    // that reads the legacy column still works.
    const extendedStatus = deriveExtendedLeadStatus(result);
    // Stash the extended status onto the result object so the post-call
    // processor can write it into post_call_lead_analysis row + decide
    // which follow-up tasks to schedule.
    result.lead_status = extendedStatus;
    const status = extendedStatusToCrmStatus(extendedStatus, needsReview);
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
      // Email is optional per admissions spec — send null when missing so
      // the CRM doesn't store an empty string the team has to filter out.
      email: rawEmail || null,
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
        // Admissions module fields. All optional — CRM stores them in the
        // lead's custom_fields JSONB so the lead-detail UI can render them
        // when present. Drives counselor briefing + brochure choice.
        extended_lead_status: extendedStatus,
        interested_course: ke.interested_course || null,
        interested_branch: ke.interested_branch || null,
        preferred_location: ke.preferred_location || null,
        intermediate_marks: ke.intermediate_marks || null,
        intermediate_percentage: ke.intermediate_percentage || null,
        eamcet_rank: ke.eamcet_rank || null,
        jee_rank: ke.jee_rank || null,
        diploma_status: ke.diploma_status || null,
        category: ke.category || null,
        hostel_required: ke.hostel_required || null,
        parent_name: ke.parent_name || null,
        parent_mobile: ke.parent_mobile || null,
        // Post-call action signals
        callback_required: String(ke.callback_required || '').toLowerCase() === 'true',
        counselor_meeting_required: String(ke.counselor_meeting_required || '').toLowerCase() === 'true',
        brochure_required: String(ke.brochure_required || '').toLowerCase() === 'true',
        whatsapp_required: String(ke.whatsapp_required || '').toLowerCase() === 'true',
        email_required: String(ke.email_required || '').toLowerCase() === 'true',
        confidence_score: result.confidence_score || null,
        missing_fields: result.missing_fields || [],
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

    // Auto-create first follow-up task for this lead (scheduler module).
    try {
      const { createFollowupForLead } = await import('./followupScheduler');
      await createFollowupForLead(pool, {
        tenantId,
        leadId,
        conversationId,
        agentId: conv.agent_id || undefined,
        type: 'admission_interest',
      });
    } catch (_e) { /* non-fatal — scheduler is optional */ }

    // Auto-send brochure. Selection (per college/course/branch), per-tenant
    // settings, email + WhatsApp + SMS delivery, duplicate-prevention, lead
    // tracking, admin-review task on no-match, and the recall enqueue now live
    // in the autoBrochure orchestrator — a superset of the original inline
    // WhatsApp+SMS send. Fire-and-forget (never blocks lead creation); the
    // module honors AUTO_BROCHURE=off and BROCHURE_DEFAULT_URL internally.
    const e164Phone = STRICT_INDIAN_MOBILE_RE.test(mobileFor10)
      ? `+91${mobileFor10}`
      : (mobile.startsWith('+') ? mobile : `+${mobileDigits}`);
    void maybeAutoSendBrochure({
      tenantId,
      leadId,
      conversationId,
      agentId: conv.agent_id || null,
      firstName: first_name,
      email: rawEmail || null,
      phoneE164: e164Phone,
      extendedStatus,
      brochureRequired: String(ke.brochure_required || '').toLowerCase() === 'true',
      counselorMeetingRequired: String(ke.counselor_meeting_required || '').toLowerCase() === 'true',
      callbackRequired: String(ke.callback_required || '').toLowerCase() === 'true',
      college: ke.interested_university || null,
      course: ke.interested_course || null,
      branch: ke.interested_branch || null,
      recommendedFollowUpTime: result.recommended_follow_up_time || ke.appointment_time || null,
    });

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
            ca.metadata->>'lead_id' AS linked_lead_id,
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
      linked_lead_id: (conv as any).linked_lead_id || null,
    },
    result,
  );

  return result;
}
