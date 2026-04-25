/**
 * Full-width graphical analytics panel rendered at the bottom of the Call
 * Detail page. Pulls everything out of `conversation.analysis` (JSONB that
 * the conversation-service analyzer writes) and the `voice_quality` that
 * telephony-adapter's WS handler attaches on recording finalisation.
 *
 * Deliberately all inline SVG + CSS so there's no extra chart dependency
 * beyond recharts (already in the project for the other pages).
 */
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Sparkles, ThumbsUp, ThumbsDown, Minus, Mic, User, Bot, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface VoiceClarity {
  score: number;
  label: 'clear' | 'good' | 'muffled' | 'unclear';
  rms_db?: number;
  clip_ratio?: number;
  silence_ratio?: number;
  pitch_mean_hz?: number;
  pitch_std_hz?: number;
  expressiveness_score?: number;
  expressiveness_label?: 'monotone' | 'flat' | 'natural' | 'expressive';
}

interface VoiceQuality {
  caller?: VoiceClarity;
  agent?: VoiceClarity;
}

interface ConversationQuality {
  customer?: {
    understanding_score?: number;
    engagement_score?: number;
    emotion?: string;
    frustration_level?: string;
    pitch_impression?: string;
    notes?: string;
  };
  agent?: {
    clarity_score?: number;
    tone_score?: number;
    pacing?: string;
    pitch_impression?: string;
    notes?: string;
  };
  overall_note?: string;
}

interface CallAnalysis {
  summary?: string;
  short_summary?: string;
  detailed_summary?: string;
  sentiment?: string;
  interest_level?: number;
  lead_score?: string;                 // HOT | WARM | COLD | UNQUALIFIED
  conversion_probability?: string;     // HIGH | MEDIUM | LOW
  next_best_action?: string;
  call_outcome?: string;
  outcome?: string;
  objections?: string[];
  topics?: string[];
  key_entities?: {
    budget?: string; timeline?: string; city?: string;
    product_interest?: string; appointment_time?: string; customer_name?: string;
  };
  follow_up_required?: boolean;
  human_handoff_needed?: boolean;
  compliance_flags?: string[];
  qa_score?: string;
  agent_performance_notes?: string[];
  quality_risks?: string[];
  voice_quality?: VoiceQuality;
  conversation_quality?: ConversationQuality;
}

export interface AiAnalyticsPanelProps {
  analysis?: CallAnalysis | null;
  fallbackSummary?: string;
  fallbackSentiment?: string;
  fallbackInterest?: number;
}

// ── Recharts palette ─────────────────────────────────────────────────
const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#16a34a',  // green-600
  NEUTRAL: '#9ca3af',   // gray-400
  NEGATIVE: '#dc2626',  // red-600
  MIXED: '#f59e0b',     // amber-500
};

function clarityColor(label?: string): string {
  switch (label) {
    case 'clear': return '#16a34a';
    case 'good': return '#22c55e';
    case 'muffled': return '#f59e0b';
    case 'unclear': return '#dc2626';
    default: return '#9ca3af';
  }
}

function sentimentIcon(s: string) {
  const up = (s || '').toUpperCase();
  if (up === 'POSITIVE') return <ThumbsUp className="h-5 w-5 text-success-500" />;
  if (up === 'NEGATIVE') return <ThumbsDown className="h-5 w-5 text-danger-500" />;
  if (up === 'MIXED') return <Sparkles className="h-5 w-5 text-warning-500" />;
  return <Minus className="h-5 w-5 text-gray-400" />;
}

function leadBadgeVariant(score?: string): 'success' | 'warning' | 'danger' | 'outline' {
  const s = (score || '').toUpperCase();
  if (s === 'HOT') return 'success';
  if (s === 'WARM') return 'warning';
  if (s === 'COLD') return 'danger';
  return 'outline';
}

function conversionBadgeVariant(p?: string): 'success' | 'warning' | 'danger' | 'outline' {
  const s = (p || '').toUpperCase();
  if (s === 'HIGH') return 'success';
  if (s === 'MEDIUM') return 'warning';
  if (s === 'LOW') return 'danger';
  return 'outline';
}

