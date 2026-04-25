import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Settings, Phone, Puzzle, Users, CreditCard, Mail, KeyRound, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Select } from '@/components/ui/Input';
import { formatDate } from '@/utils/formatters';
import type { TeamMember } from '@/types';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'API', path: '/settings/api', icon: KeyRound },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
  { label: 'Audit Log', path: '/settings/audit-log', icon: ScrollText },
];

const mockMembers: TeamMember[] = [
  { id: '1', name: 'Admin User', email: 'admin@techcorp.com', role: 'admin', status: 'active', lastActive: '2026-04-18T10:30:00Z', joinedAt: '2025-06-01T00:00:00Z' },
  { id: '2', name: 'John Doe', email: 'john@techcorp.com', role: 'manager', status: 'active', lastActive: '2026-04-18T09:15:00Z', joinedAt: '2025-08-15T00:00:00Z' },
  { id: '3', name: 'Jane Smith', email: 'jane@techcorp.com', role: 'agent', status: 'active', lastActive: '2026-04-17T16:00:00Z', joinedAt: '2025-11-20T00:00:00Z' },
  { id: '4', name: 'David Kim', email: 'david@techcorp.com', role: 'agent', status: 'active', lastActive: '2026-04-17T14:30:00Z', joinedAt: '2026-01-10T00:00:00Z' },
  { id: '5', name: 'Pending Invite', email: 'newuser@techcorp.com', role: 'agent', status: 'invited', joinedAt: '2026-04-17T00:00:00Z' },
];

const roleBadge: Record<string, 'primary' | 'warning' | 'default'> = {
  admin: 'primary',
  manager: 'warning',
  agent: 'default',
};

export function TeamPage() {
  const [showInviteModal, setShowInviteModal] = useState(false);

  const columns = [
    {
      key: 'name',
      label: 'Member',
      render: (item: TeamMember) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-600 flex items-center justify-center text-sm font-semibold">
            {item.name[0]}
          </div>
          <div>
            <p className="font-medium text-gray-900">{item.name}</p>
            <p className="text-xs text-gray-400">{item.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (item: TeamMember) => (
        <Badge variant={roleBadge[item.role] || 'default'}>
          {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
        </Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (item: TeamMember) => <StatusBadge status={item.status} />,
    },
    {
      key: 'lastActive',
      label: 'Last Active',
      render: (item: TeamMember) => (
        <span className="text-sm text-gray-500">
          {item.lastActive ? formatDate(item.lastActive) : 'Never'}
        </span>
      ),
    },
    {
      key: 'joinedAt',
      label: 'Joined',
      render: (item: TeamMember) => (
        <span className="text-sm text-gray-500">{formatDate(item.joinedAt)}</span>
      ),
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
                <h3 className="text-lg font-semibold text-gray-900">Team Members</h3>
                <p className="text-sm text-gray-500">{mockMembers.length} members</p>
              </div>
              <Button variant="gradient" size="sm" onClick={() => setShowInviteModal(true)} className="rounded-xl">
                <Mail className="h-4 w-4" />
                Invite Member
              </Button>
            </div>
            <Table columns={columns} data={mockMembers} />
          </Card>
        </div>
      </div>

      <Modal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} title="Invite Team Member">
        <div className="space-y-4">
          <Input label="Email Address" type="email" placeholder="colleague@company.com" />
          <Select label="Role" options={[
            { value: 'agent', label: 'Agent' },
            { value: 'manager', label: 'Manager' },
            { value: 'admin', label: 'Admin' },
          ]} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowInviteModal(false)} className="rounded-xl">Cancel</Button>
            <Button variant="gradient" onClick={() => setShowInviteModal(false)} className="rounded-xl">
              <Mail className="h-4 w-4" />
              Send Invite
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
