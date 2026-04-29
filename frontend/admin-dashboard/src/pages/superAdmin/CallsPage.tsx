import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Loader2, ChevronLeft, ChevronRight, Eye, Search, X, Download, BarChart3,
  TrendingUp, TrendingDown, Sparkles, Flame, Trophy, Phone,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, Area, Brush, Sector, AreaChart,
} from 'recharts';
import { superAdminApi, downloadCsv, type CallRow } from '@/services/superAdmin.api';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-700',
  ENDED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
};

const CHART = {
  amber: '#f59e0b', orange: '#f97316', sky: '#0ea5e9', cyan: '#06b6d4',
  emerald: '#10b981', violet: '#8b5cf6', rose: '#f43f5e', fuchsia: '#d946ef',
  teal: '#14b8a6',
};
const PIE_PALETTE = [CHART.amber, CHART.sky, CHART.emerald, CHART.violet, CHART.rose, CHART.cyan, CHART.fuchsia, CHART.teal];
const STATUS_FILL: Record<string, string> = {
  ENDED: CHART.emerald, ACTIVE: CHART.sky, FAILED: CHART.rose,
};
const tooltipStyle = {
  contentStyle: { background: 'rgba(15,23,42,0.95)', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12, padding: '8px 12px', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.4)' },
  itemStyle: { color: '#f1f5f9' },
  labelStyle: { color: '#fbbf24', fontWeight: 600, marginBottom: 4 },
};

// Animated active sector for the donut — renders an extra outer ring + label
// in the centre when the user hovers/clicks a slice.
function ActiveDonutShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  return (
    <g>
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#0f172a" fontSize={18} fontWeight={700}>{value}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#64748b" fontSize={11}>{payload.name} · {(percent * 100).toFixed(0)}%</text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 4} startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} startAngle={startAngle} endAngle={endAngle} innerRadius={outerRadius + 6} outerRadius={outerRadius + 9} fill={fill} opacity={0.4} />
    </g>
  );
}

