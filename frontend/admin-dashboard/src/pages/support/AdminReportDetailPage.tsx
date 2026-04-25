import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, AlertCircle, Send, Paperclip, Clock, Sparkles, Copy,
  GitBranch, ShieldAlert, Bot, User as UserIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  supportApi,
  type ReportDetail, type ReportStatus, type Priority,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, PRIORITY_OPTIONS,
} from '@/services/support.api';

const STATUSES: ReportStatus[] = [
  'SUBMITTED', 'UNDER_REVIEW', 'NEED_MORE_INFO', 'IN_PROGRESS',
  'PLANNED', 'FIXED', 'RELEASED', 'REJECTED', 'DUPLICATE', 'CLOSED',
];

export function AdminReportDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState('');

  const load = async () => {
    if (!ticketId) return;
    setLoading(true); setError(null);
    try {
      const d = await supportApi.adminGet(ticketId);
      setData(d);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticketId]);

  const changeStatus = async (s: ReportStatus) => {
    if (!ticketId) return;
    setBusy('status');
    try { await supportApi.adminSetStatus(ticketId, s); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };
  const changePriority = async (p: Priority) => {
    if (!ticketId) return;
    setBusy('priority');
    try { await supportApi.adminSetPriority(ticketId, p); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };
  const postReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId || reply.trim().length === 0) return;
    setBusy('reply');
    try { await supportApi.adminReply(ticketId, reply.trim()); setReply(''); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };
  const postNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId || note.trim().length === 0) return;
    setBusy('note');
    try { await supportApi.adminInternalNote(ticketId, note.trim()); setNote(''); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };
  const markDuplicate = async () => {
    if (!ticketId || !duplicateOf) return;
    setBusy('dup');
    try { await supportApi.adminMarkDuplicate(ticketId, duplicateOf); await load(); setDuplicateOf(''); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };
  const convertToRoadmap = async () => {
    if (!ticketId) return;
    setBusy('roadmap');
    try { await supportApi.adminConvertToRoadmap(ticketId); await load(); }
    catch (e: any) { setError(e?.message || 'failed'); }
    finally { setBusy(null); }
  };
  const useAiDraft = () => {
    if (data?.ai_analysis?.draft_user_reply) {
      setReply(data.ai_analysis.draft_user_reply);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </button>

      {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</div>}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-gray-500">{data.report.ticket_id}</span>
                <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[data.report.status]}`}>
                  {STATUS_LABELS[data.report.status]}
                </span>
                <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PRIORITY_COLORS[data.report.priority]}`}>{data.report.priority}</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mt-2">{data.report.title}</h1>
              <div className="text-xs text-gray-500 mt-1 inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {new Date(data.report.created_at).toLocaleString()}
                <span>· from {data.report.name} &lt;{data.report.email}&gt;</span>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <Section title="Description"><p className="whitespace-pre-wrap text-gray-800">{data.report.description}</p></Section>
                {data.report.expected_behavior && <Section title="Expected"><p className="whitespace-pre-wrap text-gray-800">{data.report.expected_behavior}</p></Section>}
                {data.report.actual_behavior && <Section title="Actual"><p className="whitespace-pre-wrap text-gray-800">{data.report.actual_behavior}</p></Section>}
                {data.report.steps_to_reproduce && <Section title="Steps to reproduce"><pre className="whitespace-pre-wrap text-gray-800 font-mono text-xs bg-gray-50 rounded-md p-2 border border-gray-200">{data.report.steps_to_reproduce}</pre></Section>}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  {data.report.affected_agent_id && <KV label="Agent" value={String(data.report.affected_agent_id)} />}
                  {data.report.affected_call_id && <KV label="Call" value={String(data.report.affected_call_id)} />}
                  {data.report.affected_campaign_id && <KV label="Campaign" value={String(data.report.affected_campaign_id)} />}
                  {data.report.browser && <KV label="Browser" value={String(data.report.browser)} />}
                  {data.report.os && <KV label="OS" value={String(data.report.os)} />}
                  {data.report.device && <KV label="Device" value={String(data.report.device)} />}
                </div>

                {data.attachments.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Attachments</div>
                    <ul className="space-y-1 text-sm">
                      {data.attachments.map((a) => (
                        <li key={a.id} className="flex items-center gap-2">
                          <Paperclip className="h-3 w-3 text-gray-500" />
                          <a href={a.public_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{a.filename}</a>
                          <span className="text-gray-400 text-xs">{(a.size_bytes / 1024).toFixed(1)} KB · {a.mime_type}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>

            {data.ai_analysis && (
              <Card className="p-5 bg-indigo-50/40 border-indigo-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-indigo-700 uppercase tracking-wide">
                    <Sparkles className="h-4 w-4" /> AI Triage
                  </div>
                  {data.ai_analysis.draft_user_reply && (
                    <Button size="sm" variant="secondary" onClick={useAiDraft}>
                      <Copy className="h-3 w-3 mr-1" /> Use draft reply
                    </Button>
                  )}
                </div>
                {data.ai_analysis.summary && (
                  <p className="mt-2 text-sm text-gray-800"><span className="font-medium">Summary:</span> {data.ai_analysis.summary}</p>
                )}
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  {data.ai_analysis.detected_type && <KV label="Detected type" value={String(data.ai_analysis.detected_type)} />}
                  {data.ai_analysis.suggested_priority && <KV label="Suggested priority" value={String(data.ai_analysis.suggested_priority)} />}
                  {data.ai_analysis.sentiment && <KV label="Sentiment" value={String(data.ai_analysis.sentiment)} />}
                  {data.ai_analysis.suggested_assignee_team && <KV label="Route to" value={String(data.ai_analysis.suggested_assignee_team)} />}
                </div>
                {data.ai_analysis.recommended_next_action && (
                  <div className="mt-3 text-xs"><span className="font-medium">Next action:</span> {data.ai_analysis.recommended_next_action}</div>
                )}
                {data.ai_analysis.possible_duplicate && (data.ai_analysis.duplicate_ticket_ids?.length || 0) > 0 && (
                  <div className="mt-2 text-xs">
                    <span className="font-medium text-amber-700">Possible duplicates:</span>{' '}
                    {data.ai_analysis.duplicate_ticket_ids!.map((t) => (
                      <Link key={t} to={`/admin/reports/${t}`} className="text-indigo-600 mr-2">{t}</Link>
                    ))}
                  </div>
                )}
                {data.ai_analysis.draft_user_reply && (
                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Draft reply to user</div>
                    <div className="text-sm bg-white border border-gray-200 rounded-md p-2 whitespace-pre-wrap">{data.ai_analysis.draft_user_reply}</div>
                  </div>
                )}
              </Card>
            )}

            {/* Activity timeline */}
            <Card className="p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Activity</div>
              <ol className="relative border-l border-gray-200 ml-2 space-y-3">
                {[...data.history, ...data.comments.map((c) => ({ ...c, kind: 'comment' as const })), ...(data.internal_notes || []).map((n) => ({ ...n, kind: 'note' as const }))]
                  .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                  .map((e: any, i: number) => {
                    if (e.to_status !== undefined) {
                      return (
                        <li key={`h-${i}`} className="ml-4">
                          <div className="absolute -left-1.5 w-3 h-3 bg-indigo-300 rounded-full border-2 border-white" />
                          <div className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
                          <div className="text-sm text-gray-800">
                            Status → <span className="font-medium">{STATUS_LABELS[e.to_status as keyof typeof STATUS_LABELS] || e.to_status}</span>
                            {e.reason && <span className="text-gray-500"> — {e.reason}</span>}
                          </div>
                        </li>
                      );
                    }
                    if (e.kind === 'comment') {
                      return (
                        <li key={`c-${i}`} className="ml-4">
                          <div className="absolute -left-1.5 w-3 h-3 bg-gray-300 rounded-full border-2 border-white" />
                          <div className="text-xs text-gray-500 flex items-center gap-1">
                            {e.author_type === 'admin' ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                            {e.author_type === 'admin' ? 'Support' : 'User'} · {new Date(e.created_at).toLocaleString()}
                          </div>
                          <div className={`mt-1 text-sm whitespace-pre-wrap rounded-lg p-2 ${e.author_type === 'admin' ? 'bg-indigo-50 text-indigo-900' : 'bg-gray-50 text-gray-800'}`}>{e.body}</div>
                        </li>
                      );
                    }
                    // internal note
                    return (
                      <li key={`n-${i}`} className="ml-4">
                        <div className="absolute -left-1.5 w-3 h-3 bg-amber-300 rounded-full border-2 border-white" />
                        <div className="text-xs text-amber-700 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3" /> Internal · {new Date(e.created_at).toLocaleString()}
                        </div>
                        <div className="mt-1 text-sm whitespace-pre-wrap rounded-lg p-2 bg-amber-50 text-amber-900 border border-amber-100">{e.body}</div>
                      </li>
                    );
                  })}
              </ol>
            </Card>

            <Card className="p-4">
              <form onSubmit={postReply}>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Reply to user (public)</div>
                <textarea className={inputCls} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Visible to the reporter" />
                <div className="mt-2 flex justify-end">
                  <Button type="submit" disabled={busy === 'reply' || reply.trim().length === 0}>
                    {busy === 'reply' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                    Send reply
                  </Button>
                </div>
              </form>
            </Card>

            <Card className="p-4 bg-amber-50/40 border-amber-100">
              <form onSubmit={postNote}>
                <div className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">Internal note (team only)</div>
                <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Private to support/engineering" />
                <div className="mt-2 flex justify-end">
                  <Button type="submit" variant="secondary" disabled={busy === 'note' || note.trim().length === 0}>
                    {busy === 'note' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                    Save note
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card className="p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Status</div>
              <div className="grid grid-cols-2 gap-1">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    disabled={busy === 'status' || s === data.report.status}
                    onClick={() => changeStatus(s)}
                    className={`text-xs px-2 py-1 rounded-md border ${s === data.report.status ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Priority</div>
              <div className="grid grid-cols-4 gap-1">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    disabled={busy === 'priority' || p.value === data.report.priority}
                    onClick={() => changePriority(p.value)}
                    className={`text-xs px-2 py-1 rounded-md border ${p.value === data.report.priority ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Mark duplicate of</div>
              <div className="flex items-center gap-1">
                <input className={inputCls + ' font-mono'} placeholder="ISS-000123" value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} />
                <Button size="sm" variant="secondary" disabled={!duplicateOf || busy === 'dup'} onClick={markDuplicate}>
                  <GitBranch className="h-3 w-3 mr-1" /> Link
                </Button>
              </div>
            </Card>

            {data.report.report_type === 'FEATURE_REQUEST' && (
              <Card className="p-4">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Roadmap</div>
                <Button variant="secondary" size="sm" disabled={busy === 'roadmap'} onClick={convertToRoadmap}>
                  Convert to roadmap item
                </Button>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-0.5">{title}</div>
      {children}
    </div>
  );
}
function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
      <div className="text-[10px] uppercase text-gray-500 tracking-wide">{label}</div>
      <div className="font-mono text-gray-800 break-all">{value}</div>
    </div>
  );
}
