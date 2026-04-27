import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, TrendingDown } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

export function SuperAdminCostAnalysisPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => { superAdminApi.costAnalysis().then(setData); }, []);
  if (!data) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;

  const losers = data.data.filter((r: any) => r.margin_inr < 0);
  const totalCost = data.data.reduce((s: number, r: any) => s + r.cost_inr, 0);
  const totalRev = data.data.reduce((s: number, r: any) => s + r.revenue_inr, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <TrendingDown className="h-6 w-6 text-rose-500" /> Cost analysis
        </h1>
        <p className="text-sm text-slate-500 mt-1">Per-tenant cost-to-serve vs. wallet revenue · last {data.window_days} days</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total cost-to-serve" value={`₹${totalCost.toFixed(2)}`} accent="rose" />
        <Stat label="Total wallet revenue" value={`₹${totalRev.toFixed(2)}`} accent="emerald" />
        <Stat label="Net margin" value={`₹${(totalRev - totalCost).toFixed(2)}`} sub={`${losers.length} tenant(s) loss-making`} accent={(totalRev - totalCost) >= 0 ? 'emerald' : 'rose'} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl">
        <p className="px-5 py-3 text-xs text-slate-500 border-b border-slate-100">
          Sorted ascending by margin (loss-makers first). Cost = call minutes × agent.cost_per_min. Revenue = wallet credits in period.
        </p>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Tenant</th>
              <th className="text-right px-4 py-3 font-medium">Calls</th>
              <th className="text-right px-4 py-3 font-medium">Minutes</th>
              <th className="text-right px-4 py-3 font-medium">Cost-to-serve</th>
              <th className="text-right px-4 py-3 font-medium">Revenue</th>
              <th className="text-right px-4 py-3 font-medium">Margin</th>
              <th className="text-right px-4 py-3 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((r: any) => (
              <tr key={r.tenant_id} className={`border-t border-slate-100 ${r.margin_inr < 0 ? 'bg-rose-50/30' : ''}`}>
                <td className="px-4 py-2.5">
                  <Link to={`/super-admin/tenants/${r.tenant_id}`} className="text-sm text-slate-900 hover:text-amber-700">
                    {r.tenant_name || r.tenant_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700">{r.calls}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700">{r.minutes}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-rose-700">₹{r.cost_inr.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-700">₹{r.revenue_inr.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-right font-mono text-xs font-bold ${r.margin_inr < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  ₹{r.margin_inr.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-slate-600">{r.margin_pct === null ? '—' : `${r.margin_pct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.data.length === 0 && <p className="p-12 text-center text-sm text-slate-400">No call activity in this period.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: any; sub?: string; accent: 'rose' | 'emerald' }) {
  const color = accent === 'rose' ? 'text-rose-700' : 'text-emerald-700';
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