// Hero KPI tile — light tinted gradient with pop. Designed to sit on the
// light hero band of the call-intelligence card.
function KpiTile({ label, value, sub, accent, spark, icon: Icon, delta }: {
  label: string; value: string | number; sub?: string;
  accent: 'amber' | 'sky' | 'emerald' | 'violet' | 'rose';
  spark?: number[]; icon: any; delta?: number | null;
}) {
  const tileBg: Record<string, string> = {
    amber:   'from-amber-50 to-orange-50/60 border-amber-200',
    sky:     'from-sky-50 to-cyan-50/60 border-sky-200',
    emerald: 'from-emerald-50 to-teal-50/60 border-emerald-200',
    violet:  'from-violet-50 to-purple-50/60 border-violet-200',
    rose:    'from-rose-50 to-pink-50/60 border-rose-200',
  };
  const iconBg: Record<string, string> = {
    amber:   'from-amber-400 to-orange-500',
    sky:     'from-sky-400 to-cyan-500',
    emerald: 'from-emerald-400 to-teal-500',
    violet:  'from-violet-400 to-purple-500',
    rose:    'from-rose-400 to-pink-500',
  };
  const accentText: Record<string, string> = {
    amber: 'text-amber-700', sky: 'text-sky-700', emerald: 'text-emerald-700',
    violet: 'text-violet-700', rose: 'text-rose-700',
  };
  const accentHex: Record<string, string> = {
    amber: CHART.amber, sky: CHART.sky, emerald: CHART.emerald,
    violet: CHART.violet, rose: CHART.rose,
  };
  const sparkData = (spark ?? []).map((v, i) => ({ i, v }));
  const gradId = `kpi-spark-${accent}-${String(label).replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${tileBg[accent]} border shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 p-4 flex flex-col min-h-[150px]`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-[0.12em] font-bold ${accentText[accent]}`}>{label}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1.5 leading-none tracking-tight">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${iconBg[accent]} flex items-center justify-center shadow-lg flex-shrink-0`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 min-h-[16px]">
        {sub && <p className="text-[11px] text-slate-600 truncate font-medium">{sub}</p>}
        {delta != null && (
          <span className={`text-[10px] font-bold inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${delta >= 0 ? 'text-emerald-700 bg-emerald-100' : 'text-rose-700 bg-rose-100'}`}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="flex-1" />
      {sparkData.length > 1 && (
        <div className="h-10 -mx-1 -mb-1">
          <ResponsiveContainer>
            <AreaChart data={sparkData}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentHex[accent]} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={accentHex[accent]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={accentHex[accent]} strokeWidth={2} fill={`url(#${gradId})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function SuperAdminCallsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Filters are URL-bound, so deep links from the dashboard / external bookmarks
  // restore the same view. ?since=YYYY-MM-DD, ?status=FAILED, ?channel=PHONE,
  // ?tenant_id=<uuid>.
  const tenantId = params.get('tenant_id') || '';
  const status   = params.get('status')    || 'all';
  const channel  = params.get('channel')   || 'all';
  const since    = params.get('since')     || '';

  const [rows, setRows] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<any>(null);
  const [series, setSeries] = useState<{ days: Array<{ day: string; calls: number; minutes: number }> } | null>(null);
  const [activeStatusIdx, setActiveStatusIdx] = useState(0);
  const [activeChannelIdx, setActiveChannelIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const setFilter = (key: string, val: string) => {
    const next = new URLSearchParams(params);
    if (!val || val === 'all') next.delete(key);
    else next.set(key, val);
    setParams(next, { replace: true });
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await superAdminApi.calls({
        page, limit: 25,
        tenant_id: tenantId || undefined,
        status, channel,
        since: since || undefined,
      });
      setRows(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, tenantId, status, channel, since]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    superAdminApi.callsStats().then(setStats).catch(() => {});
    superAdminApi.timeseries().then(setSeries).catch(() => {});
  }, []);
  useEffect(() => { setPage(1); }, [tenantId, status, channel, since]);

  // ── Chart data derivations ─────────────────────────────────────────
  const seriesData = useMemo(() => (series?.days || []).map((d) => ({
    day: d.day.slice(5, 10),
    fullDay: d.day.slice(0, 10),
    calls: d.calls,
    minutes: d.minutes,
  })), [series]);

  const statusData = useMemo(() => (stats?.by_status || [])
    .map((r: any) => ({ name: r.status || 'unknown', value: Number(r.n) || 0 })), [stats]);

  const channelData = useMemo(() => (stats?.by_channel || [])
    .map((r: any) => ({ name: r.channel || 'unknown', value: Number(r.n) || 0 })), [stats]);

  const topTenantsCalls = useMemo(() => (stats?.top_tenants_7d || [])
    .slice(0, 6)
    .map((r: any) => ({
      id: r.tenant_id,
      name: r.tenant_name || (r.tenant_id ? r.tenant_id.slice(0, 8) : 'unknown'),
      calls: Number(r.n) || 0,
    })), [stats]);

  // Headline numbers for the hero strip — derived purely from calls data.
  const totalStatus = useMemo(() => statusData.reduce((a: number, b: any) => a + b.value, 0), [statusData]);
  const failedTotal = useMemo(() => (statusData.find((s: any) => s.name === 'FAILED')?.value || 0), [statusData]);
  const failureRate = totalStatus > 0 ? (failedTotal / totalStatus) * 100 : 0;
  const peakDay = useMemo(() => seriesData.reduce<{ day: string; calls: number } | null>(
    (max, d) => (max && max.calls >= d.calls) ? max : { day: d.day, calls: d.calls }, null), [seriesData]);
  const avgPerDay = seriesData.length ? seriesData.reduce((a, d) => a + d.calls, 0) / seriesData.length : 0;
  const todayN = stats?.today?.count ?? 0;
  const yestN = stats?.yesterday?.count ?? 0;
  const todayDelta = yestN > 0 ? ((todayN - yestN) / yestN) * 100 : null;
  const last7 = stats?.last7days?.count ?? 0;
  const callsSpark = useMemo(() => seriesData.map((d) => d.calls), [seriesData]);
  const minutesSpark = useMemo(() => seriesData.map((d) => d.minutes), [seriesData]);

  const totalPages = Math.max(1, Math.ceil(total / 25));
  const hasFilters = tenantId || (status !== 'all') || (channel !== 'all') || since;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calls</h1>
          <p className="text-sm text-slate-500 mt-1">{total} calls match the current filters</p>
        </div>
        <button
          onClick={() => downloadCsv(`calls-${new Date().toISOString().slice(0,10)}.csv`, rows, [
            { key: 'id', label: 'Call ID' },
            { key: 'tenant_id', label: 'Tenant ID' },
            { key: 'tenant_name', label: 'Tenant' },
            { key: 'agent_id', label: 'Agent ID' },
            { key: 'channel', label: 'Channel' },
            { key: 'status', label: 'Status' },
            { key: 'caller_number', label: 'From' },
            { key: 'called_number', label: 'To' },
            { key: 'started_at', label: 'Started' },
            { key: 'ended_at', label: 'Ended' },
            { key: 'duration_seconds', label: 'Duration (s)' },
            { key: 'outcome', label: 'Outcome' },
            { key: 'sentiment', label: 'Sentiment' },
          ])}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* ── Hero analytics card (calls data only) ───────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-amber-50/40 to-orange-50/30 shadow-sm">
        {/* Decorative blurs in soft brand tints */}
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-amber-300/20 blur-3xl pointer-events-none" />
        <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-orange-300/15 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/3 w-72 h-72 rounded-full bg-rose-200/15 blur-3xl pointer-events-none" />

        <div className="relative p-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">Call intelligence</h3>
                <p className="text-[11px] text-slate-500">click any chart segment to filter the list below</p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live · analytics streaming</span>
            </div>
          </div>

          {/* Hero KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiTile label="Today" value={todayN} sub={`${stats?.today?.minutes ?? 0}m talk`}
              accent="amber" icon={Phone} spark={callsSpark.slice(-7)} delta={todayDelta} />
            <KpiTile label="Yesterday" value={yestN} sub="prev day" accent="sky" icon={Phone} />
            <KpiTile label="Last 7 days" value={last7} sub={`${avgPerDay.toFixed(1)}/day avg`}
              accent="emerald" icon={BarChart3} spark={callsSpark.slice(-7)} />
            <KpiTile label="Avg / day (14d)" value={avgPerDay.toFixed(1)} sub="rolling mean"
              accent="violet" icon={TrendingUp} spark={callsSpark} />
            <KpiTile label="Peak day" value={peakDay?.calls ?? 0} sub={peakDay?.day ?? '—'}
              accent="amber" icon={Flame} />
            <KpiTile label="Failure rate" value={`${failureRate.toFixed(1)}%`}
              sub={`${failedTotal} failed`} accent="rose" icon={X} />
          </div>

          {/* Big composed chart with calls bars + minutes area + brush */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Calls & talk-time trend</p>
                <p className="text-[11px] text-slate-500">14 days · drag the slider below to zoom · click a bar to filter by that day</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <span className="inline-block w-3 h-3 rounded-sm bg-gradient-to-b from-amber-500 to-orange-500" />Calls
                </span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <span className="inline-block w-3 h-3 rounded-sm bg-sky-400/60" />Minutes
                </span>
              </div>
            </div>
            {seriesData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-400">No call activity in this window</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer>
                  <ComposedChart data={seriesData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    onClick={(e: any) => e?.activePayload?.[0]?.payload?.fullDay && setFilter('since', e.activePayload[0].payload.fullDay)}>
                    <defs>
                      <linearGradient id="callsBarStrip" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.amber} stopOpacity={1} />
                        <stop offset="100%" stopColor={CHART.orange} stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id="minutesAreaStrip" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.sky} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={CHART.sky} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                    <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(245,158,11,0.08)' }} />
                    <Bar yAxisId="left" dataKey="calls" name="Calls" fill="url(#callsBarStrip)" radius={[8, 8, 0, 0]} cursor="pointer" maxBarSize={32} animationDuration={800} />
                    <Area yAxisId="right" type="monotone" dataKey="minutes" name="Minutes" fill="url(#minutesAreaStrip)" stroke="none" />
                    <Line yAxisId="right" type="monotone" dataKey="minutes" name="Minutes" stroke={CHART.sky} strokeWidth={2.5} dot={{ r: 3, fill: CHART.sky, strokeWidth: 0 }} activeDot={{ r: 6, fill: CHART.sky, stroke: 'white', strokeWidth: 2 }} animationDuration={1000} />
                    <Brush dataKey="day" height={22} stroke={CHART.amber} fill="#fff7ed" travellerWidth={10} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Donuts + leaderboard row */}
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Status donut */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-slate-900">By status</p>
                <span className="text-[10px] uppercase tracking-wider text-slate-400">click slice to filter</span>
              </div>
              {statusData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-slate-400">No status data</div>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={statusData}
                          dataKey="value" nameKey="name"
                          cx="50%" cy="50%" innerRadius={55} outerRadius={82} paddingAngle={2}
                          activeIndex={activeStatusIdx}
                          activeShape={ActiveDonutShape}
                          onMouseEnter={(_: any, idx: number) => setActiveStatusIdx(idx)}
                          onClick={(d: any) => d?.name && setFilter('status', d.name)}
                          animationDuration={900}
                        >
                          {statusData.map((d: any, i: number) => (
                            <Cell key={i} fill={STATUS_FILL[d.name] || PIE_PALETTE[i % PIE_PALETTE.length]} stroke="white" strokeWidth={2} cursor="pointer" />
                          ))}
                        </Pie>
                        <Tooltip {...tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {statusData.slice(0, 3).map((s: any, i: number) => {
                      const pct = totalStatus > 0 ? (s.value / totalStatus) * 100 : 0;
                      const fill = STATUS_FILL[s.name] || PIE_PALETTE[i % PIE_PALETTE.length];
                      return (
                        <button key={s.name} onClick={() => setFilter('status', s.name)} className="text-left p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ background: fill }} />
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{s.name}</span>
                          </div>
                          <p className="text-base font-bold text-slate-900 mt-0.5">{s.value}</p>
                          <p className="text-[10px] text-slate-400">{pct.toFixed(1)}%</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Channel donut */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-slate-900">By channel</p>
                <span className="text-[10px] uppercase tracking-wider text-slate-400">click slice to filter</span>
              </div>
              {channelData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-slate-400">No channel data</div>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={channelData}
                          dataKey="value" nameKey="name"
                          cx="50%" cy="50%" innerRadius={55} outerRadius={82} paddingAngle={2}
                          activeIndex={activeChannelIdx}
                          activeShape={ActiveDonutShape}
                          onMouseEnter={(_: any, idx: number) => setActiveChannelIdx(idx)}
                          onClick={(d: any) => d?.name && setFilter('channel', d.name)}
                          animationDuration={900}
                        >
                          {channelData.map((_: any, i: number) => (
                            <Cell key={i} fill={PIE_PALETTE[(i + 1) % PIE_PALETTE.length]} stroke="white" strokeWidth={2} cursor="pointer" />
                          ))}
                        </Pie>
                        <Tooltip {...tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {channelData.map((c: any, i: number) => (
                      <button key={c.name} onClick={() => setFilter('channel', c.name)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px]">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: PIE_PALETTE[(i + 1) % PIE_PALETTE.length] }} />
                        <span className="font-medium text-slate-700">{c.name}</span>
                        <span className="font-mono text-slate-500">{c.value}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Top-tenants leaderboard */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-amber-500" />
                  <p className="text-sm font-semibold text-slate-900">Top tenants · 7d</p>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400">click row → filter</span>
              </div>
              {topTenantsCalls.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-slate-400">No tenant activity</div>
              ) : (
                <ol className="space-y-2">
                  {(() => {
                    const max = Math.max(1, ...topTenantsCalls.map((t: any) => t.calls));
                    const rankAccent = ['from-amber-400 to-orange-500', 'from-slate-400 to-slate-500', 'from-orange-300 to-amber-400', 'from-slate-300 to-slate-400', 'from-slate-300 to-slate-400', 'from-slate-300 to-slate-400'];
                    return topTenantsCalls.map((t: any, i: number) => {
                      const pct = (t.calls / max) * 100;
                      return (
                        <li key={t.id || i}>
                          <button onClick={() => t.id && setFilter('tenant_id', t.id)}
                            className="w-full text-left p-1.5 rounded-lg hover:bg-amber-50/40 transition group">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`flex-shrink-0 w-5 h-5 rounded-md bg-gradient-to-br ${rankAccent[i] || rankAccent[5]} text-white text-[10px] font-bold flex items-center justify-center shadow-sm`}>
                                {i + 1}
                              </span>
                              <span className="text-xs text-slate-700 group-hover:text-amber-700 font-medium truncate flex-1">{t.name}</span>
                              <span className="text-[11px] font-mono text-slate-500 flex-shrink-0">{t.calls}</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </button>
                        </li>
                      );
                    });
                  })()}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={tenantId} onChange={(e) => setFilter('tenant_id', e.target.value)} placeholder="Tenant ID (UUID) — exact match"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All statuses</option>
          <option value="ENDED">Ended</option>
          <option value="ACTIVE">Active</option>
          <option value="FAILED">Failed</option>
        </select>
        <select value={channel} onChange={(e) => setFilter('channel', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All channels</option>
          <option value="PHONE">Phone</option>
          <option value="WEB">Web</option>
          <option value="WHATSAPP">WhatsApp</option>
        </select>
        <input type="date" value={since} onChange={(e) => setFilter('since', e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white" title="Started on or after" />
        {hasFilters && (
          <button onClick={() => setParams({}, { replace: true })}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400">No calls match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Started</th>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">From → To</th>
                <th className="text-left px-4 py-3 font-medium">Channel</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-xs text-slate-700">{new Date(c.started_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-700">{c.tenant_name || '—'}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{c.tenant_id?.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{c.caller_number || '—'} → {c.called_number || '—'}</td>
                  <td className="px-4 py-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{c.channel}</span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{c.duration_seconds ? `${Math.round(c.duration_seconds)}s` : '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/super-admin/calls/${c.id}`)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-medium">
                      <Eye className="h-3 w-3" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500">Showing {rows.length} of {total}</p>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-slate-600">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

