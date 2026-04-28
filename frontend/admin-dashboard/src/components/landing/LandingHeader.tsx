import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mic, Search, Globe, ChevronDown, Bot, MessageSquare, Phone,
  BookOpen, Users, BarChart3, Sparkles, Wand2,
  ListTree, KeyRound, Megaphone, Workflow,
} from 'lucide-react';
import { FeatureInfoModal } from './FeatureInfoModal';

type SubItem = { label: string; desc?: string; to: string; icon?: any; featureId?: string };

// Top-row product links — clicking any of these opens an info modal
// (backed by /api/v1/landing/features/:id) instead of navigating away.
const TOP_PRODUCTS: { label: string; featureId: string }[] = [
  { label: 'Voice Agents',  featureId: 'voice-agents' },
  { label: 'Chatbots',      featureId: 'chatbots' },
  { label: 'Phone Numbers', featureId: 'phone-numbers' },
  { label: 'Knowledge',     featureId: 'knowledge' },
  { label: 'CRM',           featureId: 'crm' },
  { label: 'Analytics',     featureId: 'analytics' },
];

const ALL_PRODUCTS: { group: string; items: SubItem[] }[] = [
  {
    group: 'Build',
    items: [
      { label: 'Voice Agents',  desc: 'Inbound + outbound AI calling', to: '/agents',        icon: Bot,           featureId: 'voice-agents' },
      { label: 'Chatbots',      desc: 'Embeddable web/widget bots',    to: '/chatbots',      icon: MessageSquare, featureId: 'chatbots' },
      { label: 'Voice Cloning', desc: 'Clone any voice in 30s',        to: '/voice-cloning', icon: Mic,           featureId: 'voice-cloning' },
      { label: 'Workflows',     desc: 'Multi-step automations',        to: '/workflows',     icon: Workflow,      featureId: 'workflows' },
    ],
  },
  {
    group: 'Connect',
    items: [
      { label: 'Phone Numbers',  desc: 'Plivo, Twilio, Exotel',     to: '/settings/phone-numbers', icon: Phone,    featureId: 'phone-numbers' },
      { label: 'Knowledge Base', desc: 'PDFs, URLs, CSV import',     to: '/knowledge',              icon: BookOpen, featureId: 'knowledge' },
      { label: 'Integrations',   desc: 'CRM, calendar, messaging',   to: '/settings/integrations',  icon: Wand2 },
      { label: 'API & Webhooks', desc: 'REST + streaming events',    to: '/docs',                   icon: ListTree },
    ],
  },
  {
    group: 'Operate',
    items: [
      { label: 'CRM',         desc: 'Built-in lead pipeline',  to: '/crm/leads',    icon: Users,    featureId: 'crm' },
      { label: 'Analytics',   desc: 'Per-call dashboards',     to: '/analytics',    icon: BarChart3, featureId: 'analytics' },
      { label: 'Campaigns',   desc: 'Bulk outbound calling',   to: '/campaigns',    icon: Megaphone, featureId: 'campaigns' },
      { label: 'API Keys',    desc: 'Provision API access',    to: '/settings/api', icon: KeyRound },
    ],
  },
];

const FEATURES_MENU: SubItem[] = [
  { label: 'AI Voice Agents',  to: '#features' },
  { label: 'Real Phone Calls', to: '#features' },
  { label: 'Chatbot Widgets',  to: '#features' },
  { label: 'Knowledge Base',   to: '#features' },
  { label: 'Built-in CRM',     to: '#features' },
  { label: 'Deep Analytics',   to: '#features' },
];

const PLATFORM_MENU: SubItem[] = [
  { label: 'Integrations',     to: '#integrations' },
  { label: 'Provider Stack',   to: '#integrations' },
  { label: 'API Reference',    to: '/docs' },
  { label: 'Webhooks & Events', to: '/docs' },
];

const CUSTOMERS_MENU: SubItem[] = [
  { label: 'Testimonials',    to: '#testimonials' },
  { label: 'Customer Stories', to: '#testimonials' },
  { label: 'Case Studies',    to: '#testimonials' },
];

const RESOURCES_MENU: SubItem[] = [
  { label: 'Documentation', to: '/docs' },
  { label: 'Help Center',   to: '/contact' },
  { label: 'Support',       to: '/support' },
  { label: 'Status',        to: '/docs' },
];

const FREE_TOOLS_MENU: SubItem[] = [
  { label: 'Voice Cloning (50 free)', to: '/voice-cloning' },
  { label: 'AI Prompt Library',       to: '/agents/new' },
  { label: 'Try a Test Call',         to: '/agents' },
];

function isAnchor(to: string) {
  return to.startsWith('#');
}

