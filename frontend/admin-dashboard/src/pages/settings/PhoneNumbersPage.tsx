import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Phone, ShoppingCart, Loader2, AlertCircle, CheckCircle2, RefreshCw, Trash2,
  Download, X, Rocket, PhoneOutgoing, ShieldCheck, Network, Pause, Play,
  Filter, Globe, MessageSquare, MessageCircle, FileText, ScrollText, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  phoneNumberApi,
  type PhoneNumberRecord,
  type AvailableNumber,
  type KycSession,
  type KycRecord,
  type AuditEntry,
} from '@/services/phoneNumber.api';
import { PurchaseNumberModal } from '@/components/settings/PurchaseNumberModal';
import { InstantKycWizard } from '@/components/settings/InstantKycWizard';
import { AttachAgentModal } from '@/components/settings/AttachAgentModal';
import { DeployConfirmModal } from '@/components/settings/DeployConfirmModal';
import { TestCallModal } from '@/components/settings/TestCallModal';
import { VerifyNumberModal } from '@/components/settings/VerifyNumberModal';
import { RouteConfigModal } from '@/components/settings/RouteConfigModal';
import api from '@/services/api';

interface CarrierStatus {
  carrier_active: boolean | null;
  compliance_status: string;
  message?: string;
  monthly_rental_rate?: string | null;
  renewal_date?: string | null;
  region?: string | null;
}

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
  sandbox: 'bg-amber-100 text-amber-700',
};

type TabId = 'mine' | 'buy' | 'import' | 'kyc' | 'routing' | 'deployment';

const TABS: { id: TabId; label: string; icon: any; subtitle: string }[] = [
  { id: 'mine', label: 'My Numbers', icon: Phone, subtitle: 'Numbers you own + their live status' },
  { id: 'buy', label: 'Buy Number', icon: ShoppingCart, subtitle: 'Search the carrier catalog and purchase' },
  { id: 'import', label: 'Import Number', icon: Download, subtitle: 'Bring an existing carrier number into this account' },
  { id: 'kyc', label: 'KYC', icon: ShieldCheck, subtitle: 'Carrier identity & business verification' },
  { id: 'routing', label: 'Call Routing', icon: Network, subtitle: 'Hours · failover · IVR · spam/DND · geo' },
  { id: 'deployment', label: 'Deployment', icon: Rocket, subtitle: 'Snapshot history · audit log per number' },
];

