import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronRight, ChevronLeft, Phone, AlertCircle, Upload, FileText,
  Calendar, Clock, RefreshCw, Loader2, CheckCircle2, Trash2, Sparkles,
  Bot, BookOpen, Mic, Globe, Brain, MessageSquare, Wrench, Rocket,
} from 'lucide-react';

// datetime-local values are naive ("2026-05-11T16:10" with no offset). Server
// stores them as UTC by default — so 16:10 in the user's head becomes 16:10
// UTC, off by the tz offset. Convert to an ISO string anchored to the chosen
// timezone so "4:10 PM Asia/Kolkata" really means 4:10 PM IST (10:40 UTC).
function localToTzIso(localDt: string, tz: string): string {
  const [datePart, timePart] = localDt.split('T');
  const [Y, M, D] = datePart.split('-').map(Number);
  const [h, m] = (timePart || '00:00').split(':').map(Number);
  const utcMs = Date.UTC(Y, M - 1, D, h, m, 0);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  const tzMs = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  const offsetMs = tzMs - utcMs;
  return new Date(utcMs - offsetMs).toISOString();
}

const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { campaignApi } from '@/services/campaign.api';
import { agentApi } from '@/services/agent.api';
import { knowledgeApi, type KnowledgeBase } from '@/services/knowledge.api';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';

