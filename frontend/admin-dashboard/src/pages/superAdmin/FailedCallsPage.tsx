import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Loader2, AlertTriangle, Eye, Sparkles, MessageSquare, ChevronDown, ChevronUp,
} from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

const SEV_DOT: Record<string, string> = {
  info:     'bg-sky-500',
  warning:  'bg-amber-500',
  critical: 'bg-rose-500',
};
const SEV_BORDER: Record<string, string> = {
  info:     'border-l-sky-400',
  warning:  'border-l-amber-400',
  critical: 'border-l-rose-400',
};
const SEV_PILL: Record<string, string> = {
  info:     'bg-sky-50 text-sky-700 border-sky-200',
  warning:  'bg-amber-50 text-amber-800 border-amber-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
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

      {/* Recent failed calls — compact table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Recent failed calls</h2>
          <p className="text-xs text-slate-500">{data.sample.length} shown</p>
        </div>
        {data.sample.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No failures in this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-1 whitespace-nowrap" />
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Started</th>
                  <th className="text-left px-3 py-2 font-medium">Tenant</th>
                  <th className="text-left px-3 py-2 font-medium">Agent</th>
                  <th className="text-left px-3 py-2 font-medium">Channel</th>
                  <th className="text-left px-3 py-2 font-medium min-w-[200px]">Failure reason</th>
                  <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Duration</th>
                  <th className="px-3 py-2 font-medium w-1" />
                  <th className="px-2 py-2 font-medium w-1" />
                </tr>
              </thead>
              <tbody>
                {data.sample.map((c: any) => {
                  const isOpen = expanded.has(c.id);
                  const sev = c.failure_severity as keyof typeof SEV_DOT;
                  return (
                    <Fragment key={c.id}>
                      <tr className={`border-t border-slate-100 hover:bg-slate-50/60 border-l-4 ${SEV_BORDER[sev] || 'border-l-slate-200'}`}>
                        <td className="px-2 py-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${SEV_DOT[sev] || 'bg-slate-300'}`} title={sev || 'unknown'} />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                          <div>{new Date(c.started_at).toLocaleDateString()}</div>
                          <div className="text-[10px] text-slate-400">{new Date(c.started_at).toLocaleTimeString()}</div>
                        </td>
                        <td className="px-3 py-2">
                          {c.tenant ? (
                            <Link to={`/super-admin/tenants/${c.tenant.id}`} className="group">
                              <div className="text-xs text-slate-700 group-hover:text-amber-700 truncate max-w-[140px]">{c.tenant.name}</div>
                              <div className="text-[10px] text-slate-400">{c.tenant.plan?.toUpperCase()}{c.tenant.wallet_balance != null && <> · ₹{Number(c.tenant.wallet_balance).toFixed(0)}</>}</div>
                            </Link>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {c.agent ? (
                            <>
                              <div className="text-xs text-slate-700 truncate max-w-[140px]">{c.agent.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{c.agent.llm_provider || '—'}</div>
                            </>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{c.channel}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase ${SEV_PILL[sev] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>{sev || 'n/a'}</span>
                            <span className="text-xs text-slate-700 truncate max-w-[260px]" title={c.failure_reason}>{c.failure_reason}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-slate-600 whitespace-nowrap">
                          {c.duration_seconds != null ? `${Math.round(c.duration_seconds)}s` : '—'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button onClick={() => toggle(c.id)} className="p-1 rounded hover:bg-slate-100 text-slate-500" title={isOpen ? 'Hide AI analysis' : 'Show AI analysis'}>
                            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                        <td className="px-2 py-2 pr-3">
                          <Link to={`/super-admin/calls/${c.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-medium">
                            <Eye className="h-3 w-3" /> View
                          </Link>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60 border-t border-slate-100">
                          <td />
                          <td colSpan={8} className="px-3 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              {(c.summary || c.analysis?.short_summary) && (
                                <div className="md:col-span-2">
                                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1 mb-0.5">
                                    <MessageSquare className="h-3 w-3" /> Summary
                                  </p>
                                  <p className="text-slate-700">{c.analysis?.short_summary || c.summary}</p>
                                </div>
                              )}
                              {c.analysis?.quality_risks?.length > 0 && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1 mb-0.5">
                                    <AlertTriangle className="h-3 w-3 text-amber-500" /> Quality risks
                                  </p>
                                  <ul className="text-slate-700 list-disc list-inside space-y-0.5">
                                    {c.analysis.quality_risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                                  </ul>
                                </div>
                              )}
                              {c.analysis?.agent_performance_notes && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1 mb-0.5">
                                    <Sparkles className="h-3 w-3 text-violet-500" /> Agent notes
                                  </p>
                                  <p className="text-slate-700">{c.analysis.agent_performance_notes}</p>
                                </div>
                              )}
                              {c.analysis?.next_best_action && (
                                <div className="md:col-span-2">
                                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">Next best action</p>
                                  <p className="text-slate-700">{c.analysis.next_best_action}</p>
                                </div>
                              )}
                              <div className="md:col-span-2 flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-slate-200 text-[10px] font-mono text-slate-500">
                                <span>Call: {c.id}</span>
                                <span>Tenant: {c.tenant_id}</span>
                                <span>Agent: {c.agent_id || '—'}</span>
                                {c.caller_number && <span>{c.caller_number} → {c.called_number || '—'}</span>}
                                {c.recording_url && <span className="text-emerald-600">recording ✓</span>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
