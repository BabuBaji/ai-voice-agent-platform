import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';

interface Condition { field: string; operator: string; value: string; }
interface Action { type: string; config: Record<string, string>; }

const triggerOptions = [
  { value: 'call_completed', label: 'Call Completed' },
  { value: 'call_sentiment', label: 'Call Sentiment Detected' },
  { value: 'lead_created', label: 'Lead Created' },
  { value: 'lead_score_changed', label: 'Lead Score Changed' },
  { value: 'appointment_scheduled', label: 'Appointment Scheduled' },
  { value: 'agent_error', label: 'Agent Error' },
];

const fieldOptions = [
  { value: 'outcome', label: 'Call Outcome' },
  { value: 'sentiment', label: 'Sentiment' },
  { value: 'score', label: 'Lead Score' },
  { value: 'duration', label: 'Call Duration' },
  { value: 'agent', label: 'Agent Name' },
  { value: 'source', label: 'Lead Source' },
];

const operatorOptions = [
  { value: 'equals', label: 'Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
];

const actionOptions = [
  { value: 'send_email', label: 'Send Email' },
  { value: 'create_lead', label: 'Create Lead' },
  { value: 'assign_agent', label: 'Assign Agent' },
  { value: 'webhook', label: 'Call Webhook' },
  { value: 'update_field', label: 'Update Field' },
];

export function WorkflowBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [name, setName] = useState(isNew ? '' : 'Post-Call Lead Creation');
  const [description, setDescription] = useState(isNew ? '' : 'Automatically create a CRM lead after every completed sales call');
  const [trigger, setTrigger] = useState(isNew ? 'call_completed' : 'call_completed');
  const [conditions, setConditions] = useState<Condition[]>(isNew ? [] : [{ field: 'outcome', operator: 'equals', value: 'completed' }]);
  const [actions, setActions] = useState<Action[]>(isNew ? [] : [{ type: 'create_lead', config: { source: 'inbound-call' } }]);

  const addCondition = () => setConditions([...conditions, { field: 'outcome', operator: 'equals', value: '' }]);
  const removeCondition = (idx: number) => setConditions(conditions.filter((_, i) => i !== idx));
  const updateCondition = (idx: number, updates: Partial<Condition>) => setConditions(conditions.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
  const addAction = () => setActions([...actions, { type: 'send_email', config: {} }]);
  const removeAction = (idx: number) => setActions(actions.filter((_, i) => i !== idx));
  const updateAction = (idx: number, updates: Partial<Action>) => setActions(actions.map((a, i) => (i === idx ? { ...a, ...updates } : a)));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/workflows')} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{isNew ? 'Create Workflow' : 'Edit Workflow'}</h1>
            <p className="text-sm text-gray-500">Define triggers, conditions, and actions</p>
          </div>
        </div>
        <Button variant="gradient" className="rounded-xl"><Save className="h-4 w-4" />Save Workflow</Button>
      </div>

      <Card>
        <CardHeader title="Basic Information" />
        <div className="space-y-4">
          <Input label="Workflow Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Post-Call Lead Creation" />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." />
        </div>
      </Card>

      <Card>
        <CardHeader title="Trigger" subtitle="When should this workflow run?" />
        <Select label="Trigger Event" value={trigger} onChange={(e) => setTrigger(e.target.value)} options={triggerOptions} />
      </Card>

      <Card>
        <CardHeader title="Conditions" subtitle="Only run when these conditions are met (optional)"
          action={<Button variant="outline" size="sm" onClick={addCondition} className="rounded-lg"><Plus className="h-3.5 w-3.5" />Add Condition</Button>} />
        {conditions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No conditions - workflow will run on every trigger</p>
        ) : (
          <div className="space-y-3">
            {conditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <span className="text-xs text-gray-400 font-semibold w-6">{idx === 0 ? 'IF' : 'AND'}</span>
                <select value={cond.field} onChange={(e) => updateCondition(idx, { field: e.target.value })} className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white flex-1">
                  {fieldOptions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select value={cond.operator} onChange={(e) => updateCondition(idx, { operator: e.target.value })} className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white">
                  {operatorOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="text" value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })} placeholder="Value" className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white flex-1" />
                <button onClick={() => removeCondition(idx)} className="p-1.5 text-gray-400 hover:text-danger-600 rounded-lg hover:bg-danger-50 transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Actions" subtitle="What should happen when conditions are met?"
          action={<Button variant="outline" size="sm" onClick={addAction} className="rounded-lg"><Plus className="h-3.5 w-3.5" />Add Action</Button>} />
        {actions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Add at least one action</p>
        ) : (
          <div className="space-y-3">
            {actions.map((action, idx) => (
              <div key={idx} className="flex items-start gap-3 p-4 bg-gray-50 rounded-xl">
                <span className="text-xs text-gray-400 font-semibold w-8 mt-2.5">THEN</span>
                <div className="flex-1 space-y-3">
                  <select value={action.type} onChange={(e) => updateAction(idx, { type: e.target.value })} className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white w-full">
                    {actionOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {action.type === 'send_email' && (
                    <input type="email" placeholder="Recipient email" value={action.config.to || ''} onChange={(e) => updateAction(idx, { config: { ...action.config, to: e.target.value } })} className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white w-full" />
                  )}
                  {action.type === 'webhook' && (
                    <input type="url" placeholder="Webhook URL" value={action.config.url || ''} onChange={(e) => updateAction(idx, { config: { ...action.config, url: e.target.value } })} className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white w-full" />
                  )}
                </div>
                <button onClick={() => removeAction(idx)} className="p-1.5 text-gray-400 hover:text-danger-600 rounded-lg hover:bg-danger-50 mt-2 transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
