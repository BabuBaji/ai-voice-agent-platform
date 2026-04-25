import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Play, ArrowRight, Globe, KeyRound,
  Library, Headphones, ChevronRight, ArrowUpRight, Loader2, AlertCircle,
  Sparkles, Zap,
} from 'lucide-react';
import { docsApi, type DocNavSection, type DocFeaturedCard, type DocSearchHit } from '@/services/docs.api';
import { docIcon, colorFor } from './docIcons';

/**
 * Section-title → subtle accent gradient for the sidebar headers.
 * Keeps the sidebar colorful without overwhelming the actual nav items.
 */
const SECTION_ACCENTS: Record<string, string> = {
  introduction:  'from-sky-400/90 to-cyan-300/90',
  'core-features': 'from-violet-400/90 to-fuchsia-300/90',
  'api-reference': 'from-amber-400/90 to-orange-300/90',
  guides:        'from-emerald-400/90 to-teal-300/90',
  integrations:  'from-rose-400/90 to-pink-300/90',
};

function SideLink({
  label, linkTo, slug, isNew, iconName,
}: {
  label: string;
  linkTo?: string | null;
  slug: string;
  isNew?: boolean;
  iconName?: string | null;
}) {
  const Icon = docIcon(iconName);
  const target = linkTo || `/docs/article/${slug}`;
  return (
    <Link
      to={target}
      className="group relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white transition-all duration-200"
    >
      <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity" />
      <Icon className="relative h-3.5 w-3.5 flex-shrink-0 text-slate-500 group-hover:text-violet-300 transition-colors" />
      <span className="relative flex-1 truncate">{label}</span>
      {isNew && (
        <span className="relative px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200 bg-emerald-500/15 border border-emerald-400/30 rounded">
          New
        </span>
      )}
    </Link>
  );
}