function NavLink({ to, children, onClick, className }: { to: string; children: any; onClick?: () => void; className?: string }) {
  if (isAnchor(to)) {
    return (
      <a href={to} onClick={onClick} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}

export function LandingHeader() {
  const [open, setOpen] = useState<string | null>(null);
  const [featureId, setFeatureId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  function openFeature(id: string) {
    setOpen(null);
    setFeatureId(id);
  }

  function focusPromptInput() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const ta = document.querySelector('.prompt-animated-border textarea') as HTMLTextAreaElement | null;
      ta?.focus();
    }, 500);
  }

  function toggle(id: string) {
    setOpen((curr) => (curr === id ? null : id));
  }

  return (
    <div ref={wrapRef} className="sticky top-0 z-40 bg-white">
      {/* ── Top row: platform-wide products ───────────────────────── */}
      <div className="border-b border-slate-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8 min-w-0">
            <Link to="/landing" className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center shadow-md shadow-amber-500/20">
                <Mic className="h-5 w-5 text-white" />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-bold text-slate-900 tracking-tight">VoiceAgent AI</p>
                <p className="text-[9px] uppercase tracking-[0.2em] text-amber-600 font-semibold">Build · Call · Convert</p>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {TOP_PRODUCTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => openFeature(p.featureId)}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-amber-50/50 rounded-lg transition-colors"
                >
                  {p.label}
                </button>
              ))}

              {/* All Products mega-dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggle('all')}
                  className="px-3 py-1.5 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-amber-50/50 rounded-lg transition-colors"
                >
                  All Products
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === 'all' ? 'rotate-180' : ''}`} />
                </button>
                {open === 'all' && (
                  <div className="absolute top-full left-0 mt-3 w-[720px] bg-white rounded-2xl shadow-2xl shadow-slate-300/40 border border-slate-100 p-6 grid grid-cols-3 gap-5 animate-slide-down">
                    {ALL_PRODUCTS.map((g) => (
                      <div key={g.group}>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold mb-3">
                          {g.group}
                        </p>
                        <div className="space-y-1">
                          {g.items.map((it) => {
                            const inner = (
                              <>
                                <span className="w-7 h-7 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 group-hover:bg-gradient-to-br group-hover:from-amber-500 group-hover:to-rose-500 group-hover:text-white transition-all">
                                  {it.icon ? <it.icon className="h-3.5 w-3.5" /> : null}
                                </span>
                                <div className="min-w-0 text-left">
                                  <div className="text-sm font-semibold text-slate-900">{it.label}</div>
                                  <div className="text-xs text-slate-500 truncate">{it.desc}</div>
                                </div>
                              </>
                            );
                            const cls = 'flex items-start gap-2.5 p-2 w-full rounded-lg hover:bg-amber-50 transition-colors group';
                            if (it.featureId) {
                              return (
                                <button key={it.label} onClick={() => openFeature(it.featureId!)} className={cls}>
                                  {inner}
                                </button>
                              );
                            }
                            return (
                              <Link key={it.label} to={it.to} onClick={() => setOpen(null)} className={cls}>
                                {inner}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={focusPromptInput}
              className="text-slate-500 hover:text-amber-600 hover:bg-amber-50/50 p-2 rounded-lg transition-colors"
              aria-label="Search"
              title="Jump to prompt"
            >
              <Search className="h-4 w-4" />
            </button>
            <button className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1.5 rounded-lg hover:bg-slate-50">
              <Globe className="h-3.5 w-3.5" /> English (India) <ChevronDown className="h-3 w-3" />
            </button>
            <Link
              to="/login"
              className="text-sm font-bold bg-gradient-to-r from-amber-600 to-rose-600 bg-clip-text text-transparent hover:opacity-80 px-2"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>

      {/* ── Bottom row: product nav — gradient bg ─────────────────── */}
      <div className="bg-gradient-to-r from-amber-50 via-rose-50 to-amber-50 border-b border-rose-100/60">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-center gap-4">
          <nav className="hidden lg:flex items-center gap-1">
            <NavDropdown id="features"   name="Features"   items={FEATURES_MENU}   open={open} toggle={toggle} setOpen={setOpen} />
            <Link to="/pricing" className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-white/60 rounded-lg transition-all">
              Pricing
            </Link>
            <NavDropdown id="platform"   name="Platform"   items={PLATFORM_MENU}   open={open} toggle={toggle} setOpen={setOpen} />
            <NavDropdown id="customers"  name="Customers"  items={CUSTOMERS_MENU}  open={open} toggle={toggle} setOpen={setOpen} />
            <NavDropdown id="resources"  name="Resources"  items={RESOURCES_MENU}  open={open} toggle={toggle} setOpen={setOpen} />
            <NavDropdown id="free-tools" name="Free Tools" items={FREE_TOOLS_MENU} open={open} toggle={toggle} setOpen={setOpen} />

            <button
              onClick={focusPromptInput}
              className="ml-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-md hover:shadow-lg border border-slate-200 hover:border-amber-300 transition-all"
            >
              Ask AI <Sparkles className="h-3.5 w-3.5 text-amber-500 fill-amber-200" />
            </button>
          </nav>
        </div>
      </div>

      <FeatureInfoModal featureId={featureId} onClose={() => setFeatureId(null)} />
    </div>
  );
}

function NavDropdown({
  id, name, items, open, toggle, setOpen,
}: {
  id: string;
  name: string;
  items: SubItem[];
  open: string | null;
  toggle: (id: string) => void;
  setOpen: (v: string | null) => void;
}) {
  const isOpen = open === id;
  return (
    <div className="relative">
      <button
        onClick={() => toggle(id)}
        className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-white/60 rounded-lg transition-all"
      >
        {name}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-xl shadow-slate-300/40 border border-slate-100 py-2 animate-slide-down">
          {items.map((it) => (
            <NavLink
              key={it.label}
              to={it.to}
              onClick={() => setOpen(null)}
              className="block px-4 py-2 text-sm text-slate-700 hover:text-amber-700 hover:bg-amber-50 transition-colors"
            >
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
