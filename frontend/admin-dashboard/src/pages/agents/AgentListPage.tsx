import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, LayoutGrid, List, MoreVertical, Bot, Phone, Clock, TrendingUp, Copy, Trash2, Edit } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Dropdown } from '@/components/ui/Dropdown';
import { formatNumber } from '@/utils/formatters';
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

export function AgentListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const filtered = mockAgents.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const agentMenuItems = (agent: Agent) => [
    { label: 'Edit', icon: <Edit className="h-4 w-4" />, onClick: () => navigate(`/agents/${agent.id}`) },
    { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onClick: () => {} },
    { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => {}, danger: true, divider: true },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage your AI voice agents</p>
        </div>
        <Button onClick={() => navigate('/agents/new')}>
          <Plus className="h-4 w-4" />
          Create Agent
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="draft">Draft</option>
        </select>

        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 ${viewMode === 'grid' ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 ${viewMode === 'list' ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grid view */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <div
              key={agent.id}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all cursor-pointer group"
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                    <StatusBadge status={agent.status} />
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    trigger={
                      <button className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    }
                    items={agentMenuItems(agent)}
                  />
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-4 line-clamp-2">{agent.description}</p>
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-400 mb-0.5">
                    <Phone className="h-3 w-3" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{formatNumber(agent.totalCalls)}</p>
                  <p className="text-[10px] text-gray-400">Calls</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-400 mb-0.5">
                    <Clock className="h-3 w-3" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{Math.floor(agent.avgDuration / 60)}m</p>
                  <p className="text-[10px] text-gray-400">Avg Dur.</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-400 mb-0.5">
                    <TrendingUp className="h-3 w-3" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{agent.successRate}%</p>
                  <p className="text-[10px] text-gray-400">Success</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Agent</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Calls</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Avg Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Success Rate</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((agent) => (
                <tr key={agent.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/agents/${agent.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                        <p className="text-xs text-gray-500">{agent.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={agent.status} /></td>
                  <td className="px-4 py-3 text-sm text-gray-700">{formatNumber(agent.totalCalls)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{Math.floor(agent.avgDuration / 60)}m {agent.avgDuration % 60}s</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{agent.successRate}%</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={<button className="p-1 text-gray-400 hover:text-gray-600"><MoreVertical className="h-4 w-4" /></button>}
                      items={agentMenuItems(agent)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
