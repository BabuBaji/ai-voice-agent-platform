import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, Radio, Download, Filter } from 'lucide-react';
import { superAdminApi, downloadCsv } from '@/services/superAdmin.api';
import { kindMeta, relativeTime, collapseRepeats } from '@/utils/activityFormat';

const KIND_FILTERS = [
  { value: 'all',           label: 'All kinds' },
  { value: 'login',         label: 'Logins' },
  { value: 'call',          label: 'Calls' },
  { value: 'wallet_credit', label: 'Wallet credits' },
  { value: 'wallet_debit',  label: 'Wallet debits' },
  { value: 'audit',         label: 'Audit (HTTP)' },
];

export function SuperAdminActivityFeedPage() {
  const [events, setEvents] = useState<any[] | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [kindFilter, setKindFilter] = useState('all');
  const [collapse, setCollapse] = useState(true);
  const sseRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await superAdminApi.globalActivityFeed({ hours, limit: 200 });
      setEvents(r.events);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  // SSE auto-disconnects on unmount; flips when toggled. EventSource can't
  // attach a Bearer header — same-origin gateway makes this work in dev.
  useEffect(() => {
    if (!live) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    const es = new EventSource(superAdminApi.eventStreamUrl());
    es.addEventListener('activity', (ev: any) => {
      try {
        const e = JSON.parse(ev.data);
        setEvents((prev) => [e, ...(prev || [])].slice(0, 200));
      } catch { /* swallow */ }
    });
    es.onerror = () => { es.close(); setLive(false); };
    sseRef.current = es;
    return () => { es.close(); };
  }, [live]);

  // Filter then optionally collapse. Order matters — filtering before
  // collapse means counts only include rows that pass the filter.
  const visible = useMemo(() => {
    const filtered = (events || []).filter((e) => kindFilter === 'all' || e.kind === kindFilter);
    return collapse ? collapseRepeats(filtered) : filtered.map((e) => ({ ...e, count: 1, actor: null, action: e.summary }));
  }, [events, kindFilter, collapse]);

  // Group by day for the date sub-headers
  const grouped = useMemo(() => {
    const out: Array<{ day: string; rows: any[] }> = [];
    for (const ev of visible) {
      const day = dayLabel(ev.ts);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(ev);
      else out.push({ day, rows: [ev] });
    }
    return out;
  }, [visible]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Global activity feed</h1>
          <p className="text-sm text-slate-500 mt-1">
            {live ? 'Live — events stream as they happen' : `Every observable event across every tenant — last ${hours}h`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setLive((v) => !v)}
            className={`text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5 ${live ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25' : 'border border-slate-200 hover:bg-slate-50'}`}>
            <Radio className={`h-3.5 w-3.5 ${live ? 'animate-pulse' : ''}`} /> {live ? 'Live' : 'Go live'}
          </button>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={live}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:opacity-50">
            <option value={1}>Last 1 hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button onClick={load} className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          {events && events.length > 0 && (
            <button onClick={() => downloadCsv(`activity-${new Date().toISOString().slice(0,10)}.csv`, events, [
              { key: 'ts', label: 'When' },
              { key: 'kind', label: 'Kind' },
              { key: 'tenant_name', label: 'Tenant' },
              { key: 'tenant_id', label: 'Tenant ID' },
              { key: 'summary', label: 'Summary' },
            ])} className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Filter strip */}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-slate-400" />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          {KIND_FILTERS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} className="accent-amber-500" />
          Collapse consecutive duplicates
        </label>
        <span className="ml-auto text-xs text-slate-500">
          Showing {visible.length} of {events?.length ?? 0} event{events?.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl flex justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl text-center py-20 text-sm text-slate-400">
          No matching activity. Try widening the time window or clearing the kind filter.
        </div>
      ) : (
        // Render each day as its OWN card so the day header stays attached to
        // its rows. Avoids the sticky-positioning glitch where the first row
        // got clipped under a sticky header inside an overflow-hidden card.
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.day} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                <p className="text-xs uppercase tracking-wider text-slate-700 font-bold">{g.day}</p>
                <p className="text-[10px] text-slate-400">{g.rows.length} event{g.rows.length === 1 ? '' : 's'}</p>
              </div>
              <ol className="divide-y divide-slate-100">
                {g.rows.map((e, i) => <Row key={`${g.day}-${i}`} ev={e} />)}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ ev }: { ev: any }) {
  const meta = kindMeta(ev.kind);
  const Icon = meta.icon;
  // Pretty actor/action display. Falls back to the original summary if we
  // couldn't parse it (call rows, integration changes, etc.)
  return (
    <li className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
        <Icon className={`h-4 w-4 ${meta.fg}`} />
      </div>
      <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
        <div className="col-span-7 min-w-0">
          <p className="text-sm text-slate-900 truncate">
            {ev.actor ? (
              <>
                <span className="font-medium">{ev.actor}</span>
                <span className="text-slate-500"> {ev.action}</span>
              </>
            ) : (
              <span>{ev.action || ev.summary}</span>
            )}
            {ev.count > 1 && (
              <span className="ml-2 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                ×{ev.count}
              </span>
            )}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">{meta.label}</p>
        </div>
        <div className="col-span-3 text-xs truncate">
          {ev.tenant_id ? (
            <Link to={`/super-admin/tenants/${ev.tenant_id}`} className="text-amber-700 hover:underline truncate inline-block max-w-full">
              {ev.tenant_name || ev.tenant_id.slice(0, 8)}
            </Link>
          ) : <span className="text-slate-400">—</span>}
        </div>
        <p className="col-span-2 text-right text-[11px] text-slate-500 font-mono whitespace-nowrap"
          title={new Date(ev.ts).toLocaleString()}>
          {relativeTime(ev.ts)}
        </p>
      </div>
    </li>
  );
}

function dayLabel(ts: string): string {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
  if (dDay.getTime() === today.getTime()) return 'Today';
  if (dDay.getTime() === yest.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
