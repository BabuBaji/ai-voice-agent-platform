/**
 * WhatsApp delivery analytics — tile grid with counts + per-template table.
 */
import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import api from '@/services/api';

interface Counts {
  queued: number; sent: number; delivered: number; read: number; failed: number; replied: number;
}
interface Rates {
  delivery_rate: number; read_rate: number; reply_rate: number; failure_rate: number;
}
interface AnalyticsResp { days: number; counts: Counts; total: number; rates: Rates; }
interface TplRow { template_name: string; queued: number; sent: number; delivered: number; read: number; failed: number; replied: number; total: number; }

const STATUS_COLOR: Record<keyof Counts, string> = {
  queued: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-cyan-100 text-cyan-700',
  read: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  replied: 'bg-purple-100 text-purple-700',
};

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [byTpl, setByTpl] = useState<TplRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        api.get<AnalyticsResp>(`/whatsapp/analytics?days=${days}`),
        api.get<{ templates: TplRow[] }>(`/whatsapp/analytics/by-template?days=${days}`),
      ]);
      setData(a.data);
      setByTpl(t.data.templates || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [days]);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Delivery Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Per-tenant WhatsApp performance over the selected window.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <Button onClick={load}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </header>

      {loading || !data ? (
        <Card><div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></Card>
      ) : (
        <>
          {/* Status counts tile grid */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {(Object.keys(data.counts) as Array<keyof Counts>).map((k) => (
              <Card key={k} className={`p-4 ${STATUS_COLOR[k]}`}>
                <div className="text-xs uppercase opacity-75">{k}</div>
                <div className="text-3xl font-semibold mt-1">{data.counts[k]}</div>
              </Card>
            ))}
          </div>

          {/* Conversion rates */}
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Conversion (last {data.days} days, {data.total} total)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <RateTile label="Delivery rate" value={data.rates.delivery_rate} hint="delivered / sent" />
              <RateTile label="Read rate" value={data.rates.read_rate} hint="read / delivered" />
              <RateTile label="Reply rate" value={data.rates.reply_rate} hint="replied / delivered" />
              <RateTile label="Failure rate" value={data.rates.failure_rate} hint="failed / total" reverse />
            </div>
          </Card>

          {/* Per-template breakdown */}
          <Card>
            <div className="p-4 border-b text-sm font-medium">By template</div>
            {byTpl.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No template-tagged sends in this window.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Template</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Sent</th>
                    <th className="px-4 py-2 text-right">Delivered</th>
                    <th className="px-4 py-2 text-right">Read</th>
                    <th className="px-4 py-2 text-right">Replied</th>
                    <th className="px-4 py-2 text-right">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {byTpl.map((t) => (
                    <tr key={t.template_name} className="border-t">
                      <td className="px-4 py-2 font-mono text-xs">{t.template_name}</td>
                      <td className="px-4 py-2 text-right">{t.total}</td>
                      <td className="px-4 py-2 text-right">{t.sent}</td>
                      <td className="px-4 py-2 text-right">{t.delivered}</td>
                      <td className="px-4 py-2 text-right">{t.read}</td>
                      <td className="px-4 py-2 text-right">{t.replied}</td>
                      <td className="px-4 py-2 text-right text-red-600">{t.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function RateTile({ label, value, hint, reverse }: { label: string; value: number; hint: string; reverse?: boolean }) {
  const pct = (value * 100).toFixed(1);
  const tone = reverse
    ? value < 0.05 ? 'text-green-600' : value < 0.2 ? 'text-yellow-600' : 'text-red-600'
    : value > 0.5 ? 'text-green-600' : value > 0.2 ? 'text-yellow-600' : 'text-gray-600';
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${tone}`}>{pct}%</div>
      <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
    </div>
  );
}
