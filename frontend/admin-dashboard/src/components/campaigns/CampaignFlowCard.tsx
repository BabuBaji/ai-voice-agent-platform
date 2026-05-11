import {
  Upload, Clock, PhoneOutgoing, Brain, BarChart3, ArrowRight, ChevronRight,
  Users, Calendar, Repeat, FileAudio, Megaphone,
} from 'lucide-react';

type Tone = 'sky' | 'violet' | 'amber' | 'emerald' | 'rose';

type Stage = {
  icon: any;
  title: string;
  subtitle: string;
  detail: string;
  tone: Tone;
};

const STAGES: Stage[] = [
  {
    icon: Upload,
    title: 'Upload contacts',
    subtitle: 'CSV or paste',
    detail: 'Phone numbers, optional names and per-contact variables become campaign targets.',
    tone: 'sky',
  },
  {
    icon: Clock,
    title: 'Schedule + queue',
    subtitle: 'When to dial',
    detail: 'Campaign waits for its start time and stays inside the calling-hours window.',
    tone: 'violet',
  },
  {
    icon: PhoneOutgoing,
    title: 'Dial worker',
    subtitle: 'Concurrency-aware',
    detail: 'Picks pending contacts and places outbound calls, respecting the concurrency limit and retry rules.',
    tone: 'amber',
  },
  {
    icon: Brain,
    title: 'AI conversation',
    subtitle: 'Talks & records',
    detail: 'The agent speaks with the customer, the call is recorded, transcribed, and analysed.',
    tone: 'emerald',
  },
  {
    icon: BarChart3,
    title: 'Campaign analytics',
    subtitle: 'Roll-up & review',
    detail: 'Outcomes, completion rate, sentiment and lead scores roll up to the campaign dashboard.',
    tone: 'rose',
  },
];

const TONE: Record<Tone, { ring: string; bg: string; icon: string; chip: string; dot: string }> = {
  sky:     { ring: 'ring-sky-300/60',     bg: 'bg-sky-50',     icon: 'text-sky-600',     chip: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-400' },
  violet:  { ring: 'ring-violet-300/60',  bg: 'bg-violet-50',  icon: 'text-violet-600',  chip: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-400' },
  amber:   { ring: 'ring-amber-300/60',   bg: 'bg-amber-50',   icon: 'text-amber-600',   chip: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400' },
  emerald: { ring: 'ring-emerald-300/60', bg: 'bg-emerald-50', icon: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400' },
  rose:    { ring: 'ring-rose-300/60',    bg: 'bg-rose-50',    icon: 'text-rose-600',    chip: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-400' },
};

const PER_CONTACT = [
  { icon: FileAudio, label: 'Recording', detail: 'Stereo audio of caller and agent.' },
  { icon: Users,     label: 'Transcript', detail: 'Turn-by-turn dialogue captured in real time.' },
  { icon: Brain,     label: 'AI analysis', detail: 'Summary, sentiment, lead score, next action.' },
  { icon: Repeat,    label: 'Retry record', detail: 'Attempt count and outcome per contact.' },
];

export function CampaignFlowCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 px-4 pt-3 pb-4 shadow-sm">
      {/* Title bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-sm">
            <Megaphone className="h-4 w-4 text-white" />
          </div>
          <p className="text-base font-semibold text-gray-900">How a bulk-call campaign flows</p>
          <span className="text-xs text-gray-400">·  upload → dial → analyse</span>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live flow
        </span>
      </div>

      {/* Pipeline — 5 stages with arrows between them */}
      <div className="flex flex-col xl:flex-row items-stretch gap-2.5">
        {STAGES.map((s, idx) => {
          const t = TONE[s.tone];
          const Icon = s.icon;
          return (
            <div key={s.title} className="flex xl:flex-row flex-col items-stretch gap-2 flex-1 min-w-0">
              <div className={`flex-1 rounded-lg ${t.bg} ring-1 ${t.ring} p-3.5 relative overflow-hidden`}>
                <div className={`absolute top-0 left-0 h-0.5 w-full ${t.dot}`} />
                <div className="flex items-start gap-2.5">
                  <div className={`w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center ${t.icon} flex-shrink-0`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[11px] font-bold ${t.chip} rounded px-1.5 py-0.5`}>{idx + 1}</span>
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.title}</p>
                    </div>
                    <p className={`text-xs font-medium ${t.icon} mb-1.5`}>{s.subtitle}</p>
                    <p className="text-xs text-gray-600 leading-relaxed">{s.detail}</p>
                  </div>
                </div>
              </div>
              {idx < STAGES.length - 1 && (
                <div className="flex items-center justify-center text-gray-300 xl:px-0.5 self-center xl:self-stretch">
                  <ArrowRight className="h-5 w-5 hidden xl:block" />
                  <ChevronRight className="h-5 w-5 rotate-90 xl:hidden" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sub-panel: what gets stored per contact */}
      <div className="mt-3.5 rounded-lg bg-white border border-gray-200 p-3.5">
        <p className="text-sm font-semibold text-gray-700 mb-2.5 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-rose-600" />
          What is saved against every contact after their call
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {PER_CONTACT.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-2.5 py-2">
                <Icon className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 leading-tight">{s.label}</p>
                  <p className="text-xs text-gray-500 leading-snug mt-0.5">{s.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Retry footnote */}
      <p className="mt-3 text-xs text-gray-500 leading-relaxed text-center">
        Failed dials (no-answer, busy, hung up early) automatically retry up to the configured attempt limit, with the configured delay between tries.
      </p>
    </div>
  );
}
