import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

/**
 * Cal.com v2 booking client (TypeScript port of services/ai-runtime/src/integrations/calcom.py).
 *
 * Why duplicate? telephony-adapter runs in Node and shouldn't take a hard
 * dependency on ai-runtime being up just to fire a booking. Both clients hit
 * the same Cal.com v2 endpoint with the same shape so a tenant's `api_key`
 * and `event_type_id` work in either code path (phone call OR chat widget).
 *
 * Cal.com v1 is decommissioned — must use v2 with Bearer auth + cal-api-version header.
 */

const CALCOM_API = 'https://api.cal.com/v2';
const CALCOM_API_VERSION = '2024-08-13';

export interface CalcomBookingArgs {
  apiKey: string;
  eventTypeId: number | string;
  name: string;
  email: string;
  start: string; // ISO 8601, naïve treated as UTC
  durationMinutes?: number;
  timezone?: string;
  notes?: string;
  language?: string;
}

export interface CalcomBookingResult {
  ok: boolean;
  bookingId?: string | number;
  start?: string;
  end?: string;
  link?: string;
  title?: string;
  error?: string;
}

function toIso(value: string): string {
  if (!value) return value;
  const s = value.trim();
  if (s.endsWith('Z')) return s;
  // Has explicit offset like +05:30 or -08:00 starting after the date portion
  if (/[+-]\d{2}:?\d{2}$/.test(s)) return s;
  // Otherwise assume UTC and append Z if it parses
  const d = new Date(s);
  if (isNaN(d.getTime())) return s; // let cal.com surface the error
  return d.toISOString();
}

export async function createCalcomBooking(args: CalcomBookingArgs): Promise<CalcomBookingResult> {
  if (!args.apiKey) return { ok: false, error: 'Cal.com API key not configured' };
  if (!args.eventTypeId) return { ok: false, error: 'Cal.com event_type_id not configured' };
  if (!args.name || !args.email || !args.start) {
    return { ok: false, error: 'Missing name, email, or start' };
  }

  const isoStart = toIso(args.start);
  const eventTypeIdNum = typeof args.eventTypeId === 'string' && /^\d+$/.test(args.eventTypeId)
    ? parseInt(args.eventTypeId, 10)
    : args.eventTypeId;

  const body: Record<string, any> = {
    start: isoStart,
    eventTypeId: eventTypeIdNum,
    attendee: {
      name: args.name,
      email: args.email,
      timeZone: args.timezone || 'UTC',
      language: args.language || 'en',
    },
    metadata: { booked_via: 'voice-agent' },
  };
  if (args.durationMinutes) body.lengthInMinutes = args.durationMinutes;
  if (args.notes) body.bookingFieldsResponses = { notes: args.notes };

  try {
    const resp = await fetch(`${CALCOM_API}/bookings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        'cal-api-version': CALCOM_API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const j: any = await resp.json().catch(() => ({}));
      const booking = (j?.data || j) as any;
      return {
        ok: true,
        bookingId: booking?.id || booking?.uid,
        start: booking?.start || isoStart,
        end: booking?.end,
        link: booking?.meetingUrl || booking?.location,
        title: booking?.title,
      };
    }

    const text = await resp.text().catch(() => '');
    let short = text;
    try {
      const j = JSON.parse(text);
      short = j?.error?.message || j?.message || j?.error?.code || text;
    } catch { /* keep raw text */ }
    short = String(short || '').trim().slice(0, 140);
    logger.warn({ status: resp.status, body: text.slice(0, 300) }, 'calcom booking failed');
    return { ok: false, error: `Cal.com ${resp.status}: ${short}` };
  } catch (err: any) {
    logger.error({ err: err.message }, 'calcom booking error');
    return { ok: false, error: err.message || 'fetch error' };
  }
}

// ─── Sentinel parser + executor ─────────────────────────────────────────

const BOOK_RE = /\[BOOK\b([^\]]*)\]/i;
const KV_RE = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;

/**
 * Append a SCHEDULING TOOL section to the agent's system prompt so the LLM
 * knows to emit the `[BOOK ...]` sentinel when the caller wants to schedule.
 * No-op when the agent doesn't have Cal.com configured.
 */
export function maybeAugmentSystemPromptForBooking(basePrompt: string, agent: any): string {
  const cfg = agent?.integrations_config?.calcom;
  if (!cfg?.enabled || !cfg?.api_key || !cfg?.event_type_id) return basePrompt;
  return (
    basePrompt +
    '\n\n## SCHEDULING TOOL\n' +
    'If the user wants to book a meeting/demo/call, gather their full name, email, ' +
    'and preferred ISO date+time, then respond ONLY with this on its own line:\n' +
    '`[BOOK name="<Full Name>" email="<email@example.com>" start="2026-04-25T15:00" duration=30]`\n' +
    'Do not say anything else when emitting [BOOK]. The system will book and reply with confirmation.\n' +
    'Otherwise reply naturally as a conversational voice agent.'
  );
}

/**
 * If the LLM reply contains a `[BOOK ...]` sentinel, execute the Cal.com
 * booking and return a human-readable spoken confirmation/error. Returns
 * `null` when no sentinel was found — caller should use the original reply.
 */
export async function maybeExecuteBooking(reply: string, agent: any): Promise<string | null> {
  const m = reply.match(BOOK_RE);
  if (!m) return null;

  const cfg = agent?.integrations_config?.calcom;
  if (!cfg?.enabled || !cfg?.api_key || !cfg?.event_type_id) {
    return "I'd love to book that, but the calendar integration isn't configured for this agent yet.";
  }

  const kv: Record<string, string> = {};
  const raw = m[1];
  let kvMatch: RegExpExecArray | null;
  KV_RE.lastIndex = 0;
  while ((kvMatch = KV_RE.exec(raw)) !== null) {
    kv[kvMatch[1].toLowerCase()] = kvMatch[2] !== undefined ? kvMatch[2] : kvMatch[3];
  }

  const name = kv.name || '';
  const email = kv.email || '';
  const start = kv.start || '';
  const duration = parseInt(kv.duration || String(cfg.default_duration_minutes || 30), 10);
  const timezone = kv.tz || cfg.timezone || 'UTC';

  if (!name || !email || !start) {
    return 'I need your full name, email, and a preferred date and time to book the meeting. Could you share those again?';
  }

  const result = await createCalcomBooking({
    apiKey: cfg.api_key,
    eventTypeId: cfg.event_type_id,
    name,
    email,
    start,
    durationMinutes: duration,
    timezone,
  });

  if (result.ok) {
    return `Booked! You're confirmed for ${result.start || start}. We've sent a confirmation to ${email}.`;
  }
  return `I couldn't complete that booking — ${result.error}. Want to try another time?`;
}
