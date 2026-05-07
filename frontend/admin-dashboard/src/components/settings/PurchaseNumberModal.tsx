import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { phoneNumberApi, type AvailableNumber, type KycSession } from '@/services/phoneNumber.api';

interface Props {
  open: boolean;
  number: AvailableNumber | null;
  provider: 'plivo' | 'twilio' | 'exotel';
  capabilities: ('voice' | 'sms')[];
  onClose: () => void;
  onReserved: (session: KycSession) => void;
}

export function PurchaseNumberModal({ open, number, provider, capabilities, onClose, onReserved }: Props) {
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !number) return null;

  const reserve = async () => {
    setError(null);
    setReserving(true);
    try {
      const r = await phoneNumberApi.wizard.reserve({
        provider,
        number: number.number,
        capabilities,
        monthly_rate: number.monthlyRate,
        is_sandbox: number.synthetic === true,
      });
      onReserved(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to reserve number');
    } finally {
      setReserving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => !reserving && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md text-gray-900 ring-1 ring-gray-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Purchase Number</h3>
            <p className="text-sm text-gray-500 mt-0.5">Reserve this number and complete KYC verification</p>
          </div>
          <button onClick={() => !reserving && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="px-6 pt-5 pb-2 text-center">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Phone Number</div>
          <div className="text-2xl font-semibold font-mono tracking-wide text-gray-900">{number.number}</div>
          {number.monthlyRate != null && (
            <div className="text-xs text-gray-500 mt-1">${number.monthlyRate.toFixed(3)} / month</div>
          )}
          {number.synthetic && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wider">
              Sandbox
            </div>
          )}
        </div>

        {number.synthetic && (
          <div className="mx-6 mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
            This is a <strong>test number</strong> — KYC and purchase happen instantly with no carrier API call.
            It works for in-app demos and web calls but won't receive real PSTN calls.
          </div>
        )}

        <div className="px-6 py-5 space-y-3">
          <Step n={1} label="Reserve this number instantly" />
          <Step n={2} label="Complete KYC verification" />
          <Step n={3} label="Purchase and attach your Voice AI agent" />
        </div>

        {error && (
          <div className="mx-6 mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="px-6 pb-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={reserving} className="rounded-lg">
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={reserve} disabled={reserving}
            className="rounded-lg !bg-teal-500 hover:!bg-teal-600 !text-white font-semibold">
            {reserving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Reserve & Start KYC
          </Button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
        {n}
      </div>
      <div className="text-gray-700">{label}</div>
    </div>
  );
}
