import { NavLink } from 'react-router-dom';
import {
  Settings, Phone, Puzzle, Users, CreditCard, ExternalLink, Search,
  CheckCircle2, AlertCircle, Loader2, Trash2, X, KeyRound, ScrollText,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { integrationApi, type Integration } from '@/services/integration.api';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'API', path: '/settings/api', icon: KeyRound },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
  { label: 'Audit Log', path: '/settings/audit-log', icon: ScrollText },
];

export function IntegrationsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await integrationApi.list();
      setIntegrations(list);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  const categories = useMemo(
    () => [...new Set(integrations.map((i) => i.category))],
    [integrations]
  );

  const filtered = useMemo(() => integrations.filter((i) => {
    const matchSearch = i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchSearch && matchCategory;
  }), [integrations, search, categoryFilter]);

  const handleDisconnect = async (provider: string) => {
    if (!confirm(`Disconnect ${provider}?`)) return;
    try {
      await integrationApi.disconnect(provider);
      setFlash({ type: 'success', text: 'Disconnected.' });
      await fetchList();
    } catch (e: any) {
      setFlash({ type: 'error', text: e?.response?.data?.message || 'Failed to disconnect' });
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Integrations</h3>
              <p className="text-sm text-gray-500">Connect external services to enhance your platform</p>
            </div>
          </div>

          {flash && (
            <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium animate-slide-down ${
              flash.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {flash.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {flash.text}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search integrations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((integration) => (
                <div
                  key={integration.provider}
                  className={`bg-white rounded-xl border p-5 transition-all duration-200 hover:shadow-card-hover group ${
                    integration.connected ? 'border-success-200' : 'border-gray-100 shadow-card'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${integration.color} text-white flex items-center justify-center text-xs font-bold`}>
                        {integration.icon}
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900 text-sm">{integration.name}</h4>
                        <span className="text-xs text-gray-400">{integration.category}</span>
                      </div>
                    </div>
                    {integration.connected && <Badge variant="success" dot>Connected</Badge>}
                  </div>
                  <p className="text-sm text-gray-500 mb-4">{integration.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        variant={integration.connected ? 'outline' : 'primary'}
                        size="sm"
                        className="rounded-lg"
                        onClick={() => setEditing(integration)}
                      >
                        {integration.connected ? 'Configure' : 'Connect'}
                      </Button>
                      {integration.connected && (
                        <button
                          onClick={() => handleDisconnect(integration.provider)}
                          className="p-1.5 text-gray-400 hover:text-danger-600 rounded-lg hover:bg-danger-50 transition-colors"
                          title="Disconnect"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {integration.docs && (
                      <a
                        href={integration.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gray-400 hover:text-primary-600 flex items-center gap-1 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Docs
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {editing && (
        <ConfigureModal
          integration={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setFlash({ type: 'success', text: 'Integration saved.' });
            await fetchList();
          }}
          onError={(msg) => setFlash({ type: 'error', text: msg })}
        />
      )}
    </div>
  );
}

// --- Configure / connect modal ---

interface ConfigureModalProps {
  integration: Integration;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

function ConfigureModal({ integration, onClose, onSaved, onError }: ConfigureModalProps) {
  const initialConfig: Record<string, string> = {};
  const initialCreds: Record<string, string> = {};
  integration.fields.forEach((f) => {
    if (f.credential) {
      initialCreds[f.key] = '';
    } else {
      initialConfig[f.key] = integration.config?.[f.key] ?? '';
    }
  });

  const [config, setConfig] = useState(initialConfig);
  const [credentials, setCredentials] = useState(initialCreds);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'ok' | 'error'; message: string } | null>(
    integration.test_status ? { status: integration.test_status, message: integration.test_message || '' } : null
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await integrationApi.save(integration.provider, { config, credentials, enabled: true });
      onSaved();
    } catch (e: any) {
      onError(e?.response?.data?.message || e?.response?.data?.error || 'Failed to save');
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first so test uses latest creds
      await integrationApi.save(integration.provider, { config, credentials, enabled: true });
      const result = await integrationApi.test(integration.provider);
      setTestResult({ status: result.status, message: result.message });
    } catch (e: any) {
      setTestResult({ status: 'error', message: e?.response?.data?.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="" size="md">
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${integration.color} text-white flex items-center justify-center text-xs font-bold`}>
              {integration.icon}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{integration.name}</h3>
              <p className="text-xs text-gray-500">{integration.category}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-gray-500">{integration.description}</p>

        {integration.connected && Object.keys(integration.credentials_preview).length > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1">
            <p className="font-medium text-gray-700 mb-1">Current credentials:</p>
            {Object.entries(integration.credentials_preview).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="font-mono">{k}</span>
                <span className="font-mono">{v}</span>
              </div>
            ))}
            <p className="text-[10px] text-gray-400 mt-2">Leave a credential field blank to keep the current value.</p>
          </div>
        )}

        <div className="space-y-4">
          {integration.fields.map((f) => {
            const isCredential = !!f.credential;
            const value = isCredential ? credentials[f.key] ?? '' : config[f.key] ?? '';
            return (
              <Input
                key={f.key}
                label={f.label + (f.required ? ' *' : '')}
                type={f.type}
                value={value}
                placeholder={f.placeholder || (isCredential && integration.connected ? 'Leave blank to keep current' : '')}
                onChange={(e) => {
                  if (isCredential) {
                    setCredentials((prev) => ({ ...prev, [f.key]: e.target.value }));
                  } else {
                    setConfig((prev) => ({ ...prev, [f.key]: e.target.value }));
                  }
                }}
              />
            );
          })}
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${
            testResult.status === 'ok'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {testResult.status === 'ok' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
            <span>{testResult.message}</span>
          </div>
        )}

        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          ⚠️ Credentials are stored in the database. In production these should be encrypted at rest / moved to a secret manager.
        </p>

        <div className="flex items-center justify-between pt-2 gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            loading={testing}
            disabled={saving || testing}
            className="rounded-xl"
          >
            Test Connection
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving || testing} className="rounded-xl">
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={handleSave}
              loading={saving}
              disabled={saving || testing}
              className="rounded-xl"
            >
              {integration.connected ? 'Save Changes' : 'Connect'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
