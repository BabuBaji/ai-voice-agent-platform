import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Loader2, AlertTriangle, ArrowRight, Phone, Bot, Building2, Wallet,
  Clock, Mic, Sparkles, MessageSquare, ExternalLink, ChevronDown, ChevronUp,
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

const SEV_COLOR: Record<string, string> = {
  info:     'bg-sky-100 text-sky-700 border-sky-200',
  warning:  'bg-amber-100 text-amber-800 border-amber-200',
  critical: 'bg-rose-100 text-rose-700 border-rose-200',
};

export function SuperAdminFailedCallsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(7);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    setData(null);
    superAdminApi.failedCallsGrouped(since).then(setData);
  }, [days]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  if (!data) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-rose-500" /> Failed call investigation
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-semibold text-rose-700">{data.total_failed}</span> failed calls in the last {days} days · grouped by root cause
          </p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="By outcome">
          {data.by_outcome.length === 0 ? <Empty /> : data.by_outcome.map((o: any) => (
            <Bar key={o.outcome} label={o.outcome} value={o.n} max={data.by_outcome[0].n} />
          ))}
        </Card>
        <Card title="By tenant (top 10)">
          {data.by_tenant.length === 0 ? <Empty /> : data.by_tenant.map((t: any) => (
            <button key={t.tenant_id} onClick={() => navigate(`/super-admin/tenants/${t.tenant_id}`)} className="w-full text-left">
              <Bar label={t.tenant_name || t.tenant_id.slice(0, 8)} value={t.n} max={data.by_tenant[0].n} accent="rose" />
            </button>
          ))}
        </Card>
        <Card title="By agent (top 10)">
          {data.by_agent.length === 0 ? <Empty /> : data.by_agent.map((a: any) => (
            <Bar key={a.agent_id} label={a.agent_name || a.agent_id.slice(0, 8)} value={a.n} max={data.by_agent[0].n} accent="amber" />
          ))}
        </Card>
      </div>

      {/* Detail cards — every failed call rendered with full context */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Recent failed calls — full detail</h2>
          <p className="text-xs text-slate-500">{data.sample.length} shown</p>
        </div>
        {data.sample.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-400">
            No failures in this window.
          </div>
        ) : (
          <div className="space-y-3">
            {data.sample.map((c: any) => {
              const isOpen = expanded.has(c.id);
              return (
                <div key={c.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                  {/* Top strip: failure reason + severity + when */}
                  <div className={`px-5 py-3 border-b ${SEV_COLOR[c.failure_severity]} border-l-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs uppercase tracking-wider font-bold opacity-70">Why it failed</p>
                        <p className="text-sm font-semibold mt-0.5">{c.failure_reason}</p>
                      </div>
                      <div className="text-right text-xs whitespace-nowrap">
                        <p className="font-mono">{new Date(c.started_at).toLocaleString()}</p>
                        <p className="opacity-60 mt-0.5">
                          {c.duration_seconds != null ? `${Math.round(c.duration_seconds)}s connected` : 'never connected'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Three-pane main detail */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                    {/* Pane 1: Call info */}
                    <Pane title="Call" icon={Phone}>
                      <KV label="Channel" value={<span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded">{c.channel}</span>} />
                      <KV label="From" value={<span className="font-mono">{c.caller_number || '—'}</span>} />
                      <KV label="To" value={<span className="font-mono">{c.called_number || '—'}</span>} />
                      <KV label="Outcome" value={c.outcome || '—'} />
                      <KV label="Status" value={<span className="text-rose-700 font-semibold">{c.status}</span>} />
                      <KV label="Language" value={c.language || '—'} />
                      <KV label="Sentiment" value={c.sentiment || '—'} />
                      <KV label="Recording" value={c.recording_url ? '✓ available' : '— none'} />
                    </Pane>

                    {/* Pane 2: Tenant info */}
                    <Pane title="Tenant" icon={Building2}>
                      {c.tenant ? (
                        <>
                          <Link to={`/super-admin/tenants/${c.tenant.id}`} className="block group">
                            <p className="text-sm font-semibold text-slate-900 group-hover:text-amber-700 truncate">
                              {c.tenant.name}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono">{c.tenant.slug}</p>
                          </Link>
                          <div className="mt-2.5 space-y-1.5">
                            <KV label="Plan" value={<span className="text-[10px] uppercase font-semibold">{c.tenant.plan}</span>} />
                            <KV label="Status" value={
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.tenant.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {c.tenant.is_active ? 'Active' : 'Suspended'}
                              </span>
                            } />
                            <KV label={<span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" /> Wallet</span>}
                              value={<span className={`font-mono ${c.tenant.wallet_balance <= 0 ? 'text-rose-700 font-bold' : 'text-slate-700'}`}>
                                ₹{Number(c.tenant.wallet_balance || 0).toFixed(2)}
                              </span>} />
                          </div>
                        </>
                      ) : <p className="text-xs text-slate-400">No tenant info</p>}
                    </Pane>

                    {/* Pane 3: Agent info */}
                    <Pane title="Agent" icon={Bot}>
                      {c.agent ? (
                        <>
                          <p className="text-sm font-semibold text-slate-900 truncate">{c.agent.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{c.agent.id?.slice(0, 8)}</p>
                          <div className="mt-2.5 space-y-1.5">
                            <KV label="Direction" value={c.agent.direction} />
                            <KV label="LLM" value={<span className="font-mono text-[10px]">{c.agent.llm_provider} · {c.agent.llm_model}</span>} />
                            {c.agent.voice && (
                              <KV label={<span className="inline-flex items-center gap-1"><Mic className="h-3 w-3" /> Voice</span>}
                                value={<span className="text-[10px]">{c.agent.voice.voice_name || c.agent.voice.voice_id || '—'} ({c.agent.voice.provider})</span>} />
                            )}
                            <KV label="Status" value={<span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.agent.status === 'PUBLISHED' || c.agent.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{c.agent.status}</span>} />
                          </div>
                        </>
                      ) : <p className="text-xs text-slate-400">No agent assigned</p>}
                    </Pane>
                  </div>

                  {/* Expandable: AI analysis + summary + raw IDs */}
                  {isOpen && (
                    <div className="px-5 py-4 bg-slate-50/60 border-t border-slate-100 space-y-3">
                      {(c.summary || c.analysis?.short_summary) && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5 mb-1">
                            <MessageSquare className="h-3 w-3" /> Summary
                          </p>
                          <p className="text-sm text-slate-700">{c.analysis?.short_summary || c.summary}</p>
                        </div>
                      )}
                      {c.analysis?.quality_risks?.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5 mb-1">
                            <AlertTriangle className="h-3 w-3 text-amber-500" /> Quality risks (AI)
                          </p>
                          <ul className="text-xs text-slate-700 list-disc list-inside space-y-0.5">
                            {c.analysis.quality_risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}
                      {c.analysis?.agent_performance_notes && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5 mb-1">
                            <Sparkles className="h-3 w-3 text-violet-500" /> Agent performance notes (AI)
                          </p>
                          <p className="text-xs text-slate-700">{c.analysis.agent_performance_notes}</p>
                        </div>
                      )}
                      {c.analysis?.next_best_action && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Next best action (AI)</p>
                          <p className="text-xs text-slate-700">{c.analysis.next_best_action}</p>
                        </div>
                      )}
                      {c.topics?.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Topics</p>
                          <div className="flex flex-wrap gap-1">
                            {c.topics.map((t: string, i: number) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded">{t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-2 border-t border-slate-200 text-[10px] font-mono text-slate-500">
                        <KV label="Call ID" value={c.id} mono />
                        <KV label="Tenant ID" value={c.tenant_id} mono />
                        <KV label="Agent ID" value={c.agent_id || '—'} mono />
                        <KV label={<span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Ended at</span>} value={c.ended_at ? new Date(c.ended_at).toLocaleString() : '—'} />
                      </div>
                    </div>
                  )}

                  {/* Footer: actions */}
                  <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <button onClick={() => toggle(c.id)} className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
                      {isOpen ? <><ChevronUp className="h-3 w-3" /> Hide AI analysis & IDs</> : <><ChevronDown className="h-3 w-3" /> Show AI analysis & IDs</>}
                    </button>
                    <div className="flex items-center gap-2">
                      <Link to={`/super-admin/calls/${c.id}`}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1">
                        Full call detail <ArrowRight className="h-3 w-3" />
                      </Link>
                      {c.tenant && (
                        <Link to={`/super-admin/tenants/${c.tenant.id}`}
                          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white inline-flex items-center gap-1">
                          Tenant page <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Pane({ title, icon: Icon, children }: { title: string; icon: any; children: any }) {
  return (
    <div className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5 mb-2.5">
        <Icon className="h-3 w-3" /> {title}
      </p>
      {children}
    </div>
  );
}

function KV({ label, value, mono }: { label: any; value: any; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-2 text-xs py-0.5">
      <span className="text-slate-500 flex-shrink-0">{label}</span>
      <span className={`text-slate-800 text-right truncate ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function Bar({ label, value, max, accent = 'sky' }: { label: string; value: number; max: number; accent?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const bg = accent === 'rose' ? 'bg-rose-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-slate-700 truncate">{label}</span>
        <span className="font-mono font-medium text-slate-900">{value}</span>
      </div>
      <div className="h-1 bg-slate-100 rounded mt-0.5">
        <div className={`h-full ${bg} rounded`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
function Empty() { return <p className="text-xs text-slate-400">No data.</p>; }
