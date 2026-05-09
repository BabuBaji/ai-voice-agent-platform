import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Phone, Rocket, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';
import { agentApi } from '@/services/agent.api';

interface AgentLite {
  id: string;
  name: string;
  status: string;
  direction?: string;
  system_prompt?: string | null;
  greeting_message?: string | null;
  voice_config?: { provider?: string; voice_id?: string; language?: string } | null;
  llm_provider?: string | null;
  llm_model?: string | null;
}

interface ReadinessIssue {
  level: 'block' | 'warn';
  field: string;
  message: string;
}

function computeReadiness(a: AgentLite | undefined): ReadinessIssue[] {
  if (!a) return [];
  const issues: ReadinessIssue[] = [];
  if (!a.system_prompt || a.system_prompt.trim().length < 20) {
    issues.push({ level: 'block', field: 'system_prompt', message: 'No system prompt — agent has nothing to say. Add one in Agent Builder → Prompt tab.' });
  }
  if (!a.voice_config?.provider || !a.voice_config?.voice_id) {
    issues.push({ level: 'block', field: 'voice_config', message: 'No voice configured — TTS will fall back to defaults. Set one in Agent Builder → Voice tab.' });
  }
  if (!a.greeting_message || a.greeting_message.trim().length === 0) {
    issues.push({ level: 'warn', field: 'greeting_message', message: 'No greeting message — caller will hear silence until they speak. Add one in Agent Builder → Greeting.' });
  }
  if (!a.llm_provider) {
    issues.push({ level: 'warn', field: 'llm_provider', message: 'No LLM provider set — using server default.' });
  }
  return issues;
}

interface Props {
  open: boolean;
  /** The just-purchased number — modal opens with this row pre-loaded. */
  phone: PhoneNumberRecord | null;
  onClose: () => void;
  /** Fired after deploy succeeds. Parent should reload its owned-numbers list. */
  onDeployed: (rec: PhoneNumberRecord) => void;
}

