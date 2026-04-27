import { useEffect, useState, useCallback } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Search, Download } from 'lucide-react';
import { superAdminApi, downloadCsv, type AuditRow } from '@/services/superAdmin.api';

export function SuperAdminAuditLogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [adminFilter, setAdminFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await superAdminApi.auditLogs({
        page, limit: 50,
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        admin: adminFilter || undefined,
      });
      setRows(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, moduleFilter, adminFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [moduleFilter, adminFilter]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>
          <p className="text-sm text-slate-500 mt-1">Every super-admin action — never edited, never deleted</p>
        </div>
        <button
          onClick={() => downloadCsv(`audit-${new Date().toISOString().slice(0,10)}.csv`, rows, [
            { key: 'created_at', label: 'When' },
            { key: 'admin_email', label: 'Admin' },
            { key: 'module', label: 'Module' },
            { key: 'action', label: 'Action' },
            { key: 'target_tenant_name', label: 'Target tenant' },
            { key: 'target_tenant_id', label: 'Target tenant ID' },
            { key: 'target_resource_type', label: 'Resource type' },
            { key: 'target_resource_id', label: 'Resource ID' },
            { key: 'ip', label: 'IP' },
            { key: 'payload', label: 'Payload', render: (r) => JSON.stringify(r.payload) },
          ])}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3 items-center">
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All modules</option>
          <option value="tenants">Tenants</option>
          <option value="billing">Billing</option>
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} placeholder="Admin email…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400">No audit entries yet — actions you take here will appear immediately.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">When</th>
                <th className="text-left px-4 py-3 font-medium">Admin</th>
                <th className="text-left px-4 py-3 font-medium">Module</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Target tenant</th>
                <th className="text-left px-4 py-3 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">{r.admin_email}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{r.module}</td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-900">{r.action}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {r.target_tenant_name || (r.target_tenant_id ? r.target_tenant_id.slice(0, 8) : '—')}
                  </td>
                  <td className="px-4 py-3">
                    <pre className="text-[10px] text-slate-500 font-mono whitespace-pre-wrap break-all max-w-xl">{JSON.stringify(r.payload, null, 0)}</pre>
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
