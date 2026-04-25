import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, MoreVertical, ArrowUpRight, Cpu, Volume2, FileText, PhoneForwarded, Puzzle, SearchCode, Loader2,
  Bot, Edit, Phone, Copy, Trash2,
} from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { agentApi } from '@/services/agent.api';
import type { Agent } from '@/types';

/**
 * Self-contained "My Voice AI Assistants" grid, intended to sit at the bottom
 * of the /agents/new wizard's step 1. Fetches agents via agentApi.list on
 * mount, renders a search bar + a 3-col responsive grid of cards with the
 * metadata layout (LLM, Voice, KB, Search, Post-call, Integrations).
 *
 * Adding this component does not touch the wizard's creation state — it's
 * purely a listing surface that navigates to /agents/:id on click.
 */
export function MyAssistantsSection() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await agentApi.list();
        if (!cancelled) setAgents(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        (a.name || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
    );
  }, [agents, search]);

  const handleDelete = async (a: Agent) => {
    if (!confirm(`Delete agent "${a.name}"?`)) return;
    try {
      await agentApi.delete(a.id);
      setAgents((prev) => prev.filter((x) => x.id !== a.id));
    } catch {
      // ignore
    }
  };
  const handleClone = async (a: Agent) => {
    try {
      const cloned = await agentApi.clone(a.id);
      setAgents((prev) => [...prev, cloned]);
    } catch {
      // ignore
    }
  };

  const menuItems = (a: Agent) => [
    { label: 'Edit', icon: <Edit className="h-4 w-4" />, onClick: () => navigate(`/agents/${a.id}`) },
    { label: 'Voice Call', icon: <Phone className="h-4 w-4" />, onClick: () => navigate(`/agents/${a.id}/call`) },
    { label: 'Web Call (Live)', icon: <Phone className="h-4 w-4" />, onClick: () => navigate(`/agents/${a.id}/web-call`) },
    { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onClick: () => handleClone(a) },
    { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => handleDelete(a), danger: true, divider: true },
  ];

  return (
    <section className="mt-6">
      {/* Header + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-gray-900">My Voice AI Assistants</h2>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assistants..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-28 rounded-lg border border-gray-100 bg-white">
          <div className="text-center">
            <Loader2 className="h-4 w-4 animate-spin text-teal-500 mx-auto" />
            <p className="text-[11px] text-gray-400 mt-1.5">Loading assistants...</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 bg-white rounded-lg border border-gray-100">
          <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center mx-auto mb-2">
            <Bot className="h-5 w-5 text-gray-300" />
          </div>
          <h3 className="text-xs font-semibold text-gray-700">
            {agents.length === 0 ? 'No assistants yet' : 'No matches for your search'}
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {agents.length === 0
              ? 'Describe your first voice AI assistant above to get started.'
              : 'Try a different keyword.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onOpen={() => navigate(`/agents/${agent.id}`)}
              menuItems={menuItems(agent)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card — mirrors the reference screenshot: arrow + name + language (header),
// 2-col metadata grid (LLM/Voice/KB/Search/Post-call/Integrations), ID badge
// + full-width "Edit Agent" teal button (footer).
// ---------------------------------------------------------------------------

function AgentCard({
  agent,
  onOpen,
  menuItems,
}: {
  agent: Agent;
  onOpen: () => void;
  menuItems: Array<{ label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; divider?: boolean }>;
}) {
  const voiceCfg: any = (agent as any).voice_config || {};
  const llmModel = (agent as any).llm_model || 'gpt-4.1-mini';
  const voiceProvider = voiceCfg.provider || (agent as any).voiceProvider || 'cartesia';
  const kbCount = Array.isArray((agent as any).knowledge_base_ids)
    ? (agent as any).knowledge_base_ids.length
    : Array.isArray((agent as any).knowledgeBases)
      ? (agent as any).knowledgeBases.length
      : 0;
  const toolsCfg = (agent as any).tools_config || {};
  const postCallActions = Array.isArray(toolsCfg.post_call)
    ? toolsCfg.post_call.length
    : ((agent as any).post_call_config?.actions?.length || 0);
  const integrationsCount = (agent as any).integrations_config
    ? Object.values((agent as any).integrations_config).filter((v: any) => v?.enabled).length
    : 0;
  const language = voiceCfg.language || (agent as any).language || '—';
  const shortId = (agent.id || '').slice(-6).toUpperCase();
  const directionIcon = (agent as any).direction === 'INBOUND' ? '↘' : '↗';

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden flex flex-col hover:shadow-sm hover:border-gray-300 transition-all">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-start gap-1.5 cursor-pointer" onClick={onOpen}>
        <span className="text-teal-500 mt-0.5 font-bold text-xs">{directionIcon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-xs text-gray-900 truncate">{agent.name}</h3>
          <p className="text-[10px] text-gray-500 mt-0.5 truncate">{language}</p>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Dropdown
            trigger={
              <button className="p-0.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            }
            items={menuItems}
          />
        </div>
      </div>

      {/* Metadata grid — two columns */}
      <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]" onClick={onOpen}>
        <MetaRow icon={<Cpu className="h-2.5 w-2.5" />} label="LLM" value={llmModel} />
        <MetaRow icon={<Volume2 className="h-2.5 w-2.5" />} label="Voice" value={voiceProvider} />
        <MetaRow icon={<FileText className="h-2.5 w-2.5" />} label="KB" value={String(kbCount)} />
        <MetaRow icon={<SearchCode className="h-2.5 w-2.5" />} label="Search" value="Off" muted />
        <MetaRow
          icon={<PhoneForwarded className="h-2.5 w-2.5" />}
          label={`Post-call (${postCallActions})`}
          value={postCallActions > 0 ? `${postCallActions}` : 'None'}
          muted={postCallActions === 0}
        />
        <MetaRow
          icon={<Puzzle className="h-2.5 w-2.5" />}
          label={`Integ. (${integrationsCount})`}
          value={integrationsCount > 0 ? `${integrationsCount} active` : 'None'}
          muted={integrationsCount === 0}
        />
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between gap-1.5">
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md border border-gray-200 text-gray-500 bg-gray-50">
          #{shortId}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md bg-teal-500/90 hover:bg-teal-500 text-white text-[11px] font-semibold transition"
        >
          Edit Agent <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function MetaRow({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-gray-400 shrink-0">{icon}</span>
      <span className="text-gray-500 whitespace-nowrap">{label}:</span>
      <span className={`font-semibold truncate ${muted ? 'text-gray-400' : 'text-gray-800'}`}>{value}</span>
    </div>
  );
}
