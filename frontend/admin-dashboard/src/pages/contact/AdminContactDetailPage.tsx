import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, AlertCircle, Send, Sparkles, Copy, Clock, Mail, Phone, MessageSquare, Globe, Building2, Users,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  contactApi,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS,
  CONTACT_METHOD_OPTIONS,
  type ContactRequest, type ContactEvent, type ContactStatus, type ContactMethod,
} from '@/services/contact.api';

const STATUSES: ContactStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'IN_PROGRESS', 'CLOSED', 'SPAM'];

export function AdminContactDetailPage() {
  const { refId } = useParams<{ refId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<{ request: ContactRequest; events: ContactEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [channel, setChannel] = useState<ContactMethod>('EMAIL');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!refId) return;
    setLoading(true); setError(null);
    try { setData(await contactApi.adminGet(refId)); }
    catch (e: any) { setError(e?.response?.data?.message || e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refId]);

  const changeStatus = async (s: ContactStatus) => {
    if (!refId) return;
    setBusy('status');
    try { await contactApi.adminSetStatus(refId, s); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refId || reply.trim().length === 0) return;
    setBusy('reply');
    try { await contactApi.adminReply(refId, reply.trim(), channel); setReply(''); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };

  const useAiDraft = () => {
    const draft = data?.request.ai_payload?.draft_reply;
    if (draft) setReply(draft);
  };

  if (loading) return <div className="max-w-4xl mx-auto p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (error || !data) return <div className="max-w-4xl mx-auto p-6 text-sm text-red-700"><AlertCircle className="h-4 w-4 inline mr-1" /> {error || 'Not found'}</div>;

  const r = data.request;
  const ai = r.ai_payload || {};

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-500">{r.reference_id}</span>
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</span>
              <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-700">{r.inquiry_type.replace(/_/g, ' ')}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mt-2">{r.full_name}{r.company_name ? ` · ${r.company_name}` : ''}</h1>
            <div className="text-xs text-gray-500 mt-1 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> Received {new Date(r.created_at).toLocaleString()}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <KV icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={<a href={`mailto:${r.email}`} className="text-indigo-600">{r.email}</a>} />
              <KV icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={<a href={`tel:${r.phone}`} className="text-indigo-600">{r.phone}</a>} />
              {r.website && <KV icon={<Globe className="h-3.5 w-3.5" />} label="Website" value={<a href={r.website} target="_blank" rel="noreferrer" className="text-indigo-600">{r.website}</a>} />}
              {r.company_size && <KV icon={<Users className="h-3.5 w-3.5" />} label="Size" value={r.company_size.replace(/_/g, ' ').toLowerCase()} />}
              <KV icon={<MessageSquare className="h-3.5 w-3.5" />} label="Preferred" value={r.preferred_contact_method.replace(/_/g, ' ')} />
              {r.company_name && <KV icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={r.company_name} />}
            </div>

            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Message</div>
              <p className="whitespace-pre-wrap text-gray-800 text-sm">{r.message}</p>
            </div>
          </Card>

          <Card className="p-5 bg-indigo-50/40 border-indigo-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-indigo-700 uppercase tracking-wide">
                <Sparkles className="h-4 w-4" /> AI Lead Qualification
              </div>
              {ai.draft_reply && (
                <Button size="sm" variant="secondary" onClick={useAiDraft}>
                  <Copy className="h-3 w-3 mr-1" /> Use draft reply
                </Button>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-800">{r.ai_summary || ai.summary || 'Awaiting AI qualification…'}</p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <KV compact label="Lead score" value={r.lead_score ?? '—'} />
              <KV compact label="Urgency" value={ai.urgency || r.priority} />
              <KV compact label="Route to" value={ai.recommended_team || '—'} />
              <KV compact label="Product interest" value={(ai.product_interest || []).join(', ') || '—'} />
            </div>
            {ai.next_best_action && (
              <div className="mt-3 text-xs"><span className="font-medium">Next best action:</span> {ai.next_best_action}</div>
            )}
            {ai.draft_reply && (
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Draft reply</div>
                <div className="text-sm bg-white border border-gray-200 rounded-md p-2 whitespace-pre-wrap">{ai.draft_reply}</div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Activity</div>
            <ol className="relative border-l border-gray-200 ml-2 space-y-3">
              {data.events.map((e) => (
                <li key={e.id} className="ml-4">
                  <div className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-white ${e.visibility === 'public' ? 'bg-indigo-300' : 'bg-gray-300'}`} />
                  <div className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()} · {e.event_type}</div>
                  <div className="text-sm text-gray-800">{e.description || '—'}</div>
                </li>
              ))}
              {data.events.length === 0 && <div className="text-sm text-gray-400 ml-4">No events yet.</div>}
            </ol>
          </Card>

          <Card className="p-4">
            <form onSubmit={sendReply}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Reply to contact</div>
                <select value={channel} onChange={(e) => setChannel(e.target.value as ContactMethod)} className={selectCls}>
                  {CONTACT_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <textarea className={inputCls} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Logged as a public activity event. (Email delivery wiring coming in a future release.)" />
              <div className="mt-2 flex justify-end">
                <Button type="submit" disabled={busy === 'reply' || reply.trim().length === 0}>
                  {busy === 'reply' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Log reply
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Status</div>
            <div className="grid grid-cols-2 gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  disabled={busy === 'status' || s === r.status}
                  onClick={() => changeStatus(s)}
                  className={`text-xs px-2 py-1 rounded-md border ${s === r.status ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </Card>

          {r.crm_lead_id && (
            <Card className="p-4 bg-emerald-50/40 border-emerald-100">
              <div className="text-xs font-medium text-emerald-700 uppercase tracking-wide mb-1">CRM</div>
              <div className="text-sm text-gray-800 font-mono break-all">{r.crm_lead_id}</div>
              <p className="text-xs text-gray-500 mt-1">Auto-created in CRM on submit.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const selectCls = 'rounded-lg border border-gray-300 px-2 py-1 text-xs';

function KV({ icon, label, value, compact = false }: { icon?: React.ReactNode; label: string; value: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`${compact ? 'bg-white border border-gray-200 rounded-md px-2 py-1' : ''}`}>
      <div className="text-[10px] uppercase text-gray-500 tracking-wide inline-flex items-center gap-1">{icon}{label}</div>
      <div className="text-gray-800 break-words">{value}</div>
    </div>
  );
}
