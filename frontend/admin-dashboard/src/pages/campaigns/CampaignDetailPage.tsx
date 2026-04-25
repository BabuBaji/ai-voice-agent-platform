import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Upload, Plus, Loader2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { campaignApi, type Campaign, type CampaignTarget } from '@/services/campaign.api';

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

  // Auto-refresh every 5s while running
  useEffect(() => {
    if (!campaign || campaign.status !== 'RUNNING') return;
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

  const columns = [
    {
      key: 'phone_number', label: 'Phone',
      render: (t: CampaignTarget) => (
        <div>
          <div className="font-mono text-sm text-gray-900">{t.phone_number}</div>
          {t.name && <div className="text-xs text-gray-500">{t.name}</div>}
        </div>
      ),
    },
    { key: 'attempts', label: 'Attempts', render: (t: CampaignTarget) => <span className="text-sm">{t.attempts}</span> },
    { key: 'status', label: 'Status', render: (t: CampaignTarget) => <StatusBadge status={t.status.toLowerCase()} /> },
    {
      key: 'outcome', label: 'Outcome',
      render: (t: CampaignTarget) => <span className="text-xs text-gray-600">{t.outcome || '—'}</span>,
    },
    {
      key: 'last_error', label: 'Error',
      render: (t: CampaignTarget) => (
        <span className="text-xs text-danger-600 line-clamp-1 max-w-[300px]" title={t.last_error || ''}>
          {t.last_error || ''}
        </span>
      ),
    },
    {
      key: 'last_attempt_at', label: 'Last attempt',
      render: (t: CampaignTarget) => (
        <span className="text-xs text-gray-500">
          {t.last_attempt_at ? new Date(t.last_attempt_at).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'view', label: '',
      render: (t: CampaignTarget) => (
        t.conversation_id ? (
          <button onClick={(e) => { e.stopPropagation(); navigate(`/calls/${t.conversation_id}`); }}
            className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700 hover:bg-primary-100">
            View call
          </button>
        ) : null
      ),
    },
  ];

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
          <p className="text-sm text-gray-500 font-mono">From: {campaign.from_number} · {campaign.provider} · concurrency {campaign.concurrency}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={reload}><RefreshCw className="h-4 w-4" /></Button>
          {campaign.status === 'RUNNING' ? (
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

      {/* Targets table */}
      <Card padding={false} className="shadow-card">
        <CardHeader className="px-4 pt-4" title="Targets" subtitle={`${targets.length} loaded`} />
        {targets.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">No targets yet. Add some above to get started.</div>
        ) : (
          <Table columns={columns} data={targets} />
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
