import { useEffect, useState } from 'react';
import { ScrollText, RefreshCw, AlertCircle, Loader2, Search } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { auditApi, type AuditLogEntry } from '@/services/audit.api';

const PRESET_FILTERS: { label: string; resource_type?: string }[] = [
  { label: 'All' },
  { label: 'Integrations', resource_type: 'integrations' },
  { label: 'Tenant', resource_type: 'me' },
  { label: 'Users', resource_type: 'users' },
  { label: 'Roles', resource_type: 'roles' },
];

function methodColor(m: string | null): string {
  switch ((m || '').toUpperCase()) {
    case 'POST': return 'bg-emerald-100 text-emerald-700';
    case 'PUT':  return 'bg-amber-100 text-amber-800';
    case 'PATCH': return 'bg-amber-100 text-amber-800';
    case 'DELETE': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function statusColor(s: number | null): string {
  if (!s) return 'text-gray-500';
  if (s >= 500) return 'text-red-600';
  if (s >= 400) return 'text-amber-600';
  if (s >= 200) return 'text-success-600';
  return 'text-gray-500';
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resourceFilter, setResourceFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await auditApi.list({ limit: 200, resource_type: resourceFilter });
      setEntries(list);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [resourceFilter]);

  const filtered = search.trim()
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        return (
          e.action?.toLowerCase().includes(q) ||
          e.path?.toLowerCase().includes(q) ||
          e.user_email?.toLowerCase().includes(q) ||
          e.ip?.toLowerCase().includes(q) ||
          e.resource_id?.toLowerCase().includes(q)
        );
      })
    : entries;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ScrollText className="h-6 w-6 text-primary-600" /> Audit Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Sensitive admin actions across this tenant — integration credential changes, role updates, settings updates.
          </p>
        </div>
        <Button variant="outline" onClick={reload} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          {PRESET_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setResourceFilter(f.resource_type)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                (resourceFilter || '') === (f.resource_type || '')
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, path, user, IP…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>
      </div>

      <Card padding={false}>
        <CardHeader title={`${filtered.length} events`} subtitle={loading ? 'Loading…' : 'Newest first'} className="px-4 pt-4" />

        {filtered.length === 0 && !loading ? (
          <div className="py-12 text-center text-sm text-gray-400">
            <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No audit events {search || resourceFilter ? 'match this filter' : 'recorded yet'}.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((e) => (
              <div key={e.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div
                  className="flex items-start gap-3 cursor-pointer"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                >
                  <span className={`text-[10px] font-mono font-semibold px-2 py-1 rounded ${methodColor(e.method)}`}>
                    {e.method || '—'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{e.action}</span>
                      <span className={`text-xs font-mono ${statusColor(e.status_code)}`}>{e.status_code || '—'}</span>
                      {e.path && <span className="text-xs font-mono text-gray-400 truncate">{e.path}</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                      <span>{new Date(e.created_at).toLocaleString()}</span>
                      {e.ip && <span className="font-mono">{e.ip}</span>}
                      {e.user_id && <span className="font-mono text-[10px]">user: {e.user_id.slice(0, 8)}…</span>}
                      {e.resource_id && <span className="font-mono text-[10px]">resource: {e.resource_id.slice(0, 8)}…</span>}
                    </div>
                  </div>
                </div>
                {expanded === e.id && (
                  <pre className="mt-2 ml-12 text-[11px] font-mono bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto max-h-72">
{JSON.stringify(e.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {loading && entries.length > 0 && (
        <div className="flex items-center justify-center text-xs text-gray-400">
          <Loader2 className="h-3 w-3 animate-spin mr-1" /> Refreshing…
        </div>
      )}
    </div>
  );
}
