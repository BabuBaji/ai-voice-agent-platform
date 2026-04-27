import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Plug } from 'lucide-react';
import { superAdminApi, type IntegrationsResp } from '@/services/superAdmin.api';

export function SuperAdminIntegrationsPage() {
  const [data, setData] = useState<IntegrationsResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.integrations().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (!data) return <div className="text-sm text-slate-400">No integration data.</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500 mt-1">Provider keys + per-tenant install health</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Platform-level providers</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {data.providers.map((p) => (
            <div key={p.key} className={`flex items-center justify-between p-3 rounded-xl border ${p.configured ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
              <div>
                <div className="flex items-center gap-2">
                  <Plug className={`h-4 w-4 ${p.configured ? 'text-emerald-500' : 'text-slate-400'}`} />
                  <p className="text-sm font-medium text-slate-900">{p.name}</p>
                </div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{p.category}</p>
                <p className="text-[10px] text-slate-400 font-mono mt-1">{p.key}</p>
              </div>
              {p.configured ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-slate-300" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Per-tenant integration installs</h3>
        {data.tenant_installs.length === 0 ? (
          <p className="text-sm text-slate-400">No tenants have configured integrations yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Provider</th>
                <th className="text-right px-4 py-2 font-medium">Installs</th>
                <th className="text-right px-4 py-2 font-medium">Enabled</th>
                <th className="text-right px-4 py-2 font-medium">Healthy</th>
                <th className="text-right px-4 py-2 font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {data.tenant_installs.map((i) => (
                <tr key={i.provider} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-sm font-medium text-slate-900">{i.provider}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">{i.install_count}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">{i.enabled_count}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-emerald-600">{i.healthy_count}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-rose-600">{i.error_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
