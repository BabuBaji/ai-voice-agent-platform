import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Phone, Mail, Building2, Calendar, MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Input';
import { formatDate, formatCurrency, timeAgo } from '@/utils/formatters';

const mockLead = {
  id: '1', name: 'Sarah Johnson', email: 'sarah@healthclinics.com', phone: '+14155551234',
  company: 'Health Clinics Inc.', status: 'qualified' as const, source: 'inbound-call' as const,
  score: 92, value: 45000, assignedTo: 'John Doe', notes: 'Very interested in the enterprise healthcare plan. Needs HIPAA compliance.',
  tags: ['healthcare', 'enterprise', 'high-priority'],
  createdAt: '2026-04-18T10:30:00Z', updatedAt: '2026-04-18T10:30:00Z',
};

const activityTimeline = [
  { id: '1', type: 'call', title: 'Inbound call - 4m 05s', description: 'Discussed enterprise healthcare plan. Demo scheduled for Thursday.', timestamp: '2026-04-18T10:30:00Z' },
  { id: '2', type: 'note', title: 'Note added', description: 'Very interested in HIPAA compliance features. Decision maker.', timestamp: '2026-04-18T10:35:00Z' },
  { id: '3', type: 'email', title: 'Demo confirmation sent', description: 'Calendar invite and prep materials sent to sarah@healthclinics.com', timestamp: '2026-04-18T10:40:00Z' },
  { id: '4', type: 'status', title: 'Status changed to Qualified', description: 'Lead score updated from 60 to 92 based on call engagement.', timestamp: '2026-04-18T10:36:00Z' },
];

const linkedCalls = [
  { id: '1', agentName: 'Sales Bot', duration: '4:05', outcome: 'completed', sentiment: 'positive', date: '2026-04-18T10:30:00Z' },
];

export function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [note, setNote] = useState('');

  const iconForType: Record<string, React.ReactNode> = {
    call: <Phone className="h-4 w-4" />,
    note: <MessageSquare className="h-4 w-4" />,
    email: <Mail className="h-4 w-4" />,
    status: <Calendar className="h-4 w-4" />,
  };

  const colorForType: Record<string, string> = {
    call: 'bg-primary-100 text-primary-600',
    note: 'bg-warning-100 text-warning-600',
    email: 'bg-success-100 text-success-600',
    status: 'bg-purple-100 text-purple-600',
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/crm/leads')} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{mockLead.name}</h1>
            <p className="text-sm text-gray-500">{mockLead.company}</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => setIsEditing(!isEditing)}>
          <Edit className="h-4 w-4" />
          {isEditing ? 'Cancel' : 'Edit'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Activity timeline */}
        <div className="lg:col-span-2 space-y-4">
          {/* Notes input */}
          <Card>
            <div className="flex items-start gap-3">
              <Textarea
                placeholder="Add a note..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="flex-1"
              />
              <Button disabled={!note.trim()} size="sm" className="mt-1">
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </Card>

          {/* Activity Timeline */}
          <Card>
            <CardHeader title="Activity Timeline" />
            <div className="space-y-6">
              {activityTimeline.map((activity) => (
                <div key={activity.id} className="flex gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorForType[activity.type]}`}>
                    {iconForType[activity.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">{activity.title}</p>
                      <span className="text-xs text-gray-400">{timeAgo(activity.timestamp)}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{activity.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Linked Calls */}
          <Card>
            <CardHeader title="Linked Calls" />
            <div className="space-y-3">
              {linkedCalls.map((call) => (
                <div
                  key={call.id}
                  onClick={() => navigate(`/calls/${call.id}`)}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{call.agentName}</p>
                      <p className="text-xs text-gray-400">{formatDate(call.date)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">{call.duration}</span>
                    <StatusBadge status={call.outcome} />
                    <StatusBadge status={call.sentiment} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: Lead info */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Lead Information" />
            {isEditing ? (
              <div className="space-y-4">
                <Input label="Name" defaultValue={mockLead.name} />
                <Input label="Email" defaultValue={mockLead.email} />
                <Input label="Phone" defaultValue={mockLead.phone} />
                <Input label="Company" defaultValue={mockLead.company} />
                <Input label="Value" type="number" defaultValue={mockLead.value} />
                <Button className="w-full">Save Changes</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Status</span>
                  <StatusBadge status={mockLead.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Score</span>
                  <span className="text-sm font-bold text-success-600">{mockLead.score}/100</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Value</span>
                  <span className="text-sm font-semibold">{formatCurrency(mockLead.value)}</span>
                </div>
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-700">{mockLead.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-700">{mockLead.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-700">{mockLead.company}</span>
                  </div>
                </div>
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500 mb-2">Source</p>
                  <Badge variant="info">Inbound Call</Badge>
                </div>
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500 mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {mockLead.tags.map((tag) => (
                      <Badge key={tag} variant="default">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500 mb-1">Assigned To</p>
                  <p className="text-sm font-medium text-gray-900">{mockLead.assignedTo}</p>
                </div>
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-sm text-gray-700">{mockLead.notes}</p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
