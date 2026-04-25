import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, Send, Paperclip, Clock, Sparkles, Bot, User as UserIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supportApi, type ReportDetail, STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS } from '@/services/support.api';

export function ReportDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!ticketId) return;
    setLoading(true); setError(null);
    try {
      const d = await supportApi.get(ticketId);
      setData(d);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticketId]);

  const onSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId || reply.trim().length === 0) return;
    setSending(true);
    try {
      await supportApi.comment(ticketId, reply.trim());
      setReply('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not post comment');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</div>}

      {data && (
        <>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-500">{data.report.ticket_id}</span>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[data.report.status]}`}>
                    {STATUS_LABELS[data.report.status]}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PRIORITY_COLORS[data.report.priority]}`}>
                    {data.report.priority}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-700">{data.report.report_type.replace(/_/g, ' ')}</span>
                  {data.report.product_area && (
                    <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-700">{data.report.product_area.replace(/_/g, ' ')}</span>
                  )}
                </div>
                <h1 className="text-xl font-bold text-gray-900 mt-2">{data.report.title}</h1>
                <div className="text-xs text-gray-500 mt-1 inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Created {new Date(data.report.created_at).toLocaleString()}
                  {' · Updated '}{new Date(data.report.updated_at).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <Section title="Description"><p className="whitespace-pre-wrap text-gray-800">{data.report.description}</p></Section>
              {data.report.expected_behavior && <Section title="Expected"><p className="whitespace-pre-wrap text-gray-800">{data.report.expected_behavior}</p></Section>}
              {data.report.actual_behavior && <Section title="Actual"><p className="whitespace-pre-wrap text-gray-800">{data.report.actual_behavior}</p></Section>}
              {data.report.steps_to_reproduce && <Section title="Steps to reproduce"><pre className="whitespace-pre-wrap text-gray-800 font-mono text-xs bg-gray-50 rounded-md p-2 border border-gray-200">{data.report.steps_to_reproduce}</pre></Section>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {data.report.affected_agent_id && <KV label="Agent ID" value={String(data.report.affected_agent_id)} />}
                {data.report.affected_call_id && <KV label="Call ID" value={String(data.report.affected_call_id)} />}
                {data.report.affected_campaign_id && <KV label="Campaign ID" value={String(data.report.affected_campaign_id)} />}
                {data.report.browser && <KV label="Browser" value={String(data.report.browser)} />}
                {data.report.os && <KV label="OS" value={String(data.report.os)} />}
                {data.report.device && <KV label="Device" value={String(data.report.device)} />}
              </div>
            </div>
          </Card>

          {data.ai_analysis && (
            <Card className="p-5 mt-4">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <Sparkles className="h-4 w-4 text-indigo-500" /> AI Triage Summary
              </div>
              {data.ai_analysis.summary && (
                <p className="mt-2 text-sm text-gray-800">{data.ai_analysis.summary}</p>
              )}
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {data.ai_analysis.detected_type && <KV label="Detected type" value={String(data.ai_analysis.detected_type)} />}
                {data.ai_analysis.suggested_priority && <KV label="Suggested priority" value={String(data.ai_analysis.suggested_priority)} />}
                {data.ai_analysis.product_area && <KV label="Product area" value={String(data.ai_analysis.product_area)} />}
                {data.ai_analysis.sentiment && <KV label="Sentiment" value={String(data.ai_analysis.sentiment)} />}
              </div>
              {data.ai_analysis.recommended_next_action && (
                <div className="mt-3 text-xs text-gray-600">
                  <span className="font-medium">Recommended next action:</span> {data.ai_analysis.recommended_next_action}
                </div>
              )}
              {data.ai_analysis.possible_duplicate && (data.ai_analysis.duplicate_ticket_ids?.length || 0) > 0 && (
                <div className="mt-3 text-xs">
                  <span className="font-medium text-amber-700">Possible duplicates:</span>{' '}
                  {data.ai_analysis.duplicate_ticket_ids!.map((t) => (
                    <Link key={t} to={`/support/${t}`} className="text-indigo-600 mr-2">{t}</Link>
                  ))}
                </div>
              )}
            </Card>
          )}

          {data.attachments.length > 0 && (
            <Card className="p-4 mt-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Attachments</div>
              <ul className="space-y-1 text-sm">
                {data.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Paperclip className="h-3 w-3 text-gray-500" />
                    <a href={a.public_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{a.filename}</a>
                    <span className="text-gray-400 text-xs">{(a.size_bytes / 1024).toFixed(1)} KB · {a.mime_type}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-4 mt-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Activity</div>
            <ol className="relative border-l border-gray-200 ml-2 space-y-4">
              {data.history.map((h, i) => (
                <li key={i} className="ml-4">
                  <div className="absolute -left-1.5 w-3 h-3 bg-indigo-300 rounded-full border-2 border-white" />
                  <div className="text-xs text-gray-500">{new Date(h.created_at).toLocaleString()}</div>
                  <div className="text-sm text-gray-800">
                    Status → <span className="font-medium">{STATUS_LABELS[h.to_status as keyof typeof STATUS_LABELS] || h.to_status}</span>
                    {h.reason && <span className="text-gray-500"> — {h.reason}</span>}
                  </div>
                </li>
              ))}
              {data.comments.map((c) => (
                <li key={c.id} className="ml-4">
                  <div className="absolute -left-1.5 w-3 h-3 bg-gray-300 rounded-full border-2 border-white" />
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    {c.author_type === 'admin' ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                    {c.author_type === 'admin' ? 'Support' : 'You'} · {new Date(c.created_at).toLocaleString()}
                  </div>
                  <div className={`mt-1 text-sm whitespace-pre-wrap rounded-lg p-2 ${c.author_type === 'admin' ? 'bg-indigo-50 text-indigo-900' : 'bg-gray-50 text-gray-800'}`}>
                    {c.body}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-4 mt-4">
            <form onSubmit={onSubmitReply}>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Reply</div>
              <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Add a comment or reply to support..."
              />
              <div className="mt-2 flex justify-end">
                <Button type="submit" disabled={sending || reply.trim().length === 0}>
                  {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  {sending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}

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
