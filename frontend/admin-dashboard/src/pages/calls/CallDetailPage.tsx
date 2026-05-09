import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, User, Bot, ThumbsUp, ThumbsDown, Minus, TrendingUp, Tag, Lightbulb, CheckCircle2, Sparkles, FileText, Loader2, AlertCircle, Download } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CallPlayer } from '@/components/calls/CallPlayer';
import { TranscriptViewer } from '@/components/calls/TranscriptViewer';
import { AiAnalyticsPanel } from '@/components/calls/AiAnalyticsPanel';
import { TranslationCard } from '@/components/calls/TranslationCard';
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
      <div className="max-w-7xl mx-auto space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/calls')} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">Call Not Found</h1>
        </div>
        <Card padding={false} className="p-3">
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
    <div className="max-w-7xl mx-auto space-y-3">
      {/* Hero strip — compact header with status, duration, channel, timestamp inline */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2 flex items-center gap-3">
        <button onClick={() => navigate('/calls')} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 leading-tight flex items-center gap-2">
              Call Detail
              <StatusBadge status={(conversation.status || 'completed').toLowerCase()} />
            </h1>
            <p className="text-[11px] text-gray-400 font-mono truncate">{conversation.id}</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-600 ml-auto sm:ml-0">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-gray-400" />{formatDuration(duration)}</span>
            <span className="text-gray-300">·</span>
            <Badge variant="outline-primary">{conversation.channel}</Badge>
            <span className="text-gray-300">·</span>
            <span className="tabular-nums">{formatDate(conversation.started_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
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
              } catch { /* swallow */ }
            }}
          >
            <Download className="h-3.5 w-3.5" /> JSON
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
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Stat strip — at-a-glance metrics above the grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
          <div className="text-[10px] uppercase text-gray-500 tracking-wide flex items-center gap-1">
            {sentiment === 'positive' && <ThumbsUp className="h-3 w-3 text-success-500" />}
            {sentiment === 'negative' && <ThumbsDown className="h-3 w-3 text-danger-500" />}
            {sentiment === 'neutral' && <Minus className="h-3 w-3 text-gray-400" />}
            {sentiment === 'mixed' && <Sparkles className="h-3 w-3 text-warning-500" />}
            Sentiment
          </div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5 capitalize">{sentiment || '—'}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
          <div className="text-[10px] uppercase text-gray-500 tracking-wide flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Interest
          </div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5 tabular-nums">{interest}%</div>
          <div className="w-full bg-gray-100 rounded-full h-1 mt-1">
            <div
              className={`h-1 rounded-full transition-all ${interest >= 70 ? 'bg-success-500' : interest >= 40 ? 'bg-warning-500' : 'bg-gray-400'}`}
              style={{ width: `${interest}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
          <div className="text-[10px] uppercase text-gray-500 tracking-wide flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-success-500" /> Outcome
          </div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5 truncate" title={outcome}>{outcome}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
          <div className="text-[10px] uppercase text-gray-500 tracking-wide flex items-center gap-1">
            <Tag className="h-3 w-3 text-primary-500" /> Topics
          </div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5 tabular-nums">
            {topics.length} <span className="text-gray-400 font-normal text-xs">discussed</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          <Card padding={false} className="p-3">
            <CardHeader className="mb-2" title="Recording" subtitle={conversation.language ? `Language: ${conversation.language}` : undefined} />
            <CallPlayer recordingUrl={audioBlobUrl} duration={duration} />
          </Card>
          <Card padding={false} className="p-3">
            <CardHeader className="mb-2" title="Transcript" subtitle={`${transcript.length} messages (live)`} />
            <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
              {transcript.length > 0 ? (
                <TranscriptViewer messages={transcript} />
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No messages recorded during the call.</p>
              )}
            </div>
          </Card>

          <TranslationCard conversationId={conversation.id} hasTranscript={transcript.length > 0} />

          <Card padding={false} className="p-3">
            <CardHeader
              className="mb-2"
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
              <p className="text-sm text-gray-400 py-2">
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
              <div className="space-y-2">
                <div className="max-h-[360px] overflow-y-auto scrollbar-thin space-y-1 bg-gray-50 rounded-lg p-2.5">
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

        <div className="space-y-3">
          {/* Combined Agent + Caller card — less wasted space than 2 separate */}
          <Card padding={false} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase text-gray-400 tracking-wide">Agent</p>
                  <p className="text-sm font-medium text-gray-900 truncate">{agentName || 'Agent'}</p>
                  {agentVoice && <p className="text-[11px] text-gray-500 truncate">{agentVoice}</p>}
                </div>
              </div>
              {conversation.caller_number && (
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-primary-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase text-gray-400 tracking-wide">Caller</p>
                    <p className="text-sm font-medium text-gray-900 font-mono truncate">{conversation.caller_number}</p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {topics.length > 0 && (
            <Card padding={false} className="p-3">
              <CardHeader className="mb-2" title="Key Topics" />
              <div className="flex flex-wrap gap-1.5">
                {topics.map((topic) => (
                  <Badge key={topic} variant="outline-primary">
                    <Tag className="h-3 w-3 mr-1" />
                    {topic}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <Card padding={false} className="p-3">
            <CardHeader className="mb-2" title="Summary" />
            <p className="text-sm text-gray-600 leading-relaxed">{summary}</p>
          </Card>

          {keyPoints.length > 0 && (
            <Card padding={false} className="p-3">
              <CardHeader className="mb-2" title="Key Points" />
              <ul className="space-y-1.5">
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
            <Card padding={false} className="p-3">
              <CardHeader className="mb-2" title="Recommended Follow-ups" subtitle="AI-suggested next steps" />
              <ul className="space-y-2">
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
