import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mic, ChevronDown, Bot, MessageSquare, Phone,
  BookOpen, Users, BarChart3, Wand2,
  ListTree, KeyRound, Megaphone, Workflow,
} from 'lucide-react';

type SubItem = { label: string; desc?: string; href: string; icon?: any };

const PRODUCTS: { group: string; items: SubItem[] }[] = [
  {
    group: 'Build',
    items: [
      { label: 'Voice Agents',  desc: 'Inbound + outbound AI calling', href: '#voice-agents',   icon: Bot },
      { label: 'Chatbots',      desc: 'Embeddable web/widget bots',    href: '#chatbots',       icon: MessageSquare },
      { label: 'Voice Cloning', desc: 'Clone any voice in 30s',        href: '#voice-cloning',  icon: Mic },
      { label: 'Workflows',     desc: 'Multi-step automations',        href: '#workflows',      icon: Workflow },
    ],
  },
  {
    group: 'Connect',
    items: [
      { label: 'Phone Numbers',  desc: 'Plivo, Twilio, Exotel',     href: '#phone-numbers', icon: Phone },
      { label: 'Knowledge Base', desc: 'PDFs, URLs, CSV import',     href: '#knowledge',     icon: BookOpen },
      { label: 'Integrations',   desc: 'CRM, calendar, messaging',   href: '#integrations',  icon: Wand2 },
      { label: 'API & Webhooks', desc: 'REST + streaming events',    href: '#api',           icon: ListTree },
    ],
  },
  {
    group: 'Operate',
    items: [
      { label: 'CRM',         desc: 'Built-in lead pipeline',  href: '#crm',        icon: Users },
      { label: 'Analytics',   desc: 'Per-call dashboards',     href: '#analytics',  icon: BarChart3 },
      { label: 'Campaigns',   desc: 'Bulk outbound calling',   href: '#campaigns',  icon: Megaphone },
      { label: 'API Keys',    desc: 'Provision API access',    href: '#api',        icon: KeyRound },
    ],
  },
];

const RESOURCES_MENU: { label: string; href: string; external?: boolean }[] = [
  { label: 'Documentation', href: '/docs', external: true },
  { label: 'Help Center',   href: '/contact', external: true },
  { label: 'Support',       href: '/support', external: true },
];

export function LandingHeader() {
  const [open, setOpen] = useState<string | null>(null);
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

  function toggle(id: string) {
    setOpen((curr) => (curr === id ? null : id));
  }

  return (
    <div ref={wrapRef} className="sticky top-0 z-40 bg-white border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
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
          {/* Products mega-dropdown */}
          <div className="relative">
            <button
              onClick={() => toggle('products')}
              className="px-3 py-2 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-amber-50/50 rounded-lg transition-colors"
            >
              Products
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === 'products' ? 'rotate-180' : ''}`} />
            </button>
            {open === 'products' && (
              <div className="absolute top-full left-0 mt-3 w-[720px] bg-white rounded-2xl shadow-2xl shadow-slate-300/40 border border-slate-100 p-6 grid grid-cols-3 gap-5 animate-slide-down">
                {PRODUCTS.map((g) => (
                  <div key={g.group}>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold mb-3">
                      {g.group}
                    </p>
                    <div className="space-y-1">
                      {g.items.map((it) => (
                        <a
                          key={it.label}
                          href={it.href}
                          onClick={() => setOpen(null)}
                          className="flex items-start gap-2.5 p-2 w-full rounded-lg hover:bg-amber-50 transition-colors group"
                        >
                          <span className="w-7 h-7 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 group-hover:bg-gradient-to-br group-hover:from-amber-500 group-hover:to-rose-500 group-hover:text-white transition-all">
                            {it.icon ? <it.icon className="h-3.5 w-3.5" /> : null}
                          </span>
                          <div className="min-w-0 text-left">
                            <div className="text-sm font-semibold text-slate-900">{it.label}</div>
                            <div className="text-xs text-slate-500 truncate">{it.desc}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <a href="#pricing" className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-amber-50/50 rounded-lg transition-colors">
            Pricing
          </a>

          {/* Resources dropdown */}
          <div className="relative">
            <button
              onClick={() => toggle('resources')}
              className="px-3 py-2 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-amber-50/50 rounded-lg transition-colors"
            >
              Resources
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === 'resources' ? 'rotate-180' : ''}`} />
            </button>
            {open === 'resources' && (
              <div className="absolute top-full left-0 mt-3 w-56 bg-white rounded-xl shadow-xl shadow-slate-300/40 border border-slate-100 py-2 animate-slide-down">
                {RESOURCES_MENU.map((it) => (
                  <Link
                    key={it.label}
                    to={it.href}
                    onClick={() => setOpen(null)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link to="/contact" className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-amber-700 hover:bg-amber-50/50 rounded-lg transition-colors">
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/login"
            className="text-sm font-medium text-slate-700 hover:text-amber-700 px-3 py-2"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-rose-500 hover:opacity-90 px-4 py-2 rounded-lg shadow-md shadow-amber-500/20 transition-opacity"
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
}