export function AiAnalyticsPanel({
  analysis,
  fallbackSummary,
  fallbackSentiment,
  fallbackInterest,
}: AiAnalyticsPanelProps) {
  const a: CallAnalysis = analysis || {};
  const sentiment = (a.sentiment || fallbackSentiment || 'NEUTRAL').toUpperCase();
  const interest = Math.max(0, Math.min(100, a.interest_level ?? fallbackInterest ?? 0));
  const satisfied = sentiment === 'POSITIVE' ? Math.max(60, interest) : sentiment === 'NEGATIVE' ? Math.min(30, interest) : interest;

  const shortSummary = a.short_summary || a.summary || fallbackSummary || 'No AI analysis available yet.';
  const objections = a.objections || [];
  const callerClarity = a.voice_quality?.caller;
  const agentClarity = a.voice_quality?.agent;

  // Donut data for sentiment — single "slice" worth 100% of whichever sentiment applies.
  // Gives a satisfying visual without overstating certainty.
  const donutData = [
    { name: 'Satisfied', value: satisfied },
    { name: 'Unsatisfied', value: Math.max(0, 100 - satisfied) },
  ];
  const donutColors = [SENTIMENT_COLORS[sentiment] || '#9ca3af', '#e5e7eb'];

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-gray-100">
        <CardHeader
          title="AI Conversation Analytics"
          subtitle="Automated insights from the agent-customer conversation and recording"
        />
      </div>

      {/* ── Top row: sentiment donut + key stats ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 border-b border-gray-100">
        <div className="p-6 border-r border-gray-100 flex flex-col items-center justify-center">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Sentiment</p>
          <div className="relative h-44 w-44">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={donutData}
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={1}
                  dataKey="value"
                  stroke="none"
                >
                  {donutData.map((_, i) => <Cell key={i} fill={donutColors[i]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-bold text-gray-900">{satisfied}%</span>
              <span className="text-xs text-gray-500">satisfied</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            {sentimentIcon(sentiment)}
            <span className="text-sm font-medium text-gray-700 capitalize">{sentiment.toLowerCase()}</span>
          </div>
        </div>

        {/* Interest gauge + lead score */}
        <div className="p-6 border-r border-gray-100 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Interest Level</span>
              <span className="text-lg font-bold text-gray-900">{interest}%</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${interest}%`,
                  background: interest >= 70 ? '#16a34a' : interest >= 40 ? '#f59e0b' : '#dc2626',
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Lead Score</p>
              <Badge variant={leadBadgeVariant(a.lead_score)}>{a.lead_score || '—'}</Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Conversion</p>
              <Badge variant={conversionBadgeVariant(a.conversion_probability)}>{a.conversion_probability || '—'}</Badge>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Outcome</p>
            <p className="text-sm font-medium text-gray-800">{a.call_outcome || a.outcome || '—'}</p>
          </div>
        </div>

        {/* Next best action + flags */}
        <div className="p-6 space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Next Best Action</p>
            <p className="text-sm font-medium text-gray-800 capitalize">{(a.next_best_action || 'close_no_action').replace(/_/g, ' ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.follow_up_required && (
              <span className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full">
                <CheckCircle2 className="h-3.5 w-3.5" /> Follow-up required
              </span>
            )}
            {a.human_handoff_needed && (
              <span className="inline-flex items-center gap-1 text-xs bg-warning-50 text-warning-700 px-2.5 py-1 rounded-full">
                <AlertTriangle className="h-3.5 w-3.5" /> Human handoff
              </span>
            )}
            {(a.compliance_flags || []).map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs bg-danger-50 text-danger-700 px-2.5 py-1 rounded-full">
                <AlertTriangle className="h-3.5 w-3.5" /> {f}
              </span>
            ))}
          </div>
          {a.qa_score && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">QA Score</p>
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50 text-lg font-bold text-gray-800">
                {a.qa_score}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Voice + conversation quality per speaker ─────────────────── */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary-500" />
            <h4 className="text-sm font-semibold text-gray-800">Voice & Conversation Quality</h4>
          </div>
          <p className="text-xs text-gray-500">Acoustic clarity + pitch from the recording, understanding + emotion from the transcript</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SpeakerPanel
            who="Customer"
            icon={<User className="h-5 w-5 text-primary-500" />}
            accent="primary"
            acoustic={callerClarity}
            conversation={a.conversation_quality?.customer}
            kind="customer"
          />
          <SpeakerPanel
            who="Agent"
            icon={<Bot className="h-5 w-5 text-accent-500" />}
            accent="accent"
            acoustic={agentClarity}
            conversation={a.conversation_quality?.agent}
            kind="agent"
          />
        </div>

        {a.conversation_quality?.overall_note && (
          <div className="mt-4 p-3 rounded-lg bg-primary-50 border border-primary-100 text-sm text-primary-900">
            <span className="font-medium">Overall:</span> {a.conversation_quality.overall_note}
          </div>
        )}
      </div>

      {/* ── Summary + objections + key entities ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        <div className="p-6 lg:col-span-2 border-r border-gray-100">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">AI Overview</h4>
          <p className="text-sm text-gray-600 leading-relaxed">{shortSummary}</p>
          {a.detailed_summary && a.detailed_summary !== shortSummary && (
            <details className="mt-3">
              <summary className="text-xs text-primary-600 cursor-pointer font-medium">Detailed summary</summary>
              <p className="text-sm text-gray-600 leading-relaxed mt-2">{a.detailed_summary}</p>
            </details>
          )}
          {objections.length > 0 && (
            <div className="mt-4">
              <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Objections raised</h5>
              <div className="flex flex-wrap gap-1.5">
                {objections.map((o, i) => (
                  <span key={i} className="text-xs bg-danger-50 text-danger-700 px-2 py-0.5 rounded-full">{o}</span>
                ))}
              </div>
            </div>
          )}
          {(a.agent_performance_notes || []).length > 0 && (
            <div className="mt-4">
              <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Agent performance</h5>
              <ul className="space-y-1 text-sm text-gray-600">
                {a.agent_performance_notes!.map((n, i) => <li key={i} className="flex gap-2"><span className="text-primary-400">•</span>{n}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Captured Fields</h4>
          <dl className="space-y-2 text-sm">
            <EntityRow label="Customer" value={a.key_entities?.customer_name} />
            <EntityRow label="City" value={a.key_entities?.city} />
            <EntityRow label="Interest" value={a.key_entities?.product_interest} />
            <EntityRow label="Budget" value={a.key_entities?.budget} />
            <EntityRow label="Timeline" value={a.key_entities?.timeline} />
            <EntityRow label="Appointment" value={a.key_entities?.appointment_time} />
          </dl>
        </div>
      </div>
    </Card>
  );
}

function SpeakerPanel({
  who,
  icon,
  accent,
  acoustic,
  conversation,
  kind,
}: {
  who: string;
  icon: React.ReactNode;
  accent: 'primary' | 'accent';
  acoustic?: VoiceClarity;
  conversation?: ConversationQuality['customer'] & ConversationQuality['agent'];
  kind: 'customer' | 'agent';
}) {
  const clarityLbl = acoustic?.label ?? 'unclear';
  const clarityScore = acoustic?.score ?? 0;
  const clarityColorHex = clarityColor(clarityLbl);

  // Primary "understanding" metric depends on which side we're showing:
  //  - Customer side → understanding_score (how well they understood agent)
  //  - Agent side    → clarity_score       (how clearly they explained)
  const understandingScore =
    kind === 'customer'
      ? conversation?.understanding_score ?? 0
      : conversation?.clarity_score ?? 0;
  const understandingLabel = kind === 'customer' ? 'Understanding' : 'Explanation clarity';

  // Secondary metric: engagement (customer) or tone (agent)
  const secondaryScore =
    kind === 'customer'
      ? conversation?.engagement_score ?? 0
      : conversation?.tone_score ?? 0;
  const secondaryLabel = kind === 'customer' ? 'Engagement' : 'Tone';

  // Emotion / state bubble (customer only)
  const emotion = (conversation as any)?.emotion as string | undefined;
  const frustration = (conversation as any)?.frustration_level as string | undefined;
  const pacing = (conversation as any)?.pacing as string | undefined;

  const expressiveness = acoustic?.expressiveness_score ?? 0;
  const expressivenessLbl = acoustic?.expressiveness_label ?? 'monotone';
  const pitchMean = acoustic?.pitch_mean_hz ?? 0;
  const pitchStd = acoustic?.pitch_std_hz ?? 0;

  // Overall = average of acoustic clarity + understanding score, the two
  // headline numbers the user asked for.
  const overall = Math.round((clarityScore + understandingScore) / 2);

  const accentBg = accent === 'primary' ? 'bg-primary-50 border-primary-100' : 'bg-accent-50 border-accent-100';
  return (
    <div className={`p-4 rounded-xl border ${accentBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-gray-900">{who}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-2xl font-bold text-gray-900">{overall}</span>
          <span className="text-xs text-gray-500 pb-0.5">/100</span>
        </div>
      </div>

      {/* Two stacked meters */}
      <div className="space-y-2.5 mb-3">
        <MiniMeter
          label="Voice clarity"
          value={clarityScore}
          color={clarityColorHex}
          badge={clarityLbl}
        />
        <MiniMeter
          label={understandingLabel}
          value={understandingScore}
          color={understandingScore >= 70 ? '#16a34a' : understandingScore >= 40 ? '#f59e0b' : '#dc2626'}
        />
        <MiniMeter
          label={secondaryLabel}
          value={secondaryScore}
          color={secondaryScore >= 70 ? '#16a34a' : secondaryScore >= 40 ? '#f59e0b' : '#dc2626'}
        />
        <MiniMeter
          label="Pitch expressiveness"
          value={expressiveness}
          color={expressiveness >= 70 ? '#16a34a' : expressiveness >= 40 ? '#f59e0b' : '#9ca3af'}
          badge={expressivenessLbl}
        />
      </div>

      {/* Emotion / pacing pills + pitch stats */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {emotion && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${emotionBg(emotion)}`}>
            {emotion}
          </span>
        )}
        {frustration && frustration !== 'none' && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-50 text-danger-700 capitalize">
            {frustration} frustration
          </span>
        )}
        {pacing && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 capitalize">
            {pacing} pacing
          </span>
        )}
        {pitchMean > 0 && (
          <span className="text-[11px] text-gray-500">
            {pitchMean} Hz ± {pitchStd}
          </span>
        )}
      </div>

      {(conversation?.pitch_impression || conversation?.notes) && (
        <p className="text-xs text-gray-600 leading-relaxed">
          {conversation?.pitch_impression && <span className="italic">"{conversation.pitch_impression}"</span>}
          {conversation?.pitch_impression && conversation?.notes && ' — '}
          {conversation?.notes}
        </p>
      )}

      {/* Raw acoustic stats (collapsed inline) */}
      <div className="mt-2 text-[11px] text-gray-500 flex flex-wrap gap-x-3">
        <span>RMS {acoustic?.rms_db ?? '—'} dB</span>
        <span>{((acoustic?.silence_ratio ?? 0) * 100).toFixed(0)}% silence</span>
        {acoustic?.clip_ratio && acoustic.clip_ratio > 0.001 ? (
          <span>{(acoustic.clip_ratio * 100).toFixed(1)}% clipping</span>
        ) : null}
      </div>
    </div>
  );
}

function MiniMeter({ label, value, color, badge }: { label: string; value: number; color: string; badge?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-gray-600">{label}</span>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded capitalize" style={{ background: `${color}20`, color }}>
              {badge}
            </span>
          )}
          <span className="text-[11px] font-semibold text-gray-800">{value}</span>
        </div>
      </div>
      <div className="h-1.5 bg-white rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

function emotionBg(emotion: string): string {
  const e = emotion.toLowerCase();
  if (e.includes('frustrat') || e.includes('angry')) return 'bg-danger-50 text-danger-700';
  if (e.includes('confus')) return 'bg-warning-50 text-warning-700';
  if (e.includes('satisfi')) return 'bg-success-50 text-success-700';
  if (e.includes('curious')) return 'bg-primary-50 text-primary-700';
  return 'bg-gray-100 text-gray-700';
}

function EntityRow({ label, value }: { label: string; value?: string }) {
  const v = (value || '').trim();
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`text-sm text-right ${v ? 'text-gray-800 font-medium' : 'text-gray-400 italic'}`}>
        {v || 'not captured'}
      </dd>
    </div>
  );
}
