import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Rocket, Snowflake, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';
import { agentApi } from '@/services/agent.api';

/**
 * Deploys an already-attached number. Verify (already passed earlier or
 * bypassed) → publish agent if draft → snapshot config → activate routing.
 *
 * Splits cleanly from AttachAgentModal: this assumes the number has agent_id
 * set (otherwise we tell the user to Attach first).
 */
interface Props {
  open: boolean;
  phone: PhoneNumberRecord | null;
  onClose: () => void;
  onDeployed: (rec: PhoneNumberRecord) => void;
}

export function DeployConfirmModal({ open, phone, onClose, onDeployed }: Props) {
  const [agentName, setAgentName] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'idle' | 'verifying' | 'publishing' | 'deploying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [skipVerify, setSkipVerify] = useState(false);

  useEffect(() => {
    if (!open || !phone) return;
    setError(null);
    setStep('idle');
    setSkipVerify(false);
    if (phone.agent_id) {
      agentApi.get(phone.agent_id).then((a: any) => {
        setAgentName(a?.name || phone.agent_id?.slice(0, 8) || '');
        setAgentStatus(String(a?.status || 'DRAFT').toUpperCase());
      }).catch(() => { setAgentName(phone.agent_id?.slice(0, 8) || ''); setAgentStatus('UNKNOWN'); });
    }
  }, [open, phone]);

  if (!open || !phone) return null;

  if (!phone.agent_id) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-base font-semibold text-gray-900 mb-2">Attach an agent first</h3>
          <p className="text-sm text-gray-600">This number isn't mapped to any agent. Click <strong>Attach Agent</strong> on the row, then come back to deploy.</p>
          <div className="flex justify-end mt-4">
            <Button variant="primary" size="sm" onClick={onClose}>OK</Button>
          </div>
        </div>
      </div>
    );
  }

  const isDraft = !['PUBLISHED', 'ACTIVE'].includes(agentStatus);

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Verify (best-effort) so the deploy gate is satisfied.
      if (!skipVerify) {
        setStep('verifying');
        try { await phoneNumberApi.verify(phone.id); } catch { /* fall through; deploy uses bypass below */ }
      }
      // 2. Publish if draft (existing /agents/:id/publish endpoint).
      if (isDraft) {
        setStep('publishing');
        try {
          await agentApi.publish(phone.agent_id!);
        } catch (e: any) {
          const msg = e?.response?.data?.message || '';
          if (!/already.*publish|published/i.test(msg)) throw e;
        }
      }
      // 3. Snapshot config + activate routing.
      setStep('deploying');
      const r = await phoneNumberApi.deploy(phone.id, { bypass_verification: skipVerify });
      const rec: PhoneNumberRecord = {
        ...phone,
        is_active: true,
        deployment_status: r.deployment_status as any,
        deployed_at: new Date().toISOString(),
        deployed_config_id: r.deployed_config_id,
      };
      setStep('done');
      onDeployed(rec);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e?.message || 'Deploy failed';
      if (status === 412) {
        setError(`${msg} Tick "Skip verification" to override.`);
      } else {
        setError(msg);
      }
      setStep('idle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Rocket className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Deploy number</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                <span className="font-mono font-medium text-gray-700">{phone.phone_number}</span> → <strong>{agentName || '…'}</strong>. Going live freezes the agent config and starts routing inbound calls.
              </p>
            </div>
          </div>
          <button onClick={() => !busy && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
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

          <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-blue-900 font-medium">
              <Snowflake className="h-4 w-4" /> What gets frozen on deploy
            </div>
            <ul className="text-xs text-blue-800 list-disc pl-5 space-y-0.5">
              <li>Agent system prompt + greeting</li>
              <li>Voice provider, voice ID, language, speed</li>
              <li>LLM provider + model + temperature</li>
              <li>Tools, knowledge bases, post-call actions, integrations</li>
              <li>Future edits in Agent Builder won't affect calls until you re-deploy</li>
            </ul>
          </div>

          <ol className="text-xs text-gray-600 space-y-1 pl-4 list-decimal">
            <li className={step === 'verifying' ? 'text-primary-700 font-medium' : ''}>Run verification (carrier API · webhook · audio path · outbound dry-run)</li>
            <li className={step === 'publishing' ? 'text-primary-700 font-medium' : ''}>Publish agent (currently <span className={`font-semibold ${isDraft ? 'text-amber-600' : 'text-emerald-600'}`}>{(agentStatus || 'unknown').toLowerCase()}</span>)</li>
            <li className={step === 'deploying' ? 'text-primary-700 font-medium' : ''}>Snapshot config &amp; activate live routing</li>
            <li className={step === 'done' ? 'text-emerald-700 font-medium' : ''}>Inbound calls land on this agent</li>
          </ol>

          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={skipVerify}
              onChange={(e) => setSkipVerify(e.target.checked)}
              className="accent-primary-600"
            />
            Skip verification step (dev only — when ngrok / PUBLIC_BASE_URL flaky)
          </label>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy} className="rounded-lg">Cancel</Button>
          <Button variant="primary" size="sm" onClick={deploy} disabled={busy} className="rounded-lg">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : step === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />}
            {step === 'verifying' ? 'Verifying…'
              : step === 'publishing' ? 'Publishing…'
              : step === 'deploying' ? 'Deploying…'
              : step === 'done' ? 'Deployed' : 'Deploy now'}
          </Button>
        </div>
      </div>
    </div>
  );
}
