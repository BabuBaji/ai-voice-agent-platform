import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, RotateCcw, Bot } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TranscriptViewer } from '@/components/calls/TranscriptViewer';
import type { TranscriptMessage } from '@/types';

const sampleResponses = [
  "Thanks for your interest! I'd be happy to help you learn more about our solutions. Could you tell me a bit about your company and what challenges you're facing?",
  "That sounds great! We have several plans that could work for a team of that size. Our Professional plan starts at $99/month and includes up to 10 agents. Would you like me to schedule a personalized demo?",
  "Absolutely! I can help you set that up. What day and time works best for you? We have availability this week on Wednesday and Thursday afternoon.",
  "I've noted that down. Let me also get your email address so we can send you a calendar invite and some additional information beforehand.",
  "Perfect! You're all set for a demo on Thursday at 2 PM. You'll receive a confirmation email shortly. Is there anything else I can help you with?",
];

export function AgentTestPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<TranscriptMessage[]>([
    { role: 'assistant', content: "Hi there! Thanks for calling TechCorp. I'm your AI assistant. How can I help you today?", timestamp: 0 },
  ]);
  const [input, setInput] = useState('');
  const [responseIndex, setResponseIndex] = useState(0);

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMsg: TranscriptMessage = {
      role: 'user',
      content: input,
      timestamp: messages.length * 5,
    };

    const assistantMsg: TranscriptMessage = {
      role: 'assistant',
      content: sampleResponses[responseIndex % sampleResponses.length],
      timestamp: messages.length * 5 + 2,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setResponseIndex((i) => i + 1);
    setInput('');
  };

  const reset = () => {
    setMessages([
      { role: 'assistant', content: "Hi there! Thanks for calling TechCorp. I'm your AI assistant. How can I help you today?", timestamp: 0 },
    ]);
    setResponseIndex(0);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/agents/${id}`)}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Test Agent</h1>
            <p className="text-sm text-gray-500">Sales Assistant - Simulated conversation</p>
          </div>
        </div>
        <Button variant="outline" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </div>

      <Card className="h-[600px] flex flex-col" padding={false}>
        {/* Agent info bar */}
        <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-3 bg-gray-50">
          <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Sales Assistant</p>
            <p className="text-xs text-success-600">Active - Testing Mode</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <TranscriptViewer messages={messages} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message to test the agent..."
              className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none"
            />
            <Button onClick={sendMessage} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