export function PhoneNumbersPage() {
  const [activeTab, setActiveTab] = useState<TabId>('mine');

  // Owned numbers
  const [owned, setOwned] = useState<PhoneNumberRecord[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(true);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  // Browse & buy filters. Default to Plivo + IN since that's the carrier we
  // primarily ship on; the user can broaden to "all carriers" explicitly.
  const [country, setCountry] = useState('IN');
  const [filterTollFree, setFilterTollFree] = useState<'any' | 'local' | 'tollfree'>('any');
  const [filterVoice, setFilterVoice] = useState(true);
  const [filterSms, setFilterSms] = useState(false);
  const [filterWhatsapp, setFilterWhatsapp] = useState(false);
  const [filterProvider, setFilterProvider] = useState<'any' | 'plivo' | 'twilio' | 'exotel'>('plivo');
  const [available, setAvailable] = useState<AvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 3-stage purchase flow modals
  const [purchaseTarget, setPurchaseTarget] = useState<AvailableNumber | null>(null);
  const [kycSession, setKycSession] = useState<KycSession | null>(null);
  const [attachTarget, setAttachTarget] = useState<PhoneNumberRecord | null>(null);
  const [deployTarget, setDeployTarget] = useState<PhoneNumberRecord | null>(null);
  const [testCallTarget, setTestCallTarget] = useState<PhoneNumberRecord | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<PhoneNumberRecord | null>(null);
  const [routeTarget, setRouteTarget] = useState<PhoneNumberRecord | null>(null);
  const [carrierStatus, setCarrierStatus] = useState<Record<string, CarrierStatus>>({});
  // Numbers currently auto-verifying after purchase. Drives the small spinner
  // shown next to the row Status badge so the user knows verification's running.
  const [autoVerifying, setAutoVerifying] = useState<Record<string, boolean>>({});

  // Import-existing-number tab state (was modal; now inline tab)
  const [importProvider, setImportProvider] = useState<'plivo' | 'twilio' | 'exotel' | 'sip'>('plivo');
  const [importNumber, setImportNumber] = useState('');
  const [importSid, setImportSid] = useState('');
  const [importVoice, setImportVoice] = useState(true);
  const [importSms, setImportSms] = useState(false);
  // Provider-specific credential fields (sent for validation, not stored
  // unless valid). Populated only when the user picks a non-Plivo carrier.
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [exotelApiKey, setExotelApiKey] = useState('');
  const [exotelApiToken, setExotelApiToken] = useState('');
  const [exotelSubdomain, setExotelSubdomain] = useState('api.exotel.com');
  const [exotelAccountSid, setExotelAccountSid] = useState('');
  const [sipUri, setSipUri] = useState('');
  const [sipUsername, setSipUsername] = useState('');
  const [sipPassword, setSipPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // KYC tab data
  const [kycSummary, setKycSummary] = useState<KycRecord | null>(null);
  const [kycLoading, setKycLoading] = useState(false);

  // Wallet — shown in Buy tab
  const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);

  // Deployment tab data — audit log + snapshot history per number
  const [deploymentNumberId, setDeploymentNumberId] = useState<string | null>(null);
  const [deploymentAudit, setDeploymentAudit] = useState<AuditEntry[]>([]);
  const [deploymentHistory, setDeploymentHistory] = useState<any[]>([]);
  const [deploymentLoading, setDeploymentLoading] = useState(false);

  // Per-number 30-day usage map (best-effort: counted client-side from /calls)
  const [usage, setUsage] = useState<Record<string, { calls_30d: number; last_call_at: string | null }>>({});

  const reloadOwned = async () => {
    setOwnedLoading(true);
    setOwnedError(null);
    try {
      const list = await phoneNumberApi.list();
      const arr = Array.isArray(list) ? list : [];
      setOwned(arr);
      // Fan out carrier-status fetches in the background.
      arr.forEach((n) => {
        api.get(`/phone-numbers/${n.id}/carrier-status`)
          .then((r) => {
            const data = r.data?.data ?? r.data;
            setCarrierStatus((prev) => ({ ...prev, [n.id]: data }));
          })
          .catch(() => { /* leave the badge as 'checking' */ });
      });
      // Fetch 30-day usage per number (one call to /calls, group locally).
      try {
        const r = await api.get('/calls?limit=200');
        const rows: any[] = r.data?.data ?? [];
        const byNum: Record<string, { calls_30d: number; last_call_at: string | null }> = {};
        const since = Date.now() - 30 * 24 * 3600_000;
        for (const c of rows) {
          if (!c.started_at && !c.created_at) continue;
          const t = new Date(c.started_at || c.created_at).getTime();
          if (t < since) continue;
          for (const num of arr) {
            if (c.caller_number === num.phone_number || c.called_number === num.phone_number) {
              const k = num.id;
              if (!byNum[k]) byNum[k] = { calls_30d: 0, last_call_at: null };
              byNum[k].calls_30d += 1;
              const ts = c.started_at || c.created_at;
              if (!byNum[k].last_call_at || ts > byNum[k].last_call_at) byNum[k].last_call_at = ts;
            }
          }
        }
        setUsage(byNum);
      } catch { /* non-fatal */ }
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Failed to load numbers');
    } finally {
      setOwnedLoading(false);
    }
  };

  useEffect(() => { reloadOwned(); }, []);
  // Re-run the catalog search whenever the user lands on Buy or changes a
  // filter — keeps the result list in sync with the carrier/country/caps
  // selection. Without this, swapping country wouldn't refresh the list
  // until the user manually clicked Search.
  useEffect(() => {
    if (activeTab !== 'buy') return;
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, country, filterProvider, filterVoice, filterSms, filterTollFree]);

  // Lazy-load wallet balance when Buy tab opens
  useEffect(() => {
    if (activeTab !== 'buy') return;
    api.get('/billing/wallet').then((r) => {
      const d = r.data?.data ?? r.data;
      setWallet({ balance: Number(d?.balance) || 0, currency: d?.currency || 'INR' });
    }).catch(() => setWallet(null));
  }, [activeTab]);

  // Lazy-load KYC summary when KYC tab opens
  useEffect(() => {
    if (activeTab !== 'kyc') return;
    setKycLoading(true);
    phoneNumberApi.getKyc('plivo')
      .then((rec) => setKycSummary(rec))
      .catch(() => setKycSummary(null))
      .finally(() => setKycLoading(false));
  }, [activeTab]);

  // Lazy-load deployment audit when a number is selected on Deployment tab
  useEffect(() => {
    if (!deploymentNumberId) return;
    setDeploymentLoading(true);
    Promise.all([
      phoneNumberApi.getAudit(deploymentNumberId).catch(() => []),
      phoneNumberApi.getDeploymentHistory(deploymentNumberId).catch(() => []),
    ])
      .then(([audit, hist]) => {
        setDeploymentAudit(audit);
        setDeploymentHistory(hist);
      })
      .finally(() => setDeploymentLoading(false));
  }, [deploymentNumberId]);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    setSearchInfo(null);
    setBuyMsg(null);
    setHasSearched(true);
    try {
      const caps: ('voice' | 'sms')[] = [];
      if (filterVoice) caps.push('voice');
      if (filterSms) caps.push('sms');
      if (caps.length === 0) caps.push('voice');
      // Single-carrier endpoint when a specific provider is chosen — returns
      // only that carrier's catalog (no merge). Falls back to /available-all
      // for the explicit "Any" filter.
      let rows: AvailableNumber[] = [];
      let info: string | undefined;
      if (filterProvider === 'any') {
        const r = await phoneNumberApi.listAvailableAll({ country, capabilities: caps });
        rows = r.data;
        info = r.message;
      } else {
        const r = await phoneNumberApi.listAvailable({ provider: filterProvider, country, capabilities: caps, numberType: filterTollFree === 'any' ? undefined : filterTollFree });
        rows = (r.data || []).map((row) => ({ ...row, provider: row.provider || filterProvider }));
        info = r.message;
      }
      setAvailable(rows);
      if (info) setSearchInfo(info);
    } catch (e: any) {
      setSearchError(e?.response?.data?.message || e?.message || 'Search failed');
      setAvailable([]);
    } finally {
      setSearching(false);
    }
  };

  const filteredAvailable = useMemo(() => {
    return available.filter((n) => {
      if (filterProvider !== 'any' && (n.provider || '').toLowerCase() !== filterProvider) return false;
      if (filterTollFree !== 'any') {
        // Plivo + Twilio mark toll-free in their region/type fields. Heuristic:
        // US toll-free numbers start with +1 800/833/844/855/866/877/888.
        const num = n.number.replace(/[^\d]/g, '');
        const isTollFree = /^1(800|833|844|855|866|877|888)/.test(num);
        if (filterTollFree === 'tollfree' && !isTollFree) return false;
        if (filterTollFree === 'local' && isTollFree) return false;
      }
      return true;
    });
  }, [available, filterProvider, filterTollFree]);

  const buy = (n: AvailableNumber) => {
    setBuyMsg(null);
    setSearchError(null);
    setPurchaseTarget(n);
  };

  const onReserved = (session: KycSession) => {
    setPurchaseTarget(null);
    setKycSession(session);
  };

  const onWizardCompleted = (rec: PhoneNumberRecord) => {
    const number = rec.phone_number;
    setBuyMsg(`Purchased ${number}. Auto-verifying… then attach an agent to take live calls.`);
    setAvailable((p) => p.filter((x) => x.number !== number && '+' + x.number.replace(/^\+/, '') !== number));
    setKycSession(null);
    setActiveTab('mine');
    reloadOwned();
    // Kick off auto-verify in the background so the row shows "Verified ✓"
    // by the time the user clicks Attach Agent. No modal — silent.
    setAutoVerifying((m) => ({ ...m, [rec.id]: true }));
    phoneNumberApi.verify(rec.id)
      .catch(() => { /* surfaced to the user via the row badge */ })
      .finally(() => {
        setAutoVerifying((m) => { const next = { ...m }; delete next[rec.id]; return next; });
        reloadOwned();
      });
    // Open the Attach modal so the user closes the loop in one flow.
    setTimeout(() => setAttachTarget(rec), 300);
  };

  const onAttached = (rec: PhoneNumberRecord) => {
    setAttachTarget(null);
    setBuyMsg(`Attached ${rec.phone_number} → agent ${rec.agent_id?.slice(0, 8)}…. Click Deploy on the row to take it live.`);
    reloadOwned();
    // Open the Deploy modal so the user closes the full purchase→attach→deploy
    // loop in one continuous flow (matching the OmniDim-style spec).
    setTimeout(() => setDeployTarget(rec), 300);
  };

  const onDeployed = (rec: PhoneNumberRecord) => {
    setBuyMsg(`Deployed ${rec.phone_number} — runtime activated. Number now routes inbound calls to the assigned agent. Click Test on the row to verify outbound.`);
    setDeployTarget(null);
    reloadOwned();
  };

  const submitImport = async () => {
    setImporting(true);
    setImportError(null);
    setImportMsg(null);
    try {
      const caps: ('voice' | 'sms')[] = [];
      if (importVoice) caps.push('voice');
      if (importSms) caps.push('sms');
      if (caps.length === 0) caps.push('voice');
      if (importProvider === 'sip') {
        if (!sipUri.trim()) {
          setImportError('Enter the SIP URI (e.g. sip:user@trunk.example.com).');
          setImporting(false);
          return;
        }
        // SIP rides on Plivo provider so existing inbound webhook works; the
        // SIP trunk creds are stashed in metadata for trunk-level routing.
        await phoneNumberApi.importExisting({
          provider: 'plivo',
          phone_number: importNumber.trim(),
          provider_sid: importSid.trim() || sipUri.trim(),
          capabilities: caps,
          sip_uri: sipUri.trim(),
          sip_username: sipUsername.trim() || undefined,
          sip_password: sipPassword || undefined,
        });
      } else {
        await phoneNumberApi.importExisting({
          provider: importProvider,
          phone_number: importNumber.trim(),
          provider_sid: importSid.trim() || undefined,
          capabilities: caps,
          twilio_account_sid: importProvider === 'twilio' ? (twilioAccountSid.trim() || undefined) : undefined,
          twilio_auth_token: importProvider === 'twilio' ? (twilioAuthToken.trim() || undefined) : undefined,
          exotel_api_key: importProvider === 'exotel' ? (exotelApiKey.trim() || undefined) : undefined,
          exotel_api_token: importProvider === 'exotel' ? (exotelApiToken.trim() || undefined) : undefined,
          exotel_subdomain: importProvider === 'exotel' ? (exotelSubdomain.trim() || undefined) : undefined,
          exotel_account_sid: importProvider === 'exotel' ? (exotelAccountSid.trim() || undefined) : undefined,
        });
      }
      setImportMsg(`Imported ${importNumber.trim()} — go to My Numbers to verify and deploy.`);
      setImportNumber('');
      setImportSid('');
      reloadOwned();
    } catch (e: any) {
      setImportError(e?.response?.data?.message || e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const pauseNumber = async (rec: PhoneNumberRecord) => {
    try {
      await phoneNumberApi.pause(rec.id);
      reloadOwned();
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Pause failed');
    }
  };

  const resumeNumber = async (rec: PhoneNumberRecord) => {
    try {
      await phoneNumberApi.resume(rec.id);
      reloadOwned();
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Resume failed');
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

  const deployedNumbers = useMemo(() => owned.filter((n) => n.deployment_status === 'deployed'), [owned]);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header — tighter, single-row */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-gray-900 flex items-center gap-2 leading-tight">
            <Phone className="h-4 w-4 text-primary-600" /> Phone Numbers
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Buy, import, verify, deploy, and route phone numbers across carriers.
          </p>
        </div>
      </div>

      {/* Tabs — tighter button padding, subtitle inlined into a thinner strip */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-3 overflow-x-auto">
        <nav className="flex">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition whitespace-nowrap ${
                  active
                    ? 'border-primary-600 text-primary-700 bg-primary-50/30'
                    : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-1.5 text-[11px] text-gray-500 border-t border-gray-100 bg-gray-50/40">
          {TABS.find((t) => t.id === activeTab)?.subtitle}
        </div>
      </div>

      {/* My Numbers */}
      {activeTab === 'mine' && (
        <Card padding={false} className="shadow-card">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 leading-tight">Your Phone Numbers</h3>
              <p className="text-[11px] text-gray-500">Provider, agent, deployment status, and 30-day usage at a glance.</p>
            </div>
            <Button variant="outline" size="sm" onClick={reloadOwned} disabled={ownedLoading} className="rounded-lg">
              <RefreshCw className={`h-3.5 w-3.5 ${ownedLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
          {ownedError && (
            <div className="mx-4 mt-2 flex items-center gap-2 p-2 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
              <AlertCircle className="h-3.5 w-3.5" /> {ownedError}
            </div>
          )}
          {ownedLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /></div>
          ) : owned.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">
              <Phone className="h-7 w-7 mx-auto mb-1.5 opacity-30" />
              You don't own any numbers yet. Open the <strong>Buy Number</strong> tab to get one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Number</th>
                    <th className="text-left px-3 py-2 font-medium">Provider</th>
                    <th className="text-left px-3 py-2 font-medium">Capabilities</th>
                    <th className="text-center px-3 py-2 font-medium">Inbound</th>
                    <th className="text-center px-3 py-2 font-medium">Outbound</th>
                    <th className="text-left px-3 py-2 font-medium">Agent</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Carrier</th>
                    <th className="text-right px-3 py-2 font-medium">$ / mo</th>
                    <th className="text-left px-3 py-2 font-medium">Renewal</th>
                    <th className="text-right px-3 py-2 font-medium">30d calls</th>
                    <th className="text-right px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {owned.map((n) => {
                    const cs = carrierStatus[n.id];
                    const status = (n.deployment_status || (n.agent_id && n.is_active ? 'deployed' : 'draft')) as string;
                    const u = usage[n.id];
                    return (
                      <tr key={n.id} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-md bg-primary-50 flex items-center justify-center flex-shrink-0">
                              <Phone className="h-3.5 w-3.5 text-primary-500" />
                            </div>
                            <span className="font-mono font-medium text-gray-900 text-sm">{n.phone_number}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${providerColor[n.provider] || 'bg-gray-100 text-gray-700'}`}>{n.provider}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 flex-wrap">
                            {n.capabilities?.voice && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                            {n.capabilities?.voice && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Web</span>}
                            {n.capabilities?.sms && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">SMS</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <InboundToggle
                            enabled={n.inbound_enabled !== false}
                            numberId={n.id}
                            onToggled={(v) => setOwned((prev) => prev.map((x) => x.id === n.id ? { ...x, inbound_enabled: v } : x))}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <OutboundToggle
                            enabled={n.outbound_enabled !== false}
                            numberId={n.id}
                            onToggled={(v) => setOwned((prev) => prev.map((x) => x.id === n.id ? { ...x, outbound_enabled: v } : x))}
                          />
                        </td>
                        <td className="px-3 py-2 text-sm">
                          {n.agent_id ? (
                            <span className="text-gray-700 font-medium font-mono text-xs">{n.agent_id.slice(0, 8)}…</span>
                          ) : <span className="text-gray-400 text-xs">Unassigned</span>}
                        </td>
                        <td className="px-3 py-2"><DeploymentBadge status={status} lastVerifiedAt={n.last_verified_at} /></td>
                        <td className="px-3 py-2"><CarrierBadge cs={cs} /></td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-gray-700 tabular-nums">
                          {cs?.monthly_rental_rate ? `$${parseFloat(cs.monthly_rental_rate).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">
                          {cs?.renewal_date ? new Date(cs.renewal_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">
                          {u?.calls_30d != null ? <span className="font-medium text-gray-900 tabular-nums">{u.calls_30d}</span> : <span className="text-gray-400">0</span>}
                          {u?.last_call_at && (
                            <div className="text-[10px] text-gray-400">last {new Date(u.last_call_at).toLocaleDateString()}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <RowActions
                            n={n}
                            status={status}
                            verifying={!!autoVerifying[n.id]}
                            onVerify={() => setVerifyTarget(n)}
                            onAttach={() => setAttachTarget(n)}
                            onDeploy={() => setDeployTarget(n)}
                            onRoute={() => setRouteTarget(n)}
                            onTest={() => setTestCallTarget(n)}
                            onPause={() => pauseNumber(n)}
                            onResume={() => resumeNumber(n)}
                            onRelease={() => release(n)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Buy Number */}
      {activeTab === 'buy' && (
        <div className="space-y-3">
          <Card padding={false} className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="h-3.5 w-3.5 text-primary-600" />
              <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 inline-flex items-center gap-1"><Globe className="h-3 w-3" />Country</label>
                <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
                  {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Number type</label>
                <select value={filterTollFree} onChange={(e) => setFilterTollFree(e.target.value as any)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
                  <option value="any">Any</option>
                  <option value="local">Local only</option>
                  <option value="tollfree">Toll-free only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
                <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value as any)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
                  <option value="any">All carriers</option>
                  <option value="plivo">Plivo</option>
                  <option value="twilio">Twilio</option>
                  <option value="exotel">Exotel</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Capabilities</label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={filterVoice} onChange={(e) => setFilterVoice(e.target.checked)} className="accent-primary-600" />
                    <Phone className="h-3 w-3" /> Voice
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={filterSms} onChange={(e) => setFilterSms(e.target.checked)} className="accent-primary-600" />
                    <MessageSquare className="h-3 w-3" /> SMS
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-gray-400" title="WhatsApp via carrier API — coming soon">
                    <input type="checkbox" checked={filterWhatsapp} onChange={(e) => setFilterWhatsapp(e.target.checked)} className="accent-primary-600" disabled />
                    <MessageCircle className="h-3 w-3" /> WhatsApp
                  </label>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end pt-2">
              <Button variant="primary" size="sm" onClick={search} disabled={searching} className="rounded-lg">
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Search
              </Button>
            </div>
          </Card>

          <Card padding={false} className="p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-gray-900">Available numbers</h3>
              </div>
              {wallet && (
                <div className={`text-[11px] px-2.5 py-1 rounded-lg border ${wallet.balance > 100 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                  Wallet: <span className="font-mono font-bold">{wallet.currency} {wallet.balance.toFixed(2)}</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mb-2">
              Carrier picked automatically from inventory. Wallet is debited on purchase; KYC kicks off if not yet completed.
            </p>

            {buyMsg && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-success-50 border border-success-200 text-xs text-success-700 mb-2">
                <CheckCircle2 className="h-3.5 w-3.5" /> {buyMsg}
              </div>
            )}
            {searchError && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700 mb-2">
                <AlertCircle className="h-3.5 w-3.5" /> {searchError}
              </div>
            )}
            {searchInfo && (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 mb-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{searchInfo}</span>
              </div>
            )}

            {hasSearched && !searching && filteredAvailable.length === 0 && !searchError && (
              <div className="text-center py-4 text-sm text-gray-500">
                No numbers match these filters. Loosen filters, switch country, or use <strong>Import Number</strong>.
              </div>
            )}

            {filteredAvailable.length > 0 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Number</th>
                      <th className="text-left px-4 py-2 font-medium">Provider</th>
                      <th className="text-left px-4 py-2 font-medium">Capabilities</th>
                      <th className="text-right px-4 py-2 font-medium">Monthly cost</th>
                      <th className="text-right px-4 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAvailable.map((n) => (
                      <tr key={`${n.provider}-${n.number}`} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-gray-900">{n.number}</span>
                            {n.synthetic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold uppercase tracking-wider">Sandbox</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md ${providerColor[n.provider || ''] || 'bg-gray-100 text-gray-700'}`}>{n.provider || '—'}</span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 flex-wrap">
                            {n.capabilities?.includes('voice') && <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                            {n.capabilities?.includes('voice') && <span className="text-[11px] px-2 py-0.5 rounded bg-purple-100 text-purple-700">Web</span>}
                            {n.capabilities?.includes('sms') && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">SMS</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {n.monthlyRate != null ? `$${n.monthlyRate.toFixed(3)} / mo` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button variant="primary" size="sm" disabled={buying === n.number} onClick={() => buy(n)}>
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
          </Card>
        </div>
      )}

      {/* Import Number */}
      {activeTab === 'import' && (
        <Card padding={false} className="p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Download className="h-4 w-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-gray-900">Import an existing number</h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Bring a number you already own at Plivo, Twilio, Exotel, or a SIP trunk. Provider credentials are validated before storing.
          </p>

          <div className="space-y-3 max-w-2xl">
            {importError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}
            {importMsg && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-success-50 border border-success-200 text-sm text-success-700">
                <CheckCircle2 className="h-4 w-4" /> {importMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Carrier</label>
              <div className="grid grid-cols-4 gap-2">
                {(['plivo', 'twilio', 'exotel', 'sip'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setImportProvider(p)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${importProvider === p ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}
                  >
                    {p === 'plivo' ? 'Plivo' : p === 'twilio' ? 'Twilio' : p === 'exotel' ? 'Exotel' : 'SIP Trunk'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone number (E.164)</label>
              <input
                type="tel" value={importNumber} onChange={(e) => setImportNumber(e.target.value)}
                placeholder="+919493324795"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">Include the country code with a leading "+".</p>
            </div>

            {/* Twilio-specific creds */}
            {importProvider === 'twilio' && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2.5">
                <p className="text-xs text-gray-600 font-medium">Twilio credentials (validated against twilio.com/account)</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account SID</label>
                  <input value={twilioAccountSid} onChange={(e) => setTwilioAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Auth Token</label>
                  <input type="password" value={twilioAuthToken} onChange={(e) => setTwilioAuthToken(e.target.value)} placeholder="••••••••••••" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                </div>
                <p className="text-[11px] text-gray-500">Optional in dev — server falls back to TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN env vars.</p>
              </div>
            )}

            {/* Exotel-specific creds */}
            {importProvider === 'exotel' && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2.5">
                <p className="text-xs text-gray-600 font-medium">Exotel credentials (my.exotel.com → Settings → API)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
                    <input value={exotelApiKey} onChange={(e) => setExotelApiKey(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">API Token</label>
                    <input type="password" value={exotelApiToken} onChange={(e) => setExotelApiToken(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subdomain</label>
                    <input value={exotelSubdomain} onChange={(e) => setExotelSubdomain(e.target.value)} placeholder="api.exotel.com" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Account SID</label>
                    <input value={exotelAccountSid} onChange={(e) => setExotelAccountSid(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                  </div>
                </div>
              </div>
            )}

            {/* SIP-specific creds */}
            {importProvider === 'sip' && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2.5">
                <p className="text-xs text-gray-600 font-medium">SIP trunk</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SIP URI</label>
                  <input value={sipUri} onChange={(e) => setSipUri(e.target.value)} placeholder="sip:user@trunk.example.com:5060" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
                    <input value={sipUsername} onChange={(e) => setSipUsername(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                    <input type="password" value={sipPassword} onChange={(e) => setSipPassword(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
                  </div>
                </div>
                <p className="text-[11px] text-amber-700">SIP support stores trunk metadata; outbound dial via SIP requires the SIP outbound feature flag at the carrier (Plivo/Twilio expose this through their REST API).</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Provider SID / Number ID <span className="text-gray-400">(optional)</span></label>
              <input value={importSid} onChange={(e) => setImportSid(e.target.value)} placeholder="PNxxxxx (Twilio) — leave blank if unsure" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Capabilities</label>
              <div className="flex gap-3 text-sm">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={importVoice} onChange={(e) => setImportVoice(e.target.checked)} className="accent-primary-600" />
                  <span>Voice</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={importSms} onChange={(e) => setImportSms(e.target.checked)} className="accent-primary-600" />
                  <span>SMS</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="primary" size="sm" onClick={submitImport} disabled={importing || !importNumber.trim()} className="rounded-lg">
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Import to my numbers
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* KYC */}
      {activeTab === 'kyc' && (
        <Card padding={false} className="p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck className="h-4 w-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-gray-900">KYC Verification</h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Carrier-side identity + business verification. Required before you can rent or activate Indian numbers (Plivo / Twilio India).
          </p>

          {kycLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : kycSummary ? (
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-200">
                <span className="text-sm text-gray-600">Status</span>
                <KycStatusBadge status={kycSummary.status} />
              </div>
              <KvRow k="Business" v={kycSummary.business_name} />
              <KvRow k="Owner" v={kycSummary.owner_name} />
              <KvRow k="Email" v={kycSummary.owner_email} />
              <KvRow k="Phone" v={kycSummary.owner_phone} />
              <KvRow k="Address" v={[kycSummary.address_line1, kycSummary.address_line2, kycSummary.city, kycSummary.state, kycSummary.postal_code, kycSummary.country].filter(Boolean).join(', ')} />
              <KvRow k="PAN" v={kycSummary.pan} />
              <KvRow k="Aadhaar (last 4)" v={kycSummary.aadhaar_last4} />
              <KvRow k="GSTIN" v={kycSummary.gstin} />
              {kycSummary.rejection_reason && (
                <div className="p-3 rounded-xl bg-danger-50 border border-danger-200 text-xs text-danger-700">
                  <strong>Rejected:</strong> {kycSummary.rejection_reason}
                </div>
              )}
              {kycSummary.verified_at && (
                <p className="text-xs text-gray-400">Verified {new Date(kycSummary.verified_at).toLocaleString()}</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center max-w-2xl">
              <ShieldCheck className="h-7 w-7 mx-auto text-gray-300 mb-1.5" />
              <p className="text-sm text-gray-700 font-medium">No KYC submitted yet for this tenant.</p>
              <p className="text-xs text-gray-500 mt-1">
                KYC kicks off automatically when you click <strong>Buy</strong> on an Indian number — the wizard collects PAN, Aadhaar (OTP-verified), GSTIN, and address.
              </p>
              <Button variant="primary" size="sm" className="mt-2 rounded-lg" onClick={() => setActiveTab('buy')}>
                <ShoppingCart className="h-3.5 w-3.5" /> Go to Buy Number
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Call Routing */}
      {activeTab === 'routing' && (
        <Card padding={false} className="p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Network className="h-4 w-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-gray-900">Call Routing Rules</h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Per-number rules: business hours, failover agent, IVR menu, geo restrictions, spam/DND. Routing only applies to deployed numbers.
          </p>

          {deployedNumbers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center max-w-2xl">
              <p className="text-sm text-gray-700 font-medium">No deployed numbers yet.</p>
              <p className="text-xs text-gray-500 mt-1">Routing rules apply only after a number is deployed (Status → Live).</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-w-3xl">
              {deployedNumbers.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setRouteTarget(n)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50/30 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                      <Phone className="h-4 w-4 text-primary-500" />
                    </div>
                    <div className="text-left">
                      <div className="font-mono font-medium text-gray-900 text-sm">{n.phone_number}</div>
                      <div className="text-[11px] text-gray-500">via {n.provider}</div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Deployment */}
      {activeTab === 'deployment' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card padding={false} className="lg:col-span-1 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Rocket className="h-3.5 w-3.5 text-primary-600" />
              <h3 className="text-sm font-semibold text-gray-900">Numbers</h3>
            </div>
            {owned.length === 0 ? (
              <p className="text-xs text-gray-500">No numbers yet.</p>
            ) : (
              <div className="space-y-1.5">
                {owned.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setDeploymentNumberId(n.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition ${deploymentNumberId === n.id ? 'border-primary-500 bg-primary-50 text-primary-900' : 'border-gray-200 hover:bg-gray-50'}`}
                  >
                    <div className="font-mono font-medium text-gray-900">{n.phone_number}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <DeploymentBadge status={(n.deployment_status || 'draft') as string} small />
                      <span className="text-[10px] text-gray-400">{n.provider}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card padding={false} className="lg:col-span-2 p-3">
            {!deploymentNumberId ? (
              <div className="text-center py-6 text-sm text-gray-400">
                <FileText className="h-7 w-7 mx-auto mb-1.5 opacity-30" />
                Pick a number on the left to see its deployment snapshots and audit log.
              </div>
            ) : deploymentLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <ScrollText className="h-4 w-4 text-primary-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Snapshot history (last 5)</h3>
                </div>
                {deploymentHistory.length === 0 ? (
                  <p className="text-xs text-gray-500 mb-3">No deployments yet.</p>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {deploymentHistory.map((h: any) => (
                      <div key={h.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                        <div>
                          <span className="font-medium text-gray-900">v{h.version}</span>
                          <span className="text-gray-500 ml-2">{h.agent_name || '—'}</span>
                          <span className="text-gray-400 ml-2 font-mono">{h.llm_provider}/{h.llm_model}</span>
                        </div>
                        <div className="text-right">
                          {h.is_active ? <Badge variant="success">Active</Badge> : <span className="text-gray-400">retired</span>}
                          <div className="text-[10px] text-gray-400 mt-0.5">{new Date(h.deployed_at).toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-3">
                  <ScrollText className="h-4 w-4 text-primary-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Audit log</h3>
                </div>
                {deploymentAudit.length === 0 ? (
                  <p className="text-xs text-gray-500">No events yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {deploymentAudit.map((a) => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-100 text-xs">
                        <div>
                          <span className="font-medium text-gray-900 capitalize">{a.event_type.replace(/_/g, ' ')}</span>
                          {a.actor_email && <span className="text-gray-500 ml-2">by {a.actor_email}</span>}
                        </div>
                        <span className="text-[10px] text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* ─── Modals ─── */}
      <PurchaseNumberModal
        open={purchaseTarget !== null}
        number={purchaseTarget}
        provider={(purchaseTarget?.provider === 'sandbox' ? 'plivo' : purchaseTarget?.provider) || 'plivo'}
        capabilities={['voice']}
        onClose={() => setPurchaseTarget(null)}
        onReserved={onReserved}
      />
      <InstantKycWizard
        open={kycSession !== null}
        session={kycSession}
        onClose={() => setKycSession(null)}
        onCompleted={onWizardCompleted}
      />
      <AttachAgentModal
        open={attachTarget !== null}
        phone={attachTarget}
        onClose={() => setAttachTarget(null)}
        onAttached={onAttached}
      />
      <DeployConfirmModal
        open={deployTarget !== null}
        phone={deployTarget}
        onClose={() => setDeployTarget(null)}
        onDeployed={onDeployed}
      />
      <TestCallModal
        open={testCallTarget !== null}
        phone={testCallTarget}
        onClose={() => setTestCallTarget(null)}
      />
      <VerifyNumberModal
        open={verifyTarget !== null}
        phone={verifyTarget}
        onClose={() => setVerifyTarget(null)}
        onVerified={() => reloadOwned()}
      />
      <RouteConfigModal
        open={routeTarget !== null}
        phone={routeTarget}
        onClose={() => setRouteTarget(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components

function InboundToggle({ enabled, numberId, onToggled }: { enabled: boolean; numberId: string; onToggled: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await phoneNumberApi.toggleInbound(numberId, !enabled);
      onToggled(r.inbound_enabled);
    } catch { /* ignore */ }
    setBusy(false);
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={enabled ? 'Inbound calls enabled — click to disable' : 'Inbound calls disabled — click to enable'}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-success-500' : 'bg-gray-300'} ${busy ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function OutboundToggle({ enabled, numberId, onToggled }: { enabled: boolean; numberId: string; onToggled: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await phoneNumberApi.toggleOutbound(numberId, !enabled);
      onToggled(r.outbound_enabled);
    } catch { /* ignore */ }
    setBusy(false);
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={enabled ? 'Outbound calls enabled — click to disable' : 'Outbound calls disabled — click to enable'}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-primary-500' : 'bg-gray-300'} ${busy ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function DeploymentBadge({ status, lastVerifiedAt, small }: { status: string; lastVerifiedAt?: string | null; small?: boolean }) {
  const cls = small ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  const map: Record<string, string> = {
    deployed: 'bg-emerald-100 text-emerald-700',
    deploying: 'bg-blue-100 text-blue-700',
    testing: 'bg-amber-100 text-amber-700',
    paused: 'bg-orange-100 text-orange-700',
    draft: 'bg-amber-100 text-amber-700',
  };
  const label = status === 'deployed' ? 'Live' : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <div>
      <span className={`uppercase font-semibold rounded-md ${cls} ${map[status] || 'bg-gray-100 text-gray-700'}`}>{label}</span>
      {lastVerifiedAt && !small && (
        <div className="text-[10px] text-gray-400 mt-0.5">Verified {new Date(lastVerifiedAt).toLocaleDateString()}</div>
      )}
    </div>
  );
}

function CarrierBadge({ cs }: { cs?: CarrierStatus }) {
  if (!cs) return <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> checking</span>;
  if (cs.compliance_status === 'active') return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700" title={cs.message}>Active</span>;
  if (cs.compliance_status === 'sandbox') return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700" title={cs.message}>Sandbox</span>;
  if (cs.compliance_status === 'pending') return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700" title={cs.message}>KYC pending</span>;
  return <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700" title={cs.message}>{cs.compliance_status}</span>;
}

function KycStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    verified: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    rejected: 'bg-danger-100 text-danger-700',
  };
  return <span className={`text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
}

function KvRow({ k, v }: { k: string; v: any }) {
  if (!v) return null;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-900 font-medium">{v}</span>
    </div>
  );
}

function RowActions({
  n, status, verifying, onVerify, onAttach, onDeploy, onRoute, onTest, onPause, onResume, onRelease,
}: {
  n: PhoneNumberRecord;
  status: string;
  verifying?: boolean;
  onVerify: () => void;
  onAttach: () => void;
  onDeploy: () => void;
  onRoute: () => void;
  onTest: () => void;
  onPause: () => void;
  onResume: () => void;
  onRelease: () => void;
}) {
  const deployed = status === 'deployed';
  const paused = status === 'paused';
  const attached = !!n.agent_id;
  // Lifecycle gate: which "next step" is highlighted as the primary action.
  // Without agent: Attach. With agent but not deployed: Deploy. Deployed: Test.
  return (
    <div className="inline-flex items-center gap-1 flex-wrap justify-end">
      <button
        onClick={onVerify}
        className="px-2 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 inline-flex items-center gap-1"
        title="Run pre-deploy checks"
        disabled={verifying}
      >
        {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        {verifying ? 'Verifying' : 'Verify'}
      </button>

      {/* Attach Agent — primary action when no agent is mapped */}
      {!attached && !deployed && !paused && (
        <button
          onClick={onAttach}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 inline-flex items-center gap-1"
          title="Map this number to a Voice AI agent"
        >
          <Plus className="h-3.5 w-3.5" /> Attach Agent
        </button>
      )}

      {/* Deploy — primary action when agent attached but not yet live */}
      {attached && !deployed && !paused && (
        <>
          <button
            onClick={onAttach}
            className="px-2 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 inline-flex items-center gap-1"
            title="Change the attached agent"
          >
            <Plus className="h-3.5 w-3.5" /> Re-attach
          </button>
          <button
            onClick={onDeploy}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 inline-flex items-center gap-1"
            title="Freeze agent config and activate live routing"
          >
            <Rocket className="h-3.5 w-3.5" /> Deploy
          </button>
        </>
      )}

      {deployed && (
        <>
          <button onClick={onRoute} className="px-2 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 inline-flex items-center gap-1" title="Configure routing rules"><Network className="h-3.5 w-3.5" /> Routing</button>
          <button onClick={onTest} className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1" title="Place an outbound test call"><PhoneOutgoing className="h-3.5 w-3.5" /> Test</button>
          <button onClick={onPause} className="p-1.5 rounded-md text-gray-400 hover:text-orange-600 hover:bg-orange-50" title="Pause live calls"><Pause className="h-4 w-4" /></button>
        </>
      )}

      {paused && (
        <button onClick={onResume} className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1" title="Resume"><Play className="h-3.5 w-3.5" /> Resume</button>
      )}

      <button onClick={onRelease} className="p-1.5 rounded-md text-gray-400 hover:text-danger-600 hover:bg-danger-50" title="Release number"><Trash2 className="h-4 w-4" /></button>
      <span className="hidden"><X className="h-3 w-3" /></span>
    </div>
  );
}
