import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, User, Bot, ThumbsUp, ThumbsDown, Minus, TrendingUp, Tag, Lightbulb, CheckCircle2, Sparkles, FileText, Loader2, AlertCircle, Download } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CallPlayer } from '@/components/calls/CallPlayer';
import { TranscriptViewer } from '@/components/calls/TranscriptViewer';
import { AiAnalyticsPanel } from '@/components/calls/AiAnalyticsPanel';
import { formatDuration, formatDate } from '@/utils/formatters';
import { conversationApi, type Conversation, type ConversationMessage, type WhisperTranscript } from '@/services/conversation.api';
import { agentApi } from '@/services/agent.api';
import api from '@/services/api';
import type { TranscriptMessage } from '@/types';

function toTranscript(messages: ConversationMessage[]): TranscriptMessage[] {
  if (!messages.length) return [];
  const startMs = new Date(messages[0].created_at).getTime();
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: Math.max(0, Math.floor((new Date(m.created_at).getTime() - startMs) / 1000)),
    }));
}

function normalizeSentiment(s?: string): 'positive' | 'neutral' | 'negative' | 'mixed' {
  const up = (s || '').toUpperCase();
  if (up === 'POSITIVE') return 'positive';
  if (up === 'NEGATIVE') return 'negative';
  if (up === 'MIXED') return 'mixed';
  return 'neutral';
}

