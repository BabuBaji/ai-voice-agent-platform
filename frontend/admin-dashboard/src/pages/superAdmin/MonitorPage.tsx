import { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertCircle, CheckCircle2, XCircle, Loader2, RefreshCw,
  Server, Database, Cpu, Phone, ArrowUpDown, Clock, ScrollText, Pause, Play,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import api from '@/services/api';

interface ServiceProbe {
  name: string;
  kind: 'node' | 'python' | 'frontend';
  status: 'up' | 'degraded' | 'down';
  http_status?: number;
  latency_ms: number;
  error?: string;
}

interface MonitorSnapshot {
  generated_at: string;
  overall: 'healthy' | 'degraded' | 'down';
  services: ServiceProbe[];
  counts: {
    tenants: number;
    agents: number;
    phone_numbers: number;
    deployed_numbers: number;
    calls_total: number;
    calls_last_30m: number;
    calls_last_24h: number;
    failed_last_24h: number;
  };
  provider_split_24h: { provider: string; calls: number; failed: number }[];
  recent_calls: any[];
  recent_audit: any[];
}

const POLL_MS = 5000;

export function MonitorPage() {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = async () => {
    try {
      const r = await api.get('/super-admin/system/monitor');
      setSnap(r.data);
      setError(null);
      setLastFetched(new Date());
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to fetch monitor data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary-600" /> Live Monitor
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Per-service health, DB counts, and recent activity. Auto-refreshes every {POLL_MS / 1000}s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} className="rounded-lg">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !snap ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : snap ? (
        <>
          <OverallBanner overall={snap.overall} services={snap.services} />

          {/* Service grid */}
          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-5 inline-flex items-center gap-1.5">
            <Server className="h-4 w-4" /> Services
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {snap.services.map((s) => <ServiceCard key={s.name} probe={s} />)}
          </div>

          {/* Counts grid */}
          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6 inline-flex items-center gap-1.5">
            <Database className="h-4 w-4" /> Platform counts
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Counter label="Tenants" value={snap.counts.tenants} />
            <Counter label="Agents" value={snap.counts.agents} />
            <Counter label="Phone numbers" value={snap.counts.phone_numbers} />
            <Counter label="Deployed numbers" value={snap.counts.deployed_numbers} accent="emerald" />
            <Counter label="Calls (last 30m)" value={snap.counts.calls_last_30m} accent="primary" />
            <Counter label="Calls (24h)" value={snap.counts.calls_last_24h} />
            <Counter label="Failed (24h)" value={snap.counts.failed_last_24h} accent={snap.counts.failed_last_24h > 0 ? 'danger' : 'gray'} />
            <Counter label="Calls (all-time)" value={snap.counts.calls_total} />
          </div>

          {/* Per-provider split */}
          {snap.provider_split_24h.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6 inline-flex items-center gap-1.5">
                <Phone className="h-4 w-4" /> Carrier split (last 24h)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {snap.provider_split_24h.map((p) => (
                  <Card key={p.provider} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono uppercase text-xs font-semibold text-gray-700">{p.provider || '—'}</span>
                      {p.failed > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-100 text-danger-700 font-semibold uppercase">{p.failed} failed</span>}
                    </div>
                    <div className="mt-1.5 text-xl font-semibold text-gray-900">{p.calls}</div>
                    <div className="text-xs text-gray-500">{p.calls > 0 ? Math.round(((p.calls - p.failed) / p.calls) * 100) : 0}% success rate</div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* Recent activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-6">
            <Card>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 inline-flex items-center gap-1.5">
                <ArrowUpDown className="h-4 w-4" /> Recent calls
              </h2>
              {snap.recent_calls.length === 0 ? (
                <p className="text-xs text-gray-400">No calls yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {snap.recent_calls.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${c.direction === 'OUTBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{c.direction}</span>
                        <span className="font-mono text-gray-700 truncate">{c.caller_number || '—'} → {c.called_number || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <CallStatusBadge status={c.status} />
                        <span className="text-[10px] text-gray-400">{new Date(c.at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 inline-flex items-center gap-1.5">
                <ScrollText className="h-4 w-4" /> Recent number lifecycle events
              </h2>
              {snap.recent_audit.length === 0 ? (
                <p className="text-xs text-gray-400">No events yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {snap.recent_audit.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{a.event_type}</span>
                        {a.actor_email && <span className="text-gray-500 truncate">{a.actor_email}</span>}
                      </div>
                      <span className="text-[10px] text-gray-400">{new Date(a.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function OverallBanner({ overall, services }: { overall: 'healthy' | 'degraded' | 'down'; services: ServiceProbe[] }) {
  const up = services.filter((s) => s.status === 'up').length;
  const total = services.length;
  if (overall === 'healthy') {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
        <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        <div>
          <div className="text-sm font-semibold text-emerald-900">All systems operational</div>
          <div className="text-xs text-emerald-700">{up}/{total} services responding within 2.5s.</div>
        </div>
      </div>
    );
  }
  if (overall === 'degraded') {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
        <AlertCircle className="h-6 w-6 text-amber-600" />
        <div>
          <div className="text-sm font-semibold text-amber-900">Degraded — partial outage</div>
          <div className="text-xs text-amber-700">{up}/{total} services responding. Check the cards below to spot the failing ones.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-danger-50 border border-danger-200">
      <XCircle className="h-6 w-6 text-danger-600" />
      <div>
        <div className="text-sm font-semibold text-danger-900">Major outage</div>
        <div className="text-xs text-danger-700">Only {up}/{total} services responding.</div>
      </div>
    </div>
  );
}

function ServiceCard({ probe }: { probe: ServiceProbe }) {
  const statusCls =
    probe.status === 'up' ? 'border-emerald-200 bg-emerald-50/40' :
    probe.status === 'degraded' ? 'border-amber-200 bg-amber-50/40' :
    'border-danger-200 bg-danger-50/40';
  const Icon = probe.status === 'up' ? CheckCircle2 : probe.status === 'degraded' ? AlertCircle : XCircle;
  const iconCls = probe.status === 'up' ? 'text-emerald-600' : probe.status === 'degraded' ? 'text-amber-600' : 'text-danger-600';
  const kindLabel = probe.kind === 'node' ? 'Node' : probe.kind === 'python' ? 'Python' : 'Web';
  const slow = probe.latency_ms > 1000;
  return (
    <div className={`rounded-xl border p-3 ${statusCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3 text-gray-400" />
            <span className="text-[10px] uppercase font-semibold text-gray-500">{kindLabel}</span>
          </div>
          <div className="text-sm font-semibold text-gray-900 truncate mt-0.5">{probe.name}</div>
        </div>
        <Icon className={`h-5 w-5 flex-shrink-0 ${iconCls}`} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className={`font-medium ${slow ? 'text-amber-700' : 'text-gray-600'}`}>
          {probe.latency_ms}ms
        </span>
        {probe.http_status != null && (
          <span className="font-mono text-gray-500">HTTP {probe.http_status}</span>
        )}
      </div>
      {probe.error && (
        <div className="mt-1.5 text-[11px] text-danger-700 truncate" title={probe.error}>
          {probe.error}
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, accent = 'gray' }: { label: string; value: number; accent?: 'gray' | 'primary' | 'emerald' | 'danger' }) {
  const cls =
    accent === 'primary' ? 'border-primary-200 bg-primary-50/40' :
    accent === 'emerald' ? 'border-emerald-200 bg-emerald-50/40' :
    accent === 'danger' ? 'border-danger-200 bg-danger-50/40' :
    'border-gray-200 bg-white';
  const numCls =
    accent === 'primary' ? 'text-primary-700' :
    accent === 'emerald' ? 'text-emerald-700' :
    accent === 'danger' ? 'text-danger-700' :
    'text-gray-900';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[11px] uppercase text-gray-500 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${numCls}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function CallStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    RINGING: 'bg-blue-100 text-blue-700',
    FAILED: 'bg-danger-100 text-danger-700',
    CANCELLED: 'bg-orange-100 text-orange-700',
    ENDED: 'bg-gray-100 text-gray-700',
  };
  return <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
}
