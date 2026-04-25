import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronRight, ChevronLeft, Phone, AlertCircle, Upload, FileText,
  Calendar, RefreshCw, Loader2, CheckCircle2, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { campaignApi } from '@/services/campaign.api';
import { agentApi } from '@/services/agent.api';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';

const STEPS = [
  { id: 1, title: 'Campaign & Phone Number' },
  { id: 2, title: 'Upload Contact List' },
  { id: 3, title: 'Campaign Settings' },
  { id: 4, title: 'Review & Create' },
];

interface ParsedTarget {
  phone_number: string;
  name?: string;
  variables: Record<string, string>;
}

export function CampaignWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberRecord[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [concurrency, setConcurrency] = useState(1);

  // Step 2
  const [csvText, setCsvText] = useState('');
  const [targets, setTargets] = useState<ParsedTarget[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [retryDelay, setRetryDelay] = useState(900);
  const [scheduleStartAt, setScheduleStartAt] = useState('');
  const [provider, setProvider] = useState<'plivo' | 'twilio' | 'exotel'>('plivo');

  useEffect(() => {
    phoneNumberApi.list()
      .then((nums) => {
        setPhoneNumbers(nums);
        // auto-pick the first assigned-to-an-agent number
        const usable = nums.find((n) => n.agent_id);
        if (usable) {
          setPhoneNumberId(usable.id);
          if (usable.provider) setProvider(usable.provider as any);
        }
      })
      .catch(() => {});
    agentApi.list().then((a: any) => {
      const arr = Array.isArray(a) ? a : a?.data || [];
      setAgents(arr.map((x: any) => ({ id: x.id, name: x.name })));
    }).catch(() => {});
  }, []);

  const selectedPhone = useMemo(() => phoneNumbers.find((n) => n.id === phoneNumberId) || null, [phoneNumberId, phoneNumbers]);
  const selectedAgentName = useMemo(() => {
    if (!selectedPhone?.agent_id) return null;
    return agents.find((a) => a.id === selectedPhone.agent_id)?.name || selectedPhone.agent_id;
  }, [selectedPhone, agents]);

  // ── CSV parsing ───────────────────────────────────────────────
  // Lightweight client-side parse so we can show a preview + count before
  // shipping to the backend. The backend re-parses authoritatively.
  const parseCsv = (text: string) => {
    setParseError(null);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      setTargets([]);
      return;
    }
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const phoneIdx = header.findIndex((h) => h === 'phone_number' || h === 'phone' || h === 'number' || h === 'to');
    if (phoneIdx === -1) {
      setParseError('CSV must contain a column named phone_number / phone / number / to');
      setTargets([]);
      return;
    }
    const nameIdx = header.findIndex((h) => h === 'name');
    const out: ParsedTarget[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      const phone = parts[phoneIdx];
      if (!phone) continue;
      const variables: Record<string, string> = {};
      header.forEach((h, idx) => {
        if (h === 'phone_number' || h === 'phone' || h === 'number' || h === 'to' || h === 'name') return;
        if (parts[idx]) variables[h] = parts[idx];
      });
      out.push({ phone_number: phone, name: nameIdx >= 0 ? parts[nameIdx] : undefined, variables });
    }
    setTargets(out);
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    parseCsv(text);
    e.target.value = '';
  };

  // ── Validation ─────────────────────────────────────────────────
  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!name.trim()) return 'Campaign name is required';
      if (!phoneNumberId) return 'Pick a phone number';
      if (!selectedPhone?.agent_id) return 'The selected number must be attached to an agent';
    }
    if (s === 2) {
      if (targets.length === 0) return 'Upload or paste at least one contact';
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => Math.min(STEPS.length, s + 1));
  };
  const goBack = () => { setError(null); setStep((s) => Math.max(1, s - 1)); };

  // ── Final create flow ─────────────────────────────────────────
  const handleCreate = async () => {
    if (!selectedPhone?.agent_id) { setError('Selected number has no agent'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const created = await campaignApi.create({
        name: name.trim(),
        agent_id: selectedPhone.agent_id,
        from_number: selectedPhone.phone_number,
        provider,
        concurrency,
        max_attempts: maxAttempts,
        retry_delay_seconds: retryDelay,
        schedule_start_at: scheduleStartAt || undefined,
      } as any);

      // Upload contacts
      if (csvText.trim()) {
        await campaignApi.uploadCsv(created.id, csvText);
      } else {
        // Fall back: upload one-by-one
        for (const t of targets) {
          await campaignApi.addTarget(created.id, t);
        }
      }
      navigate(`/campaigns/${created.id}`);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  const usableNumbers = phoneNumbers.filter((n) => n.is_active);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ─── Step indicator ─── */}
      <ol className="flex items-center justify-center gap-2 sm:gap-6">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <li key={s.id} className="flex items-center gap-2 sm:gap-6">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  done
                    ? 'bg-primary-500 text-white'
                    : active
                    ? 'bg-primary-500 text-white ring-4 ring-primary-500/20'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {done ? <Check className="h-4 w-4" /> : s.id}
                </div>
                <span className={`text-sm hidden sm:inline ${active ? 'text-gray-900 font-semibold' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                  {s.title}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`hidden sm:block h-px w-8 ${done ? 'bg-primary-500' : 'bg-gray-200'}`} />
              )}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ─── Step 1: Campaign & Phone Number ─── */}
      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Campaign Details</h3>
            <p className="text-sm text-gray-500 mb-4">Enter a name for your bulk call campaign</p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Campaign Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Q2 Outbound — Karnataka Leads"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900">Phone Number</h3>
            <p className="text-sm text-gray-500 mb-4">Select a phone number to use for this campaign</p>

            {usableNumbers.length === 0 ? (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-danger-300 bg-danger-50/40 text-danger-700 mb-4">
                <Phone className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">No Phone Numbers Available</p>
                  <p className="text-xs mt-1">
                    You need to purchase a phone number and attach an agent to it before you can create a campaign.
                    Please visit the <a href="/settings/phone-numbers" className="underline font-medium">Phone Numbers</a> section to buy a number first.
                  </p>
                </div>
              </div>
            ) : null}

            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
            <select
              value={phoneNumberId}
              onChange={(e) => {
                setPhoneNumberId(e.target.value);
                const pn = phoneNumbers.find((n) => n.id === e.target.value);
                if (pn?.provider) setProvider(pn.provider as any);
              }}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="">Select a phone number</option>
              {usableNumbers.map((n) => {
                const ag = agents.find((a) => a.id === n.agent_id);
                return (
                  <option key={n.id} value={n.id}>
                    {n.phone_number} ({n.provider}){n.agent_id ? ` — ${ag?.name || 'agent'}` : ' — UNATTACHED'}
                  </option>
                );
              })}
            </select>
            {selectedPhone && !selectedPhone.agent_id && (
              <p className="text-xs text-danger-600 mt-2">
                This number has no agent attached. Pick a different number or attach an agent in the Phone Numbers page.
              </p>
            )}
            {selectedAgentName && (
              <p className="text-xs text-gray-500 mt-2">
                Calls will use agent: <span className="font-medium text-gray-700">{selectedAgentName}</span>
              </p>
            )}
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900">Concurrent Call Settings</h3>
            <p className="text-sm text-gray-500 mb-4">Set how many calls can run simultaneously (max: 10)</p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Concurrent Call Limit</label>
            <input
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            <p className="text-xs text-gray-500 mt-2">Controls how many calls will be active at the same time</p>
          </Card>
        </div>
      )}

      {/* ─── Step 2: Upload Contact List ─── */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Upload Contact List</h3>
            <p className="text-sm text-gray-500 mb-4">
              CSV with a header row. Required column: <code className="text-[11px] bg-gray-100 px-1 rounded">phone_number</code> (or
              <code className="text-[11px] bg-gray-100 px-1 rounded">phone</code> /
              <code className="text-[11px] bg-gray-100 px-1 rounded">number</code> /
              <code className="text-[11px] bg-gray-100 px-1 rounded">to</code>).
              Optional: <code className="text-[11px] bg-gray-100 px-1 rounded">name</code> + any additional columns become per-target template variables.
            </p>

            <div className="flex items-center gap-2 mb-3">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Choose CSV file
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChosen} />
              <span className="text-xs text-gray-400">or paste CSV below</span>
            </div>

            <textarea
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); parseCsv(e.target.value); }}
              placeholder={'phone_number,name,company\n+919493324795,Karthik,Acme\n+918876543210,Priya,Beta'}
              rows={8}
              className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-100"
            />

            {parseError && (
              <div className="flex items-center gap-2 mt-3 p-2 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
                <AlertCircle className="h-3.5 w-3.5" /> {parseError}
              </div>
            )}
          </Card>

          {/* Preview */}
          {targets.length > 0 && (
            <Card padding={false}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary-500" />
                  <span className="text-sm font-medium text-gray-900">
                    {targets.length} contact{targets.length === 1 ? '' : 's'} parsed
                  </span>
                </div>
                <button onClick={() => { setTargets([]); setCsvText(''); }} className="text-xs text-gray-400 hover:text-danger-600 inline-flex items-center gap-1">
                  <Trash2 className="h-3 w-3" /> Clear
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Phone</th>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Variables</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.slice(0, 50).map((t, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{t.phone_number}</td>
                        <td className="px-4 py-2 text-gray-700">{t.name || '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 font-mono truncate max-w-[400px]">
                          {Object.keys(t.variables).length === 0 ? '—' : Object.entries(t.variables).map(([k, v]) => `${k}=${v}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                    {targets.length > 50 && (
                      <tr className="border-t border-gray-100">
                        <td colSpan={3} className="text-center text-xs text-gray-400 py-3">
                          …and {targets.length - 50} more rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ─── Step 3: Campaign Settings ─── */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Retry Behaviour</h3>
            <p className="text-sm text-gray-500 mb-4">If a call fails (busy / no-answer), how aggressive should the retry be?</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Max attempts per contact</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5"
                />
                <p className="text-xs text-gray-400 mt-1">1 = call once. Up to 5 attempts allowed.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Retry delay (seconds)</label>
                <input
                  type="number"
                  min={60}
                  max={86400}
                  value={retryDelay}
                  onChange={(e) => setRetryDelay(Math.max(60, Math.min(86400, parseInt(e.target.value) || 900)))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5"
                />
                <p className="text-xs text-gray-400 mt-1">{Math.round(retryDelay / 60)} minute(s) between attempts.</p>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary-500" /> Schedule (optional)
            </h3>
            <p className="text-sm text-gray-500 mb-4">Leave blank to start the campaign immediately when you click "Create" on the next step.</p>
            <input
              type="datetime-local"
              value={scheduleStartAt}
              onChange={(e) => setScheduleStartAt(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5"
            />
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900">Provider</h3>
            <p className="text-sm text-gray-500 mb-4">Auto-detected from your phone number, but you can override.</p>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white"
            >
              <option value="plivo">Plivo</option>
              <option value="twilio">Twilio</option>
              <option value="exotel">Exotel</option>
            </select>
          </Card>
        </div>
      )}

      {/* ─── Step 4: Review & Create ─── */}
      {step === 4 && (
        <Card>
          <h3 className="text-base font-semibold text-gray-900 mb-4">Review & Create</h3>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Row label="Campaign name" value={name} />
            <Row label="Phone number" value={selectedPhone ? `${selectedPhone.phone_number} (${selectedPhone.provider})` : '—'} />
            <Row label="Agent" value={selectedAgentName || '—'} />
            <Row label="Concurrent calls" value={String(concurrency)} />
            <Row label="Contacts to call" value={String(targets.length)} />
            <Row label="Max attempts" value={String(maxAttempts)} />
            <Row label="Retry delay" value={`${Math.round(retryDelay / 60)} min`} />
            <Row label="Provider" value={provider} />
            <Row label="Scheduled start" value={scheduleStartAt ? new Date(scheduleStartAt).toLocaleString() : 'Immediately'} />
          </dl>

          <div className="mt-6 p-3 rounded-lg bg-primary-50 border border-primary-100 text-xs text-primary-800 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            Clicking <strong>Create Campaign</strong> below will create the campaign in DRAFT mode and upload all contacts. You can start dialing from the detail page.
          </div>
        </Card>
      )}

      {/* ─── Footer nav ─── */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={step === 1 ? () => navigate('/campaigns') : goBack} disabled={submitting} className="rounded-xl">
          {step === 1 ? (<>Cancel</>) : (<><ChevronLeft className="h-4 w-4" /> Back</>)}
        </Button>
        {step < STEPS.length ? (
          <Button variant="gradient" onClick={goNext} className="rounded-xl">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="gradient" onClick={handleCreate} disabled={submitting} className="rounded-xl">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? 'Creating…' : 'Create Campaign'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium">{value}</dd>
    </>
  );
}
