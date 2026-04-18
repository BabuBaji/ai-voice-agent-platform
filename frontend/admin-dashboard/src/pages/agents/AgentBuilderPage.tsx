import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Play, Settings, MessageSquare, Volume2, Wrench, BookOpen, Globe, Phone, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PromptEditor } from '@/components/agent-builder/PromptEditor';
import { VoiceSelector } from '@/components/agent-builder/VoiceSelector';
import { ToolConfigurator } from '@/components/agent-builder/ToolConfigurator';
import { KnowledgeAttacher } from '@/components/agent-builder/KnowledgeAttacher';

const tabs = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'prompt', label: 'System Prompt', icon: MessageSquare },
  { id: 'voice', label: 'Voice & Language', icon: Volume2 },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
  { id: 'phone', label: 'Phone Numbers', icon: Phone },
];

const llmProviders = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
];

const llmModels: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  google: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  mistral: [
    { value: 'mistral-large', label: 'Mistral Large' },
  ],
  groq: [
    { value: 'llama-3-70b', label: 'Llama 3 70B' },
  ],
};

export function AgentBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(isNew ? '' : 'Sales Assistant');
  const [description, setDescription] = useState(isNew ? '' : 'Handles inbound sales calls, qualifies leads, and schedules demos');
  const [greeting, setGreeting] = useState(isNew ? '' : 'Hi there! Thanks for calling. How can I help you today?');
  const [llmProvider, setLlmProvider] = useState('openai');
  const [llmModel, setLlmModel] = useState('gpt-4o');
  const [temperature, setTemperature] = useState(0.7);
  const [systemPrompt, setSystemPrompt] = useState(
    isNew ? '' : `You are a professional sales assistant for TechCorp. Your role is to:\n\n1. Greet callers warmly and identify their needs\n2. Qualify leads by asking about their company size, budget, and timeline\n3. Explain our products and services clearly\n4. Schedule demos with interested prospects\n5. Handle objections professionally\n\nKey rules:\n- Always be polite and professional\n- Never make promises about pricing without checking\n- If you cannot answer a question, offer to connect them with a human agent\n- Collect the caller's name, email, and company at minimum`
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
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/agents')}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isNew ? 'Create Agent' : 'Edit Agent'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isNew ? 'Configure your new AI voice agent' : `Editing: ${name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!isNew && (
            <Button variant="outline" onClick={() => navigate(`/agents/${id}/test`)} className="rounded-xl">
              <Play className="h-4 w-4" />
              Test Agent
            </Button>
          )}
          <Button variant="gradient" onClick={handleSave} loading={saving} className="rounded-xl">
            <Save className="h-4 w-4" />
            {isNew ? 'Create' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1 -mb-px overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 pb-3 px-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
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
      <Card className="animate-fade-in">
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

            <div className="grid grid-cols-2 gap-4">
              <Select
                label="LLM Provider"
                value={llmProvider}
                onChange={(e) => {
                  setLlmProvider(e.target.value);
                  setLlmModel(llmModels[e.target.value]?.[0]?.value || '');
                }}
                options={llmProviders}
              />
              <Select
                label="Model"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                options={llmModels[llmProvider] || []}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature: {temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Precise (0.0)</span>
                <span>Balanced (0.5)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>

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

        {activeTab === 'phone' && (
          <div className="text-center py-12">
            <Phone className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">Assign Phone Numbers</h3>
            <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
              Connect phone numbers to this agent so it can receive and make calls.
            </p>
            <Button variant="outline" onClick={() => navigate('/settings/phone-numbers')} className="rounded-xl">
              Manage Phone Numbers
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
