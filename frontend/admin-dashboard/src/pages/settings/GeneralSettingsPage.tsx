import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Settings, Phone, Puzzle, Users, CreditCard, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
];

const timezones = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Central European (CET)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Tokyo', label: 'Japan (JST)' },
];

const languages = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'hi', label: 'Hindi' },
];

export function GeneralSettingsPage() {
  const location = useLocation();
  const [saving, setSaving] = useState(false);

  const isGeneralPage = location.pathname === '/settings';

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and platform settings</p>
      </div>

      <div className="flex gap-6">
        {/* Settings nav */}
        <nav className="w-56 flex-shrink-0">
          <ul className="space-y-1">
            {settingsNav.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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

        {/* Content */}
        {isGeneralPage ? (
          <div className="flex-1 space-y-6">
            <Card>
              <CardHeader
                title="General Settings"
                subtitle="Basic configuration for your organization"
                action={
                  <Button onClick={handleSave} loading={saving} size="sm">
                    <Save className="h-4 w-4" />
                    Save Changes
                  </Button>
                }
              />
              <div className="space-y-6 max-w-lg">
                <Input
                  label="Organization Name"
                  defaultValue="TechCorp Inc."
                  placeholder="Your company name"
                />
                <Select
                  label="Timezone"
                  defaultValue="America/New_York"
                  options={timezones}
                />
                <Select
                  label="Default Language"
                  defaultValue="en"
                  options={languages}
                />
                <Input
                  label="Support Email"
                  type="email"
                  defaultValue="support@techcorp.com"
                  placeholder="support@company.com"
                />
                <Input
                  label="Webhook URL"
                  type="url"
                  defaultValue="https://api.techcorp.com/webhooks/va"
                  placeholder="https://..."
                  helperText="URL to receive event notifications"
                />
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
