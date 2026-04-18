import { NavLink } from 'react-router-dom';
import { Settings, Phone, Puzzle, Users, CreditCard, ExternalLink } from 'lucide-react';
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
  { id: '1', name: 'Twilio', description: 'Voice calls, SMS, and phone number management', category: 'Telephony', connected: true, icon: 'T' },
  { id: '2', name: 'Exotel', description: 'Cloud telephony for India and Southeast Asia', category: 'Telephony', connected: false, icon: 'E' },
  { id: '3', name: 'Vonage', description: 'Global voice and messaging APIs', category: 'Telephony', connected: false, icon: 'V' },
  { id: '4', name: 'SendGrid', description: 'Email delivery and marketing campaigns', category: 'Email', connected: true, icon: 'S' },
  { id: '5', name: 'Salesforce', description: 'CRM data sync and lead management', category: 'CRM', connected: false, icon: 'SF' },
  { id: '6', name: 'HubSpot', description: 'Marketing automation and CRM integration', category: 'CRM', connected: true, icon: 'H' },
  { id: '7', name: 'Google Calendar', description: 'Appointment booking and scheduling', category: 'Productivity', connected: true, icon: 'G' },
  { id: '8', name: 'Slack', description: 'Real-time notifications and alerts', category: 'Productivity', connected: false, icon: 'SL' },
  { id: '9', name: 'Zapier', description: 'Connect with 5000+ apps via workflows', category: 'Automation', connected: false, icon: 'Z' },
  { id: '10', name: 'Google Analytics', description: 'Call analytics and conversion tracking', category: 'Analytics', connected: false, icon: 'GA' },
  { id: '11', name: 'AWS S3', description: 'Call recording and document storage', category: 'Storage', connected: true, icon: 'S3' },
  { id: '12', name: 'Stripe', description: 'Payment processing and billing', category: 'Payments', connected: false, icon: 'ST' },
];

const categoryColors: Record<string, string> = {
  Telephony: 'bg-blue-500',
  Email: 'bg-green-500',
  CRM: 'bg-purple-500',
  Productivity: 'bg-orange-500',
  Automation: 'bg-pink-500',
  Analytics: 'bg-cyan-500',
  Storage: 'bg-yellow-500',
  Payments: 'bg-indigo-500',
};

export function IntegrationsPage() {
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
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'
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

        <div className="flex-1">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Integrations</h3>
            <p className="text-sm text-gray-500">Connect external services to enhance your platform</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {integrations.map((integration) => (
              <div
                key={integration.id}
                className={`bg-white rounded-xl border p-5 transition-all hover:shadow-md ${
                  integration.connected ? 'border-success-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${categoryColors[integration.category] || 'bg-gray-500'} text-white flex items-center justify-center text-xs font-bold`}>
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
                  >
                    {integration.connected ? 'Disconnect' : 'Connect'}
                  </Button>
                  <button className="text-xs text-gray-400 hover:text-primary-600 flex items-center gap-1">
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
