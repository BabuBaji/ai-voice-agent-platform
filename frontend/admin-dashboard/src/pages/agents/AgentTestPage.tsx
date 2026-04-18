import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, RotateCcw, Bot, User, Save, Loader2, AlertCircle, TrendingUp, MessageSquare, Clock, Tag, BarChart3, ThumbsUp, ThumbsDown, Minus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import api from '@/services/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Agent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  llm_provider: string;
  llm_model: string;
  greeting_message?: string;
  status: string;
}

interface Analysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  interestLevel: number;
  keyTopics: string[];
  leadScore: number;
  summary: string;
  messageCount: number;
  estimatedDuration: string;
}

const POSITIVE_WORDS = [
  'great', 'awesome', 'love', 'excellent', 'amazing', 'perfect', 'wonderful',
  'interested', 'yes', 'absolutely', 'definitely', 'sure', 'please', 'thanks',
  'thank', 'good', 'fantastic', 'happy', 'excited', 'agree', 'like', 'want',
  'need', 'buy', 'purchase', 'demo', 'schedule', 'sign up', 'subscribe',
];

const NEGATIVE_WORDS = [
  'no', 'not', 'never', 'bad', 'terrible', 'awful', 'hate', 'dislike',
  'expensive', 'costly', 'waste', 'useless', 'cancel', 'unsubscribe',
  'complaint', 'problem', 'issue', 'wrong', 'disappointed', 'frustrat',
  'annoying', 'horrible', 'worst', 'refuse', 'reject',
];

const BUYING_SIGNALS = [
  'price', 'pricing', 'cost', 'plan', 'demo', 'trial', 'subscribe',
  'purchase', 'buy', 'sign up', 'get started', 'how much', 'discount',
  'features', 'integration', 'setup', 'implementation', 'timeline',
  'contract', 'team', 'enterprise', 'upgrade', 'compare',
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'it', 'its', 'this', 'that', 'and',
  'or', 'but', 'if', 'so', 'as', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'she', 'they', 'them', 'what', 'which', 'who', 'how',
  'all', 'each', 'every', 'about', 'up', 'out', 'just', 'also', 'than',
  'very', 'too', 'more', 'some', 'any', 'not', 'no', 'hi', 'hello',
  'thanks', 'thank', 'please', 'okay', 'ok', 'yes', 'sure',
]);

function analyzeConversation(messages: ChatMessage[]): Analysis {
  const userMessages = messages.filter((m) => m.role === 'user');
  const allText = messages.map((m) => m.content).join(' ').toLowerCase();
  const userText = userMessages.map((m) => m.content).join(' ').toLowerCase();

  // Sentiment
  let positiveCount = 0;
  let negativeCount = 0;
  for (const word of POSITIVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = userText.match(regex);
    if (matches) positiveCount += matches.length;
  }
  for (const word of NEGATIVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = userText.match(regex);
    if (matches) negativeCount += matches.length;
  }
  const sentimentScore = positiveCount - negativeCount;
  const sentiment: Analysis['sentiment'] =
    sentimentScore > 1 ? 'positive' : sentimentScore < -1 ? 'negative' : 'neutral';

  // Interest level based on buying signals
  let buyingSignalCount = 0;
  for (const signal of BUYING_SIGNALS) {
    if (allText.includes(signal)) buyingSignalCount++;
  }
  const engagementBonus = Math.min(userMessages.length * 5, 30);
  const avgLength = userMessages.length > 0
    ? userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length
    : 0;
  const lengthBonus = Math.min(avgLength / 5, 20);
  const interestLevel = Math.min(
    100,
    Math.round(buyingSignalCount * 8 + engagementBonus + lengthBonus)
  );

  // Key topics - extract meaningful words
  const words = allText.match(/\b[a-z]{4,}\b/g) || [];
  const wordFreq: Record<string, number> = {};
  for (const word of words) {
    if (!STOP_WORDS.has(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  }
  const keyTopics = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));

  // Lead score
  const leadScore = Math.min(100, Math.round(
    interestLevel * 0.4 +
    (sentiment === 'positive' ? 30 : sentiment === 'neutral' ? 15 : 0) +
    Math.min(userMessages.length * 3, 20) +
    (positiveCount > 3 ? 10 : 0)
  ));

  // Summary
  const topicStr = keyTopics.slice(0, 3).join(', ');
  const summary = messages.length <= 1
    ? 'Conversation has just started.'
    : `Conversation with ${messages.length} messages covering ${topicStr || 'general topics'}. User sentiment is ${sentiment} with ${interestLevel}% interest level.`;

  // Duration
  const durationSec = messages.length > 1
    ? Math.round((messages[messages.length - 1].timestamp.getTime() - messages[0].timestamp.getTime()) / 1000)
    : 0;
  const durationMin = Math.floor(durationSec / 60);
  const durationRemSec = durationSec % 60;
  const estimatedDuration = durationSec > 0
    ? `${durationMin}m ${durationRemSec}s`
    : '0s';

  return {
    sentiment,
    interestLevel,
    keyTopics,
    leadScore,
    summary,
    messageCount: messages.length,
    estimatedDuration,
  };
}

