import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Power, LogIn, Wallet, Users as UsersIcon, PhoneCall, Bot,
  Activity, FileText, ScrollText, Database, Mail, Phone, Calendar, BadgeCheck, Eye,
  Tag,
} from 'lucide-react';
import { superAdminApi, type TenantDetail } from '@/services/superAdmin.api';
import { useAuthStore } from '@/stores/auth.store';

type Tab = 'overview' | 'users' | 'activity' | 'calls' | 'agents' | 'billing' | 'resources' | 'audit';

const TABS: Array<{ id: Tab; label: string; icon: any }> = [
  { id: 'overview',  label: 'Overview',  icon: BadgeCheck },
  { id: 'users',     label: 'Users',     icon: UsersIcon },
  { id: 'activity',  label: 'Activity',  icon: Activity },
  { id: 'calls',     label: 'Calls',     icon: PhoneCall },
  { id: 'agents',    label: 'Agents',    icon: Bot },
  { id: 'billing',   label: 'Billing',   icon: Wallet },
  { id: 'resources', label: 'Resources', icon: Database },
  { id: 'audit',     label: 'Audit',     icon: ScrollText },
];

export function SuperAdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [actioning, setActioning] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ amount: '', type: 'credit' as 'credit' | 'debit', reason: '' });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await superAdminApi.tenantDetail(id);
      setData(d);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleStatus = async () => {
    if (!id || !data) return;
    if (!confirm(`${data.tenant.is_active ? 'Suspend' : 'Activate'} ${data.tenant.name}?`)) return;
    setActioning('status');
    try {
      const reason = data.tenant.is_active ? prompt('Reason for suspension (optional):') || undefined : undefined;
      await superAdminApi.setTenantStatus(id, !data.tenant.is_active, reason);
      await load();
    } finally { setActioning(null); }
  };

  const impersonate = async () => {
    if (!id || !data) return;
    if (!confirm(`Log in as ${data.tenant.name}? Your super-admin session will be paused.`)) return;
    setActioning('impersonate');
    try {
      const auth = useAuthStore.getState();
      const original = { accessToken: auth.accessToken!, refreshToken: auth.refreshToken!, user: auth.user! };
      const r = await superAdminApi.impersonate(id);
      auth.login({
        id: r.impersonating.userId, email: r.impersonating.email,
        name: r.impersonating.email.split('@')[0], role: 'admin',
        tenantId: r.impersonating.tenantId, isPlatformAdmin: false,
        impersonating: {
          originalAccessToken: original.accessToken,
          originalRefreshToken: original.refreshToken,
          originalUser: { ...original.user, impersonating: undefined },
        },
      }, r.accessToken, r.refreshToken);
      window.location.href = '/';
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Impersonation failed');
      setActioning(null);
    }
  };

  const submitAdjust = async () => {
    if (!id) return;
    const amt = parseFloat(adjustForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) { alert('Amount must be positive'); return; }
    if (!adjustForm.reason.trim()) { alert('Reason is required'); return; }
    setActioning('adjust');
    try {
      await superAdminApi.walletAdjust({ tenant_id: id, amount: amt, type: adjustForm.type, reason: adjustForm.reason.trim() });
      setAdjustOpen(false);
      setAdjustForm({ amount: '', type: 'credit', reason: '' });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Adjust failed');
    } finally { setActioning(null); }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (error || !data) return <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error || 'Not found'}</div>;

  const t = data.tenant;
  const owner = data.users[0];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/super-admin/tenants')} className="p-2 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{t.name}</h1>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${t.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {t.is_active ? 'Active' : 'Suspended'}
            </span>
            <span className="text-[10px] uppercase font-semibold text-slate-500 px-2 py-0.5 rounded bg-slate-100">{t.plan}</span>
          </div>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{t.id} · {t.slug}</p>
        </div>
        <button onClick={async () => {
          const newPlan = prompt(`Change plan for ${t.name}.\nCurrent: ${t.plan}\nEnter new plan id (free / pro / enterprise / jump_starter):`, t.plan);
          if (!newPlan || newPlan === t.plan) return;
          const reason = prompt('Reason (audited):') || undefined;
          try {
            await superAdminApi.changePlan(id!, newPlan, reason);
            await load();
          } catch (e: any) { alert(e?.response?.data?.error || 'Plan change failed'); }
        }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs font-medium">
          <Tag className="h-3.5 w-3.5" /> Change plan
        </button>
        <button onClick={impersonate} disabled={actioning === 'impersonate'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50">
          <LogIn className="h-3.5 w-3.5" /> Impersonate
        </button>
        <button onClick={toggleStatus} disabled={actioning === 'status'} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${t.is_active ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
          <Power className="h-3.5 w-3.5" /> {t.is_active ? 'Suspend' : 'Activate'}
        </button>
      </div>

      {/* Quick stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat icon={UsersIcon} label="Users" value={data.users.length} />
        <Stat icon={Bot} label="Agents" value={data.agents.total} sub={`${data.agents.active} active`} />
        <Stat icon={PhoneCall} label="Calls" value={data.calls.total} sub={`${data.calls.total_minutes}m`} />
        <Stat icon={Wallet} label="Wallet" value={`₹${(data.wallet?.balance ?? 0).toFixed(2)}`} />
        <Stat icon={Calendar} label="Joined" value={new Date(t.created_at).toLocaleDateString()} />
      </div>

      {/* Tab strip */}
      <div className="border-b border-slate-200 flex gap-1 overflow-x-auto">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id
                ? 'border-amber-500 text-amber-700 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <tb.icon className="h-4 w-4" /> {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview'  && <OverviewTab data={data} owner={owner} adjustOpen={adjustOpen} setAdjustOpen={setAdjustOpen} adjustForm={adjustForm} setAdjustForm={setAdjustForm} submitAdjust={submitAdjust} actioning={actioning} />}
      {tab === 'users'     && <UsersTab tenantId={id!} />}
      {tab === 'activity'  && <ActivityTab tenantId={id!} />}
      {tab === 'calls'     && <CallsTab tenantId={id!} navigate={navigate} />}
      {tab === 'agents'    && <AgentsTab tenantId={id!} />}
      {tab === 'billing'   && <BillingTab tenantId={id!} />}
      {tab === 'resources' && <ResourcesTab tenantId={id!} />}
      {tab === 'audit'     && <AuditTab tenantId={id!} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: any; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-3">
      <Icon className="h-5 w-5 text-slate-400" />
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className="text-base font-bold text-slate-900">{value}</p>
        {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────
function OverviewTab({ data, owner, adjustOpen, setAdjustOpen, adjustForm, setAdjustForm, submitAdjust, actioning }: any) {
  const t = data.tenant;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Registration</h3>
        <Field label="Tenant ID"      value={t.id} mono />
        <Field label="Slug"           value={t.slug} mono />
        <Field label="Plan"           value={t.plan} />
        <Field label="Status"         value={t.is_active ? 'Active' : 'Suspended'} />
        <Field label="Created"        value={new Date(t.created_at).toLocaleString()} />
        <Field label="Last updated"   value={new Date(t.updated_at).toLocaleString()} />
        {owner && (
          <>
            <hr className="my-3 border-slate-100" />
            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Owner</h4>
            <Field label="Name"   value={`${owner.first_name} ${owner.last_name}`.trim() || '—'} />
            <Field label="Email"  value={<span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {owner.email}</span>} />
            <Field label="Roles"  value={owner.roles.join(', ') || '—'} />
            <Field label="Last login" value={owner.last_login_at ? new Date(owner.last_login_at).toLocaleString() : 'Never'} />
          </>
        )}
        {Object.keys(t.settings || {}).length > 0 && (
          <>
            <hr className="my-3 border-slate-100" />
            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Settings</h4>
            <pre className="text-[10px] text-slate-600 font-mono whitespace-pre-wrap break-all bg-slate-50 p-2 rounded">{JSON.stringify(t.settings, null, 2)}</pre>
          </>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Wallet & adjustments</h3>
          <button onClick={() => setAdjustOpen((v: boolean) => !v)} className="text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium">
            Adjust balance
          </button>
        </div>
        <div className="text-3xl font-bold text-slate-900 mb-2">₹{(data.wallet?.balance ?? 0).toFixed(2)}</div>
        <p className="text-xs text-slate-500 mb-4">{data.wallet?.currency || 'INR'} · low at ₹{data.wallet?.low_balance_threshold ?? 0}</p>

        {adjustOpen && (
          <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex gap-2">
              <select value={adjustForm.type} onChange={(e) => setAdjustForm((f: any) => ({ ...f, type: e.target.value }))} className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
              <input type="number" step="0.01" value={adjustForm.amount} onChange={(e) => setAdjustForm((f: any) => ({ ...f, amount: e.target.value }))}
                placeholder="Amount (INR)" className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5" />
            </div>
            <input type="text" value={adjustForm.reason} onChange={(e) => setAdjustForm((f: any) => ({ ...f, reason: e.target.value }))}
              placeholder="Reason (audited)" className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdjustOpen(false)} className="text-xs px-2.5 py-1 text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
              <button onClick={submitAdjust} disabled={actioning === 'adjust'} className="text-xs px-2.5 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800">Apply</button>
            </div>
          </div>
        )}

        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Recent transactions</h4>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {data.recent_transactions.length === 0 ? (
            <p className="text-xs text-slate-400">No transactions yet.</p>
          ) : data.recent_transactions.map((tx: any) => (
            <div key={tx.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-slate-700 truncate">{tx.reason}</p>
                <p className="text-[10px] text-slate-400">{new Date(tx.created_at).toLocaleString()}</p>
              </div>
              <span className={`font-mono font-medium ${tx.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {tx.type === 'credit' ? '+' : '−'}₹{tx.amount.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`text-slate-800 text-right ${mono ? 'font-mono' : ''} truncate`}>{value}</span>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────
function UsersTab({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    superAdminApi.tenantUsers(tenantId, { limit: 100 }).then(setData).finally(() => setLoading(false));
  }, [tenantId]);
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  if (!data) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-3 font-medium">User</th>
            <th className="text-left px-4 py-3 font-medium">Roles</th>
            <th className="text-left px-4 py-3 font-medium">Phone</th>
            <th className="text-center px-4 py-3 font-medium">Verified</th>
            <th className="text-right px-4 py-3 font-medium">Logins</th>
            <th className="text-right px-4 py-3 font-medium">Agents</th>
            <th className="text-right px-4 py-3 font-medium">Calls</th>
            <th className="text-left px-4 py-3 font-medium">Last login</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((u: any) => (
            <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-900">{u.first_name} {u.last_name}</p>
                <p className="text-[11px] text-slate-500">{u.email}</p>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">{u.roles.join(', ') || '—'}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{u.phone || '—'}</td>
              <td className="px-4 py-3 text-center">
                {u.email_verified ? <BadgeCheck className="h-4 w-4 text-emerald-500 inline" /> : <span className="text-[10px] text-rose-500">No</span>}
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{u.login_count}</td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{u.agents_owned}</td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{u.calls_via_owned_agents}</td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
              </td>
              <td className="px-4 py-3">
                <button onClick={() => navigate(`/super-admin/users/${u.id}`)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px]">
                  <Eye className="h-3 w-3" /> View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Activity tab (synthetic firehose for this tenant) ─────────────────────
const KIND_BADGES: Record<string, string> = {
  login: 'bg-sky-100 text-sky-700',
  audit: 'bg-violet-100 text-violet-700',
  call: 'bg-emerald-100 text-emerald-700',
  agent_create: 'bg-amber-100 text-amber-700',
  agent_update: 'bg-slate-100 text-slate-600',
  wallet_credit: 'bg-emerald-100 text-emerald-700',
  wallet_debit: 'bg-rose-100 text-rose-700',
  integration: 'bg-indigo-100 text-indigo-700',
};

function ActivityTab({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => {
    superAdminApi.tenantActivity(tenantId, 200).then((r) => setEvents(r.events));
  }, [tenantId]);
  if (!events) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <p className="text-xs text-slate-500 mb-4">
        Synthetic timeline — every observable change in any DB combined into one feed. {events.length} events.
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">No activity yet.</p>
      ) : (
        <ol className="space-y-2 max-h-[600px] overflow-y-auto">
          {events.map((e, i) => (
            <li key={i} className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
              <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded h-fit ${KIND_BADGES[e.kind] || 'bg-slate-100 text-slate-600'}`}>{e.kind}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800">{e.summary}</p>
                <p className="text-[10px] text-slate-400">{new Date(e.ts).toLocaleString()}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Calls / Agents / Billing / Resources / Audit ──────────────────────────
function CallsTab({ tenantId, navigate }: { tenantId: string; navigate: (p: string) => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { superAdminApi.tenantCalls(tenantId, { limit: 100 }).then(setData); }, [tenantId]);
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Started</th>
            <th className="text-left px-4 py-3 font-medium">Channel</th>
            <th className="text-left px-4 py-3 font-medium">From → To</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
            <th className="text-right px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((c: any) => (
            <tr key={c.id} className="border-t border-slate-100">
              <td className="px-4 py-3 text-xs text-slate-700">{new Date(c.started_at).toLocaleString()}</td>
              <td className="px-4 py-3 text-xs"><span className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">{c.channel}</span></td>
              <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{c.caller_number || '—'} → {c.called_number || '—'}</td>
              <td className="px-4 py-3 text-xs">{c.status}</td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{c.duration_seconds ? `${Math.round(c.duration_seconds)}s` : '—'}</td>
              <td className="px-4 py-3">
                <button onClick={() => navigate(`/super-admin/calls/${c.id}`)} className="text-[11px] px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">View</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.data.length === 0 && <p className="text-center py-12 text-sm text-slate-400">No calls yet.</p>}
    </div>
  );
}

function AgentsTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { superAdminApi.tenantAgents(tenantId, { limit: 100 }).then(setData); }, [tenantId]);
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Agent</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
            <th className="text-left px-4 py-3 font-medium">Direction</th>
            <th className="text-left px-4 py-3 font-medium">LLM</th>
            <th className="text-right px-4 py-3 font-medium">Calls</th>
            <th className="text-right px-4 py-3 font-medium">₹/min</th>
            <th className="text-left px-4 py-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((a: any) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-4 py-3"><p className="font-medium text-slate-900">{a.name}</p><p className="text-[10px] text-slate-400 font-mono">{a.id.slice(0,8)}</p></td>
              <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${a.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{a.status}</span></td>
              <td className="px-4 py-3 text-xs text-slate-600">{a.direction}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{a.llm_provider} / {a.llm_model}</td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{a.total_calls}</td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{a.cost_per_min ? `₹${a.cost_per_min.toFixed(2)}` : '—'}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{new Date(a.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.data.length === 0 && <p className="text-center py-12 text-sm text-slate-400">No agents yet.</p>}
    </div>
  );
}

function BillingTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { superAdminApi.tenantBillingHistory(tenantId, { limit: 100 }).then(setData); }, [tenantId]);
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Subscriptions</h3>
          {data.subscriptions.length === 0 ? <p className="text-sm text-slate-400">No subscriptions on file.</p> : data.subscriptions.map((s: any) => (
            <div key={s.id} className="border border-slate-100 rounded-lg p-3 mb-2">
              <div className="flex justify-between">
                <p className="font-medium text-slate-900">{s.plan_name}</p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{s.status}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">₹{s.price.toFixed(2)} / {s.billing_cycle} · auto-renew {s.auto_renew ? 'on' : 'off'}</p>
              <p className="text-[10px] text-slate-400 mt-1">Next renewal: {new Date(s.next_renewal_date).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Invoices</h3>
          {data.invoices.length === 0 ? <p className="text-sm text-slate-400">No invoices yet.</p> : (
            <ul className="space-y-1 text-xs">
              {data.invoices.map((i: any) => (
                <li key={i.id} className="flex justify-between py-1 border-b border-slate-100 last:border-0">
                  <span className="text-slate-700">{i.invoice_number || i.id.slice(0,8)}</span>
                  <span className="text-slate-500">₹{(i.amount || i.total || 0).toFixed(2)} · {i.status || 'pending'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Wallet transactions ({data.transactions.total})</h3>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr><th className="text-left py-2">When</th><th className="text-left py-2">Type</th><th className="text-left py-2">Reason</th><th className="text-right py-2">Amount</th><th className="text-right py-2">Balance after</th></tr>
          </thead>
          <tbody>
            {data.transactions.data.map((tx: any) => (
              <tr key={tx.id} className="border-t border-slate-100">
                <td className="py-1.5 text-xs text-slate-600">{new Date(tx.created_at).toLocaleString()}</td>
                <td className="py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${tx.type === 'credit' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{tx.type}</span></td>
                <td className="py-1.5 text-xs text-slate-700">{tx.reason}</td>
                <td className={`py-1.5 text-right font-mono text-xs ${tx.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>{tx.type === 'credit' ? '+' : '−'}₹{tx.amount.toFixed(2)}</td>
                <td className="py-1.5 text-right font-mono text-xs text-slate-600">₹{tx.balance_after.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResourcesTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { superAdminApi.tenantResources(tenantId).then(setData); }, [tenantId]);
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ResourceList title="Workflows" empty="No workflows." items={data.workflows} render={(w: any) => (
        <li key={w.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <span className="text-slate-700">{w.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${w.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{w.is_active ? 'active' : 'paused'}</span>
        </li>
      )} />
      <ResourceList title="Knowledge bases" empty="No knowledge bases." items={data.knowledge_bases} render={(kb: any) => (
        <li key={kb.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <span className="text-slate-700">{kb.name}</span>
          <span className="text-[10px] text-slate-500">{kb.document_count} docs</span>
        </li>
      )} />
      <ResourceList title="Phone numbers" empty="No rented numbers." items={data.phone_numbers} render={(p: any) => (
        <li key={p.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <span className="text-slate-700 inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {p.number}</span>
          <span className="text-[10px] text-slate-500">{p.provider} · {p.status} · ₹{p.monthly_cost}/mo</span>
        </li>
      )} />
      <ResourceList title="Integrations" empty="No integrations connected." items={data.integrations} render={(i: any) => (
        <li key={i.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <span className="text-slate-700">{i.provider}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${i.test_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{i.test_status || 'untested'}</span>
        </li>
      )} />
      <ResourceList title="API keys" empty="No API keys." items={data.api_keys} render={(k: any) => (
        <li key={k.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <div>
            <span className="text-slate-700">{k.name}</span>
            <span className="text-[10px] text-slate-400 font-mono ml-2">{k.key_prefix}…</span>
          </div>
          <span className="text-[10px] text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'never used'}</span>
        </li>
      )} />
    </div>
  );
}

function ResourceList({ title, items, empty, render }: { title: string; items: any[]; empty: string; render: (it: any) => any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      {items.length === 0 ? <p className="text-xs text-slate-400">{empty}</p> : <ul className="space-y-0">{items.map(render)}</ul>}
    </div>
  );
}

function AuditTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { superAdminApi.tenantAudit(tenantId, { limit: 100 }).then(setData); }, [tenantId]);
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <p className="px-5 py-3 text-xs text-slate-500 border-b border-slate-100">
        Per-tenant audit trail (HTTP-level). Sourced from <code className="text-[10px] bg-slate-100 px-1 rounded">audit_log</code>.
      </p>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-4 py-3 font-medium">When</th>
            <th className="text-left px-4 py-3 font-medium">User</th>
            <th className="text-left px-4 py-3 font-medium">Action</th>
            <th className="text-left px-4 py-3 font-medium">Resource</th>
            <th className="text-left px-4 py-3 font-medium">Method</th>
            <th className="text-left px-4 py-3 font-medium">IP</th>
            <th className="text-right px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((r: any) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-3 text-xs text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-4 py-3 text-xs text-slate-700">{r.user_email || '—'}</td>
              <td className="px-4 py-3 text-xs font-medium text-slate-900">{r.action}</td>
              <td className="px-4 py-3 text-xs text-slate-600">{r.resource_type} {r.resource_id ? `· ${String(r.resource_id).slice(0, 8)}` : ''}</td>
              <td className="px-4 py-3 text-[10px] font-mono text-slate-500">{r.method}</td>
              <td className="px-4 py-3 text-[10px] font-mono text-slate-500">{r.ip || '—'}</td>
              <td className="px-4 py-3 text-right text-xs"><span className={`px-1.5 py-0.5 rounded ${r.status_code < 300 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{r.status_code}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.data.length === 0 && (
        <p className="text-center py-12 text-sm text-slate-400">
          No HTTP-level audit entries yet for this tenant.<br />
          <span className="text-xs">The Activity tab shows synthetic events from every DB even when audit middleware hasn't fired.</span>
        </p>
      )}
    </div>
  );
}
