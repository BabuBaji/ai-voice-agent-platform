import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import api from '@/services/api';

const SEV: Record<string, string> = {
  info:     'bg-sky-500 text-white',
  warning:  'bg-amber-500 text-amber-950',
  critical: 'bg-rose-500 text-white',
};

// Renders any active platform-wide broadcasts above the tenant header. Quietly
// no-ops if the endpoint isn't reachable. Dismissals are stored in
// sessionStorage so they reappear next session — for "I read it once" UX.
export function BroadcastBanner() {
  const [items, setItems] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('va-broadcast-dismissed') || '[]')); } catch { return new Set(); }
  });

  useEffect(() => {
    api.get('/broadcasts/active').then((r) => setItems(r.data?.data || [])).catch(() => {});
  }, []);

  const dismiss = (id: string) => {
    const next = new Set(dismissed); next.add(id); setDismissed(next);
    sessionStorage.setItem('va-broadcast-dismissed', JSON.stringify(Array.from(next)));
  };

  const visible = items.filter((b) => !dismissed.has(b.id));
  if (!visible.length) return null;

  return (
    <>
      {visible.map((b) => (
        <div key={b.id} className={`px-4 py-2 flex items-center gap-3 ${SEV[b.severity] || SEV.info}`}>
          <Megaphone className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm flex-1">{b.message}</p>
          <button onClick={() => dismiss(b.id)} className="hover:opacity-70" title="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </>
  );
}
