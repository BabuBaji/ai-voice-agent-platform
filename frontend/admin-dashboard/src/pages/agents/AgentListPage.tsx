import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, LayoutGrid, List, MoreVertical, Bot, Phone, Clock,
  TrendingUp, Copy, Trash2, Edit, Loader2, AlertCircle, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Dropdown } from '@/components/ui/Dropdown';
import { formatNumber } from '@/utils/formatters';
import { agentApi } from '@/services/agent.api';
import type { Agent } from '@/types';

const mockAgents: Agent[] = [
  {
    id: '1', name: 'Sales Assistant', description: 'Handles inbound sales calls, qualifies leads, and schedules demos',
    status: 'active', greeting: 'Hi! Thanks for calling.', systemPrompt: '', voiceProvider: 'elevenlabs',
    voiceId: 'rachel', voiceSpeed: 1.0, language: 'en-US', tools: ['calendar', 'crm_lookup'],
    knowledgeBases: ['kb-1'], totalCalls: 1245, avgDuration: 204, successRate: 87.5, createdAt: '2026-03-15T00:00:00Z', updatedAt: '2026-04-17T00:00:00Z',
  },
  {
    id: '2', name: 'Customer Support', description: 'Provides 24/7 customer support for product inquiries and troubleshooting',
    status: 'active', greeting: 'Hello! How can I help?', systemPrompt: '', voiceProvider: 'elevenlabs',
    voiceId: 'adam', voiceSpeed: 1.0, language: 'en-US', tools: ['knowledge_search', 'transfer'],
    knowledgeBases: ['kb-1', 'kb-2'], totalCalls: 3420, avgDuration: 180, successRate: 92.1, createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-04-16T00:00:00Z',
  },
  {
    id: '3', name: 'Appointment Booking', description: 'Books, reschedules, and cancels appointments for the clinic',
    status: 'active', greeting: 'Welcome to our booking line!', systemPrompt: '', voiceProvider: 'azure',
    voiceId: 'en-US-JennyNeural', voiceSpeed: 1.1, language: 'en-US', tools: ['calendar'],
    knowledgeBases: [], totalCalls: 890, avgDuration: 120, successRate: 95.3, createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
  },
  {
    id: '4', name: 'Lead Qualifier', description: 'Pre-qualifies leads from marketing campaigns before routing to sales',
    status: 'draft', greeting: 'Hi there!', systemPrompt: '', voiceProvider: 'elevenlabs',
    voiceId: 'bella', voiceSpeed: 1.0, language: 'en-US', tools: ['crm_lookup'],
    knowledgeBases: ['kb-3'], totalCalls: 0, avgDuration: 0, successRate: 0, createdAt: '2026-04-10T00:00:00Z', updatedAt: '2026-04-17T00:00:00Z',
  },
  {
    id: '5', name: 'Survey Agent', description: 'Conducts post-purchase satisfaction surveys',
    status: 'inactive', greeting: 'Hi, we would love your feedback!', systemPrompt: '', voiceProvider: 'google',
    voiceId: 'en-US-Neural2-C', voiceSpeed: 0.9, language: 'en-US', tools: ['webhook'],
    knowledgeBases: [], totalCalls: 560, avgDuration: 90, successRate: 78.2, createdAt: '2026-01-15T00:00:00Z', updatedAt: '2026-03-20T00:00:00Z',
  },
];

const providerLabels: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  azure: 'Azure',
  google: 'Google',
  aws: 'AWS',
};

