import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ExternalLink, Download } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';
import api from '@/services/api';

export function SuperAdminCallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Recording is fetched as a blob (so the auth interceptor can attach the
  // bearer token) and replayed via an object URL — <audio src> can't set
  // headers, which is why the gateway-protected /conversations/:id/recording
  // endpoint would otherwise return 401.
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await superAdminApi.callDetail(id);
        if (cancelled) return;
        setData(d);

        if (d.conversation.recording_url) {
          try {
            const r = await api.get(`/conversations/${id}/recording`, { responseType: 'blob' });
            if (!cancelled) setAudioBlobUrl(URL.createObjectURL(r.data));
          } catch (e: any) {
            if (!cancelled) setAudioError(e?.response?.data?.message || 'Recording failed to load');
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || e?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    return () => {
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    };
  }, [audioBlobUrl]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (error || !data) return <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error}</div>;

  const c = data.conversation;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/super-admin/calls')} className="p-2 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">Call detail</h1>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{c.id}</p>
        </div>
        <button onClick={() => navigate(`/calls/${c.id}`)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1">
          <ExternalLink className="h-3 w-3" /> Open in tenant view
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Tenant" value={data.tenant?.name || '—'} sub={c.tenant_id} />
        <Field label="Agent" value={c.agent_id?.slice(0, 8) || '—'} />
        <Field label="Channel" value={c.channel} />
        <Field label="Status" value={c.status} />
        <Field label="From" value={c.caller_number || '—'} />
        <Field label="To" value={c.called_number || '—'} />
        <Field label="Duration" value={c.duration_seconds ? `${Math.round(c.duration_seconds)}s` : '—'} />
        <Field label="Sentiment" value={c.sentiment || '—'} />
      </div>

      {c.recording_url && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-slate-500 font-medium">Recording</p>
            {audioBlobUrl && (
              <a href={audioBlobUrl} download={`recording-${c.id}.wav`} className="text-xs text-amber-700 hover:text-amber-800 inline-flex items-center gap-1">
                <Download className="h-3 w-3" /> Download
              </a>
            )}
          </div>
          {audioBlobUrl ? (
            <audio controls src={audioBlobUrl} className="w-full" preload="metadata" />
          ) : audioError ? (
            <div className="text-xs text-rose-600 py-3">{audioError}</div>
          ) : (
            <div className="text-xs text-slate-400 py-3 inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading recording…
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-2 font-mono break-all">{c.recording_url}</p>
        </div>
      )}

      {c.summary && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">Summary</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.summary}</p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-3">Transcript ({data.messages.length} messages)</p>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {data.messages.map((m: any) => (
            <div key={m.id} className={`px-3 py-2 rounded-lg ${m.role === 'user' ? 'bg-slate-50 text-slate-800' : 'bg-amber-50/40 text-slate-800'}`}>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">{m.role}</p>
              <p className="text-sm whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
      <p className="text-sm font-medium text-slate-900 mt-1">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{sub}</p>}
    </div>
  );
}
