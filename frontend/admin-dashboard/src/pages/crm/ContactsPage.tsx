import { useState } from 'react';
import { Search, Plus, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { ContactForm } from '@/components/crm/ContactForm';
import { formatDate } from '@/utils/formatters';
import type { Contact } from '@/types';

const mockContacts: Contact[] = [
  { id: '1', name: 'Sarah Johnson', email: 'sarah@healthclinics.com', phone: '+14155551234', company: 'Health Clinics Inc.', title: 'CEO', lastContactedAt: '2026-04-18T10:30:00Z', createdAt: '2026-03-10T00:00:00Z' },
  { id: '2', name: 'Mike Chen', email: 'mike@techstart.io', phone: '+14155555678', company: 'TechStart', title: 'CTO', lastContactedAt: '2026-04-17T14:20:00Z', createdAt: '2026-02-15T00:00:00Z' },
  { id: '3', name: 'Emily Davis', email: 'emily@retailco.com', phone: '+14155559012', company: 'RetailCo', title: 'VP Sales', lastContactedAt: '2026-04-16T09:00:00Z', createdAt: '2026-01-20T00:00:00Z' },
  { id: '4', name: 'Alex Rivera', email: 'alex@edufirst.org', phone: '+14155553456', company: 'EduFirst', title: 'Director of Operations', lastContactedAt: '2026-04-18T08:50:00Z', createdAt: '2026-04-01T00:00:00Z' },
  { id: '5', name: 'Jordan Smith', email: 'jordan@bigcorp.com', phone: '+14155557890', company: 'BigCorp', title: 'Head of IT', lastContactedAt: '2026-04-15T16:00:00Z', createdAt: '2025-12-05T00:00:00Z' },
  { id: '6', name: 'Lisa Wang', email: 'lisa@finserve.com', phone: '+14155552345', company: 'FinServe', title: 'COO', lastContactedAt: '2026-04-16T09:00:00Z', createdAt: '2026-03-01T00:00:00Z' },
];

export function ContactsPage() {
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filtered = mockContacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    {
      key: 'name', label: 'Name', sortable: true,
      render: (item: Contact) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-600 flex items-center justify-center text-sm font-semibold">
            {item.name[0]}
          </div>
          <div>
            <p className="font-medium text-gray-900">{item.name}</p>
            <p className="text-xs text-gray-400">{item.title}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'email', label: 'Email',
      render: (item: Contact) => (
        <div className="flex items-center gap-1.5 text-gray-600">
          <Mail className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-sm">{item.email}</span>
        </div>
      ),
    },
    {
      key: 'phone', label: 'Phone',
      render: (item: Contact) => (
        <div className="flex items-center gap-1.5 text-gray-600">
          <Phone className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-sm font-mono">{item.phone}</span>
        </div>
      ),
    },
    { key: 'company', label: 'Company', sortable: true },
    {
      key: 'lastContactedAt', label: 'Last Contacted', sortable: true,
      render: (item: Contact) => (
        <span className="text-sm text-gray-500">
          {item.lastContactedAt ? formatDate(item.lastContactedAt) : 'Never'}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your contact directory</p>
        </div>
        <Button variant="gradient" onClick={() => setShowCreateModal(true)} className="rounded-xl">
          <Plus className="h-4 w-4" />
          Add Contact
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all" />
      </div>

      <Card padding={false} className="shadow-card">
        <Table columns={columns} data={filtered} />
      </Card>

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add Contact">
        <ContactForm
          onSubmit={(data) => { console.log('Create contact:', data); setShowCreateModal(false); }}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>
    </div>
  );
}
