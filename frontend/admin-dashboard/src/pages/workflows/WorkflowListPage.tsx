import { useNavigate } from 'react-router-dom';
import { Plus, Workflow as WorkflowIcon, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { timeAgo } from '@/utils/formatters';
import type { Workflow } from '@/types';

const mockWorkflows: Workflow[] = [
  { id: '1', name: 'Post-Call Lead Creation', description: 'Automatically create a CRM lead after every completed sales call', active: true, trigger: 'call_completed', conditions: [{ field: 'outcome', operator: 'equals', value: 'completed' }], actions: [{ type: 'create_lead', config: { source: 'inbound-call' } }], lastRun: '2026-04-18T10:30:00Z', runCount: 342, createdAt: '2026-03-01T00:00:00Z' },
  { id: '2', name: 'High-Value Lead Alert', description: 'Send email notification when a lead score exceeds 80', active: true, trigger: 'lead_score_changed', conditions: [{ field: 'score', operator: 'greater_than', value: '80' }], actions: [{ type: 'send_email', config: { to: 'sales-team@company.com', subject: 'High-value lead detected' } }], lastRun: '2026-04-18T09:15:00Z', runCount: 89, createdAt: '2026-03-15T00:00:00Z' },
  { id: '3', name: 'Negative Sentiment Escalation', description: 'Transfer call to human agent when sentiment is consistently negative', active: true, trigger: 'call_sentiment', conditions: [{ field: 'sentiment', operator: 'equals', value: 'negative' }], actions: [{ type: 'assign_agent', config: { agentType: 'human' } }], lastRun: '2026-04-17T16:45:00Z', runCount: 28, createdAt: '2026-02-20T00:00:00Z' },
  { id: '4', name: 'Follow-up Email', description: 'Send a follow-up email 24 hours after a demo is scheduled', active: false, trigger: 'appointment_scheduled', conditions: [{ field: 'type', operator: 'equals', value: 'demo' }], actions: [{ type: 'send_email', config: { template: 'demo-followup' } }], lastRun: '2026-04-10T12:00:00Z', runCount: 156, createdAt: '2026-01-15T00:00:00Z' },
  { id: '5', name: 'CRM Sync Webhook', description: 'Sync new leads to external CRM via webhook', active: true, trigger: 'lead_created', conditions: [], actions: [{ type: 'webhook', config: { url: 'https://api.externalcrm.com/leads' } }], lastRun: '2026-04-18T10:35:00Z', runCount: 512, createdAt: '2026-02-01T00:00:00Z' },
];

const triggerLabels: Record<string, string> = {
  call_completed: 'Call Completed', lead_score_changed: 'Lead Score Changed',
  call_sentiment: 'Call Sentiment', appointment_scheduled: 'Appointment Scheduled',
  lead_created: 'Lead Created',
};

export function WorkflowListPage() {
  const navigate = useNavigate();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-sm text-gray-500 mt-1">Automate actions based on events and conditions</p>
        </div>
        <Button variant="gradient" onClick={() => navigate('/workflows/new')} className="rounded-xl">
          <Plus className="h-4 w-4" />
          Create Workflow
        </Button>
      </div>

      <div className="space-y-3">
        {mockWorkflows.map((wf) => (
          <Card
            key={wf.id}
            className="hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
            onClick={() => navigate(`/workflows/${wf.id}`)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-4">
                <div className={`p-2.5 rounded-xl transition-colors ${wf.active ? 'bg-success-100 text-success-600' : 'bg-gray-100 text-gray-400'}`}>
                  <WorkflowIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{wf.name}</h3>
                    <Badge variant={wf.active ? 'success' : 'default'} dot>
                      {wf.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{wf.description}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>Trigger: <span className="text-gray-600 font-medium">{triggerLabels[wf.trigger] || wf.trigger}</span></span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last run: {wf.lastRun ? timeAgo(wf.lastRun) : 'Never'}
                    </span>
                    <span>{wf.runCount} total runs</span>
                  </div>
                </div>
              </div>

              <div onClick={(e) => e.stopPropagation()}>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={wf.active} onChange={() => {}} className="sr-only peer" />
                  <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-success-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow-sm" />
                </label>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
