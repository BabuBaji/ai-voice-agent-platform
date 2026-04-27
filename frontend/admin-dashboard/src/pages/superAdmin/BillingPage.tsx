import { useEffect, useState } from 'react';
import { Loader2, Wallet, AlertCircle } from 'lucide-react';
import { superAdminApi, type BillingOverview } from '@/services/superAdmin.api';

export function SuperAdminBillingPage() {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    superAdminApi.billing().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (!data) return <div className="text-sm text-slate-400">No billing data.</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Billing & revenue</h1>
        <p className="text-sm text-slate-500 mt-1">Wallet float and recent activity</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Total wallet float</p>
              <p className="text-2xl font-bold text-slate-900 mt-2">₹{data.totals.total_balance.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">{data.totals.wallet_count} wallets</p>
            </div>
            <Wallet className="h-8 w-8 text-amber-500" />
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Low-balance wallets</p>
              <p className="text-2xl font-bold text-slate-900 mt-2">{data.totals.low_count}</p>
              <p className="text-xs text-slate-500 mt-1">below threshold</p>
            </div>
            <AlertCircle className="h-8 w-8 text-rose-500" />
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2">Plan distribution</p>
          <div className="space-y-1.5">
            {data.plan_distribution.map((p) => (
              <div key={p.plan} className="flex justify-between text-sm">
                <span className="text-slate-700">{p.plan}</span>
                <span className="font-medium text-slate-900">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Top wallets</h3>
          <div className="space-y-2">
            {data.top_wallets.length === 0 ? (
              <p className="text-sm text-slate-400">No wallets yet.</p>
            ) : data.top_wallets.map((w) => (
              <div key={w.tenant_id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-xs text-slate-700">{w.tenant_name || w.tenant_id.slice(0, 8)}</span>
                <span className="text-xs font-mono font-medium text-slate-900">₹{w.balance.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Recent transactions</h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {data.recent_transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 truncate">{t.tenant_name || '—'} — {t.reason}</p>
                  <p className="text-[10px] text-slate-400">{new Date(t.created_at).toLocaleString()}</p>
                </div>
                <span className={`text-xs font-mono font-medium ${t.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {t.type === 'credit' ? '+' : '−'}₹{t.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