export function CallDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [agentName, setAgentName] = useState<string>('');
  const [agentVoice, setAgentVoice] = useState<string>('');
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [whisper, setWhisper] = useState<WhisperTranscript | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [whisperError, setWhisperError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [conv, msgs] = await Promise.all([
          conversationApi.get(id),
          conversationApi.getMessages(id),
        ]);
        if (cancelled) return;
        setConversation(conv);
        setMessages(msgs);

        // Fetch agent info
        if (conv.agent_id) {
          try {
            const agent: any = await agentApi.get(conv.agent_id);
            if (!cancelled) {
              setAgentName(agent.name || 'Agent');
              const vc = agent.voice_config || agent.voiceConfig || {};
              setAgentVoice([vc.provider, vc.voice_id].filter(Boolean).join(' / '));
            }
          } catch {
            // ignore
          }
        }

        // Hydrate Whisper transcript if already cached in metadata
        const cached = (conv.metadata as any)?.whisper_transcript as WhisperTranscript | undefined;
        if (cached && !cancelled) setWhisper(cached);

        // Both phone-call WAVs and web-widget uploads are served through
        // conversation-service /conversations/:id/recording. The endpoint serves
        // local web-call uploads, sibling telephony-adapter WAVs (looked up by
        // callSid parsed from recording_url), and only as a last resort proxies
        // the remote URL — so playback works whether or not the ngrok tunnel
        // is currently up.
        if (conv.recording_url) {
          try {
            const audioRes = await api.get(`/conversations/${id}/recording`, { responseType: 'blob' });
            if (!cancelled) {
              setAudioBlobUrl(URL.createObjectURL(audioRes.data));
            }
          } catch {
            // recording fetch failed; player will show "No recording available"
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.message || e.message || 'Failed to load call');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    return () => {
      // Only revoke object URLs; direct https URLs shouldn't be revoked.
      if (audioBlobUrl && audioBlobUrl.startsWith('blob:')) URL.revokeObjectURL(audioBlobUrl);
    };
  }, [audioBlobUrl]);

  const runWhisper = async () => {
    if (!id) return;
    setTranscribing(true);
    setWhisperError(null);
    try {
      const t = await conversationApi.transcribe(id);
      setWhisper(t);
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.response?.data?.message || e?.message || 'Transcription failed';
      setWhisperError(detail);
    } finally {
      setTranscribing(false);
    }
  };

  const formatTs = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/calls')} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Call Not Found</h1>
        </div>
        <Card>
          <p className="text-sm text-gray-500">{error || 'This call could not be loaded.'}</p>
        </Card>
      </div>
    );
  }

  const sentiment = normalizeSentiment(conversation.sentiment);
  const transcript = toTranscript(messages);
  const duration = conversation.duration_seconds || 0;
  const interest = conversation.interest_level ?? (conversation.analysis?.interest_level ?? 0);
  const followUps: string[] = conversation.follow_ups || conversation.analysis?.follow_ups || [];
  const keyPoints: string[] = conversation.key_points || conversation.analysis?.key_points || [];
  const topics: string[] = conversation.topics || conversation.analysis?.topics || [];
  const outcome = conversation.outcome || conversation.analysis?.outcome || '—';
  const summary = conversation.summary || conversation.analysis?.summary || 'No summary available yet.';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/calls')} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Call Detail</h1>
          <p className="text-sm text-gray-500 font-mono">Call ID: {conversation.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await api.get(`/conversations/${conversation.id}/export?format=json`, { responseType: 'blob' });
                const url = URL.createObjectURL(new Blob([r.data], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url; a.download = `conversation-${conversation.id}.json`; a.click();
                URL.revokeObjectURL(url);
              } catch { /* swallow — could surface a toast */ }
            }}
          >
            <Download className="h-4 w-4" /> Export JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await api.get(`/conversations/${conversation.id}/export?format=csv`, { responseType: 'blob' });
                const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url; a.download = `conversation-${conversation.id}.csv`; a.click();
                URL.revokeObjectURL(url);
              } catch { /* swallow */ }
            }}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader title="Recording" subtitle={conversation.language ? `Language: ${conversation.language}` : undefined} />
            <CallPlayer recordingUrl={audioBlobUrl} duration={duration} />
          </Card>
          <Card>
            <CardHeader title="Transcript" subtitle={`${transcript.length} messages (live)`} />
            <div className="max-h-[500px] overflow-y-auto scrollbar-thin">
              {transcript.length > 0 ? (
                <TranscriptViewer messages={transcript} />
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No messages recorded during the call.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Whisper Transcript"
              subtitle={
                whisper
                  ? `OpenAI Whisper · ${whisper.language || 'auto'} · ${whisper.segments.length} segments`
                  : 'Re-transcribe the recording with OpenAI Whisper for accurate STT'
              }
              action={
                <Button
                  size="sm"
                  variant={whisper ? 'outline' : 'primary'}
                  onClick={runWhisper}
                  disabled={transcribing || !audioBlobUrl}
                >
                  {transcribing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Transcribing…</>
                  ) : (
                    <><FileText className="h-4 w-4" /> {whisper ? 'Re-transcribe' : 'Transcribe with Whisper'}</>
                  )}
                </Button>
              }
            />

            {!audioBlobUrl && (
              <p className="text-sm text-gray-400 py-4">
                No recording file is available for this call — nothing to transcribe.
              </p>
            )}

            {whisperError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-sm text-danger-700 mb-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Whisper failed</p>
                  <p className="text-xs mt-0.5 font-mono break-all">{whisperError}</p>
                </div>
              </div>
            )}

            {whisper && (
              <div className="space-y-4">
                <div className="max-h-[420px] overflow-y-auto scrollbar-thin space-y-1.5 bg-gray-50 rounded-lg p-3">
                  {whisper.segments.length > 0 ? (
                    whisper.segments.map((seg, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <span className="text-xs font-mono text-gray-400 pt-0.5 flex-shrink-0 w-14">
                          {formatTs(seg.start)}
                        </span>
                        <span className="text-gray-800">{seg.text}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">{whisper.text || '(empty transcript)'}</p>
                  )}
                </div>
                {whisper.transcribed_at && (
                  <p className="text-xs text-gray-400">
                    Transcribed {new Date(whisper.transcribed_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Call Information" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Status</span>
                <StatusBadge status={(conversation.status || 'completed').toLowerCase()} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Duration</span>
                <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />{formatDuration(duration)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Date</span>
                <span className="text-sm text-gray-700">{formatDate(conversation.started_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Channel</span>
                <Badge variant="outline-primary">{conversation.channel}</Badge>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="AI Analysis" subtitle="Automated call insights" />
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Sentiment</span>
                <div className="flex items-center gap-1.5">
                  {sentiment === 'positive' && <ThumbsUp className="h-4 w-4 text-success-500" />}
                  {sentiment === 'negative' && <ThumbsDown className="h-4 w-4 text-danger-500" />}
                  {sentiment === 'neutral' && <Minus className="h-4 w-4 text-gray-400" />}
                  {sentiment === 'mixed' && <Sparkles className="h-4 w-4 text-warning-500" />}
                  <StatusBadge status={sentiment} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" /> Interest Level
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{interest}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      interest >= 70 ? 'bg-success-500' : interest >= 40 ? 'bg-warning-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${interest}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Outcome</span>
                <Badge variant="success" dot>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {outcome}
                </Badge>
              </div>
            </div>
          </Card>

          {topics.length > 0 && (
            <Card>
              <CardHeader title="Key Topics" />
              <div className="flex flex-wrap gap-2">
                {topics.map((topic) => (
                  <Badge key={topic} variant="outline-primary">
                    <Tag className="h-3 w-3 mr-1" />
                    {topic}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Agent" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{agentName || 'Agent'}</p>
                {agentVoice && <p className="text-xs text-gray-500">{agentVoice}</p>}
              </div>
            </div>
          </Card>

          {conversation.caller_number && (
            <Card>
              <CardHeader title="Caller" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{conversation.caller_number}</p>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Summary" />
            <p className="text-sm text-gray-600 leading-relaxed">{summary}</p>
          </Card>

          {keyPoints.length > 0 && (
            <Card>
              <CardHeader title="Key Points" />
              <ul className="space-y-2">
                {keyPoints.map((pt, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-primary-500">•</span>
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {followUps.length > 0 && (
            <Card>
              <CardHeader title="Recommended Follow-ups" subtitle="AI-suggested next steps" />
              <ul className="space-y-3">
                {followUps.map((rec, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <Lightbulb className="h-4 w-4 text-warning-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-600">{rec}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* Full-width graphical AI analytics at the bottom of the page.
          Reads everything out of conversations.analysis JSONB (voice_quality
          comes from telephony-adapter's recording-finalisation step). */}
      <AiAnalyticsPanel
        analysis={conversation.analysis as any}
        fallbackSummary={summary}
        fallbackSentiment={conversation.sentiment}
        fallbackInterest={interest}
      />
    </div>
  );
}
