import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Loader2, AlertCircle, Headphones, ArrowUpRight,
  Clock, ArrowRight, Search,
} from 'lucide-react';
import { docsApi, type DocArticle, type DocNavSection } from '@/services/docs.api';
import { docIcon, colorFor } from './docIcons';

const SECTION_ACCENTS: Record<string, string> = {
  introduction:  'from-sky-400/90 to-cyan-300/90',
  'core-features': 'from-violet-400/90 to-fuchsia-300/90',
  'api-reference': 'from-amber-400/90 to-orange-300/90',
  guides:        'from-emerald-400/90 to-teal-300/90',
  integrations:  'from-rose-400/90 to-pink-300/90',
};

/**
 * Pragmatic inline Markdown renderer — handles what the seed corpus uses:
 * headings, code fences, inline code, paragraphs, ordered/unordered lists,
 * and bold/italic. Good enough for our own docs without pulling in a
 * heavyweight markdown dep.
 */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inlineFormat = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const token = m[0];
      if (token.startsWith('`')) {
        parts.push(<code key={parts.length} className="px-1.5 py-0.5 rounded bg-slate-800 text-teal-300 font-mono text-[0.85em]">{token.slice(1, -1)}</code>);
      } else if (token.startsWith('**')) {
        parts.push(<strong key={parts.length} className="font-semibold text-white">{token.slice(2, -2)}</strong>);
      } else {
        parts.push(<em key={parts.length} className="italic">{token.slice(1, -1)}</em>);
      }
      last = m.index + token.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      out.push(
        <pre key={key++} className="my-4 p-4 rounded-xl bg-slate-950 border border-slate-800 overflow-x-auto text-xs text-slate-200">
          {lang && <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{lang}</div>}
          <code className="font-mono whitespace-pre">{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Headings
    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s+/, '');
      const sizes = ['text-3xl', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm'] as const;
      const cls = `${sizes[Math.min(level, 6) - 1]} font-bold text-white ${level === 1 ? 'mt-2 mb-4' : 'mt-8 mb-3'}`;
      const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
      out.push(<Tag key={key++} className={cls}>{inlineFormat(text)}</Tag>);
      i++;
      continue;
    }

    // Lists — consume consecutive lines
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={key++} className="my-4 ml-6 list-disc space-y-1.5 text-slate-300">
          {items.map((it, idx) => <li key={idx}>{inlineFormat(it)}</li>)}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(
        <ol key={key++} className="my-4 ml-6 list-decimal space-y-1.5 text-slate-300">
          {items.map((it, idx) => <li key={idx}>{inlineFormat(it)}</li>)}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — merge consecutive non-empty non-special lines
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(
      <p key={key++} className="my-4 text-sm text-slate-300 leading-relaxed">
        {inlineFormat(buf.join(' '))}
      </p>,
    );
  }

  return out;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function DocArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<DocArticle | null>(null);
  const [nav, setNav] = useState<DocNavSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [art, n] = await Promise.all([
          docsApi.article(slug!),
          nav.length === 0 ? docsApi.nav() : Promise.resolve(nav),
        ]);
        if (!mounted) return;
        setArticle(art);
        setNav(n);
      } catch (e: any) {
        if (!mounted) return;
        if (e?.response?.status === 404) setError('This article could not be found.');
        else setError(e?.response?.data?.error || e.message || 'Failed to load article');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Flatten nav to compute prev/next of current slug
  const flat = nav.flatMap((s) => s.items.filter((i) => !i.link_to).map((i) => ({ sec: s.title, ...i })));
  const idx = flat.findIndex((i) => i.slug === slug);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;

  return (
    <div className="min-h-screen bg-[#0b0b1a] text-slate-100 flex relative overflow-hidden">
      {/* Ambient gradient mesh to match /docs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-500/15 blur-[120px] animate-float" />
        <div className="absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full bg-cyan-500/15 blur-[120px] animate-float" style={{ animationDelay: '1s' }} />
      </div>

      {/* Sidebar */}
      <aside className="relative w-64 flex-shrink-0 border-r border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl sticky top-0 h-screen overflow-y-auto z-10">
        <div className="px-5 pt-5 pb-3">
          <Link to="/docs" className="flex items-center gap-2 group">
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
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documentation..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-md text-slate-200 placeholder-slate-500 focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/30 focus:outline-none"
            />
          </div>
        </div>

        <nav className="px-2 pb-8 space-y-4">
          {nav
            .map((s) => ({
              ...s,
              items: query ? s.items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())) : s.items,
            }))
            .filter((s) => s.items.length > 0)
            .map((section) => (
              <div key={section.slug}>
                <div className={`px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r ${SECTION_ACCENTS[section.slug] || 'from-slate-400 to-slate-300'} bg-clip-text text-transparent`}>
                  {section.title}
                </div>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = docIcon(item.icon);
                    const target = item.link_to || `/docs/article/${item.slug}`;
                    const active = !item.link_to && item.slug === slug;
                    return (
                      <li key={`${section.slug}-${item.slug}`}>
                        <Link
                          to={target}
                          className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                            active
                              ? 'bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-violet-200 border border-violet-400/30'
                              : 'text-slate-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="flex-1 truncate">{item.title}</span>
                          {item.is_new && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-300 bg-teal-500/10 border border-teal-500/20 rounded">
                              New
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="relative flex-1 min-w-0 z-10">
        <div className="max-w-3xl mx-auto px-10 py-10">
          <div className="flex items-center justify-between mb-6">
            <Link to="/docs" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
              <ChevronLeft className="h-3.5 w-3.5" />
              All documentation
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
            >
              Back to dashboard
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {article && !loading && (
            <>
              {article.section_title && (
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                  <span className="bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent uppercase tracking-widest font-bold">{article.section_title}</span>
                  {article.updated_at && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Updated {fmtDate(article.updated_at)}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-start gap-3 mb-6">
                {(() => {
                  const Icon = docIcon(article.icon);
                  const c = colorFor(article.color);
                  return (
                    <div className={`h-11 w-11 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 border border-white/5`}>
                      <Icon className={`h-5 w-5 ${c.text}`} />
                    </div>
                  );
                })()}
                <div>
                  <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">{article.title}</h1>
                  {article.excerpt && <p className="text-sm text-slate-400 mt-1">{article.excerpt}</p>}
                </div>
              </div>

              <article className="prose-invert">
                {renderMarkdown(article.body_md || '')}
              </article>

              {/* Prev / Next nav */}
              {(prev || next) && (
                <div className="mt-12 pt-6 border-t border-slate-800 grid grid-cols-2 gap-4">
                  <div>
                    {prev && (
                      <Link
                        to={`/docs/article/${prev.slug}`}
                        className="group flex flex-col px-4 py-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/50 hover:bg-slate-900 transition-colors"
                      >
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 inline-flex items-center gap-1">
                          <ChevronLeft className="h-3 w-3" /> Previous
                        </span>
                        <span className="text-sm font-medium text-white">{prev.title}</span>
                      </Link>
                    )}
                  </div>
                  <div>
                    {next && (
                      <Link
                        to={`/docs/article/${next.slug}`}
                        className="group flex flex-col px-4 py-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/50 hover:bg-slate-900 transition-colors text-right"
                      >
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 inline-flex items-center gap-1 justify-end">
                          Next <ChevronRight className="h-3 w-3" />
                        </span>
                        <span className="text-sm font-medium text-white">{next.title}</span>
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* CTA */}
              <div className="mt-10 relative rounded-2xl p-[1px] bg-gradient-to-br from-violet-500/50 via-fuchsia-400/40 to-cyan-400/50">
                <div className="relative rounded-[15px] p-6 bg-[#0f0f1e] flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Ready to try it out?</p>
                    <p className="text-xs text-slate-400 mt-0.5">Jump straight into the dashboard and start building.</p>
                  </div>
                  <Link
                    to="/agents/new"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-full shadow-lg shadow-fuchsia-500/30"
                  >
                    Start Building <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
