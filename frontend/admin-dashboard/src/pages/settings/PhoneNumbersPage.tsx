import { useState } from 'react';
import { Plus, Phone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Input';
import { formatPhone } from '@/utils/formatters';
import type { PhoneNumber } from '@/types';
import { NavLink } from 'react-router-dom';
import { Settings, Puzzle, Users, CreditCard } from 'lucide-react';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
];

const mockNumbers: PhoneNumber[] = [
  { id: '1', number: '+14155551234', provider: 'twilio', agentId: '1', agentName: 'Sales Bot', status: 'active', country: 'US' },
  { id: '2', number: '+14155555678', provider: 'twilio', agentId: '2', agentName: 'Support Agent', status: 'active', country: 'US' },
  { id: '3', number: '+442071234567', provider: 'vonage', agentId: '3', agentName: 'Booking Agent', status: 'active', country: 'GB' },
  { id: '4', number: '+919876543210', provider: 'exotel', status: 'inactive', country: 'IN' },
];

const providerBadge: Record<string, 'primary' | 'success' | 'info'> = {
  twilio: 'primary',
  exotel: 'success',
  vonage: 'info',
};

export function PhoneNumbersPage() {
  const [showAddModal, setShowAddModal] = useState(false);

  const columns = [
    {
      key: 'number',
      label: 'Phone Number',
      render: (item: PhoneNumber) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
            <Phone className="h-4 w-4 text-primary-500" />
          </div>
          <span className="font-mono font-medium text-gray-900">{formatPhone(item.number)}</span>
        </div>
      ),
    },
    {
      key: 'provider',
      label: 'Provider',
      render: (item: PhoneNumber) => (
        <Badge variant={providerBadge[item.provider] || 'default'}>
          {item.provider.charAt(0).toUpperCase() + item.provider.slice(1)}
        </Badge>
      ),
    },
    {
      key: 'agentName',
      label: 'Assigned Agent',
      render: (item: PhoneNumber) => (
        <span className={`text-sm ${item.agentName ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
          {item.agentName || 'Unassigned'}
        </span>
      ),
    },
    { key: 'country', label: 'Country' },
    {
      key: 'status',
      label: 'Status',
      render: (item: PhoneNumber) => <StatusBadge status={item.status} />,
    },
  ];

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

        <div className="flex-1">
          <Card padding={false} className="shadow-card">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Phone Numbers</h3>
                <p className="text-sm text-gray-500">Manage phone numbers and assign them to agents</p>
              </div>
              <Button variant="gradient" size="sm" onClick={() => setShowAddModal(true)} className="rounded-xl">
                <Plus className="h-4 w-4" />
                Buy Number
              </Button>
            </div>
            <Table columns={columns} data={mockNumbers} />
          </Card>
        </div>
      </div>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Phone Number">
        <div className="space-y-4">
          <Input label="Phone Number" placeholder="+1 (555) 123-4567" />
          <Select label="Provider" options={[
            { value: 'twilio', label: 'Twilio' },
            { value: 'exotel', label: 'Exotel' },
            { value: 'vonage', label: 'Vonage' },
          ]} />
          <Select label="Assign Agent" options={[
            { value: '', label: 'Unassigned' },
            { value: '1', label: 'Sales Bot' },
            { value: '2', label: 'Support Agent' },
            { value: '3', label: 'Booking Agent' },
          ]} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAddModal(false)} className="rounded-xl">Cancel</Button>
            <Button variant="gradient" onClick={() => setShowAddModal(false)} className="rounded-xl">Add Number</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