export function DocsPage() {
  const [nav, setNav] = useState<DocNavSection[]>([]);
  const [featured, setFeatured] = useState<DocFeaturedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<DocSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [n, f] = await Promise.all([docsApi.nav(), docsApi.featured()]);
        if (!mounted) return;
        setNav(n);
        setFeatured(f);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.response?.data?.error || e.message || 'Failed to load documentation');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSearchHits([]); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const hits = await docsApi.search(q);
        setSearchHits(hits);
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const filteredSections = useMemo(() => {
    if (!query.trim()) return nav;
    const q = query.toLowerCase();
    return nav
      .map((s) => ({ ...s, items: s.items.filter((i) => i.title.toLowerCase().includes(q)) }))
      .filter((s) => s.items.length > 0);
  }, [query, nav]);

  // Bento-style layout: make the first two featured cards double-wide on lg screens
  const bentoSpan = (idx: number) =>
    idx === 0 ? 'lg:col-span-2 lg:row-span-1' :
    idx === 3 ? 'lg:col-span-2' :
    '';

  return (
    <div className="min-h-screen bg-[#0b0b1a] text-slate-100 flex relative overflow-hidden">
      {/* ── Animated gradient-mesh backdrop ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-500/20 blur-[120px] animate-float" />
        <div className="absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full bg-cyan-500/20 blur-[120px] animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-0 left-1/4 h-[400px] w-[400px] rounded-full bg-fuchsia-500/15 blur-[120px] animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] rounded-full bg-amber-500/10 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%224%22 height=%224%22%3E%3Cpath d=%22M1 1h1v1H1V1zm2 2h1v1H3V3z%22 fill=%22white%22/%3E%3C/svg%3E")',
          }}
        />
      </div>

      {/* ── Glassmorphic sidebar ── */}
      <aside className="relative w-64 flex-shrink-0 border-r border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl sticky top-0 h-screen overflow-y-auto z-10">
        <div className="px-5 pt-5 pb-3">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-violet-500/30 group-hover:shadow-fuchsia-500/40 transition-shadow">
              <Headphones className="h-4 w-4 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/30 to-transparent" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                VoiceAgent
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-widest text-violet-300/70">Docs</span>
            </div>
          </Link>
        </div>

        <div className="px-4 pb-3">
          <div className="relative group">
            <div className="absolute -inset-px rounded-lg bg-gradient-to-r from-violet-500/30 via-fuchsia-500/20 to-cyan-500/30 opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm" />
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 group-focus-within:text-violet-300 transition-colors" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documentation..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900/60 border border-white/[0.06] rounded-lg text-slate-200 placeholder-slate-500 focus:border-violet-400/40 focus:outline-none"
              />
            </div>
          </div>

          {query.trim().length >= 2 && (
            <div className="mt-2 px-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-violet-400" />}
                {searchHits.length} result{searchHits.length === 1 ? '' : 's'}
              </div>
              <ul className="space-y-0.5 max-h-52 overflow-y-auto pr-1">
                {searchHits.map((h) => (
                  <li key={h.slug}>
                    <Link
                      to={`/docs/article/${h.slug}`}
                      className="block px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/5 rounded truncate"
                    >
                      {h.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <nav className="px-2 pb-8 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading docs...
            </div>
          )}
          {filteredSections.map((section) => (
            <div key={section.slug}>
              <div className={`px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r ${SECTION_ACCENTS[section.slug] || 'from-slate-400 to-slate-300'} bg-clip-text text-transparent`}>
                {section.title}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={`${section.slug}-${item.slug}`}>
                    <SideLink
                      slug={item.slug}
                      label={item.title}
                      linkTo={item.link_to}
                      isNew={item.is_new}
                      iconName={item.icon}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!loading && filteredSections.length === 0 && (
            <div className="px-3 py-4 text-xs text-slate-500">
              {query ? `No results for "${query}"` : 'No docs yet.'}
            </div>
          )}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <main className="relative flex-1 min-w-0 z-10">
        <div className="max-w-6xl mx-auto px-10 py-10">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-400/30 text-violet-200">
                <Sparkles className="h-3 w-3" />
                Documentation
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-br from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Developer Hub
              </h1>
            </div>
            <Link
              to="/"
              className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg transition-all"
            >
              Back to dashboard
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          {error && (
            <div className="mb-6 flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Hero: multi-gradient frame around video block ── */}
          <div id="overview" className="relative rounded-3xl p-[1px] mb-12 group bg-gradient-to-br from-violet-500/60 via-fuchsia-400/40 to-cyan-400/60">
            <div className="relative rounded-[23px] overflow-hidden bg-[#0b0b1a]">
              <div className="aspect-[21/9] relative flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/60 via-slate-950 to-cyan-950/60" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(168,85,247,0.25),transparent_50%),radial-gradient(circle_at_70%_60%,rgba(6,182,212,0.2),transparent_50%)]" />

                {/* Decorative dots */}
                <div className="absolute top-6 left-6 flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                </div>

                <div className="relative text-center space-y-4 px-6">
                  <div className="mx-auto h-16 w-16 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl shadow-fuchsia-500/30 group-hover:scale-110 group-hover:shadow-fuchsia-500/50 transition-all cursor-pointer">
                    <Play className="h-7 w-7 text-white fill-white ml-1" />
                  </div>
                  <h2 className="text-4xl md:text-6xl font-black tracking-tight">
                    <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-300 bg-clip-text text-transparent">VOICE</span>
                    <span className="text-white">AGENT</span>
                  </h2>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Build · Ship · Scale
                  </p>
                </div>
              </div>
              <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border-t border-white/[0.06] px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200 bg-fuchsia-500/15 border border-fuchsia-400/30 rounded">
                      Video Tutorial
                    </span>
                    <span className="text-[10px] text-slate-500">· 4 min</span>
                  </div>
                  <h3 className="text-lg font-semibold text-white">Introducing VoiceAgent AI</h3>
                  <p className="text-sm text-slate-400 mt-0.5">
                    Discover how VoiceAgent can transform your voice AI workflows.
                  </p>
                </div>
                <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/10">
                  <Zap className="h-3 w-3 text-amber-300" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">Watch now</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bento-style featured grid ── */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Explore the platform</h3>
            <div className="text-[10px] text-slate-500">{featured.length} guides</div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading documentation...
            </div>
          ) : (
            <div id="getting-started" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12 auto-rows-[190px]">
              {featured.map((card, idx) => {
                const Icon = docIcon(card.icon);
                const c = colorFor(card.color);
                const target = card.link_to || `/docs/article/${card.slug}`;
                return (
                  <Link
                    key={card.slug}
                    to={target}
                    className={`group relative rounded-2xl p-[1px] transition-all duration-300 hover:scale-[1.02] ${bentoSpan(idx)}`}
                  >
                    {/* Gradient border that lights up on hover */}
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-white/5 to-white/10 group-hover:from-violet-400/40 group-hover:via-fuchsia-400/30 group-hover:to-cyan-400/40 transition-colors" />

                    {/* Card surface */}
                    <div className="relative h-full rounded-2xl bg-[#0f0f1e] overflow-hidden flex flex-col p-5">
                      {/* subtle corner glow matching card color */}
                      <div className={`absolute -top-12 -right-12 h-32 w-32 rounded-full ${c.bg} blur-2xl opacity-60 group-hover:opacity-100 transition-opacity`} />

                      <div className="relative flex items-start justify-between mb-3">
                        <div className={`h-10 w-10 rounded-xl ${c.bg} flex items-center justify-center border border-white/5`}>
                          <Icon className={`h-5 w-5 ${c.text}`} />
                        </div>
                        {card.is_new && (
                          <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200 bg-emerald-500/15 border border-emerald-400/30 rounded-full">
                            New
                          </span>
                        )}
                      </div>

                      <h4 className="relative text-sm font-semibold text-white mb-1.5 group-hover:text-white">
                        {card.title}
                      </h4>
                      <p className="relative text-xs text-slate-400 leading-relaxed flex-1 group-hover:text-slate-300 transition-colors">
                        {card.excerpt}
                      </p>
                      <div className={`relative mt-3 inline-flex items-center gap-1 text-xs font-semibold ${c.text} group-hover:gap-2 transition-all`}>
                        Learn more
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* ── Bottom CTA: triple-gradient frame ── */}
          <div className="relative rounded-3xl p-[1px] bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-2xl shadow-violet-500/20">
            <div className="relative rounded-[23px] overflow-hidden bg-[#0b0b1a]">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-950/60 via-slate-950 to-cyan-950/60" />
              <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-fuchsia-500/25 blur-3xl" />
              <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-cyan-500/25 blur-3xl" />

              <div className="relative px-8 py-14 text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full bg-white/[0.06] border border-white/20 text-white backdrop-blur-sm mb-5">
                  <Sparkles className="h-3 w-3 text-amber-300" />
                  Developer API
                </span>
                <h3 className="text-3xl md:text-4xl font-black text-white">
                  Ready to build your <span className="bg-gradient-to-r from-fuchsia-300 via-violet-200 to-cyan-300 bg-clip-text text-transparent">AI voice agent</span>?
                </h3>
                <p className="text-sm text-slate-400 mt-3 max-w-xl mx-auto">
                  Get started with the VoiceAgent SDK today and create powerful AI voice experiences for your users.
                </p>
                <Link
                  to="/agents/new"
                  className="group inline-flex items-center gap-2 mt-7 px-6 py-3 text-sm font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-full shadow-2xl shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50 transition-all"
                >
                  Start Building
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-10 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <Library className="h-3.5 w-3.5" />
              <span>VoiceAgent Docs · v0.1</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="/api-docs" target="_blank" rel="noreferrer" className="hover:text-violet-300 inline-flex items-center gap-1 transition-colors">
                OpenAPI spec <Globe className="h-3 w-3" />
              </a>
              <Link to="/settings/api" className="hover:text-fuchsia-300 inline-flex items-center gap-1 transition-colors">
                Generate API key <KeyRound className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
