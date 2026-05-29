import { useState, useEffect, useCallback } from 'react';
import {
  Phone, Calendar, Clock, CheckCircle2, XCircle, Loader2, RefreshCw,
  AlertCircle, MapPin, User, Star, MessageSquare, TrendingUp,
  PhoneCall, ChevronRight, Plus, Filter, FileText, Mail, Send,
} from 'lucide-react';
import api from '@/services/api';

type Tab = 'followups' | 'visits' | 'feedback' | 'report' | 'analytics' | 'brochure';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'followups', label: 'Follow-ups', icon: PhoneCall },
  { key: 'brochure',  label: 'Brochure',   icon: FileText },
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
  // Brochure delivery statuses
  SENT: '#10b981', DELIVERED: '#10b981', OPENED: '#10b981', READ: '#10b981',
  SEND_PENDING: '#f59e0b', BOUNCED: '#ef4444', INVALID_EMAIL: '#ef4444',
  INVALID_MOBILE: '#ef4444', PROVIDER_NOT_CONFIGURED: '#ef4444',
  BROCHURE_NOT_FOUND: '#f59e0b', TEMPLATE_NOT_APPROVED: '#ef4444',
  NEEDS_REVIEW: '#f59e0b', SKIPPED_DUPLICATE: '#6b7280', SKIPPED_NOT_INTERESTED: '#6b7280',
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
    api.get('/followups/stats').then(r => setStats(r.data)).catch(() => {});
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
      const r = await api.get('/followups', { params });
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
        {data.map(t => {
          const lead = t.lead || {};
          const college = lead.interested_university;
          const course = lead.interested_course || lead.interested_branch;
          return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#f9fafb', borderRadius: 10 }}>
            <PhoneCall size={16} color={statusColors[t.status] || '#6b7280'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {lead.name || ('Lead ' + (t.lead_id?.slice(0, 8) || ''))}
                <span style={{ fontSize: 10, fontWeight: 600, color: '#6366f1', background: '#eef2ff', borderRadius: 8, padding: '1px 7px', textTransform: 'capitalize' }}>{t.type?.replace(/_/g, ' ')}</span>
                {typeof lead.score === 'number' && <span style={{ fontSize: 10, color: '#6b7280' }}>Score {lead.score}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                {lead.mobile && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Phone size={10} />{lead.mobile}</span>}
                {college && <span>🎓 {college}</span>}
                {course && <span>{course}</span>}
                {(lead.intermediate_percentage || lead.intermediate_marks) && <span>12th: {lead.intermediate_percentage || lead.intermediate_marks}</span>}
                {lead.eamcet_rank && <span>Rank: {lead.eamcet_rank}</span>}
                <span>Attempts: {t.attempt_count}/{t.max_attempts}</span>
                {t.notes && <span>| {t.notes.slice(0, 40)}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11 }}>
              <div style={{ color: '#374151' }}>{new Date(t.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</div>
              <Badge text={t.status} />
            </div>
          </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Visits Tab ──────────────────────────────────────────────────────────────

function leadChips(lead: any, extra: { label: string; value: any }[] = []) {
  const chips: { label: string; value: string }[] = [];
  if (lead.interested_university) chips.push({ label: 'College', value: lead.interested_university });
  if (lead.interested_course || lead.interested_branch) chips.push({ label: 'Course', value: [lead.interested_course, lead.interested_branch].filter(Boolean).join(' / ') });
  if (lead.intermediate_percentage || lead.intermediate_marks) chips.push({ label: '12th', value: lead.intermediate_percentage || lead.intermediate_marks });
  if (lead.eamcet_rank) chips.push({ label: 'EAMCET Rank', value: lead.eamcet_rank });
  for (const e of extra) if (e.value) chips.push({ label: e.label, value: String(e.value) });
  return chips;
}

function LeadHeader({ name, lead, right }: { name: string; lead: any; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{String(name)[0]?.toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{name}</span>
          {typeof lead.score === 'number' && <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 12, padding: '1px 8px' }}>Score {lead.score}</span>}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
          {lead.mobile && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{lead.mobile}</span>}
          {lead.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={11} />{lead.email}</span>}
        </div>
      </div>
      {right}
    </div>
  );
}

function ChipRow({ chips }: { chips: { label: string; value: string }[] }) {
  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
      {chips.map((c) => (
        <span key={c.label} style={{ fontSize: 11, background: '#f3f4f6', borderRadius: 8, padding: '3px 8px', color: '#374151' }}>
          <span style={{ color: '#9ca3af' }}>{c.label}: </span><strong style={{ fontWeight: 600 }}>{c.value}</strong>
        </span>
      ))}
    </div>
  );
}

function VisitsTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/followups/visits').then(r => { setData(r.data.data || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, action: 'confirm' | 'complete') => {
    setBusyId(id);
    try {
      if (action === 'confirm') await api.put(`/followups/visits/${id}/confirm`, {});
      else await api.put(`/followups/visits/${id}/status`, { status: 'COMPLETED' });
      load();
    } catch { /* ignore */ }
    setBusyId(null);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Scheduled Visits ({data.length})</h3>
        <button onClick={load} style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: '#fff' }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {data.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No visits scheduled</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map(v => {
          const lead = v.lead || {};
          const name = lead.name || 'Lead ' + (v.lead_id?.slice(0, 8) || '');
          const done = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(v.status);
          return (
            <div key={v.id} style={{ border: '1px solid #eef0f3', borderRadius: 12, padding: 14, background: '#fff' }}>
              <LeadHeader name={name} lead={lead} right={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {v.created_from === 'AI_FOLLOW_UP_CALL' && <span style={{ fontSize: 10, color: '#6366f1', background: '#eef2ff', borderRadius: 8, padding: '1px 7px' }}>AI scheduled</span>}
                  <Badge text={v.status} />
                </div>
              } />
              <ChipRow chips={leadChips(lead, [{ label: 'Visitor', value: v.visitor_type }])} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, paddingTop: 8, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#374151', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Calendar size={12} />{new Date(v.visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{v.visit_time && ` · ${String(v.visit_time).slice(0, 5)}`}</span>
                {v.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={11} />{v.location}</span>}
                {v.counselor_name && <span>Counselor: {v.counselor_name}</span>}
                {v.reminder_24h_sent && <span style={{ fontSize: 10, color: '#10b981' }}>24h reminder sent</span>}
                {!done && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {!v.customer_confirmed && <button onClick={() => setStatus(v.id, 'confirm')} disabled={busyId === v.id} style={{ padding: '4px 10px', border: '1px solid #8b5cf6', color: '#8b5cf6', background: '#fff', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>}
                    <button onClick={() => setStatus(v.id, 'complete')} disabled={busyId === v.id} style={{ padding: '4px 10px', border: '1px solid #10b981', color: '#10b981', background: '#fff', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Mark Completed</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Feedback Tab ────────────────────────────────────────────────────────────

function FeedbackTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/followups/feedback').then(r => { setData(r.data.data || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <Card>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Customer Feedback ({data.length})</h3>
      {data.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No feedback collected yet</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map(f => {
          const lead = f.lead || {};
          const name = lead.name || 'Lead ' + (f.lead_id?.slice(0, 8) || '');
          return (
            <div key={f.id} style={{ border: '1px solid #eef0f3', borderRadius: 12, padding: 14, background: '#fff' }}>
              <LeadHeader name={name} lead={lead} right={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {f.rating_score && <span style={{ fontSize: 11, color: '#6b7280' }}>{f.rating_score}/5</span>}
                  <Badge text={f.rating} />
                  {f.requires_escalation && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>ESCALATE</span>}
                </div>
              } />
              {f.feedback_text && <div style={{ fontSize: 13, color: '#374151', marginTop: 8, lineHeight: 1.4 }}>“{f.feedback_text}”</div>}
              <ChipRow chips={leadChips(lead, [
                { label: 'Interest', value: f.interest_after_visit },
                { label: 'Admission', value: f.admission_readiness },
                { label: 'Visited', value: f.visited_status },
                { label: 'Next', value: f.next_action },
              ])} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Report Tab ──────────────────────────────────────────────────────────────

function ReportTab() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/followups/report/daily').then(r => { setReport(r.data); setLoading(false); }).catch(() => setLoading(false));
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

// ─── Brochure Tracking Tab ───────────────────────────────────────────────────

type BrochureSub = 'sent' | 'not-sent' | 'pending';
const BROCHURE_SUBS: { key: BrochureSub; label: string; endpoint: string }[] = [
  { key: 'sent',     label: 'Sent',     endpoint: '/brochures/deliveries/sent' },
  { key: 'not-sent', label: 'Not Sent', endpoint: '/brochures/deliveries/not-sent' },
  { key: 'pending',  label: 'Pending',  endpoint: '/brochures/deliveries/pending' },
];

const channelIcon: Record<string, any> = { email: Mail, whatsapp: MessageSquare, sms: Send };

function BrochureTab() {
  const [sub, setSub] = useState<BrochureSub>('sent');
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ sent: number; not_sent: number; pending: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const endpoint = BROCHURE_SUBS.find((s) => s.key === sub)!.endpoint;

  const loadSummary = useCallback(() => {
    api.get('/brochures/deliveries/summary').then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(endpoint, { params: { limit: 50 } });
      setData(r.data.data || []);
      setTotal(r.data.total || 0);
    } catch { setData([]); setTotal(0); }
    setLoading(false);
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const retry = async (id: string) => {
    setRetryingId(id);
    try {
      await api.post(`/brochures/deliveries/${id}/retry`, {});
      await load();
      loadSummary();
    } catch { /* ignore */ }
    setRetryingId(null);
  };

  const counts = { sent: summary?.sent ?? 0, 'not-sent': summary?.not_sent ?? 0, pending: summary?.pending ?? 0 } as Record<BrochureSub, number>;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {BROCHURE_SUBS.map((s) => (
            <button key={s.key} onClick={() => setSub(s.key)}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: sub === s.key ? '#3b82f6' : '#f3f4f6', color: sub === s.key ? '#fff' : '#374151',
              }}>
              {s.label} <span style={{ opacity: 0.8 }}>({counts[s.key]})</span>
            </button>
          ))}
        </div>
        <button onClick={() => { load(); loadSummary(); }} style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: '#fff' }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {data.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
          <FileText size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No brochure deliveries in “{sub.replace('-', ' ')}”.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((d) => {
          const CIcon = channelIcon[d.channel] || FileText;
          const lead = d.lead || {};
          const name = lead.name || d.recipient_email || d.recipient_mobile || 'Unknown lead';
          const when = d.sent_at || d.created_at;
          const sColor = statusColors[d.send_status] || '#6b7280';
          const chips: { label: string; value: string }[] = [];
          const college = lead.interested_university || d.college_name;
          const course = lead.interested_course || d.course_name;
          if (college) chips.push({ label: 'College', value: college });
          if (course) chips.push({ label: 'Course', value: course });
          if (lead.interested_branch || d.branch_name) chips.push({ label: 'Branch', value: lead.interested_branch || d.branch_name });
          if (lead.intermediate_percentage || lead.intermediate_marks) chips.push({ label: '12th', value: lead.intermediate_percentage || lead.intermediate_marks });
          if (lead.eamcet_rank) chips.push({ label: 'EAMCET Rank', value: lead.eamcet_rank });
          if (lead.jee_rank) chips.push({ label: 'JEE Rank', value: lead.jee_rank });
          if (lead.city || lead.preferred_location) chips.push({ label: 'Location', value: lead.city || lead.preferred_location });
          if (lead.parent_mobile) chips.push({ label: 'Parent', value: `${lead.parent_name || ''} ${lead.parent_mobile}`.trim() });
          return (
            <div key={d.id} style={{ border: '1px solid #eef0f3', borderRadius: 12, padding: 14, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {String(name)[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{name}</span>
                    {typeof lead.score === 'number' && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: lead.score >= 80 ? '#10b981' : lead.score >= 60 ? '#f59e0b' : '#6b7280', background: '#f3f4f6', borderRadius: 12, padding: '1px 8px' }}>Score {lead.score}</span>
                    )}
                    {lead.status && <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.3px' }}>{lead.status}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
                    {(lead.mobile || d.recipient_mobile) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{lead.mobile || d.recipient_mobile}</span>}
                    {(lead.email || d.recipient_email) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={11} />{lead.email || d.recipient_email}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Badge text={d.send_status} />
                  {sub === 'not-sent' && (
                    <button onClick={() => retry(d.id)} disabled={retryingId === d.id}
                      style={{ padding: '4px 10px', border: '1px solid #3b82f6', color: '#3b82f6', background: '#fff', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {retryingId === d.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Retry
                    </button>
                  )}
                </div>
              </div>
              {chips.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {chips.map((c) => (
                    <span key={c.label} style={{ fontSize: 11, background: '#f3f4f6', borderRadius: 8, padding: '3px 8px', color: '#374151' }}>
                      <span style={{ color: '#9ca3af' }}>{c.label}: </span><strong style={{ fontWeight: 600 }}>{c.value}</strong>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 8, borderTop: '1px solid #f3f4f6', fontSize: 11, color: '#6b7280', flexWrap: 'wrap' }}>
                <CIcon size={13} color={sColor} />
                <span style={{ textTransform: 'uppercase', fontWeight: 700, color: sColor }}>{d.channel}</span>
                <span>· {d.brochure_name || 'Brochure'}</span>
                {when && <span>· {new Date(when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</span>}
                {d.retry_count > 0 && <span>· retries: {d.retry_count}</span>}
                {sub === 'not-sent' && d.failure_reason && <span style={{ color: '#ef4444' }}>· {String(d.failure_reason).slice(0, 70)}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {total > data.length && <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>Showing {data.length} of {total}</div>}
    </Card>
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
      {tab === 'brochure' && <BrochureTab />}
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
  useEffect(() => { api.get('/followups/analytics').then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false)); }, []);
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
