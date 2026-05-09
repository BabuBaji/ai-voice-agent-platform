import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, PhoneOutgoing, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import api from '@/services/api';
import type { PhoneNumberRecord } from '@/services/phoneNumber.api';

interface Props {
  open: boolean;
  /** The owned number to dial OUT FROM. Must have agent_id set + is_active=true. */
  phone: PhoneNumberRecord | null;
  onClose: () => void;
}

const COUNTRY_CODES: { iso: string; flag: string; name: string; code: string; example: string }[] = [
  { iso: 'IN', flag: '🇮🇳', name: 'India',          code: '+91',  example: '9876543210' },
  { iso: 'US', flag: '🇺🇸', name: 'United States',  code: '+1',   example: '4155551234' },
  { iso: 'GB', flag: '🇬🇧', name: 'United Kingdom', code: '+44',  example: '2071234567' },
  { iso: 'CA', flag: '🇨🇦', name: 'Canada',         code: '+1',   example: '4161234567' },
  { iso: 'AU', flag: '🇦🇺', name: 'Australia',      code: '+61',  example: '412345678' },
  { iso: 'DE', flag: '🇩🇪', name: 'Germany',        code: '+49',  example: '15123456789' },
  { iso: 'FR', flag: '🇫🇷', name: 'France',         code: '+33',  example: '612345678' },
  { iso: 'SG', flag: '🇸🇬', name: 'Singapore',      code: '+65',  example: '81234567' },
  { iso: 'AE', flag: '🇦🇪', name: 'UAE',            code: '+971', example: '501234567' },
  { iso: 'BR', flag: '🇧🇷', name: 'Brazil',         code: '+55',  example: '11912345678' },
  { iso: 'JP', flag: '🇯🇵', name: 'Japan',          code: '+81',  example: '9012345678' },
  { iso: 'NL', flag: '🇳🇱', name: 'Netherlands',    code: '+31',  example: '612345678' },
];

export function TestCallModal({ open, phone, onClose }: Props) {
  const [countryIdx, setCountryIdx] = useState(0); // default: India
  const [localDigits, setLocalDigits] = useState('');
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ providerCallId?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalDigits('');
    setError(null);
    setResult(null);
    // Default the country to match the FROM number when possible.
    if (phone?.phone_number) {
      const match = COUNTRY_CODES.findIndex((c) => phone.phone_number.startsWith(c.code));
      if (match >= 0) setCountryIdx(match);
    }
  }, [open, phone?.phone_number]);

  if (!open || !phone) return null;

  const country = COUNTRY_CODES[countryIdx];
  const cleanedDigits = localDigits.replace(/[^\d]/g, '');
  const fullE164 = country.code + cleanedDigits;
  const validE164 = /^\+\d{8,15}$/.test(fullE164);
  const isSandbox = phone.provider === 'sandbox';
  const ready = !!phone.agent_id && phone.is_active && !isSandbox;

  const placeCall = async () => {
    if (isSandbox) {
      setError('Sandbox numbers cannot place real PSTN calls. Use the in-app web-call widget for sandbox testing, or buy a real number from a carrier.');
      return;
    }
    if (!validE164) {
      setError(`Local number must be 7–14 digits. Example: ${country.example}`);
      return;
    }
    setCalling(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post('/calls/initiate', {
        from: phone.phone_number,
        to: fullE164,
        agent_id: phone.agent_id,
        provider: phone.provider,
        metadata: { source: 'test-call-modal' },
      });
      setResult(r.data?.data ?? r.data);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message;
      if (status === 402) {
        // Carrier wallet empty. Honest message + actionable next step.
        // Inbound still works — calling INTO this number from your phone
        // doesn't consume your carrier balance (caller's network pays).
        setError(
          (msg || 'Carrier balance is zero.') +
          ' Test inbound instead: call this number from your phone to hear the agent — that path doesn\'t need balance.',
        );
      } else if (status === 400) {
        setError(`Carrier rejected the call request: ${msg || 'invalid payload'}. This often happens when the FROM number isn't yet active at the carrier (compliance pending).`);
      } else if (status === 401) {
        setError(`Carrier rejected your credentials: ${msg}. Check the API key in Settings → Integrations.`);
      } else if (status === 422) {
        setError(`Carrier compliance not cleared: ${msg}.`);
      } else if (status === 502) {
        setError(`Provider error: ${msg}. Check the carrier dashboard for the FROM number's status.`);
      } else {
        setError(msg || 'Call failed');
      }
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={() => !calling && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <PhoneOutgoing className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Make a test call</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Dial out from <span className="font-mono font-medium text-gray-700">{phone.phone_number}</span> to verify routing &amp; voice quality.
              </p>
            </div>
          </div>
          <button onClick={() => !calling && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isSandbox && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Sandbox number — real outbound calls are disabled.</div>
                <div className="text-xs mt-1">Sandbox numbers are synthetic and don't exist at any carrier. Use the in-app web-call widget for testing, or buy a real number to place real PSTN calls.</div>
              </div>
            </div>
          )}

          {!isSandbox && !ready && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>This number isn't deployed yet. Attach it to an agent and activate it before placing test calls.</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-success-50 border border-success-200 text-sm text-success-700">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Call queued at the carrier.</div>
                {result.providerCallId && <div className="text-[11px] font-mono mt-0.5 text-success-800">id: {result.providerCallId}</div>}
                <div className="text-[11px] mt-1">Check Calls → Call Log for the live status.</div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Destination number</label>
            <div className="flex gap-2">
              <select
                value={countryIdx}
                onChange={(e) => setCountryIdx(parseInt(e.target.value, 10))}
                disabled={calling || !ready}
                className="text-sm border border-gray-200 rounded-lg pl-2 pr-1 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 disabled:bg-gray-50 disabled:text-gray-400 max-w-[140px]"
              >
                {COUNTRY_CODES.map((c, i) => (
                  <option key={c.iso} value={i}>
                    {c.flag} {c.code} · {c.iso}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={localDigits}
                onChange={(e) => setLocalDigits(e.target.value.replace(/[^\d\s-]/g, ''))}
                placeholder={country.example}
                disabled={calling || !ready}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Final number: <span className="font-mono">{cleanedDigits ? fullE164 : `${country.code}…`}</span> · Carrier rates apply.
            </p>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">From</span>
              <span className="font-mono text-gray-900">{phone.phone_number}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Provider</span>
              <span className="font-medium text-gray-900 capitalize">{phone.provider}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Agent</span>
              <span className="font-mono text-gray-900">{phone.agent_id ? phone.agent_id.slice(0, 8) + '…' : '—'}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
          <Button variant="outline" size="sm" onClick={onClose} disabled={calling} className="rounded-lg">
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={placeCall}
            disabled={calling || !ready || !validE164}
            className="rounded-lg"
          >
            {calling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
            {calling ? 'Placing call…' : 'Call now'}
          </Button>
        </div>
      </div>
    </div>
  );
}