export function AgentTestPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const analysis = analyzeConversation(messages);

  // Load agent details
  useEffect(() => {
    async function loadAgent() {
      try {
        const res = await api.get(`/agents/${id}`);
        setAgent(res.data);
        // Set greeting message
        const greeting = res.data.greeting_message || `Hello! I'm ${res.data.name}. How can I help you today?`;
        setMessages([{ role: 'assistant', content: greeting, timestamp: new Date() }]);
      } catch {
        setError('Failed to load agent details');
      } finally {
        setAgentLoading(false);
      }
    }
    loadAgent();
  }, [id]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // Build history (exclude the greeting for clean context)
      const history = messages
        .filter((_, i) => i > 0) // skip initial greeting from history sent to API
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await api.post(`/agents/${id}/test`, {
        message: input.trim(),
        history,
      });

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.data.reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || 'Failed to get response';
      setError(errMsg);
      // Remove the user message if we failed
      setMessages((prev) => prev.slice(0, -1));
      // Re-set input so user can retry
      setInput(userMsg.content);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, id]);

  const reset = () => {
    const greeting = agent?.greeting_message || `Hello! I'm ${agent?.name || 'Agent'}. How can I help you today?`;
    setMessages([{ role: 'assistant', content: greeting, timestamp: new Date() }]);
    setError(null);
    setSaved(false);
  };

  const saveConversation = async () => {
    if (messages.length <= 1 || saving) return;
    setSaving(true);
    try {
      await api.post('/conversations', {
        agent_id: id,
        channel: 'test',
        status: 'completed',
        summary: analysis.summary,
        sentiment: analysis.sentiment,
        metadata: {
          lead_score: analysis.leadScore,
          interest_level: analysis.interestLevel,
          key_topics: analysis.keyTopics,
          duration: analysis.estimatedDuration,
        },
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp.toISOString(),
        })),
      });
      setSaved(true);
    } catch {
      setError('Failed to save conversation');
    } finally {
      setSaving(false);
    }
  };

  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/agents/${id}`)} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Test: {agent?.name || 'Agent'}</h1>
              <StatusBadge status={agent?.status || 'draft'} />
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-500">{agent?.description || 'No description'}</span>
              <Badge variant="info">{agent?.llm_provider || 'openai'}</Badge>
              <Badge variant="purple">{agent?.llm_model || 'gpt-4o'}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={reset} className="rounded-xl">
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            variant="gradient"
            onClick={saveConversation}
            disabled={messages.length <= 1 || saving || saved}
            className="rounded-xl"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? 'Saved!' : 'End & Save'}
          </Button>
        </div>
      </div>

      {/* System Prompt Preview */}
      {agent?.system_prompt && (
        <Card className="bg-gray-50/50">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">System Prompt</p>
          <p className="text-sm text-gray-600 line-clamp-2">{agent.system_prompt}</p>
        </Card>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* Chat Panel */}
        <Card className="h-[600px] flex flex-col" padding={false}>
          <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center shadow-sm">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{agent?.name || 'Agent'}</p>
              <p className="text-xs text-success-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success-500" />
                Live Testing Mode
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-4 w-4 text-primary-600" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {error && (
            <div className="px-4 py-2 bg-danger-50 border-t border-danger-100 flex items-center gap-2 text-sm text-danger-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="p-4 border-t border-gray-100 bg-white">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Type a message to test the agent..."
                disabled={loading}
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all disabled:opacity-50"
              />
              <Button variant="gradient" onClick={sendMessage} disabled={!input.trim() || loading} className="rounded-xl">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </Card>

        {/* Analysis Panel */}
        <div className="space-y-4">
          {/* Sentiment */}
          <Card>
            <CardHeader title="Call Analysis" subtitle="Real-time conversation insights" />
            <div className="space-y-5">
              {/* Sentiment */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-500">Sentiment</span>
                  <div className="flex items-center gap-1.5">
                    {analysis.sentiment === 'positive' && <ThumbsUp className="h-4 w-4 text-success-500" />}
                    {analysis.sentiment === 'negative' && <ThumbsDown className="h-4 w-4 text-danger-500" />}
                    {analysis.sentiment === 'neutral' && <Minus className="h-4 w-4 text-gray-400" />}
                    <span className={`text-sm font-medium ${
                      analysis.sentiment === 'positive' ? 'text-success-600' :
                      analysis.sentiment === 'negative' ? 'text-danger-600' : 'text-gray-600'
                    }`}>
                      {analysis.sentiment.charAt(0).toUpperCase() + analysis.sentiment.slice(1)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Interest Level */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" /> Interest Level
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{analysis.interestLevel}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      analysis.interestLevel >= 70 ? 'bg-success-500' :
                      analysis.interestLevel >= 40 ? 'bg-warning-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${analysis.interestLevel}%` }}
                  />
                </div>
              </div>

              {/* Lead Score */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <BarChart3 className="h-3.5 w-3.5" /> Lead Score
                  </span>
                  <span className={`text-lg font-bold ${
                    analysis.leadScore >= 70 ? 'text-success-600' :
                    analysis.leadScore >= 40 ? 'text-warning-600' : 'text-gray-500'
                  }`}>
                    {analysis.leadScore}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      analysis.leadScore >= 70 ? 'bg-success-500' :
                      analysis.leadScore >= 40 ? 'bg-warning-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${analysis.leadScore}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                <div className="text-center p-2 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-lg font-bold text-gray-900">{analysis.messageCount}</p>
                  <p className="text-xs text-gray-500">Messages</p>
                </div>
                <div className="text-center p-2 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
                    <Clock className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-lg font-bold text-gray-900">{analysis.estimatedDuration}</p>
                  <p className="text-xs text-gray-500">Duration</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Key Topics */}
          <Card>
            <CardHeader title="Key Topics" />
            {analysis.keyTopics.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {analysis.keyTopics.map((topic) => (
                  <Badge key={topic} variant="outline-primary">
                    <Tag className="h-3 w-3 mr-1" />
                    {topic}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Topics will appear as the conversation progresses...</p>
            )}
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader title="Summary" />
            <p className="text-sm text-gray-600 leading-relaxed">{analysis.summary}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
