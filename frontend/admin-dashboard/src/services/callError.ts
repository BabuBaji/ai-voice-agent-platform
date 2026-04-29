// Translate raw carrier / backend errors from the call-initiate endpoint
// into a short, actionable message the user can act on. The backend already
// passes Plivo/Twilio error text through verbatim; this helper detects the
// common cases and rewrites them into something a non-engineer can fix.
//
// Returns: { title, hint } where `title` is a short headline and `hint`
// optionally provides the next step.

export interface FriendlyCallError {
  title: string;
  hint?: string;
}

const PLIVO_CONSOLE_PERMISSIONS = 'console.plivo.com → Voice → Calls Permissions';
const PLIVO_CONSOLE_KYC = 'console.plivo.com → Account → Compliance / KYC';

export function explainCallError(err: unknown): FriendlyCallError {
  // Pull the most likely text out of an axios error / plain Error / string
  const anyErr = err as any;
  const raw: string =
    anyErr?.response?.data?.message ||
    anyErr?.response?.data?.error ||
    anyErr?.response?.data?.err ||
    anyErr?.message ||
    (typeof err === 'string' ? err : '') ||
    'Failed to place call';
  const lower = raw.toLowerCase();
  const status = anyErr?.response?.status as number | undefined;

  // ── Plivo / carrier permission errors ────────────────────────────────
  if (lower.includes('region are barred') || lower.includes('destination region') || lower.includes('not authorized to dial')) {
    return {
      title: 'This destination is not enabled on your phone-provider account',
      hint: `The carrier blocked the call before it left their network. Enable the destination country at ${PLIVO_CONSOLE_PERMISSIONS}, then retry.`,
    };
  }
  if (lower.includes('compliance') || lower.includes('kyc') || /\b8011\b/.test(raw)) {
    return {
      title: 'Phone-number KYC is still pending',
      hint: `Indian numbers (+91) require DOT/TRAI verification before any outbound call works. Submit your documents at ${PLIVO_CONSOLE_KYC} — approval takes 1–3 business days.`,
    };
  }
  if (lower.includes('not a valid') && lower.includes('number')) {
    return {
      title: 'Phone number format invalid',
      hint: 'Use full E.164 with country code, e.g. +919493324795 or +14155550100.',
    };
  }
  if (lower.includes('insufficient balance') || lower.includes('insufficient funds') || lower.includes('balance too low')) {
    return {
      title: 'Carrier wallet is empty',
      hint: 'Top up your Plivo / Twilio balance, then retry.',
    };
  }
  if (lower.includes('invalid auth') || status === 401 || lower.includes('authentication')) {
    return {
      title: 'Carrier credentials are invalid',
      hint: 'Check PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN (or the Twilio equivalents) in your environment.',
    };
  }
  if (status === 402 && (lower.includes('plan') || lower.includes('upgrade'))) {
    return {
      title: 'Plan upgrade required',
      hint: raw,
    };
  }

  // ── Our own backend gates ────────────────────────────────────────────
  if (lower.includes('click deploy') || lower.includes('not deployed')) {
    return {
      title: 'Agent is in DRAFT',
      hint: 'Open the agent and click Deploy / Publish first.',
    };
  }
  if (lower.includes('no phone number') || lower.includes('no from number')) {
    return {
      title: 'Agent has no outbound number assigned',
      hint: 'Assign a phone number to this agent at Settings → Phone Numbers, then retry.',
    };
  }

  // Fallback — surface the raw message so the user sees something.
  return { title: raw };
}

// Convenience: format the friendly error as a single string for alert() etc.
export function formatCallError(err: unknown): string {
  const f = explainCallError(err);
  return f.hint ? `${f.title}\n\n${f.hint}` : f.title;
}
