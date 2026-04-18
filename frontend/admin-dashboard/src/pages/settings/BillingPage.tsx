import { NavLink } from 'react-router-dom';
import { Settings, Phone, Puzzle, Users, CreditCard, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
];

const usageMetrics = [
  { label: 'Calls', used: 1284, limit: 5000, unit: 'calls' },
  { label: 'AI Agents', used: 8, limit: 15, unit: 'agents' },
  { label: 'Minutes Used', used: 4520, limit: 10000, unit: 'min' },
  { label: 'Storage', used: 2.4, limit: 10, unit: 'GB' },
];

const plans = [
  {
    name: 'Starter',
    price: 29,
    current: false,
    features: ['3 AI Agents', '1,000 calls/mo', '2 GB storage', 'Email support', 'Basic analytics'],
  },
  {
    name: 'Professional',
    price: 99,
    current: true,
    features: ['15 AI Agents', '5,000 calls/mo', '10 GB storage', 'Priority support', 'Advanced analytics', 'Custom workflows', 'API access'],
  },
  {
    name: 'Enterprise',
    price: 299,
    current: false,
    features: ['Unlimited AI Agents', 'Unlimited calls', '100 GB storage', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'HIPAA compliance', 'SSO'],
  },
];

export function BillingPage() {
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

        <div className="flex-1 space-y-6">
          {/* Current Plan */}
          <Card>
            <CardHeader title="Current Plan" />
            <div className="flex items-center justify-between p-4 bg-primary-50 rounded-lg border border-primary-200">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900">Professional</h3>
                  <Badge variant="primary">Current Plan</Badge>
                </div>
                <p className="text-sm text-gray-500 mt-1">Billed monthly -- Next billing: May 1, 2026</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-gray-900">$99</p>
                <p className="text-sm text-gray-500">/month</p>
              </div>
            </div>
          </Card>

          {/* Usage */}
          <Card>
            <CardHeader title="Usage This Month" subtitle="Billing period: Apr 1 - Apr 30, 2026" />
            <div className="grid grid-cols-2 gap-6">
              {usageMetrics.map((metric) => {
                const percentage = (metric.used / metric.limit) * 100;
                const isWarning = percentage > 80;
                return (
                  <div key={metric.label}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{metric.label}</span>
                      <span className="text-sm text-gray-500">
                        {metric.used.toLocaleString()} / {metric.limit.toLocaleString()} {metric.unit}
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-100 rounded-full">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isWarning ? 'bg-warning-500' : 'bg-primary-500'
                        }`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{percentage.toFixed(0)}% used</p>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Plans */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Plans</h3>
            <div className="grid grid-cols-3 gap-4">
              {plans.map((plan) => (
                <div
                  key={plan.name}
                  className={`rounded-xl border p-5 ${
                    plan.current
                      ? 'border-primary-300 bg-primary-50/30 shadow-md'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <h4 className="font-semibold text-gray-900">{plan.name}</h4>
                  <div className="mt-2 mb-4">
                    <span className="text-3xl font-bold text-gray-900">${plan.price}</span>
                    <span className="text-sm text-gray-500">/mo</span>
                  </div>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-gray-600">
                        <Check className="h-4 w-4 text-success-500 flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {plan.current ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current Plan
                    </Button>
                  ) : (
                    <Button variant={plan.price > 99 ? 'primary' : 'outline'} className="w-full">
                      {plan.price > 99 ? 'Upgrade' : 'Downgrade'}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
