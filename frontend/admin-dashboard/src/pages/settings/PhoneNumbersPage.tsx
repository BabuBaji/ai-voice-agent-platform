import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Plus, Phone, Settings, Puzzle, Users, CreditCard, ScrollText, KeyRound,
  ShoppingCart, Loader2, AlertCircle, CheckCircle2, RefreshCw, Trash2, Search,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { phoneNumberApi, type PhoneNumberRecord, type AvailableNumber } from '@/services/phoneNumber.api';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'API', path: '/settings/api', icon: KeyRound },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
  { label: 'Audit Log', path: '/settings/audit-log', icon: ScrollText },
];

const COUNTRIES = [
  { value: 'US', label: '🇺🇸 United States' },
  { value: 'IN', label: '🇮🇳 India' },
  { value: 'GB', label: '🇬🇧 United Kingdom' },
  { value: 'CA', label: '🇨🇦 Canada' },
  { value: 'AU', label: '🇦🇺 Australia' },
  { value: 'DE', label: '🇩🇪 Germany' },
  { value: 'FR', label: '🇫🇷 France' },
  { value: 'SG', label: '🇸🇬 Singapore' },
];

const providerColor: Record<string, string> = {
  plivo: 'bg-violet-100 text-violet-700',
  twilio: 'bg-red-100 text-red-700',
  exotel: 'bg-emerald-100 text-emerald-700',
};

export function PhoneNumbersPage() {
  // Owned numbers
  const [owned, setOwned] = useState<PhoneNumberRecord[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(true);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  // Browse / buy
  const [country, setCountry] = useState('US');
  const [provider, setProvider] = useState<'plivo' | 'twilio' | 'exotel'>('plivo');
  const [available, setAvailable] = useState<AvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null); // number being purchased
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const reloadOwned = async () => {
    setOwnedLoading(true);
    setOwnedError(null);
    try {
      const list = await phoneNumberApi.list();
      setOwned(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Failed to load numbers');
    } finally {
      setOwnedLoading(false);
    }
  };

  useEffect(() => { reloadOwned(); }, []);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    setBuyMsg(null);
    setHasSearched(true);
    try {
      const list = await phoneNumberApi.listAvailable({ provider, country, capabilities: ['voice'] });
      setAvailable(list);
    } catch (e: any) {
      setSearchError(e?.response?.data?.message || e?.message || 'Search failed');
      setAvailable([]);
    } finally {
      setSearching(false);
    }
  };

  const buy = async (n: AvailableNumber) => {
    setBuying(n.number);
    setBuyMsg(null);
    setSearchError(null);
    try {
      const purchased = await phoneNumberApi.buy({ provider, number: n.number, capabilities: ['voice'] });
      setBuyMsg(`Purchased ${purchased.phone_number}. Carrier may need a few minutes to activate it.`);
      // Remove from available list, refresh owned
      setAvailable((p) => p.filter((x) => x.number !== n.number));
      reloadOwned();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Buy failed';
      setSearchError(msg);
    } finally {
      setBuying(null);
    }
  };

  const release = async (rec: PhoneNumberRecord) => {
    if (!confirm(`Release ${rec.phone_number}? This removes it from your account and the carrier.`)) return;
    try {
      await phoneNumberApi.release(rec.id);
      reloadOwned();
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Release failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="space-y-6">
          {/* ─── Owned numbers ─── */}
          <Card padding={false} className="shadow-card">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Your Phone Numbers</h3>
                <p className="text-sm text-gray-500">Numbers in your account — assign them to agents on the agent's Call Configuration tab.</p>
              </div>
              <Button variant="outline" size="sm" onClick={reloadOwned} disabled={ownedLoading} className="rounded-xl">
                <RefreshCw className={`h-3.5 w-3.5 ${ownedLoading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>

            {ownedError && (
              <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
                <AlertCircle className="h-4 w-4" /> {ownedError}
              </div>
            )}

            {ownedLoading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>
            ) : owned.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                You don't own any numbers yet. Browse below and click <strong>Buy</strong> to add one.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium">Number</th>
                    <th className="text-left px-6 py-3 font-medium">Provider</th>
                    <th className="text-left px-6 py-3 font-medium">Capabilities</th>
                    <th className="text-left px-6 py-3 font-medium">Assigned Agent</th>
                    <th className="text-left px-6 py-3 font-medium">Status</th>
                    <th className="text-right px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {owned.map((n) => (
                    <tr key={n.id} className="border-t border-gray-100">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                            <Phone className="h-4 w-4 text-primary-500" />
                          </div>
                          <span className="font-mono font-medium text-gray-900">{n.phone_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md ${providerColor[n.provider] || 'bg-gray-100 text-gray-700'}`}>
                          {n.provider}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex gap-1">
                          {n.capabilities?.voice && <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                          {n.capabilities?.sms && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">SMS</span>}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm">
                        {n.agent_id
                          ? <span className="text-gray-700 font-medium">{n.agent_id.slice(0, 8)}…</span>
                          : <span className="text-gray-400">Unassigned</span>}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={n.is_active ? 'success' : 'default'}>
                          {n.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button onClick={() => release(n)} className="p-1.5 rounded-md text-gray-400 hover:text-danger-600 hover:bg-danger-50" title="Release number">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* ─── Browse & buy ─── */}
          <Card>
            <div className="flex items-center gap-2 mb-1">
              <ShoppingCart className="h-5 w-5 text-primary-600" />
              <h3 className="text-lg font-semibold text-gray-900">Buy a new number</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Search the carrier's catalog and click Buy on the one you want. Charges go to your provider account ({provider}).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value as any)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
                  <option value="plivo">Plivo</option>
                  <option value="twilio">Twilio</option>
                  <option value="exotel">Exotel</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                <select value={country} onChange={(e) => setCountry(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
                  {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={search} disabled={searching} variant="primary" className="w-full rounded-lg">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Search numbers
                </Button>
              </div>
            </div>

            {buyMsg && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-success-50 border border-success-200 text-sm text-success-700 mb-4">
                <CheckCircle2 className="h-4 w-4" /> {buyMsg}
              </div>
            )}
            {searchError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700 mb-4">
                <AlertCircle className="h-4 w-4" /> {searchError}
              </div>
            )}

            {hasSearched && !searching && available.length === 0 && !searchError && (
              <div className="text-center py-8 text-sm text-gray-400">
                No numbers available from <strong>{provider}</strong> in <strong>{country}</strong> right now.
                Try a different country, or check your provider account is properly verified.
              </div>
            )}

            {available.length > 0 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Number</th>
                      <th className="text-left px-4 py-2 font-medium">Region</th>
                      <th className="text-left px-4 py-2 font-medium">Capabilities</th>
                      <th className="text-right px-4 py-2 font-medium">Monthly</th>
                      <th className="text-right px-4 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {available.map((n) => (
                      <tr key={n.number} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-mono font-medium text-gray-900">{n.number}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{n.region || n.country || '—'}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            {n.capabilities?.includes('voice') && <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                            {n.capabilities?.includes('sms') && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">SMS</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {n.monthlyRate != null ? `$${n.monthlyRate.toFixed(3)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={buying === n.number}
                            onClick={() => buy(n)}
                          >
                            {buying === n.number ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Buy
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-gray-400 mt-3">
              Numbers in some countries (US toll-free, UK, India) require carrier KYC verification before they can place calls.
              Plivo will rent the number immediately but it shows as <code className="bg-gray-100 px-1 rounded">compliance: pending</code> until verification clears (1–3 business days).
            </p>
          </Card>
      </div>
    </div>
  );
}
