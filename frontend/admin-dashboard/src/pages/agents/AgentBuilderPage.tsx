import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Play, Settings, MessageSquare, Volume2, Wrench, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PromptEditor } from '@/components/agent-builder/PromptEditor';
import { VoiceSelector } from '@/components/agent-builder/VoiceSelector';
import { ToolConfigurator } from '@/components/agent-builder/ToolConfigurator';
import { KnowledgeAttacher } from '@/components/agent-builder/KnowledgeAttacher';

const tabs = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'prompt', label: 'Prompt', icon: MessageSquare },
  { id: 'voice', label: 'Voice', icon: Volume2 },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
];

export function AgentBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState(isNew ? '' : 'Sales Assistant');
  const [description, setDescription] = useState(isNew ? '' : 'Handles inbound sales calls, qualifies leads, and schedules demos');
  const [greeting, setGreeting] = useState(isNew ? '' : 'Hi there! Thanks for calling. How can I help you today?');
  const [systemPrompt, setSystemPrompt] = useState(
    isNew
      ? ''
      : `You are a professional sales assistant for TechCorp. Your role is to:\n\n1. Greet callers warmly and identify their needs\n2. Qualify leads by asking about their company size, budget, and timeline\n3. Explain our products and services clearly\n4. Schedule demos with interested prospects\n5. Handle objections professionally\n\nKey rules:\n- Always be polite and professional\n- Never make promises about pricing without checking\n- If you cannot answer a question, offer to connect them with a human agent\n- Collect the caller's name, email, and company at minimum`
  );
  const [voiceProvider, setVoiceProvider] = useState('elevenlabs');
  const [voiceId, setVoiceId] = useState('rachel');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [language, setLanguage] = useState('en-US');
  const [enabledTools, setEnabledTools] = useState<string[]>(['calendar', 'crm_lookup']);
  const [attachedKBs, setAttachedKBs] = useState<string[]>(['kb-1']);

  const handleToolToggle = (toolId: string) => {
    setEnabledTools((prev) =>
      prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    // Simulate save
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isNew ? 'Create Agent' : 'Edit Agent'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isNew ? 'Configure your new AI voice agent' : `Editing: ${name}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isNew && (
            <Button variant="outline" onClick={() => navigate(`/agents/${id}/test`)}>
              <Play className="h-4 w-4" />
              Test Agent
            </Button>
          )}
          <Button onClick={handleSave} loading={saving}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <Card>
        {activeTab === 'general' && (
          <div className="space-y-6 max-w-2xl">
            <Input
              label="Agent Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sales Assistant"
            />
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this agent does..."
              rows={3}
            />
            <Textarea
              label="Greeting Message"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="The first thing the agent says when answering a call..."
              rows={2}
            />
          </div>
        )}

        {activeTab === 'prompt' && (
          <PromptEditor value={systemPrompt} onChange={setSystemPrompt} />
        )}

        {activeTab === 'voice' && (
          <div className="max-w-lg">
            <VoiceSelector
              provider={voiceProvider}
              voiceId={voiceId}
              speed={voiceSpeed}
              language={language}
              onProviderChange={setVoiceProvider}
              onVoiceChange={setVoiceId}
              onSpeedChange={setVoiceSpeed}
              onLanguageChange={setLanguage}
            />
          </div>
        )}

        {activeTab === 'tools' && (
          <ToolConfigurator enabledTools={enabledTools} onToggle={handleToolToggle} />
        )}

        {activeTab === 'knowledge' && (
          <KnowledgeAttacher
            attachedIds={attachedKBs}
            onAttach={(id) => setAttachedKBs((prev) => [...prev, id])}
            onDetach={(id) => setAttachedKBs((prev) => prev.filter((kb) => kb !== id))}
          />
        )}
      </Card>
    </div>
  );
}
