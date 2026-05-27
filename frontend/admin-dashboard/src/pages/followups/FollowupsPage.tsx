import { useState, useEffect, useCallback } from 'react';
import {
  Phone, Calendar, Clock, CheckCircle2, XCircle, Loader2, RefreshCw,
  AlertCircle, MapPin, User, Star, MessageSquare, TrendingUp,
  PhoneCall, ChevronRight, Plus, Filter,
} from 'lucide-react';
import api from '@/services/api';

type Tab = 'followups' | 'visits' | 'feedback' | 'report' | 'analytics';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'followups', label: 'Follow-ups', icon: PhoneCall },
  { key: 'visits',    label: 'Visits',     icon: MapPin },
  { key: 'feedback',  label: 'Feedback',   icon: Star },
  { key: 'report',    label: 'Report',     icon: TrendingUp },
  { key: 'analytics', label: 'Analytics',  icon: Filter },
];

const statusColors: Record<string, string> = {
  PENDING: '#f59e0b', IN_PROGRESS: '#3b82f6', COMPLETED: '#10b981',
  FAILED: '#ef4444', CANCELLED: '#6b7280', SCHEDULED: '#8b5cf6',
  CONFIRMED: '#10b981', NO_SHOW: '#ef4444', RESCHEDULED: '#f59e0b',
  POSITIVE: '#10b981', NEUTRAL: '#6b7280', NEGATIVE: '#ef4444',
};

