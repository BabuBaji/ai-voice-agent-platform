import { useEffect, useState } from 'react';
import { AlertCircle, Bot, CheckCircle2, Link2, Loader2, Phone, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';
import { agentApi } from '@/services/agent.api';

/**
 * Attaches a number to an AI agent — saves the number_id ↔ agent_id mapping.
 * Does NOT deploy. After attach, the user clicks "Deploy" separately.
 *
 * This is the "purchased + verified → attached" transition only.
 */

interface AgentLite {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  system_prompt?: string | null;
  voice_config?: { provider?: string; voice_id?: string; language?: string } | null;
}

interface Props {
  open: boolean;
  phone: PhoneNumberRecord | null;
  onClose: () => void;
  onAttached: (rec: PhoneNumberRecord) => void;
}

export function AttachAgentModal({ open, phone, onClose, onAttached }: Props) {
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentId, setAgentId] = useState<string>('');
  const [attaching, setAttaching] = useState(false);
  const [skipVerify, setSkipVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAgentId('');
    setSkipVerify(false);
    setLoading(true);
    agentApi.list()
      .then((rows: any[]) => setAgents((rows || []).map((a) => ({
        id: a.id, name: a.name, status: String(a.status || '').toUpperCase(),
        description: a.description, system_prompt: a.system_prompt, voice_config: a.voice_config,
      }))))
      .catch((e: any) => setError(e?.response?.data?.message || e?.message || 'Could not load agents'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open || !phone) return null;

  const selected = agents.find((a) => a.id === agentId);

  const attach = async () => {
    if (!agentId) {
      setError('Pick an agent to attach.');
      return;
    }
    setAttaching(true);
    setError(null);
    try {
      const rec = await phoneNumberApi.assignAgent(phone.id, agentId, { bypass_verification: skipVerify });
      onAttached(rec);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e?.message || 'Attach failed';
      if (status === 412) {
        setError(`${msg} Tick "Skip verification" to override (or click Verify on the row first).`);
      } else {
        setError(msg);
      }
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => !attaching && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Link2 className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Attach to Agent</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Map <span className="font-mono font-medium text-gray-700">{phone.phone_number}</span> to a Voice AI agent. After attaching, click <strong>Deploy</strong> to take it live.
              </p>
            </div>
          </div>
          <button onClick={() => !attaching && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
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
              <div className="flex items-center gap-2 text-sm text-gray-500 py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading agents…</div>
            ) : agents.length === 0 ? (
              <div className="text-sm text-gray-500 py-3">No agents found. Create one on the Agents page first.</div>
            ) : (
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={attaching}
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
              <div className="flex items-center gap-2 text-gray-700 font-medium">
                <Bot className="h-4 w-4 text-primary-600" /> {selected.name}
              </div>
              {selected.description && <p className="text-xs text-gray-500">{selected.description}</p>}
              <div className="grid grid-cols-2 gap-2 pt-1.5 text-xs">
                <div>
                  <span className="text-gray-500">Voice:</span>{' '}
                  <span className="text-gray-900">{selected.voice_config?.voice_id || '—'} ({selected.voice_config?.language || 'en'})</span>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>{' '}
                  <span className={`uppercase font-semibold ${selected.status === 'PUBLISHED' || selected.status === 'ACTIVE' ? 'text-emerald-600' : 'text-amber-600'}`}>{selected.status.toLowerCase() || 'draft'}</span>
                </div>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={skipVerify}
              onChange={(e) => setSkipVerify(e.target.checked)}
              className="accent-primary-600"
            />
            Skip verification gate (use when PUBLIC_BASE_URL isn't a public tunnel — dev only)
          </label>

          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800">
            <Phone className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>What happens next:</strong> the number is mapped to the agent. The agent isn't live yet —
              click <strong>Deploy</strong> on the same row to freeze the agent config and activate inbound routing.
            </span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
          <Button variant="outline" size="sm" onClick={onClose} disabled={attaching} className="rounded-lg">Cancel</Button>
          <Button variant="primary" size="sm" onClick={attach} disabled={attaching || !agentId} className="rounded-lg">
            {attaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {attaching ? 'Attaching…' : 'Attach to agent'}
          </Button>
        </div>
      </div>
    </div>
  );
}
