import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, User, Bot, Phone, ThumbsUp, ThumbsDown, Minus, TrendingUp, Tag, BarChart3, Lightbulb, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { CallPlayer } from '@/components/calls/CallPlayer';
import { TranscriptViewer } from '@/components/calls/TranscriptViewer';
import { formatDuration, formatDate } from '@/utils/formatters';
import type { TranscriptMessage } from '@/types';

const mockTranscript: TranscriptMessage[] = [
  { role: 'assistant', content: "Hi there! Thanks for calling TechCorp. I'm your AI assistant. How can I help you today?", timestamp: 0 },
  { role: 'user', content: "Hi, I'm interested in learning about your enterprise plan. We're a team of about 50 people.", timestamp: 5 },
  { role: 'assistant', content: "That's great to hear! Our Enterprise plan would be perfect for a team of 50. It includes unlimited AI agents, priority support, custom integrations, and a dedicated account manager. May I ask what industry you're in?", timestamp: 12 },
  { role: 'user', content: "We're in the healthcare space. We need something that can handle patient appointment scheduling and follow-ups.", timestamp: 25 },
  { role: 'assistant', content: "Healthcare is one of our top use cases! We have HIPAA-compliant voice agents specifically designed for medical practices. They can handle appointment scheduling, prescription refill reminders, and post-visit follow-ups. Would you like me to schedule a personalized demo so our healthcare specialist can walk you through the features?", timestamp: 35 },
  { role: 'user', content: "Yes, that would be great. Can we do it sometime this week?", timestamp: 55 },
  { role: 'assistant', content: "Absolutely! I have availability on Wednesday at 2 PM or Thursday at 10 AM. Which works better for you?", timestamp: 60 },
  { role: 'user', content: "Thursday at 10 AM works perfectly.", timestamp: 70 },
  { role: 'assistant', content: "Excellent! I'll get that scheduled for you. Could I get your name and email address to send the calendar invite?", timestamp: 75 },
  { role: 'user', content: "Sure, it's Sarah Johnson, sarah@healthclinics.com", timestamp: 82 },
  { role: 'assistant', content: "Thank you, Sarah! You're all set for a demo on Thursday at 10 AM. You'll receive a confirmation email at sarah@healthclinics.com shortly. Is there anything else I can help you with?", timestamp: 90 },
  { role: 'user', content: "No, that's all. Thanks for your help!", timestamp: 100 },
  { role: 'assistant', content: "You're welcome, Sarah! We look forward to speaking with you on Thursday. Have a wonderful day!", timestamp: 105 },
];

const mockAnalysis = {
  summary: 'Caller inquired about the enterprise plan for a 50-person healthcare team. Discussed HIPAA-compliant features including appointment scheduling and patient follow-ups. Successfully scheduled a demo for Thursday at 10 AM. Lead captured with email.',
  sentiment: 'positive' as string,
  interestLevel: 85,
  keyTopics: ['Enterprise Plan', 'Healthcare', 'HIPAA', 'Appointment Scheduling', 'Demo', 'Team Size'],
  outcome: 'Demo Scheduled',
  recommendations: [
    'Follow up with healthcare-specific case studies before the demo',
    'Prepare HIPAA compliance documentation for the meeting',
    'Include pricing comparison with competitors in the demo',
    'Assign a healthcare specialist for the Thursday demo call',
    'Send a pre-demo questionnaire to understand specific needs',
  ],
};

export function CallDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/calls')} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Detail</h1>
          <p className="text-sm text-gray-500 font-mono">Call ID: {id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader title="Recording" />
            <CallPlayer recordingUrl="/sample-recording.wav" duration={245} />
          </Card>
          <Card>
            <CardHeader title="Transcript" subtitle="Full conversation transcript" />
            <div className="max-h-[500px] overflow-y-auto scrollbar-thin">
              <TranscriptViewer messages={mockTranscript} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Call Information */}
          <Card>
            <CardHeader title="Call Information" />
            <div className="space-y-4">
              {[
                { label: 'Status', value: <StatusBadge status="completed" /> },
                { label: 'Duration', value: <span className="text-sm font-medium text-gray-900 flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-gray-400" />{formatDuration(245)}</span> },
                { label: 'Date', value: <span className="text-sm text-gray-700">{formatDate('2026-04-18T10:30:00Z')}</span> },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">{item.label}</span>
                  {item.value}
                </div>
              ))}
            </div>
          </Card>

          {/* AI Analysis */}
          <Card>
            <CardHeader title="AI Analysis" subtitle="Automated call insights" />
            <div className="space-y-5">
              {/* Sentiment */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Sentiment</span>
                <div className="flex items-center gap-1.5">
                  {mockAnalysis.sentiment === 'positive' && <ThumbsUp className="h-4 w-4 text-success-500" />}
                  {mockAnalysis.sentiment === 'negative' && <ThumbsDown className="h-4 w-4 text-danger-500" />}
                  {mockAnalysis.sentiment === 'neutral' && <Minus className="h-4 w-4 text-gray-400" />}
                  <StatusBadge status={mockAnalysis.sentiment} />
                </div>
              </div>

              {/* Interest Level */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" /> Interest Level
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{mockAnalysis.interestLevel}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      mockAnalysis.interestLevel >= 70 ? 'bg-success-500' :
                      mockAnalysis.interestLevel >= 40 ? 'bg-warning-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${mockAnalysis.interestLevel}%` }}
                  />
                </div>
              </div>

              {/* Outcome */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Outcome</span>
                <Badge variant="success" dot>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {mockAnalysis.outcome}
                </Badge>
              </div>
            </div>
          </Card>

          {/* Key Topics */}
          <Card>
            <CardHeader title="Key Topics" />
            <div className="flex flex-wrap gap-2">
              {mockAnalysis.keyTopics.map((topic) => (
                <Badge key={topic} variant="outline-primary">
                  <Tag className="h-3 w-3 mr-1" />
                  {topic}
                </Badge>
              ))}
            </div>
          </Card>

          {/* Caller */}
          <Card>
            <CardHeader title="Caller" />
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Sarah Johnson</p>
                  <p className="text-xs text-gray-500 font-mono">+1 (415) 555-1234</p>
                </div>
              </div>
              <div className="pt-2 border-t border-gray-100 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Email</span><span className="text-gray-700">sarah@healthclinics.com</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Company</span><span className="text-gray-700">Health Clinics Inc.</span></div>
              </div>
            </div>
          </Card>

          {/* Agent */}
          <Card>
            <CardHeader title="Agent" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Sales Bot</p>
                <p className="text-xs text-gray-500">ElevenLabs / Rachel</p>
              </div>
            </div>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader title="Summary" />
            <p className="text-sm text-gray-600 leading-relaxed">{mockAnalysis.summary}</p>
          </Card>

          {/* Recommendations */}
          <Card>
            <CardHeader title="Recommendations" subtitle="AI-suggested next steps" />
            <ul className="space-y-3">
              {mockAnalysis.recommendations.map((rec, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <Lightbulb className="h-4 w-4 text-warning-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-600">{rec}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