function Badge({ text }: { text: string }) {
  const bg = statusColors[text] || '#6b7280';
  return (
    <span style={{ background: bg + '18', color: bg, fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>
      {text}
    </span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.06)', ...style }}>{children}</div>;
}

// ─── Stats Cards ─────────────────────────────────────────────────────────────

function StatsBar() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    api.get('/api/v1/followups/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);
  if (!stats) return null;
  const items = [
    { label: 'Pending Today', value: stats.pending_today || 0, color: '#f59e0b' },
    { label: 'Completed Today', value: stats.completed_today || 0, color: '#10b981' },
    { label: 'Overdue', value: stats.overdue || 0, color: '#ef4444' },
    { label: 'Active', value: stats.total_active || 0, color: '#3b82f6' },
    { label: 'Visits This Week', value: stats.visits_this_week || 0, color: '#8b5cf6' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
      {items.map(i => (
        <Card key={i.label} style={{ textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: i.color }}>{i.value}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{i.label}</div>
        </Card>
      ))}
    </div>
  );
}

// ─── Follow-ups Tab ──────────────────────────────────────────────────────────

function FollowupsTab() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 50, sort: 'scheduled_at', order: 'desc' };
      if (statusFilter) params.status = statusFilter;
      const r = await api.get('/api/v1/followups', { params });
      setData(r.data.data || []);
      setTotal(r.data.total || 0);
    } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Follow-up Tasks ({total})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 8, padding: '4px 8px' }}>
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button onClick={load} style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: '#fff' }}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>
      {data.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No follow-ups yet</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#f9fafb', borderRadius: 10 }}>
            <PhoneCall size={16} color={statusColors[t.status] || '#6b7280'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.type?.replace(/_/g, ' ')}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Lead: {t.lead_id?.slice(0, 8)}... | Attempts: {t.attempt_count}/{t.max_attempts}
                {t.notes && <span> | {t.notes.slice(0, 40)}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11 }}>
              <div style={{ color: '#374151' }}>{new Date(t.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</div>
              <Badge text={t.status} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Visits Tab ──────────────────────────────────────────────────────────────

function VisitsTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/v1/followups/visits').then(r => { setData(r.data.data || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <Card>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Scheduled Visits ({data.length})</h3>
      {data.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No visits scheduled</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map(v => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#f9fafb', borderRadius: 10 }}>
            <MapPin size={16} color="#8b5cf6" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{v.location || 'Location TBD'}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                <Calendar size={10} style={{ display: 'inline', marginRight: 4 }} />
                {new Date(v.visit_date).toLocaleDateString('en-IN')}
                {v.visit_time && <span> at {v.visit_time}</span>}
                {v.counselor_name && <span> | Counselor: {v.counselor_name}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge text={v.status} />
              {v.customer_confirmed && <CheckCircle2 size={14} color="#10b981" />}
              {v.reminder_24h_sent && <span style={{ fontSize: 10, color: '#6b7280' }}>24h sent</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Feedback Tab ────────────────────────────────────────────────────────────

function FeedbackTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/v1/followups/feedback').then(r => { setData(r.data.data || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <Card>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Customer Feedback ({data.length})</h3>
      {data.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No feedback collected yet</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#f9fafb', borderRadius: 10 }}>
            <Star size={16} color={statusColors[f.rating] || '#6b7280'} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{f.feedback_text || 'No comment'}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                {f.reason && <span>Reason: {f.reason} | </span>}
                Score: {f.rating_score || '-'}/5
                {f.requires_escalation && <span style={{ color: '#ef4444', fontWeight: 700 }}> | NEEDS ESCALATION</span>}
              </div>
            </div>
            <Badge text={f.rating} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Report Tab ──────────────────────────────────────────────────────────────

function ReportTab() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/v1/followups/report/daily').then(r => { setReport(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <Card><Loader2 className="animate-spin" style={{ margin: '40px auto', display: 'block' }} /></Card>;
  if (!report) return <Card><div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No report data</div></Card>;

  const f = report.followups || {};
  const v = report.visits || {};
  const fb = report.feedback_summary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Daily Report — {report.date}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <h4 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Follow-ups</h4>
            <div style={{ fontSize: 13 }}>
              <div>Total: <strong>{f.total || 0}</strong></div>
              <div>Completed: <strong style={{ color: '#10b981' }}>{f.completed || 0}</strong></div>
              <div>Pending: <strong style={{ color: '#f59e0b' }}>{f.pending || 0}</strong></div>
              <div>Failed: <strong style={{ color: '#ef4444' }}>{f.failed || 0}</strong></div>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Visits</h4>
            <div style={{ fontSize: 13 }}>
              <div>Scheduled: <strong>{v.scheduled || 0}</strong></div>
              <div>Confirmed: <strong style={{ color: '#10b981' }}>{v.confirmed || 0}</strong></div>
              <div>Completed: <strong>{v.completed || 0}</strong></div>
              <div>No-show: <strong style={{ color: '#ef4444' }}>{v.no_show || 0}</strong></div>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Feedback</h4>
            <div style={{ fontSize: 13 }}>
              <div>Positive: <strong style={{ color: '#10b981' }}>{fb.positive || 0}</strong></div>
              <div>Neutral: <strong>{fb.neutral || 0}</strong></div>
              <div>Negative: <strong style={{ color: '#ef4444' }}>{fb.negative || 0}</strong></div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function FollowupsPage() {
  const [tab, setTab] = useState<Tab>('followups');

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Follow-up Scheduler</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 16px' }}>Auto follow-ups, visits, reminders, feedback — fully automated</p>
      </div>

      <StatsBar />

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, border: 'none',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: tab === t.key ? '#3b82f6' : '#f3f4f6',
              color: tab === t.key ? '#fff' : '#374151',
            }}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'followups' && <FollowupsTab />}
      {tab === 'visits' && <VisitsTab />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'report' && <ReportTab />}
      {tab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}

function AnalyticsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/api/v1/followups/analytics').then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false)); }, []);
  if (loading) return <Card><Loader2 className="animate-spin" style={{ margin: '40px auto', display: 'block' }} /></Card>;
  if (!data) return <Card><div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No analytics data</div></Card>;
  const f = data.funnel || {};
  const c = data.calls || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Follow-up Analytics ({data.period?.from} to {data.period?.to})</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { label: 'Completed', value: f.completed || 0, color: '#10b981' },
            { label: 'Pending', value: f.pending || 0, color: '#f59e0b' },
            { label: 'Failed', value: f.failed || 0, color: '#ef4444' },
          ].map(i => (
            <div key={i.label} style={{ textAlign: 'center', padding: 16, background: '#f9fafb', borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: i.color }}>{i.value}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{i.label}</div>
            </div>
          ))}
        </div>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Call Performance</h4>
          <div style={{ fontSize: 13 }}>
            <div>Total Attempts: <strong>{c.total}</strong></div>
            <div>Successful: <strong style={{ color: '#10b981' }}>{c.successful}</strong></div>
            <div>Avg Attempts: <strong>{c.avgAttempts}</strong></div>
            <div>Success Rate: <strong>{c.total > 0 ? Math.round((c.successful / c.total) * 100) : 0}%</strong></div>
          </div>
        </Card>
        <Card>
          <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Channel Effectiveness</h4>
          {(data.channels || []).length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No channel data yet</div>}
          {(data.channels || []).map((ch: any) => (
            <div key={ch.channel} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
              <span style={{ textTransform: 'capitalize' }}>{ch.channel}</span>
              <span><strong>{ch.delivered}</strong>/{ch.attempts} ({ch.rate}%)</span>
            </div>
          ))}
        </Card>
      </div>
      {(data.weeklyTrend || []).length > 0 && (
        <Card>
          <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Weekly Trend</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
            {data.weeklyTrend.map((w: any) => {
              const maxVal = Math.max(...data.weeklyTrend.map((x: any) => x.total), 1);
              return (
                <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', height: 100, display: 'flex', alignItems: 'flex-end' }}>
                    <div style={{ width: '100%', height: Math.max(8, (w.total / maxVal) * 100), background: '#e5e7eb', borderRadius: 4, position: 'relative' }}>
                      <div style={{ width: '100%', height: Math.max(0, (w.completed / maxVal) * 100), background: '#3b82f6', borderRadius: 4, position: 'absolute', bottom: 0 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: '#6b7280' }}>{new Date(w.week).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

export default FollowupsPage;