export function AgentListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await agentApi.list();
      setAgents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Failed to load agents';
      setError(message);
      setAgents(mockAgents);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    try {
      await agentApi.delete(agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    } catch {
      // ignore
    }
  };

  const handleClone = async (agent: Agent) => {
    try {
      const cloned = await agentApi.clone(agent.id);
      setAgents((prev) => [...prev, cloned]);
    } catch {
      // ignore
    }
  };

  const filtered = agents.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const agentMenuItems = (agent: Agent) => [
    { label: 'Edit', icon: <Edit className="h-4 w-4" />, onClick: () => navigate(`/agents/${agent.id}`) },
    { label: 'Voice Call', icon: <Phone className="h-4 w-4" />, onClick: () => navigate(`/agents/${agent.id}/call`) },
    { label: 'Web Call (Live)', icon: <Phone className="h-4 w-4" />, onClick: () => navigate(`/agents/${agent.id}/web-call`) },
    { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onClick: () => handleClone(agent) },
    { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => handleDelete(agent), danger: true, divider: true },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" />
          <p className="text-sm text-gray-400 mt-3">Loading agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">AI Agents</h1>
          <p className="text-xs text-gray-500 mt-0.5">Create and manage your AI voice agents</p>
        </div>
        <Button variant="gradient" onClick={() => navigate('/agents/new')} className="rounded-lg" size="sm">
          <Plus className="h-3.5 w-3.5" />
          Create Agent
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-50 border border-warning-200 text-xs text-warning-700">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Service unavailable: showing demo data. ({error})</span>
          <button onClick={fetchAgents} className="ml-auto text-warning-800 underline text-[11px] font-medium">Retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 transition-all"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="draft">Draft</option>
        </select>

        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:bg-gray-50'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:bg-gray-50'}`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-50 to-accent-50 flex items-center justify-center mx-auto mb-3">
            <Bot className="h-6 w-6 text-primary-400" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No agents found</h3>
          <p className="text-xs text-gray-500 mb-4 max-w-sm mx-auto">Get started by creating your first AI voice agent.</p>
          <Button variant="gradient" onClick={() => navigate('/agents/new')} className="rounded-lg" size="sm">
            <Plus className="h-3.5 w-3.5" />
            Create Your First Agent
          </Button>
        </div>
      )}

      {/* Grid view — tightened card layout */}
      {filtered.length > 0 && viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((agent) => (
            <div
              key={agent.id}
              className="bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm hover:border-gray-200 transition-all cursor-pointer group"
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-50 to-accent-50 text-primary-600 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm text-gray-900 truncate">{agent.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusBadge status={agent.status} />
                      <Badge variant="outline" className="text-[9px]">{providerLabels[agent.voiceProvider] || agent.voiceProvider}</Badge>
                    </div>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    trigger={
                      <button className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    }
                    items={agentMenuItems(agent)}
                  />
                </div>
              </div>

              <p className="text-xs text-gray-500 mb-2.5 line-clamp-2 leading-relaxed">{agent.description}</p>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
                <div className="text-center">
                  <div className="flex items-center justify-center text-gray-400">
                    <Phone className="h-2.5 w-2.5" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900 tabular-nums">{formatNumber((agent as any).totalCalls || (agent as any).total_calls || 0)}</p>
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide">Calls</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center text-gray-400">
                    <Clock className="h-2.5 w-2.5" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900 tabular-nums">{Math.floor(((agent as any).avgDuration || (agent as any).avg_duration || 0) / 60)}m</p>
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide">Avg</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center text-gray-400">
                    <TrendingUp className="h-2.5 w-2.5" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900 tabular-nums">{(agent as any).successRate || (agent as any).success_rate || 0}%</p>
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide">Success</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Provider</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Calls</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Avg Dur</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Success</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((agent) => (
                <tr key={agent.id} className="hover:bg-gray-50/50 cursor-pointer transition-colors" onClick={() => navigate(`/agents/${agent.id}`)}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary-50 to-accent-50 text-primary-600 flex items-center justify-center">
                        <Bot className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-900">{agent.name}</p>
                        <p className="text-[11px] text-gray-500 line-clamp-1">{agent.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={agent.status} /></td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{providerLabels[agent.voiceProvider] || agent.voiceProvider}</Badge></td>
                  <td className="px-3 py-2 text-xs text-gray-700 font-medium tabular-nums">{formatNumber(agent.totalCalls)}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">{Math.floor(agent.avgDuration / 60)}m {agent.avgDuration % 60}s</td>
                  <td className="px-3 py-2 text-xs text-gray-700 font-medium tabular-nums">{agent.successRate}%</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={<button className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"><MoreVertical className="h-3.5 w-3.5" /></button>}
                      items={agentMenuItems(agent)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
