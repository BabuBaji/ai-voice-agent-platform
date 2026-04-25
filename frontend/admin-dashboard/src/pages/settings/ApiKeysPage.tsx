import { useEffect, useMemo, useState } from 'react';
import {
  KeyRound, Plus, Eye, EyeOff, Copy, Check, Trash2, AlertCircle, Loader2,
  ExternalLink, FileText, Github,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { apiKeyApi, type ApiKey, type CreatedApiKey } from '@/services/apiKey.api';

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ApiKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [copiedPlain, setCopiedPlain] = useState(false);

  async function fetchList() {
    setLoading(true);
    try {
      setKeys(await apiKeyApi.list());
    } catch (e: any) {
      toast.addToast(e?.response?.data?.error || 'Failed to load API keys', 'error');
    } finally { setLoading(false); }
  }
  useEffect(() => { fetchList(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await apiKeyApi.create(newName.trim());
      setJustCreated(created);
      setNewName('');
      setShowCreate(false);
      await fetchList();
    } catch (e: any) {
      toast.addToast(e?.response?.data?.error || 'Failed to create API key', 'error');
    } finally { setCreating(false); }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Delete API key "${name}"? Any services using it will stop working immediately.`)) return;
    try {
      await apiKeyApi.revoke(id);
      await fetchList();
      toast.addToast('Key deleted', 'success');
    } catch (e: any) {
      toast.addToast(e?.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  async function copyToClipboard(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  }

  async function copyPlain() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.key);
      setCopiedPlain(true);
      setTimeout(() => setCopiedPlain(false), 1500);
    } catch {}
  }

  const sorted = useMemo(
    () => [...keys].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [keys],
  );

  return (
    <div className="-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-white dark:bg-gradient-to-br dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 transition-colors">
      <div className="max-w-4xl mx-auto p-6 lg:p-10 space-y-6">
        {/* API Keys card */}
        <div className="rounded-2xl bg-white dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/80 overflow-hidden transition-colors">
          <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-start gap-3 min-w-0">
              <KeyRound className="h-5 w-5 text-cyan-600 dark:text-cyan-300 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">API Keys</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Create and manage API keys for different integrations</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold bg-cyan-500/90 hover:bg-cyan-400 text-gray-950 transition-colors flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
              Add New Key
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading API keys…
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-16 px-6">
              <KeyRound className="h-10 w-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No API keys yet</p>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Create your first key to start making authenticated requests to the platform API.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold bg-cyan-500/90 hover:bg-cyan-400 text-gray-950 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add New Key
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left font-medium px-6 py-3">Name</th>
                    <th className="text-left font-medium px-6 py-3">API Key</th>
                    <th className="text-left font-medium px-6 py-3">Created</th>
                    <th className="text-right font-medium px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((k) => (
                    <tr key={k.id} className="border-t border-gray-100 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors">
                      <td className="px-6 py-4 text-gray-900 dark:text-white font-medium">{k.name}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 max-w-md">
                          <code className="flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950/60 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-lg">
                            {revealed[k.id]
                              ? `${k.key_preview}${'•'.repeat(30)}`
                              : '•'.repeat(40)}
                          </code>
                          <button
                            onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))}
                            className="p-1.5 text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            title={revealed[k.id] ? 'Hide' : 'Show preview'}
                          >
                            {revealed[k.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => copyToClipboard(k.key_preview, k.id)}
                            className="p-1.5 text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            title="Copy preview"
                          >
                            {copiedId === k.id
                              ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                              : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtRelative(k.created_at)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleRevoke(k.id, k.name)}
                          title="Delete key"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* API Documentation card */}
        <div className="rounded-2xl bg-white dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/80 p-6 transition-colors">
          <div className="flex items-start gap-3 mb-3">
            <FileText className="h-5 w-5 text-cyan-600 dark:text-cyan-300 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">API Documentation</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Learn how to integrate with our API</p>
            </div>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mt-4 mb-5">
            Our API allows you to programmatically create and manage voice AI agents, access call logs, and more.
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              href="/docs"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 transition-colors"
            >
              <FileText className="h-4 w-4" />
              Visit Docs
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
            <a
              href="https://github.com/anthropics/anthropic-sdk-typescript"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 transition-colors"
            >
              <Github className="h-4 w-4" />
              Visit SDK on Github
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => !creating && setShowCreate(false)} title="Add new API key" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Give your key a descriptive name so you can recognize it later (e.g. "Production server", "Zapier").
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Key name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My integration"
              autoFocus
              disabled={creating}
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) handleCreate(); }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={() => setShowCreate(false)} disabled={creating} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg text-sm font-semibold bg-cyan-500 text-white hover:bg-cyan-400 disabled:opacity-50"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create key
            </button>
          </div>
        </div>
      </Modal>

      {/* One-time plaintext reveal modal */}
      <Modal isOpen={!!justCreated} onClose={() => setJustCreated(null)} title="Your new API key" size="md">
        <div className="space-y-4">
          <div className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Copy this key now — you won't see it again.</p>
              <p className="mt-1 text-amber-800/80">
                After closing this dialog, only the masked preview will be shown.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">API Key</label>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 font-mono text-xs text-gray-800 bg-gray-100 px-3 py-2.5 rounded-lg break-all">
                {justCreated?.key}
              </code>
              <button
                onClick={copyPlain}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {copiedPlain
                  ? <><Check className="h-4 w-4 text-emerald-600" /> Copied</>
                  : <><Copy className="h-4 w-4" /> Copy</>}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => setJustCreated(null)} className="h-10 px-5 rounded-lg text-sm font-semibold bg-cyan-500 text-white hover:bg-cyan-400">
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
