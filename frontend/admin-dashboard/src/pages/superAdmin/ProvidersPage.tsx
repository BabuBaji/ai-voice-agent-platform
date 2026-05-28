import { useEffect, useRef, useState } from 'react';
import { Radio, AlertCircle, Loader2, RefreshCw, Pause, Play, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { superAdminApi } from '@/services/superAdmin.api';

const POLL_MS = 10000;
const PROVIDER_LABELS: Record<string, string> = {
  deepgram: 'Deepgram (STT/TTS)', sarvam: 'Sarvam (Indic)', gemini: 'Google Gemini (LLM)',
  openai: 'OpenAI', anthropic: 'Anthropic', elevenlabs: 'ElevenLabs (TTS)',
  plivo: 'Plivo', twilio: 'Twilio', smtp: 'SMTP (Email)',
};

export function ProvidersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = async () => {
    try { setData(await superAdminApi.providers()); setError(null); }
    catch (e: any) { setError(e?.response?.data?.error || e?.message || 'Failed to load providers'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Radio className="h-5 w-5 text-amber-600" /> Provider Status</h1>
          <p className="text-sm text-gray-500 mt-0.5">Credential presence, delivery failure rates, and tenant integration health.</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(data.generated_at).toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} className="rounded-lg">{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{paused ? 'Resume' : 'Pause'}</Button>
          <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </div>

      {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700"><AlertCircle className="h-4 w-4 mt-0.5" /><span>{error}</span></div>}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : data ? (
        <>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Credentials configured</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(data.credentials).map(([k, v]) => (
              <div key={k} className={`rounded-xl border p-3 flex items-center justify-between ${v ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-gray-50/60'}`}>
                <span className="text-sm font-medium text-gray-800">{PROVIDER_LABELS[k] || k}</span>
                {v ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-gray-300" />}
              </div>
            ))}
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">Delivery failure rate by provider (7d)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.delivery_by_provider.length === 0 ? <p className="text-xs text-gray-400">No communications yet.</p> :
              data.delivery_by_provider.map((p: any) => (
                <Card key={p.provider}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono uppercase text-xs font-semibold text-gray-700">{p.provider || '—'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${p.failure_pct > 20 ? 'bg-danger-100 text-danger-700' : p.failure_pct > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{p.failure_pct}% fail</span>
                  </div>
                  <div className="mt-1.5 text-xl font-semibold text-gray-900">{p.total}</div>
                  <div className="text-xs text-gray-500">{p.failed} failed</div>
                </Card>
              ))}
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">Tenant integration health</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IntegrationCard title="Plivo" data={data.tenant_integrations.plivo} />
            <IntegrationCard title="WhatsApp" data={data.tenant_integrations.whatsapp} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function IntegrationCard({ title, data }: { title: string; data: { by_status: Record<string, number>; last_tested: string | null } }) {
  const entries = Object.entries(data?.by_status || {});
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-[11px] text-gray-400">Last tested: {data?.last_tested ? new Date(data.last_tested).toLocaleString() : 'never'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.length === 0 ? <span className="text-xs text-gray-400">No tenant integrations configured</span> :
          entries.map(([k, v]) => (
            <span key={k} className={`text-xs px-2 py-0.5 rounded-lg border ${k === 'active' ? 'border-emerald-200 text-emerald-700' : k === 'error' ? 'border-danger-200 text-danger-700' : 'border-gray-200 text-gray-600'}`}>{k}: <b>{v}</b></span>
          ))}
      </div>
    </Card>
  );
}
