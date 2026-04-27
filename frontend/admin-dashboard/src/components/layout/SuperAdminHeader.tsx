import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Building2, User, PhoneCall, Bot } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

const KIND_ICONS: Record<string, any> = {
  tenant: Building2, user: User, call: PhoneCall, agent: Bot,
};

// Header sits above the main content on every super-admin page. Cmd/Ctrl+K
// focuses the search; debounced (250ms) full-text across tenants/users/calls/
// agents — pasting a UUID, email, or phone number jumps to the right page.
export function SuperAdminHeader() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await superAdminApi.search(q.trim());
        setResults(r.results);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const onSelect = (href: string) => {
    setQ('');
    setOpen(false);
    setResults([]);
    navigate(href);
  };

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 h-14 flex items-center gap-4">
      <div className="relative flex-1 max-w-2xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search tenants, users, calls, agents — paste a UUID, email, or phone number…"
          className="w-full pl-9 pr-20 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">⌘K</kbd>
        {q && (
          <button onClick={() => { setQ(''); setResults([]); }} className="absolute right-12 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {open && q.trim().length >= 2 && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl max-h-96 overflow-y-auto z-40">
            {loading ? (
              <div className="p-4 text-xs text-slate-400">Searching…</div>
            ) : results.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">No results for "{q}"</div>
            ) : (
              <ul className="py-1">
                {results.map((r) => {
                  const Icon = KIND_ICONS[r.kind] || Search;
                  return (
                    <li key={`${r.kind}-${r.id}`}>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelect(r.href)}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-amber-50 text-left"
                      >
                        <Icon className="h-4 w-4 text-slate-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-900 truncate">{r.label}</p>
                          <p className="text-[10px] text-slate-500">{r.sub}</p>
                        </div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400">{r.kind}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