export function AssignDeployModal({ open, phone, onClose, onDeployed }: Props) {
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentId, setAgentId] = useState<string>('');
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'verifying' | 'publishing' | 'attaching' | 'deploying' | 'done'>('idle');
  const [overrideBlocks, setOverrideBlocks] = useState(false);
  const [skipVerify, setSkipVerify] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep('idle');
    setAgentId('');
    setOverrideBlocks(false);
    setLoading(true);
    agentApi.list()
      .then((rows: any[]) => {
        const list = (rows || []).map((a) => ({
          id: a.id,
          name: a.name,
          status: String(a.status || '').toUpperCase(),
          direction: a.direction,
          system_prompt: a.system_prompt,
          greeting_message: a.greeting_message,
          voice_config: a.voice_config,
          llm_provider: a.llm_provider,
          llm_model: a.llm_model,
        }));
        setAgents(list);
      })
      .catch((e: any) => setError(e?.response?.data?.message || e?.message || 'Could not load agents'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open || !phone) return null;

  const selected = agents.find((a) => a.id === agentId);
  const isDraft = selected ? !['PUBLISHED', 'ACTIVE'].includes(selected.status) : false;
  const issues = computeReadiness(selected);
  const blockingIssues = issues.filter((i) => i.level === 'block');
  const warningIssues = issues.filter((i) => i.level === 'warn');
  const canDeploy = !!agentId && (blockingIssues.length === 0 || overrideBlocks);

  const deploy = async () => {
    if (!phone) return;
    if (!agentId) {
      setError('Pick an agent to attach this number to.');
      return;
    }
    if (blockingIssues.length > 0 && !overrideBlocks) {
      setError('Resolve the blocking issues below, or check "Deploy anyway" to proceed.');
      return;
    }
    setDeploying(true);
    setError(null);
    try {
      // 1. Run verification (best-effort) so the deploy gate is satisfied.
      //    User can opt out with "Skip verification" — useful in dev where
      //    PUBLIC_BASE_URL isn't a public tunnel.
      if (!skipVerify) {
        setStep('verifying');
        try {
          await phoneNumberApi.verify(phone.id);
        } catch {
          // Non-fatal: deploy step uses bypass flag if verify fails.
        }
      }

      // 2. Publish agent if it's still draft (existing behaviour preserved).
      if (isDraft) {
        setStep('publishing');
        try {
          await agentApi.publish(agentId);
        } catch (e: any) {
          const msg = e?.response?.data?.message || '';
          if (!/already.*publish|published/i.test(msg)) throw e;
        }
      }

      // 3. Assign-agent (enforces verification gate; bypass when override on).
      setStep('attaching');
      try {
        await phoneNumberApi.assignAgent(phone.id, agentId, { bypass_verification: skipVerify || overrideBlocks });
      } catch (e: any) {
        // 412 from the backend means verification missing — surface it cleanly.
        const status = e?.response?.status;
        if (status === 412) {
          setError(e?.response?.data?.message || 'Verification needed before assigning. Tick "Skip verification" or run Verify first.');
          setStep('idle');
          return;
        }
        throw e;
      }

      // 4. Deploy: snapshot config + activate routing.
      setStep('deploying');
      await phoneNumberApi.deploy(phone.id, {
        agent_id: agentId,
        bypass_verification: skipVerify || overrideBlocks,
      });

      // Reflect new state locally so the parent reload picks up deployment_status=deployed.
      const rec: PhoneNumberRecord = {
        ...phone,
        agent_id: agentId,
        is_active: true,
        deployment_status: 'deployed',
        deployed_at: new Date().toISOString(),
      };
      setStep('done');
      onDeployed(rec);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Deploy failed');
      setStep('idle');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => !deploying && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Phone className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Attach &amp; Deploy</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                <span className="font-mono font-medium text-gray-700">{phone.phone_number}</span> needs an agent before it can take live calls.
              </p>
            </div>
          </div>
          <button onClick={() => !deploying && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
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

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Choose an agent</label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading agents…
              </div>
            ) : agents.length === 0 ? (
              <div className="text-sm text-gray-500 py-3">
                No agents found. Create one on the Agents page first.
              </div>
            ) : (
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={deploying}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
              >
                <option value="">— pick an agent —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.status && `· ${a.status.toLowerCase()}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selected && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-sm space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Agent</span>
                <span className="font-medium text-gray-900">{selected.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Status</span>
                <span className={`text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md ${isDraft ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {selected.status.toLowerCase()}
                </span>
              </div>
              {isDraft && (
                <p className="text-xs text-amber-700 pt-1.5 border-t border-gray-200 mt-2">
                  Agent is a draft — Deploy will publish it first, then attach this number.
                </p>
              )}
            </div>
          )}

          {selected && issues.length > 0 && (
            <div className={`rounded-xl border px-4 py-3 text-sm space-y-2 ${blockingIssues.length > 0 ? 'bg-danger-50 border-danger-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className={`flex items-center gap-2 font-medium ${blockingIssues.length > 0 ? 'text-danger-700' : 'text-amber-800'}`}>
                <AlertCircle className="h-4 w-4" />
                {blockingIssues.length > 0 ? 'Agent isn\'t ready for live calls' : 'Recommended improvements'}
              </div>
              <ul className="space-y-1 pl-1">
                {issues.map((i) => (
                  <li key={i.field} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${i.level === 'block' ? 'bg-danger-600' : 'bg-amber-600'}`} />
                    <span className={i.level === 'block' ? 'text-danger-700' : 'text-amber-800'}>
                      {i.message}
                    </span>
                  </li>
                ))}
              </ul>
              {blockingIssues.length > 0 && (
                <label className="flex items-center gap-2 pt-2 mt-2 border-t border-danger-200 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideBlocks}
                    onChange={(e) => setOverrideBlocks(e.target.checked)}
                    className="accent-danger-600"
                  />
                  <span className="text-danger-700">Deploy anyway — I'll fix the agent later.</span>
                </label>
              )}
            </div>
          )}

          <ol className="text-xs text-gray-500 space-y-1 pl-4 list-decimal">
            <li className={step === 'verifying' ? 'text-primary-700 font-medium' : ''}>Verify number (carrier, webhook, audio path)</li>
            <li className={step === 'publishing' ? 'text-primary-700 font-medium' : ''}>Publish agent (if draft)</li>
            <li className={step === 'attaching' ? 'text-primary-700 font-medium' : ''}>Attach number to agent</li>
            <li className={step === 'deploying' ? 'text-primary-700 font-medium' : ''}>Snapshot agent config &amp; activate live routing</li>
            <li className={step === 'done' ? 'text-emerald-700 font-medium' : ''}>Number routes inbound calls to this agent</li>
          </ol>

          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={skipVerify}
              onChange={(e) => setSkipVerify(e.target.checked)}
              className="accent-primary-600"
            />
            <ShieldCheck className="h-3.5 w-3.5 text-gray-400" />
            Skip verification (use when PUBLIC_BASE_URL isn't a public tunnel — dev only)
          </label>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2 bg-gray-50/60 rounded-b-2xl">
          <p className="text-[11px] text-gray-500">
            You can reassign or release the number later from <strong>Your Phone Numbers</strong>.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={deploying} className="rounded-lg">
              Skip for now
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={deploy}
              disabled={deploying || !canDeploy || agents.length === 0}
              className="rounded-lg"
            >
              {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : step === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />}
              {step === 'verifying' ? 'Verifying…'
                : step === 'publishing' ? 'Publishing…'
                : step === 'attaching' ? 'Attaching…'
                : step === 'deploying' ? 'Deploying…'
                : step === 'done' ? 'Deployed' : 'Deploy'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
