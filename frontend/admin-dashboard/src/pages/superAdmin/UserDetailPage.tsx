import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail, Phone, BadgeCheck, Building2, Bot, PhoneCall, ShieldAlert } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

export function SuperAdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    superAdminApi.userActivity(id)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.error || e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (error || !data) return <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error || 'Not found'}</div>;

  const u = data.user;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{u.first_name} {u.last_name}</h1>
            {u.email_verified && <BadgeCheck className="h-4 w-4 text-emerald-500" />}
            {u.is_platform_admin && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Super admin</span>}
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${u.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{u.status}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5"><Mail className="inline h-3 w-3" /> {u.email} · <Phone className="inline h-3 w-3" /> {u.phone || '—'}</p>
        </div>
        <button onClick={() => navigate(`/super-admin/tenants/${u.tenant_id}`)} className="text-xs px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 inline-flex items-center gap-1">
          <Building2 className="h-3.5 w-3.5" /> {u.tenant_name}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Bot} label="Agents owned" value={data.stats.agents_owned} />
        <Stat icon={PhoneCall} label="Calls handled" value={data.stats.calls_handled} sub="via owned agents" />
        <Stat icon={ShieldAlert} label="Audit entries" value={data.audit_trail.length} />
        <Stat icon={BadgeCheck} label="Logins recorded" value={data.login_history.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Login history</h3>
          <p className="text-xs text-slate-500 mb-3">Each row = a refresh-token issuance (a login or token refresh)</p>
          {data.login_history.length === 0 ? <p className="text-xs text-slate-400">Never logged in.</p> : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {data.login_history.map((l: any, i: number) => (
                <li key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                  <span className="text-slate-700">{new Date(l.created_at).toLocaleString()}</span>
                  <span className="text-[10px] text-slate-500">expires {new Date(l.expires_at).toLocaleDateString()} {l.revoked && <span className="text-rose-500 ml-1">revoked</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Audit trail</h3>
          {data.audit_trail.length === 0 ? <p className="text-xs text-slate-400">No audited actions yet.</p> : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {data.audit_trail.map((a: any, i: number) => (
                <li key={i} className="text-xs py-1 border-b border-slate-100 last:border-0">
                  <p className="text-slate-800"><span className="font-mono text-slate-500 mr-1">{a.method}</span><span className="font-medium">{a.action}</span></p>
                  <p className="text-[10px] text-slate-400">{new Date(a.created_at).toLocaleString()} · {a.ip || '—'} · status {a.status_code}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Agents owned ({data.agents_owned.length})</h3>
          {data.agents_owned.length === 0 ? <p className="text-xs text-slate-400">No agents created.</p> : (
            <ul className="space-y-1">
              {data.agents_owned.map((a: any) => (
                <li key={a.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                  <span className="text-slate-700">{a.name}</span>
                  <span className="text-[10px] text-slate-500">{a.status} · {a.direction}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Recent calls via this user's agents</h3>
          {data.recent_calls_via_agents.length === 0 ? <p className="text-xs text-slate-400">No calls yet.</p> : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {data.recent_calls_via_agents.map((c: any) => (
                <li key={c.id} className="text-xs py-1 border-b border-slate-100 last:border-0">
                  <p className="text-slate-700">{c.caller_number || '—'} → {c.called_number || '—'} <span className="text-[10px] text-slate-500 ml-1">({c.status})</span></p>
                  <p className="text-[10px] text-slate-400">{new Date(c.started_at).toLocaleString()} · {c.duration_seconds || 0}s</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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
