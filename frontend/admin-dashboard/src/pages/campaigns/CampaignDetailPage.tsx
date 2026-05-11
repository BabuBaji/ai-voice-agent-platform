import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, Upload, Plus, Loader2, AlertCircle, CheckCircle2, RefreshCw,
  ChevronDown, ChevronRight, ExternalLink, FileAudio, MessageSquare, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { campaignApi, type Campaign, type CampaignTarget } from '@/services/campaign.api';
import { conversationApi, type Conversation, type ConversationMessage } from '@/services/conversation.api';
import api from '@/services/api';

export function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [csv, setCsv] = useState('');
  const [singlePhone, setSinglePhone] = useState('');
  const [singleName, setSingleName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingConcurrency, setEditingConcurrency] = useState(false);
  const [concurrencyDraft, setConcurrencyDraft] = useState<number>(1);

  const reload = async () => {
    if (!id) return;
    try {
      const [c, t] = await Promise.all([campaignApi.get(id), campaignApi.listTargets(id)]);
      setCampaign(c);
      setTargets(t);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [id]);

  // Auto-refresh every 5s while running OR waiting (window may re-open).
  useEffect(() => {
    if (!campaign) return;
    if (campaign.status !== 'RUNNING' && campaign.status !== 'WAITING') return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [campaign?.status, id]);

  const handleStart = async () => {
    if (!id) return;
    try { setCampaign(await campaignApi.start(id)); } catch (e: any) { setError(e?.message); }
  };
  const handlePause = async () => {
    if (!id) return;
    try { setCampaign(await campaignApi.pause(id)); } catch (e: any) { setError(e?.message); }
  };

  const startConcurrencyEdit = () => {
    if (!campaign) return;
    setConcurrencyDraft(campaign.concurrency || 1);
    setEditingConcurrency(true);
  };
  const saveConcurrency = async () => {
    if (!id || !campaign) return;
    const next = Math.max(1, Math.min(10, concurrencyDraft));
    if (next === campaign.concurrency) { setEditingConcurrency(false); return; }
    try {
      const updated = await campaignApi.update(id, { concurrency: next });
      setCampaign({ ...campaign, ...updated });
      setEditingConcurrency(false);
      setInfo(`Concurrency set to ${next} — up to ${next} calls will dial in parallel from the next tick.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to update concurrency');
    }
  };

  const handleAddSingle = async () => {
    if (!id || !singlePhone.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await campaignApi.addTarget(id, { phone_number: singlePhone.trim(), name: singleName.trim() || undefined });
      setInfo(`Added ${r.added}, skipped ${r.skipped}`);
      setSinglePhone(''); setSingleName('');
      reload();
    } catch (e: any) { setError(e?.response?.data?.message || e?.message); }
    finally { setSubmitting(false); }
  };

  const handleUploadCsv = async () => {
    if (!id || !csv.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await campaignApi.uploadCsv(id, csv);
      setInfo(`Imported ${r.added} targets · skipped ${r.skipped}`);
      setCsv('');
      reload();
    } catch (e: any) { setError(e?.response?.data?.message || e?.message); }
    finally { setSubmitting(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    e.target.value = '';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>;
  }
  if (!campaign) {
    return (
      <div className="max-w-7xl mx-auto p-4">
        <Card><p className="text-sm text-gray-500">{error || 'Campaign not found.'}</p></Card>
      </div>
    );
  }

  const total = campaign.target_count || 0;
  const done = campaign.completed_count || 0;
  const failed = campaign.failed_count || 0;
  const pending = campaign.pending_count || 0;
  const inProgress = campaign.in_progress_count || 0;
  const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;

  const toggleExpand = (tid: string) => setExpandedId((cur) => (cur === tid ? null : tid));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/campaigns')} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            {campaign.name}
            <StatusBadge status={campaign.status.toLowerCase()} />
          </h1>
          <p className="text-sm text-gray-500 font-mono flex items-center gap-1 flex-wrap">
            From: {campaign.from_number} · {campaign.provider} ·
            {editingConcurrency ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={concurrencyDraft}
                  onChange={(e) => setConcurrencyDraft(parseInt(e.target.value) || 1)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveConcurrency(); if (e.key === 'Escape') setEditingConcurrency(false); }}
                  className="w-14 text-sm border border-primary-300 rounded px-1.5 py-0.5 font-mono text-center"
                  autoFocus
                />
                <button onClick={saveConcurrency} className="text-xs px-1.5 py-0.5 rounded bg-primary-600 text-white hover:bg-primary-700">Save</button>
                <button onClick={() => setEditingConcurrency(false)} className="text-xs px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-700">Cancel</button>
              </span>
            ) : (
              <button
                onClick={startConcurrencyEdit}
                disabled={campaign.status === 'RUNNING'}
                title={campaign.status === 'RUNNING' ? 'Pause the campaign first to change concurrency' : 'Click to edit — how many calls dial in parallel'}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-sm ${
                  campaign.status === 'RUNNING'
                    ? 'text-gray-500 cursor-not-allowed'
                    : 'text-primary-700 bg-primary-50 hover:bg-primary-100 cursor-pointer'
                }`}
              >
                concurrency {campaign.concurrency}{campaign.status !== 'RUNNING' && <span className="text-[10px] opacity-60">✏</span>}
              </button>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {campaign.call_window_start && campaign.call_window_end
              ? <>Calling hours: <span className="font-mono text-gray-600">{campaign.call_window_start}–{campaign.call_window_end} {campaign.timezone}</span>{campaign.status === 'WAITING' && <span className="ml-2 text-amber-600 font-medium">(outside window — sleeping)</span>}</>
              : <>Calling hours: <span className="text-gray-500">24×7 (no window set)</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={reload}><RefreshCw className="h-4 w-4" /></Button>
          {campaign.status === 'RUNNING' || campaign.status === 'WAITING' ? (
            <Button variant="outline" onClick={handlePause}><Pause className="h-4 w-4" /> Pause</Button>
          ) : (
            <Button variant="primary" onClick={handleStart} disabled={total === 0}>
              <Play className="h-4 w-4" /> {campaign.status === 'PAUSED' ? 'Resume' : 'Start'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      {info && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-success-50 border border-success-200 text-sm text-success-700">
          <CheckCircle2 className="h-4 w-4" /> {info}
          <button onClick={() => setInfo(null)} className="ml-auto text-xs underline">dismiss</button>
        </div>
      )}

      {/* Progress + KPIs */}
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <KPI label="Total" value={total} color="text-gray-900" />
          <KPI label="Pending" value={pending} color="text-gray-600" />
          <KPI label="In progress" value={inProgress} color="text-primary-600" />
          <KPI label="Completed" value={done} color="text-success-600" />
          <KPI label="Failed" value={failed} color="text-danger-600" />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">Progress</span>
            <span className="text-gray-700 font-medium">{pct}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-success-500 h-2 rounded-full transition-all" style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
          </div>
        </div>
      </Card>

      {/* Add targets */}
      <Card>
        <CardHeader title="Add Targets" subtitle="Single number or paste/upload a CSV (header: phone_number,name,…vars)" action={
          <Button variant="outline" onClick={() => setShowAdd((s) => !s)}>
            <Plus className="h-4 w-4" /> {showAdd ? 'Hide' : 'Add'}
          </Button>
        } />
        {showAdd && (
          <div className="space-y-4 mt-2">
            <div className="flex gap-2 flex-wrap">
              <input value={singlePhone} onChange={(e) => setSinglePhone(e.target.value)}
                placeholder="+919xxxxxxxxx" className="text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono flex-1 min-w-[200px]" />
              <input value={singleName} onChange={(e) => setSingleName(e.target.value)}
                placeholder="Name (optional)" className="text-sm border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]" />
              <Button variant="primary" onClick={handleAddSingle} disabled={submitting || !singlePhone.trim()}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" /> Choose CSV file</Button>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileUpload} />
                <span className="text-xs text-gray-400">…or paste below:</span>
              </div>
              <textarea value={csv} onChange={(e) => setCsv(e.target.value)}
                placeholder={'phone_number,name,company\n+919493324795,Karthik,Acme\n+918765432109,Priya,Beta'}
                rows={6}
                className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 resize-none" />
              <div className="mt-2 flex justify-end">
                <Button variant="primary" onClick={handleUploadCsv} disabled={submitting || !csv.trim()}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import targets
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Targets list — each row expandable to reveal recording + transcript + analysis */}
      <Card padding={false} className="shadow-card">
        <CardHeader className="px-4 pt-4" title="Contacts" subtitle={`${targets.length} contact${targets.length === 1 ? '' : 's'} · click any row to see recording, transcript, and AI analysis`} />
        {targets.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">No contacts yet. Add some above to get started.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Header row */}
            <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              <div className="col-span-3">Contact</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Outcome</div>
              <div className="col-span-1 text-center">Attempts</div>
              <div className="col-span-3">Last attempt</div>
              <div className="col-span-1 text-right">View</div>
            </div>
            {targets.map((t) => {
              const isOpen = expandedId === t.id;
              return (
                <div key={t.id} className={isOpen ? 'bg-primary-50/30' : 'hover:bg-gray-50/60 transition-colors'}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(t.id)}
                    className="w-full grid grid-cols-1 md:grid-cols-12 gap-3 px-4 py-3 text-left items-center"
                  >
                    <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-primary-600 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-gray-900">{t.phone_number}</div>
                        {t.name && <div className="text-xs text-gray-500 truncate">{t.name}</div>}
                      </div>
                    </div>
                    <div className="md:col-span-2"><StatusBadge status={t.status.toLowerCase()} /></div>
                    <div className="md:col-span-2 text-xs text-gray-600">{t.outcome || '—'}</div>
                    <div className="md:col-span-1 md:text-center text-sm text-gray-700">{t.attempts}</div>
                    <div className="md:col-span-3 text-xs text-gray-500">
                      {t.last_attempt_at ? new Date(t.last_attempt_at).toLocaleString() : '—'}
                    </div>
                    <div className="md:col-span-1 md:text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                        {isOpen ? 'Hide' : 'View'}
                      </span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-5 pt-1 border-t border-gray-100">
                      <TargetCallPanel target={t} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
    </div>
  );
}

// Lazy-loaded expanded view for one campaign target. Pulls the conversation
// + messages + recording for the linked conversation_id. If the call never
// connected (e.g. no-answer, dial failure) conversation_id is null and we
// show a graceful empty state with the error/outcome reason.
function TargetCallPanel({ target }: { target: CampaignTarget }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!target.conversation_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [c, m] = await Promise.all([
          conversationApi.get(target.conversation_id!),
          conversationApi.getMessages(target.conversation_id!),
        ]);
        if (cancelled) return;
        setConv(c);
        setMessages(m);
        if (c.recording_url) {
          try {
            const res = await api.get(`/conversations/${target.conversation_id}/recording`, { responseType: 'blob' });
            if (!cancelled) setAudioUrl(URL.createObjectURL(res.data));
          } catch { /* playback unavailable */ }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.message || e?.message || 'Failed to load call');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.conversation_id]);

  // No connected call yet — show why
  if (!target.conversation_id) {
    return (
      <div className="rounded-lg bg-white border border-gray-200 p-4">
        <p className="text-sm text-gray-700 font-medium">No call connected for this contact.</p>
        <p className="text-xs text-gray-500 mt-1">
          {target.last_error ? <>Last error: <span className="text-danger-600">{target.last_error}</span></>
            : target.status === 'PENDING' ? 'Waiting to dial — the campaign worker will pick this up on the next tick.'
            : target.status === 'IN_PROGRESS' ? 'Dial in flight — recording, transcript, and analysis will appear here once the call ends.'
            : target.outcome ? <>Outcome: <span className="text-gray-700 font-medium">{target.outcome}</span> (no audio captured)</>
            : 'Dial completed but the carrier did not return a conversation reference.'}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading recording, transcript &amp; analysis…
      </div>
    );
  }
  if (err) {
    return <div className="rounded-lg bg-danger-50 border border-danger-200 p-3 text-sm text-danger-700">{err}</div>;
  }

  const analysis: any = (conv?.analysis as any) || conv || {};
  const summary = analysis.short_summary || analysis.summary || conv?.summary;
  const detailedSummary = analysis.detailed_summary;
  const sentiment = analysis.sentiment || conv?.sentiment;
  const interest = analysis.interest_level ?? conv?.interest_level;
  const leadScore = analysis.lead_score;
  const nextAction = analysis.next_best_action;
  const topics = analysis.topics || conv?.topics || [];
  const keyPoints = analysis.key_points || conv?.key_points || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Recording + meta (left column) */}
      <div className="space-y-3">
        <div className="rounded-lg bg-white border border-gray-200 p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileAudio className="h-4 w-4 text-primary-600" />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Recording</span>
          </div>
          {audioUrl ? (
            <audio src={audioUrl} controls className="w-full" />
          ) : (
            <p className="text-xs text-gray-400">No recording available for this call.</p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
            <dt className="text-gray-500">Duration</dt>
            <dd className="text-gray-800 font-medium text-right">{conv?.duration_seconds ? `${Math.floor(conv.duration_seconds / 60)}m ${conv.duration_seconds % 60}s` : '—'}</dd>
            <dt className="text-gray-500">Channel</dt>
            <dd className="text-gray-800 font-medium text-right">{conv?.channel || '—'}</dd>
            <dt className="text-gray-500">Language</dt>
            <dd className="text-gray-800 font-medium text-right">{conv?.language || '—'}</dd>
            <dt className="text-gray-500">Started</dt>
            <dd className="text-gray-800 font-medium text-right">{conv?.started_at ? new Date(conv.started_at).toLocaleString() : '—'}</dd>
          </dl>
          <button
            onClick={() => navigate(`/calls/${target.conversation_id}`)}
            className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md bg-primary-50 text-primary-700 hover:bg-primary-100 font-medium"
          >
            Open full call page <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        {/* Analysis summary */}
        <div className="rounded-lg bg-white border border-gray-200 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">AI Analysis</span>
          </div>
          {summary ? (
            <p className="text-xs text-gray-700 leading-relaxed">{summary}</p>
          ) : (
            <p className="text-xs text-gray-400">No analysis yet.</p>
          )}
          {detailedSummary && detailedSummary !== summary && (
            <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">{detailedSummary}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            {sentiment && <Pill label="Sentiment" value={String(sentiment)} />}
            {interest !== undefined && interest !== null && <Pill label="Interest" value={`${interest}/10`} />}
            {leadScore !== undefined && leadScore !== null && <Pill label="Lead score" value={`${leadScore}/100`} />}
            {nextAction && <Pill label="Next action" value={String(nextAction)} />}
          </div>
          {topics.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Topics</p>
              <div className="flex flex-wrap gap-1">
                {topics.map((tp: string, i: number) => (
                  <span key={i} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{tp}</span>
                ))}
              </div>
            </div>
          )}
          {keyPoints.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Key points</p>
              <ul className="space-y-1">
                {keyPoints.map((kp: string, i: number) => (
                  <li key={i} className="text-[11px] text-gray-700 leading-snug">• {kp}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Transcript (right two columns) */}
      <div className="lg:col-span-2 rounded-lg bg-white border border-gray-200 p-3">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="h-4 w-4 text-primary-600" />
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Transcript</span>
          <span className="ml-auto text-[10px] text-gray-400">{messages.length} message{messages.length === 1 ? '' : 's'}</span>
        </div>
        {messages.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No transcript captured for this call.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    isUser ? 'bg-gray-100 text-gray-900' : 'bg-primary-100 text-primary-900'
                  }`}>
                    <p className="text-[9px] font-semibold uppercase mb-0.5 opacity-60">
                      {isUser ? 'Caller' : 'Agent'} · {new Date(m.created_at).toLocaleTimeString()}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 border border-gray-100 px-2 py-1">
      <p className="text-[9px] text-gray-500 uppercase">{label}</p>
      <p className="text-[11px] text-gray-800 font-medium truncate">{value}</p>
    </div>
  );
}