const STEPS = [
  { id: 1, title: 'Select Agent' },
  { id: 2, title: 'Phone Number' },
  { id: 3, title: 'Upload Contacts' },
  { id: 4, title: 'Campaign Instructions' },
  { id: 5, title: 'Call Settings' },
  { id: 6, title: 'Review & Create' },
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

  // Step 1 — pick the agent first. We hold the agent's id + the full record
  // (loaded by useEffect below) so the picker can show its welcome message, KB,
  // voice, tools right in the same step.
  const [name, setName] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; status?: string }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState<string | null>(null);
  const [allKbs, setAllKbs] = useState<KnowledgeBase[]>([]);

  // Step 2 — phone number, scoped to the selected agent.
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberRecord[]>([]);

  // Step 2
  const [csvText, setCsvText] = useState('');
  const [targets, setTargets] = useState<ParsedTarget[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 4 — campaign-level instruction (free-form, runtime-only overlay)
  const [campaignInstruction, setCampaignInstruction] = useState('');

  // Step 5 — call settings (concurrency, retry, calling window, schedule)
  const [concurrency, setConcurrency] = useState(3);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [retryDelay, setRetryDelay] = useState(900);
  const [scheduleStartAt, setScheduleStartAt] = useState('');
  const [provider, setProvider] = useState<'plivo' | 'twilio' | 'exotel'>('plivo');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [callWindowStart, setCallWindowStart] = useState('09:00');
  const [callWindowEnd, setCallWindowEnd] = useState('21:00');
  const [enforceWindow, setEnforceWindow] = useState(true);

  useEffect(() => {
    phoneNumberApi.list().then(setPhoneNumbers).catch(() => {});
    agentApi.list().then((a: any) => {
      const arr = Array.isArray(a) ? a : a?.data || [];
      setAgents(arr.map((x: any) => ({ id: x.id, name: x.name, status: x.status })));
    }).catch(() => {});
    knowledgeApi.listKnowledgeBases().then(setAllKbs).catch(() => {});
  }, []);

  // Fetch full agent record whenever the user changes their pick — needed so
  // Step 1 can preview the agent's welcome message, KB, voice, tools right
  // below the picker, and Step 2 can scope phones to this agent.
  useEffect(() => {
    if (!selectedAgentId) { setSelectedAgent(null); setAgentLoadError(null); return; }
    setLoadingAgent(true);
    setAgentLoadError(null);
    agentApi.get(selectedAgentId)
      .then((data: any) => setSelectedAgent(data))
      .catch((e: any) => setAgentLoadError(e?.response?.data?.error || e?.message || 'Failed to load agent'))
      .finally(() => setLoadingAgent(false));
  }, [selectedAgentId]);

  // When the agent changes, auto-pick its first attached phone (if any) so
  // single-number tenants don't have to click through Step 2.
  useEffect(() => {
    if (!selectedAgentId) { setPhoneNumberId(''); return; }
    const attached = phoneNumbers.filter((n) => n.agent_id === selectedAgentId && n.is_active);
    if (attached.length === 0) { setPhoneNumberId(''); return; }
    // Keep current pick if it's still valid for this agent; otherwise jump to first.
    const stillValid = attached.some((n) => n.id === phoneNumberId);
    if (!stillValid) {
      setPhoneNumberId(attached[0].id);
      if (attached[0].provider) setProvider(attached[0].provider as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId, phoneNumbers]);

  const selectedPhone = useMemo(() => phoneNumbers.find((n) => n.id === phoneNumberId) || null, [phoneNumberId, phoneNumbers]);
  const selectedAgentName = useMemo(() => {
    if (!selectedAgentId) return null;
    return (selectedAgent && (selectedAgent as any).name)
      || agents.find((a) => a.id === selectedAgentId)?.name
      || selectedAgentId;
  }, [selectedAgentId, selectedAgent, agents]);

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
      if (!selectedAgentId) return 'Pick an agent for this campaign';
      if (!selectedAgent) return 'Agent is still loading — please wait';
      const status = String((selectedAgent as any).status || '').toUpperCase();
      if (status !== 'PUBLISHED') return 'This agent is not deployed. Deploy it from the agent page before launching a campaign.';
    }
    if (s === 2) {
      if (!phoneNumberId) return 'Pick a phone number for this campaign';
      // The number may be unassigned or attached to a different agent — the
      // wizard reassigns it to selectedAgentId on Create. So no need to
      // block here. Just make sure it's still deployed/active.
      if (!selectedPhone?.is_active) return 'The selected number is inactive — pick another';
    }
    if (s === 3) {
      if (targets.length === 0) return 'Upload or paste at least one contact';
    }
    if (s === 5) {
      if (enforceWindow && callWindowStart === callWindowEnd) return 'Calling-hours start and end cannot be the same';
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
    if (!selectedAgentId) { setError('No agent selected'); return; }
    if (!selectedPhone) { setError('No phone number selected'); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Auto-reassign the chosen number to this agent if it isn't already.
      // Without this the runner's deploy-gate would refuse to dial because
      // calls.agent_id wouldn't match the number's attached agent.
      if (selectedPhone.agent_id !== selectedAgentId) {
        try {
          await phoneNumberApi.assignAgent(selectedPhone.id, selectedAgentId, { bypass_verification: true });
        } catch (assignErr: any) {
          setError(
            'Could not reassign the phone number to this agent: ' +
            (assignErr?.response?.data?.message || assignErr?.message || 'unknown error'),
          );
          setSubmitting(false);
          return;
        }
      }

      const created = await campaignApi.create({
        name: name.trim(),
        agent_id: selectedAgentId,
        from_number: selectedPhone.phone_number,
        provider,
        concurrency,
        max_attempts: maxAttempts,
        retry_delay_seconds: retryDelay,
        schedule_start_at: scheduleStartAt ? localToTzIso(scheduleStartAt, enforceWindow ? timezone : 'Asia/Kolkata') : undefined,
        timezone: enforceWindow ? timezone : undefined,
        call_window_start: enforceWindow ? callWindowStart : undefined,
        call_window_end: enforceWindow ? callWindowEnd : undefined,
        campaign_instruction: campaignInstruction.trim() ? campaignInstruction.trim() : undefined,
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

      {/* ─── Step 1: Select Agent ─── */}
      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Campaign Details</h3>
            <p className="text-sm text-gray-500 mb-4">Give your bulk call campaign a name</p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Campaign Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Q2 Outbound — Karnataka Leads"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </Card>

          <Card>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary-500" /> Agent
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              The agent is the <strong>brain</strong> of the campaign — its prompt, welcome message, voice, language, knowledge base, and tools are all reused for every dial. Only <span className="font-medium">deployed</span> agents can run a campaign.
            </p>

            {agents.length === 0 ? (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-warning-300 bg-warning-50/40 text-warning-700">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">No agents yet</p>
                  <p className="text-xs mt-1">
                    Create and deploy an agent first — go to <a href="/agents/new" className="underline font-medium">New Agent</a>.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Pick an agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                >
                  <option value="">Select an agent</option>
                  {agents.map((a) => {
                    const isDeployed = String(a.status || '').toUpperCase() === 'PUBLISHED';
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} {isDeployed ? '· DEPLOYED' : `· ${String(a.status || 'DRAFT').toUpperCase()} (not deployable)`}
                      </option>
                    );
                  })}
                </select>
              </>
            )}
          </Card>

          {/* Agent details preview — shown as soon as one is picked. Same content
              as the old standalone "Confirm Agent" step, just inline here so the
              user verifies what they're picking without an extra click. */}
          {selectedAgentId && (
            <ConfirmAgentStep
              selectedAgent={selectedAgent}
              loading={loadingAgent}
              error={agentLoadError}
              allKbs={allKbs}
            />
          )}
        </div>
      )}

      {/* ─── Step 2: Phone Number ─── */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary-500" /> Phone Number
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Pick the number this campaign should dial <strong>from</strong>. Numbers already attached to <strong>{selectedAgent?.name || 'this agent'}</strong> appear first. Picking a number attached to a different agent will reassign it to this one when you launch.
            </p>

            {(() => {
              // Show every deployed/active number across the tenant, not just
              // the ones already attached to this agent. This lets the user
              // assign-on-launch instead of bouncing to Settings → Phone
              // Numbers. Drafts and inactive numbers are hidden — they can't
              // dial outbound anyway.
              const deployedPhones = phoneNumbers.filter(
                (n) => n.is_active && (String((n as any).deployment_status || '').toLowerCase() === 'deployed' || !((n as any).deployment_status)),
              );
              if (deployedPhones.length === 0) {
                return (
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-danger-300 bg-danger-50/40 text-danger-700">
                    <Phone className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">No deployed phone numbers in this tenant</p>
                      <p className="text-xs mt-1">
                        Purchase or verify a number first. Go to <a href="/settings/phone-numbers" className="underline font-medium">Phone Numbers</a>.
                      </p>
                    </div>
                  </div>
                );
              }
              // Sort: ones attached to this agent first, then unassigned,
              // then numbers attached to a different agent.
              const sorted = [...deployedPhones].sort((a, b) => {
                const aMine = a.agent_id === selectedAgentId ? 0 : (a.agent_id ? 2 : 1);
                const bMine = b.agent_id === selectedAgentId ? 0 : (b.agent_id ? 2 : 1);
                return aMine - bMine;
              });
              const attachedCount = sorted.filter((n) => n.agent_id === selectedAgentId).length;
              return (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Available numbers ({sorted.length})
                    {attachedCount > 0 && <span className="ml-2 text-xs text-gray-500">· {attachedCount} attached to this agent</span>}
                  </label>
                  <div className="space-y-2">
                    {sorted.map((n) => {
                      const checked = phoneNumberId === n.id;
                      const mine = n.agent_id === selectedAgentId;
                      const otherAgentName = !mine && n.agent_id
                        ? (agents.find((a) => a.id === n.agent_id)?.name || 'another agent')
                        : null;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setPhoneNumberId(n.id);
                            if (n.provider) setProvider(n.provider as any);
                          }}
                          className={`w-full text-left flex items-center justify-between p-3 rounded-xl border transition-colors ${
                            checked
                              ? 'border-primary-400 bg-primary-50/40'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${checked ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500'}`}>
                              <Phone className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 font-mono">{n.phone_number}</div>
                              <div className="text-[11px] text-gray-500">
                                {n.provider} · deployed
                                {mine && <span className="text-success-600"> · attached to this agent</span>}
                                {!mine && otherAgentName && <span className="text-warning-700"> · currently on "{otherAgentName}" (will reassign)</span>}
                                {!mine && !otherAgentName && <span className="text-gray-500"> · unassigned (will attach)</span>}
                              </div>
                            </div>
                          </div>
                          {checked && <CheckCircle2 className="h-5 w-5 text-primary-600" />}
                        </button>
                      );
                    })}
                  </div>
                  {phoneNumberId && (() => {
                    const picked = sorted.find((n) => n.id === phoneNumberId);
                    if (picked && picked.agent_id !== selectedAgentId) {
                      return (
                        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-warning-50 border border-warning-200 text-xs text-warning-800">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <span>
                            When you click <strong>Create Campaign</strong>, this number will be reassigned to <strong>{selectedAgent?.name || 'this agent'}</strong> automatically.
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </>
              );
            })()}
          </Card>
        </div>
      )}

      {/* ─── Step 3: Upload Contact List ─── */}
      {step === 3 && (
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

      {/* ─── Step 4: Campaign Instructions (runtime overlay) ─── */}
      {step === 4 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary-500" /> Campaign Instructions
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              A short note added to <strong>every dial in this campaign</strong> as runtime context — it does <strong>not</strong> permanently change the agent. Use this to tell the agent what this batch is about and what to ask. The agent still uses its own prompt, welcome message, voice, language, and knowledge base.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Instruction (optional)</label>
            <textarea
              value={campaignInstruction}
              onChange={(e) => setCampaignInstruction(e.target.value.slice(0, 4000))}
              placeholder={"This campaign is for MBA admission follow-up. Ask if the student wants fee details or counselling. If they're already enrolled, capture which institute."}
              rows={5}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            <div className="text-right text-xs text-gray-400 mt-1">{campaignInstruction.length}/4000</div>
          </Card>

          {/* CSV-derived variables — show what {{vars}} the agent will see per contact */}
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Contact Variables</h3>
            <p className="text-sm text-gray-500 mb-3">
              These per-contact fields come from your CSV. They're injected into every dial so the agent can address each person personally. Use <code className="text-[11px] bg-gray-100 px-1 rounded">{'{{name}}'}</code>, <code className="text-[11px] bg-gray-100 px-1 rounded">{'{{course}}'}</code>, etc. inside the agent's welcome message to interpolate them.
            </p>
            {(() => {
              const keys = new Set<string>();
              targets.forEach((t) => {
                if (t.name) keys.add('name');
                Object.keys(t.variables || {}).forEach((k) => keys.add(k));
              });
              const list = Array.from(keys);
              if (list.length === 0) {
                return <p className="text-sm text-gray-400">No per-contact fields detected — only the phone number will be used. Add a <code className="text-[11px] bg-gray-100 px-1 rounded">name</code> column or extra CSV columns to personalize.</p>;
              }
              return (
                <div className="flex flex-wrap gap-2">
                  {list.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium border border-primary-100 font-mono">
                      {'{{'}{k}{'}}'}
                    </span>
                  ))}
                </div>
              );
            })()}
          </Card>
        </div>
      )}

      {/* ─── Step 5: Call Settings (concurrency + retry + calling-hours + schedule + provider) ─── */}
      {step === 5 && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900">How many calls in parallel?</h3>
            <p className="text-sm text-gray-500 mb-4">
              The dialer keeps this many calls ringing at the same time, refilling each slot the moment a call ends.
              <strong> 1 = sequential</strong> (one at a time), <strong>3–5 = parallel</strong> (most common), <strong>10 = blast</strong>.
              Plan capacity with your phone-number provider — too high will trigger carrier rate limits.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Concurrent calls: <span className="text-primary-600 font-semibold tabular-nums">{concurrency}</span></label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 tabular-nums w-4 text-right">1</span>
              <input
                type="range"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
                className="flex-1 accent-primary-600"
              />
              <span className="text-xs text-gray-400 tabular-nums w-6">10</span>
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-center focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {concurrency === 1
                ? 'Sequential — one call at a time (each contact waits for the previous to finish).'
                : `Up to ${concurrency} calls will ring at the same time. With ${targets.length} contact${targets.length === 1 ? '' : 's'} that's roughly ${Math.ceil(targets.length / concurrency)} batch${Math.ceil(targets.length / concurrency) === 1 ? '' : 'es'} of dialing.`}
            </p>
          </Card>

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
              <Clock className="h-4 w-4 text-primary-500" /> Calling Hours
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Outbound calls only fire inside this window. Outside it, the campaign sleeps as <code className="text-[11px] bg-gray-100 px-1 rounded">WAITING</code> and resumes automatically when the window re-opens.
            </p>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={enforceWindow}
                onChange={(e) => setEnforceWindow(e.target.checked)}
                className="rounded"
              />
              Restrict to calling hours (recommended for compliance)
            </label>
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${enforceWindow ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white"
                >
                  {TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Start (24h)</label>
                <input
                  type="time"
                  value={callWindowStart}
                  onChange={(e) => setCallWindowStart(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">End (24h)</label>
                <input
                  type="time"
                  value={callWindowEnd}
                  onChange={(e) => setCallWindowEnd(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5"
                />
              </div>
            </div>
            {enforceWindow && callWindowStart === callWindowEnd && (
              <p className="text-xs text-danger-600 mt-2">Start and end cannot be the same.</p>
            )}
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
            <p className="text-[11px] text-gray-400 mt-1.5">
              Interpreted in <span className="font-medium text-gray-600">{enforceWindow ? timezone : 'Asia/Kolkata'}</span> — so 16:10 means 4:10 PM in that timezone, not UTC.
            </p>
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

      {/* ─── Step 6: Review & Create ─── */}
      {step === 6 && (
        <div className="space-y-4">
          {/* Total-contacts banner: prominent so the user double-checks before launching */}
          <div className="rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 to-white p-5 flex items-center gap-5">
            <div className="h-14 w-14 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0">
              <FileText className="h-7 w-7" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-primary-700 font-semibold">Ready to dial</div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-3xl font-bold text-gray-900 tabular-nums">{targets.length}</span>
                <span className="text-sm text-gray-600">contact{targets.length === 1 ? '' : 's'} loaded from your upload</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                With <strong>{concurrency} call{concurrency === 1 ? '' : 's'}</strong> in parallel, the dialer will need ~<strong>{Math.ceil(targets.length / concurrency)} batch{Math.ceil(targets.length / concurrency) === 1 ? '' : 'es'}</strong> to reach everyone (more if retries kick in).
              </div>
            </div>
          </div>

        <Card>
          <h3 className="text-base font-semibold text-gray-900 mb-4">Review & Create</h3>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Row label="Campaign name" value={name} />
            <Row label="Phone number" value={selectedPhone ? `${selectedPhone.phone_number} (${selectedPhone.provider})` : '—'} />
            <Row
              label="Agent"
              value={(() => {
                const kbCount = Array.isArray((selectedAgent as any)?.knowledge_base_ids) ? (selectedAgent as any).knowledge_base_ids.length : 0;
                const stat = String((selectedAgent as any)?.status || '').toUpperCase();
                return selectedAgentName
                  ? `${selectedAgentName} · ${stat || '—'} · ${kbCount} KB${kbCount === 1 ? '' : 's'}`
                  : '—';
              })()}
            />
            <Row label="Concurrent calls" value={String(concurrency)} />
            <Row label="Contacts to call" value={String(targets.length)} />
            <Row label="Max attempts" value={String(maxAttempts)} />
            <Row label="Retry delay" value={`${Math.round(retryDelay / 60)} min`} />
            <Row label="Provider" value={provider} />
            <Row label="Scheduled start" value={scheduleStartAt ? new Date(scheduleStartAt).toLocaleString() : 'Immediately'} />
            <Row label="Calling hours" value={enforceWindow ? `${callWindowStart}–${callWindowEnd} ${timezone}` : '24×7 (no window)'} />
            <Row label="Campaign instruction" value={campaignInstruction.trim() ? `${campaignInstruction.trim().slice(0, 80)}${campaignInstruction.length > 80 ? '…' : ''}` : '(none)'} />
          </dl>

          <div className="mt-6 p-3 rounded-lg bg-primary-50 border border-primary-100 text-xs text-primary-800 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            Clicking <strong>Create Campaign</strong> below will create the campaign in DRAFT mode and upload all <strong>{targets.length}</strong> contact{targets.length === 1 ? '' : 's'}. You can start dialing from the detail page.
          </div>
        </Card>
        </div>
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

/**
 * Confirm-Agent step — read-only view of what the campaign will reuse from the
 * agent that's attached to the selected phone number. The campaign does NOT
 * create or modify the agent; it dials with whatever the agent already has
 * deployed (snapshot prompt, voice, welcome message, KB, tools).
 */
function ConfirmAgentStep({
  selectedAgent, loading, error, allKbs,
}: {
  selectedAgent: any | null;
  loading: boolean;
  error: string | null;
  allKbs: KnowledgeBase[];
}) {
  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading agent details…
        </div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4 mt-0.5" /> {error}
        </div>
      </Card>
    );
  }
  if (!selectedAgent) {
    return (
      <Card>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          No agent attached to the selected phone number. Go back to Step 1 and pick a number with an agent assigned.
        </div>
      </Card>
    );
  }

  const a = selectedAgent;
  const status = String(a.status || '').toUpperCase();
  const isDeployed = status === 'PUBLISHED';
  const voice = a.voice_config || {};
  const stt = a.stt_config || {};
  const callCfg = a.call_config || {};
  const integrations = a.integrations_config || {};
  const tools = a.tools_config || [];

  // KB id list lives on the agent; resolve each id to its name from the
  // tenant-wide KB list we fetched on mount.
  const kbIds: string[] = Array.isArray(a.knowledge_base_ids) ? a.knowledge_base_ids : [];
  const kbs = kbIds.map((id) => allKbs.find((k) => k.id === id)).filter(Boolean) as KnowledgeBase[];

  // Tool list — only show enabled ones with friendly labels.
  const enabledTools: string[] = [];
  if (Array.isArray(tools)) {
    tools.forEach((t: any) => {
      const n = typeof t === 'string' ? t : t?.name;
      if (n && (typeof t === 'string' || t?.enabled !== false)) enabledTools.push(String(n));
    });
  }
  if (integrations?.calcom?.enabled) enabledTools.push('Cal.com booking');
  if (callCfg?.call_transfer?.enabled) enabledTools.push('Call transfer');
  if (callCfg?.voicemail_detection?.enabled) enabledTools.push('Voicemail detection');

  return (
    <div className="space-y-4">
      {/* Deploy warning gate */}
      {!isDeployed && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>Agent is not deployed</strong> ({status || 'DRAFT'}). The campaign won't dial until this agent is deployed. Open the agent and click <span className="inline-flex items-center gap-1 font-medium"><Rocket className="h-3 w-3" /> Deploy</span> from its detail page.
          </div>
        </div>
      )}

      <Card>
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-base font-semibold text-gray-900 truncate">{a.name || 'Untitled Agent'}</h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                isDeployed
                  ? 'bg-success-100 text-success-700'
                  : 'bg-danger-100 text-danger-700'
              }`}>
                {isDeployed ? 'DEPLOYED' : status || 'DRAFT'}
              </span>
            </div>
            {a.description && <p className="text-sm text-gray-600">{a.description}</p>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AgentField icon={<Globe className="h-4 w-4" />} label="Language" value={voice.language || stt.language || '—'} />
        <AgentField icon={<Mic className="h-4 w-4" />} label="Voice (TTS)" value={`${voice.provider || '—'}${voice.voice_id ? ' · ' + voice.voice_id : ''}`} />
        <AgentField icon={<Brain className="h-4 w-4" />} label="LLM" value={`${a.llm_provider || '—'}${a.llm_model ? ' · ' + a.llm_model : ''}`} />
        <AgentField icon={<MessageSquare className="h-4 w-4" />} label="Speech-to-text" value={`${stt.provider || '—'}${stt.model ? ' · ' + stt.model : ''}`} />
      </div>

      {/* Welcome message — the actual template used per call. Show it verbatim. */}
      <Card>
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary-500" /> Welcome Message
        </h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">
          The first thing the agent says when the call connects. <code className="text-[11px] bg-gray-100 px-1 rounded">{'{{vars}}'}</code> from your CSV will be interpolated per contact.
        </p>
        <div className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-800 whitespace-pre-wrap font-medium">
          {(a.greeting_message || '').trim() || <span className="text-gray-400 italic font-normal">No welcome message set — the agent will improvise a greeting based on its prompt.</span>}
        </div>
      </Card>

      {/* Knowledge base — what the agent can retrieve answers from */}
      <Card>
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary-500" /> Knowledge Base
        </h4>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">
          The agent answers from these knowledge bases during every call. They were attached to the agent and stay attached — the campaign does <strong>not</strong> upload new KB content.
        </p>
        {kbs.length === 0 ? (
          <div className="text-sm text-gray-400 italic">
            No knowledge base attached. The agent will rely on its system prompt + live search only.
          </div>
        ) : (
          <div className="space-y-2">
            {kbs.map((kb) => (
              <div key={kb.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-100 bg-white">
                <div className="flex items-center gap-2 min-w-0">
                  <BookOpen className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-800 truncate">{kb.name}</span>
                  {kb.description && <span className="text-xs text-gray-400 truncate">— {kb.description}</span>}
                </div>
                {kb.document_count != null && (
                  <span className="text-xs text-gray-500 flex-shrink-0">{kb.document_count} doc{kb.document_count === 1 ? '' : 's'}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Tools enabled */}
      <Card>
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary-500" /> Tools & Integrations
        </h4>
        {enabledTools.length === 0 ? (
          <p className="text-sm text-gray-400 italic mt-2">No tools enabled. The agent will complete conversations verbally only.</p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-2">
            {enabledTools.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium border border-primary-100">
                <Check className="h-3 w-3" /> {t}
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="p-3 rounded-lg bg-primary-50 border border-primary-100 text-xs text-primary-800 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
        The campaign will reuse <strong>everything above</strong> for every dial. It only adds your contact list, schedule, and (optional) campaign instruction on top. The agent itself is never modified.
      </div>
    </div>
  );
}

function AgentField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
          <div className="text-sm font-medium text-gray-900 truncate">{value}</div>
        </div>
      </div>
    </Card>
  );
}
