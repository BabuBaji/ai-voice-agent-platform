import {
  PhoneIncoming, Mic2, Brain, Volume2, Database, ArrowRight,
  BookOpen, Wrench, FileText, Globe2, Radio, ChevronRight,
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
    icon: PhoneIncoming,
    title: 'Caller',
    subtitle: 'Inbound or outbound',
    detail: 'Customer connects over phone or web. Audio streams in real time to the agent.',
    tone: 'sky',
  },
  {
    icon: Mic2,
    title: 'Speech → Text',
    subtitle: 'Live transcription',
    detail: 'The caller\'s voice is transcribed continuously as they speak.',
    tone: 'violet',
  },
  {
    icon: Brain,
    title: 'AI Brain',
    subtitle: 'Understands & decides',
    detail: 'Reads the prompt, conversation history, knowledge, and tools — then decides what to say next.',
    tone: 'amber',
  },
  {
    icon: Volume2,
    title: 'Text → Speech',
    subtitle: 'Natural voice reply',
    detail: 'The reply is spoken back to the caller in the chosen voice and language.',
    tone: 'emerald',
  },
  {
    icon: Database,
    title: 'Record + Analyse',
    subtitle: 'Saved & scored',
    detail: 'Recording, transcript, summary, sentiment, and lead score are stored against the call.',
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

const BRAIN_INPUTS = [
  { icon: FileText, label: 'System prompt',  detail: 'Personality, goals, and constraints from step 1.' },
  { icon: BookOpen, label: 'Knowledge base', detail: 'Documents and FAQs attached to the agent.' },
  { icon: Wrench,   label: 'Tools',          detail: 'Actions the agent can take mid-call.' },
  { icon: Globe2,   label: 'Live web search',detail: 'Fresh answers for trending or news questions.' },
];

export function ArchitectureFlowCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 px-3 pt-2 pb-3 shadow-sm">
      {/* Title bar — compact, single row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-sm">
            <Radio className="h-3 w-3 text-white" />
          </div>
          <p className="text-[12px] font-semibold text-gray-900">How a call flows through your agent</p>
          <span className="text-[10px] text-gray-400">·  caller → saved analysis</span>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live flow
        </span>
      </div>

      {/* Pipeline — 5 stages with arrows between them */}
      <div className="flex flex-col xl:flex-row items-stretch gap-2">
        {STAGES.map((s, idx) => {
          const t = TONE[s.tone];
          const Icon = s.icon;
          return (
            <div key={s.title} className="flex xl:flex-row flex-col items-stretch gap-2 flex-1 min-w-0">
              <div className={`flex-1 rounded-lg ${t.bg} ring-1 ${t.ring} p-3 relative overflow-hidden`}>
                <div className={`absolute top-0 left-0 h-0.5 w-full ${t.dot}`} />
                <div className="flex items-start gap-2">
                  <div className={`w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center ${t.icon} flex-shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-bold ${t.chip} rounded px-1 py-0.5`}>{idx + 1}</span>
                      <p className="text-[12px] font-semibold text-gray-900 truncate">{s.title}</p>
                    </div>
                    <p className={`text-[10px] font-medium ${t.icon} mb-1`}>{s.subtitle}</p>
                    <p className="text-[10.5px] text-gray-600 leading-snug">{s.detail}</p>
                  </div>
                </div>
              </div>
              {idx < STAGES.length - 1 && (
                <div className="flex items-center justify-center text-gray-300 xl:px-0.5 self-center xl:self-stretch">
                  <ArrowRight className="h-4 w-4 hidden xl:block" />
                  <ChevronRight className="h-4 w-4 rotate-90 xl:hidden" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sub-panel: what stage 3 reads each turn */}
      <div className="mt-3 rounded-lg bg-white border border-gray-200 p-3">
        <p className="text-[11px] font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-amber-600" />
          What the AI Brain (stage 3) reads on every turn
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {BRAIN_INPUTS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-start gap-1.5 rounded-md border border-gray-100 bg-gray-50/60 px-2 py-1.5">
                <Icon className="h-3.5 w-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10.5px] font-semibold text-gray-800 leading-tight">{s.label}</p>
                  <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{s.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Outbound footnote */}
      <p className="mt-2 text-[10px] text-gray-400 leading-relaxed text-center">
        Outbound campaigns reuse the same flow — the agent places the call instead of receiving it, then stages 2-5 fire identically.
      </p>
    </div>
  );
}
