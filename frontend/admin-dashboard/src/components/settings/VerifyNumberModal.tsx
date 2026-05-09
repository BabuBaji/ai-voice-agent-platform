import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Phone, ShieldCheck, X, XCircle, MinusCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { phoneNumberApi, type PhoneNumberRecord, type VerificationRunSummary } from '@/services/phoneNumber.api';

interface Props {
  open: boolean;
  phone: PhoneNumberRecord | null;
  onClose: () => void;
  onVerified?: (run: VerificationRunSummary) => void;
}

const TEST_LABELS: Record<string, string> = {
  provider_api: 'Carrier API reachable',
  ownership: 'Ownership confirmed at carrier',
  webhook_reachable: 'Public webhook reachable (PUBLIC_BASE_URL)',
  ws_stream: 'WebSocket audio path responding',
  recording_writeable: 'Recording directory writable',
  outbound_call: 'Outbound dry-run (no charge)',
};

export function VerifyNumberModal({ open, phone, onClose, onVerified }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<VerificationRunSummary | null>(null);

  // Inbound probe state — separate flow from the 6-test structural run.
  const [probeId, setProbeId] = useState<string | null>(null);
  const [probeStatus, setProbeStatus] = useState<'idle' | 'waiting' | 'pass' | 'fail'>('idle');
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [probeSecondsLeft, setProbeSecondsLeft] = useState(0);
  const probeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRun(null);
    setProbeId(null);
    setProbeStatus('idle');
    setProbeMessage(null);
    setProbeSecondsLeft(0);
  }, [open]);

  useEffect(() => {
    return () => { if (probeTimerRef.current) clearInterval(probeTimerRef.current); };
  }, []);

  if (!open || !phone) return null;

  const start = async () => {
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      const result = await phoneNumberApi.verify(phone.id);
      setRun(result);
      onVerified?.(result);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Verification failed');
    } finally {
      setRunning(false);
    }
  };

  const startInboundProbe = async () => {
    if (!phone) return;
    setError(null);
    setProbeStatus('waiting');
    setProbeMessage(null);
    try {
      const r = await phoneNumberApi.startInboundProbe(phone.id);
      setProbeId(r.probe_id);
      setProbeMessage(r.message);
      setProbeSecondsLeft(60);
      // Tick down the timer + poll every 2s for the inbound webhook to land.
      const startedAt = Date.now();
      probeTimerRef.current = setInterval(async () => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setProbeSecondsLeft(Math.max(0, 60 - elapsed));
        try {
          const c = await phoneNumberApi.checkInboundProbe(phone.id, r.probe_id);
          if (c.status === 'pass') {
            setProbeStatus('pass');
            setProbeMessage(`Inbound call received from ${c.log?.caller || 'unknown'}.`);
            if (probeTimerRef.current) clearInterval(probeTimerRef.current);
          } else if (c.status === 'fail' || c.expired) {
            setProbeStatus('fail');
            setProbeMessage(c.error || 'Probe window expired (60s) without a call.');
            if (probeTimerRef.current) clearInterval(probeTimerRef.current);
          }
        } catch { /* keep waiting */ }
        if (elapsed >= 62) {
          if (probeTimerRef.current) clearInterval(probeTimerRef.current);
          setProbeStatus((prev) => prev === 'waiting' ? 'fail' : prev);
        }
      }, 2000);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to start inbound probe');
      setProbeStatus('idle');
    }
  };

  const aggregateBadge = (() => {
    if (!run) return null;
    if (run.aggregate === 'verified') return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">Verified</span>;
    if (run.aggregate === 'partial') return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">Partial</span>;
    return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-danger-100 text-danger-700">Failed</span>;
  })();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => !running && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Verify number</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Runs 5 quick checks against <span className="font-mono">{phone.phone_number}</span> so deploy is safe.
              </p>
            </div>
          </div>
          <button onClick={() => !running && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!run && !running && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600">
              Click <strong>Run verification</strong> to test carrier connectivity, ownership, webhook reachability,
              audio stream path, and the recording directory. The whole run takes &lt; 5 seconds.
            </div>
          )}

          {running && (
            <div className="flex items-center gap-2 text-sm text-primary-700 py-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Running 5 verification tests…
            </div>
          )}

          {run && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Result</span>
                {aggregateBadge}
              </div>
              <ul className="space-y-2">
                {run.results.map((r) => {
                  const label = TEST_LABELS[r.test] || r.test;
                  const Icon = r.status === 'pass' ? CheckCircle2 : r.status === 'fail' ? XCircle : MinusCircle;
                  const color =
                    r.status === 'pass' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                    : r.status === 'fail' ? 'text-danger-600 bg-danger-50 border-danger-200'
                    : 'text-gray-500 bg-gray-50 border-gray-200';
                  return (
                    <li key={r.test} className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${color}`}>
                      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{label}</div>
                        {r.error && <div className="text-xs mt-0.5 opacity-90 break-words">{r.error}</div>}
                        {!r.error && r.log && Object.keys(r.log).length > 0 && (
                          <div className="text-xs mt-0.5 opacity-75 font-mono break-words">
                            {Object.entries(r.log).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-gray-500">
                Run ID: <span className="font-mono">{run.run_id.slice(0, 8)}…</span> · {run.summary.passed} passed,{' '}
                {run.summary.failed} failed, {run.summary.skipped} skipped
              </p>
            </>
          )}
        </div>

        {/* Live inbound test */}
        <div className="px-6 pb-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Phone className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-blue-900">Live inbound test</div>
                  <div className="text-xs text-blue-700 mt-0.5">
                    Open a 60-second window. Call <span className="font-mono font-semibold">{phone.phone_number}</span> from any phone — the round-trip is verified end-to-end (carrier → webhook → our handler).
                  </div>
                </div>
              </div>
              {probeStatus === 'idle' && (
                <Button variant="outline" size="sm" onClick={startInboundProbe} className="rounded-lg whitespace-nowrap">
                  <Phone className="h-3.5 w-3.5" /> Start probe
                </Button>
              )}
            </div>
            {probeStatus === 'waiting' && (
              <div className="mt-3 flex items-center gap-2 text-sm text-blue-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Waiting for inbound call… {probeSecondsLeft}s remaining</span>
              </div>
            )}
            {probeStatus === 'pass' && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> {probeMessage}
              </div>
            )}
            {probeStatus === 'fail' && (
              <div className="mt-3 flex items-center justify-between gap-2 text-sm text-danger-800">
                <span className="flex items-center gap-2"><XCircle className="h-4 w-4" /> {probeMessage}</span>
                <Button variant="outline" size="sm" onClick={startInboundProbe} className="rounded-lg">Retry</Button>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
          <Button variant="outline" size="sm" onClick={onClose} disabled={running} className="rounded-lg">Close</Button>
          <Button variant="primary" size="sm" onClick={start} disabled={running} className="rounded-lg">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {run ? 'Run again' : 'Run verification'}
          </Button>
        </div>
      </div>
    </div>
  );
}
