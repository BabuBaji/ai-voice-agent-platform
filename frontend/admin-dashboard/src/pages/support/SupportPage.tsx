import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bug, Send, LifeBuoy, Loader2, AlertCircle, Clock, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ReportIssueForm } from '@/components/support/ReportIssueForm';
import { supportApi, type ReportSummary, STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS } from '@/services/support.api';

export function SupportPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'report' | 'my'>('report');
  const [submitted, setSubmitted] = useState<{ ticket_id: string; message: string } | null>(null);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMyReports = async () => {
    setLoading(true); setError(null);
    try {
      const r = await supportApi.my(1, 50);
      setReports(r.items);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'my' && reports === null) loadMyReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onSubmitted = (res: { ticket_id: string; message: string }) => {
    setSubmitted(res);
    // Refresh the My Reports tab next time it's viewed
    setReports(null);
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
          <LifeBuoy className="h-6 w-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Report Issue</h1>
          <p className="text-sm text-gray-500">Help us improve by reporting bugs, issues, or requesting new features.</p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-200 w-fit">
        <button
          onClick={() => setTab('report')}
          className={`h-8 px-4 rounded-lg text-sm font-medium ${tab === 'report' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <Bug className="h-4 w-4 inline mr-1" /> New Report
        </button>
        <button
          onClick={() => setTab('my')}
          className={`h-8 px-4 rounded-lg text-sm font-medium ${tab === 'my' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
        >
          My Reports
        </button>
      </div>

      {tab === 'report' ? (
        submitted ? (
          <Card className="mt-5 p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">Report submitted</h2>
            <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">{submitted.message}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button variant="secondary" onClick={() => { setSubmitted(null); setTab('my'); }}>
                View My Reports
              </Button>
              <Button onClick={() => setSubmitted(null)}>
                Submit another
              </Button>
            </div>
            <div className="mt-4">
              <Link to={`/support/${submitted.ticket_id}`} className="text-sm text-indigo-600 inline-flex items-center gap-1">
                Open ticket {submitted.ticket_id} <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </Card>
        ) : (
          <div className="mt-5">
            <ReportIssueForm onSubmitted={onSubmitted} mode="authed" />
          </div>
        )
      ) : (
        <Card className="mt-5 p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
          {!loading && !error && reports && reports.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-500">
              No reports yet. Click "New Report" to submit your first one.
            </div>
          )}
          {!loading && !error && reports && reports.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Ticket</th>
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Priority</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Updated</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/support/${r.ticket_id}`)}>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-700">{r.ticket_id}</td>
                      <td className="py-2 pr-3 text-gray-900">{r.title}</td>
                      <td className="py-2 pr-3 text-xs text-gray-600">{r.report_type.replace(/_/g, ' ')}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-500 inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {new Date(r.updated_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs">
                        <span className="text-indigo-600">Open →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
