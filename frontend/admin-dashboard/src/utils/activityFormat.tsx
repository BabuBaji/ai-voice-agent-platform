import {
  Activity, LogIn, ShieldCheck, PhoneCall,
  ArrowDownLeft, ArrowUpRight, AlertTriangle, Bot, Plug,
} from 'lucide-react';

// ── Per-kind icon + color ──────────────────────────────────────────────────
export function kindMeta(kind: string): { icon: any; bg: string; fg: string; label: string } {
  switch (kind) {
    case 'login':         return { icon: LogIn,         bg: 'bg-sky-100',     fg: 'text-sky-600',     label: 'Login' };
    case 'audit':         return { icon: ShieldCheck,   bg: 'bg-violet-100',  fg: 'text-violet-600',  label: 'Audit' };
    case 'call':          return { icon: PhoneCall,     bg: 'bg-emerald-100', fg: 'text-emerald-600', label: 'Call' };
    case 'wallet_credit': return { icon: ArrowDownLeft, bg: 'bg-emerald-100', fg: 'text-emerald-600', label: 'Credit' };
    case 'wallet_debit':  return { icon: ArrowUpRight,  bg: 'bg-rose-100',    fg: 'text-rose-600',    label: 'Debit' };
    case 'agent_create':  return { icon: Bot,           bg: 'bg-amber-100',   fg: 'text-amber-600',   label: 'Agent created' };
    case 'agent_update':  return { icon: Bot,           bg: 'bg-slate-100',   fg: 'text-slate-500',   label: 'Agent updated' };
    case 'integration':   return { icon: Plug,          bg: 'bg-indigo-100',  fg: 'text-indigo-600',  label: 'Integration' };
    case 'anomaly':       return { icon: AlertTriangle, bg: 'bg-amber-100',   fg: 'text-amber-700',   label: 'Anomaly' };
    default:              return { icon: Activity,      bg: 'bg-slate-100',   fg: 'text-slate-500',   label: kind };
  }
}

// ── Friendly relative time ─────────────────────────────────────────────────
export function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Parse summary into actor + action ─────────────────────────────────────
export type CollapsedEvent = {
  kind: string;
  actor: string | null;
  action: string;
  ts: string;             // most-recent timestamp
  count: number;
  tenant_id: string | null;
  tenant_name: string | null;
  summary: string;        // original, in case we need a fallback
};

function parseEvent(e: any): CollapsedEvent {
  let actor: string | null = null;
  let action = e.summary || '';
  if (e.kind === 'login') {
    const m = /^(.+?) signed in$/.exec(e.summary || '');
    if (m) { actor = m[1]; action = 'signed in'; }
  } else if (e.kind === 'audit') {
    const m = /^(.+?):\s*(.+)$/.exec(e.summary || '');
    if (m) { actor = m[1]; action = m[2]; }
  } else if (e.kind?.startsWith('wallet_')) {
    actor = null;
    action = (e.summary || '').replace(/^wallet\s*/, '');
  } else if (e.kind === 'call') {
    actor = null;
    action = e.summary || '';
  } else if (e.kind?.startsWith('agent_')) {
    actor = null;
    action = (e.summary || '').replace(/^agent\s*/, 'agent ');
  }
  return {
    kind: e.kind, actor, action,
    ts: e.ts, count: 1,
    tenant_id: e.tenant_id ?? null,
    tenant_name: e.tenant_name ?? null,
    summary: e.summary,
  };
}

// Collapse consecutive same-actor + same-kind + same-action rows. Events come
// pre-sorted descending by timestamp, so the first row in each group is the
// most recent — which is the timestamp we surface for the collapsed entry.
export function collapseRepeats(events: any[]): CollapsedEvent[] {
  const out: CollapsedEvent[] = [];
  for (const raw of events) {
    const ev = parseEvent(raw);
    const last = out[out.length - 1];
    if (last && last.kind === ev.kind && last.actor === ev.actor && last.action === ev.action && last.tenant_id === ev.tenant_id) {
      last.count++;
    } else {
      out.push(ev);
    }
  }
  return out;
}
