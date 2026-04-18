import { NavLink } from 'react-router-dom';
import { Settings, Phone, Puzzle, Users, CreditCard, ExternalLink, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
];

const integrations = [
  { id: '1', name: 'Twilio', description: 'Voice calls, SMS, and phone number management', category: 'Telephony', connected: true, icon: 'T', color: 'bg-red-500' },
  { id: '2', name: 'Exotel', description: 'Cloud telephony for India and Southeast Asia', category: 'Telephony', connected: false, icon: 'E', color: 'bg-blue-600' },
  { id: '3', name: 'OpenAI', description: 'GPT-4o and GPT-4 Turbo language models', category: 'AI / LLM', connected: true, icon: 'AI', color: 'bg-gray-900' },
  { id: '4', name: 'Anthropic', description: 'Claude language models for conversation', category: 'AI / LLM', connected: true, icon: 'A', color: 'bg-amber-700' },
  { id: '5', name: 'Google', description: 'Gemini models and Google Cloud TTS', category: 'AI / LLM', connected: false, icon: 'G', color: 'bg-blue-500' },
  { id: '6', name: 'ElevenLabs', description: 'Ultra-realistic AI voice synthesis', category: 'Voice', connected: true, icon: 'XI', color: 'bg-violet-600' },
  { id: '7', name: 'Deepgram', description: 'Real-time speech-to-text transcription', category: 'Voice', connected: true, icon: 'DG', color: 'bg-emerald-600' },
  { id: '8', name: 'Salesforce', description: 'CRM data sync and lead management', category: 'CRM', connected: false, icon: 'SF', color: 'bg-sky-500' },
  { id: '9', name: 'HubSpot', description: 'Marketing automation and CRM integration', category: 'CRM', connected: true, icon: 'H', color: 'bg-orange-500' },
  { id: '10', name: 'SendGrid', description: 'Email delivery and marketing campaigns', category: 'Email', connected: true, icon: 'SG', color: 'bg-blue-400' },
  { id: '11', name: 'Slack', description: 'Real-time notifications and alerts', category: 'Productivity', connected: false, icon: 'SL', color: 'bg-purple-600' },
  { id: '12', name: 'Zapier', description: 'Connect with 5000+ apps via workflows', category: 'Automation', connected: false, icon: 'Z', color: 'bg-orange-600' },
  { id: '13', name: 'Make', description: 'Visual automation platform for workflows', category: 'Automation', connected: false, icon: 'M', color: 'bg-indigo-600' },
  { id: '14', name: 'N8N', description: 'Self-hosted workflow automation', category: 'Automation', connected: false, icon: 'N8', color: 'bg-pink-600' },
  { id: '15', name: 'Cal.com', description: 'Open-source scheduling and booking', category: 'Calendar', connected: false, icon: 'C', color: 'bg-gray-800' },
  { id: '16', name: 'Google Calendar', description: 'Appointment booking and scheduling', category: 'Calendar', connected: true, icon: 'GC', color: 'bg-green-600' },
];

export function IntegrationsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const categories = [...new Set(integrations.map((i) => i.category))];

  const filtered = integrations.filter((i) => {
    const matchSearch = i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and platform settings</p>
      </div>

      <div className="flex gap-6">
        <nav className="w-56 flex-shrink-0">
          <ul className="space-y-1">
            {settingsNav.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      isActive ? 'bg-primary-50 text-primary-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Integrations</h3>
              <p className="text-sm text-gray-500">Connect external services to enhance your platform</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search integrations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((integration) => (
              <div
                key={integration.id}
                className={`bg-white rounded-xl border p-5 transition-all duration-200 hover:shadow-card-hover group ${
                  integration.connected ? 'border-success-200' : 'border-gray-100 shadow-card'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${integration.color} text-white flex items-center justify-center text-xs font-bold`}>
                      {integration.icon}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 text-sm">{integration.name}</h4>
                      <span className="text-xs text-gray-400">{integration.category}</span>
                    </div>
                  </div>
                  {integration.connected && <Badge variant="success" dot>Connected</Badge>}
                </div>
                <p className="text-sm text-gray-500 mb-4">{integration.description}</p>
                <div className="flex items-center justify-between">
                  <Button
                    variant={integration.connected ? 'outline' : 'primary'}
                    size="sm"
                    className="rounded-lg"
                  >
                    {integration.connected ? 'Configure' : 'Connect'}
                  </Button>
                  <button className="text-xs text-gray-400 hover:text-primary-600 flex items-center gap-1 transition-colors">
                    <ExternalLink className="h-3 w-3" />
                    Docs
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
