import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Cloud, X, CheckCircle2, Loader2, AlertCircle, LogOut, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import api from '@/services/api';

type PhoneStatus = 'idle' | 'qr' | 'scanned' | 'connected' | 'expired' | 'error';
type CloudStatus = 'idle' | 'connected';

interface PhoneSessionState {
  status: PhoneStatus;
  qr: string | null;
  qr_expires_at: number | null;
  phone_number: string | null;
  error: string | null;
}

interface CloudSessionState {
  status: CloudStatus;
  business_account_id?: string;
  phone_number?: string | null;
  verified_at?: string;
}

export function WhatsAppPage() {
  const [phone, setPhone] = useState<PhoneSessionState | null>(null);
  const [cloud, setCloud] = useState<CloudSessionState | null>(null);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load any existing sessions on mount
  useEffect(() => {
    api.get('/whatsapp/phone/status').then((r) => setPhone(r.data)).catch(() => {});
    api.get('/whatsapp/cloud/status').then((r) => setCloud(r.data)).catch(() => {});
  }, []);

  // Poll the phone session while the QR modal is open OR while status is
  // still `qr` (waiting for scan). Stops polling once connected / expired.
  useEffect(() => {
    if (!showPhoneModal) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      return;
    }
    const poll = async () => {
      try {
        const r = await api.get('/whatsapp/phone/status');
        setPhone(r.data);
        if (r.data.status === 'connected') {
          // "when i scan it have to connect automatically" — close the modal 1s
          // after we see the connected flip so the user sees the success state.
          setTimeout(() => setShowPhoneModal(false), 1000);
        }
      } catch { /* ignore transient errors */ }
    };
    pollTimer.current = setInterval(poll, 2000);
    poll();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [showPhoneModal]);

  const startPhoneConnection = async () => {
    try {
      const r = await api.post('/whatsapp/phone/connect');
      setPhone(r.data);
      setShowPhoneModal(true);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Failed to start WhatsApp session');
    }
  };

  const logoutPhone = async () => {
    if (!confirm('Disconnect WhatsApp? You\'ll need to scan a new QR code to reconnect.')) return;
    try {
      await api.post('/whatsapp/phone/logout');
      setPhone({ status: 'idle', qr: null, qr_expires_at: null, phone_number: null, error: null });
    } catch (e: any) {
      alert(e?.message || 'Logout failed');
    }
  };

  const disconnectCloud = async () => {
    if (!confirm('Disconnect Cloud WhatsApp? Your stored Meta credentials will be removed.')) return;
    try {
      await api.post('/whatsapp/cloud/disconnect');
      setCloud({ status: 'idle' });
    } catch { /* ignore */ }
  };

  const phoneConnected = phone?.status === 'connected';
  const cloudConnected = cloud?.status === 'connected';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your WhatsApp Business connections and settings.</p>
      </div>

      {(phoneConnected || cloudConnected) && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Connected accounts</h3>
          <div className="space-y-2">
            {phoneConnected && (
              <div className="flex items-center justify-between p-3 rounded-xl border border-success-200 bg-success-50/40">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <MessageSquare className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Phone WhatsApp</p>
                    <p className="text-xs text-gray-500">Connected via QR code · <span className="font-mono">+{phone?.phone_number || '—'}</span></p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={logoutPhone}>
                  <LogOut className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            )}
            {cloudConnected && (
              <div className="flex items-center justify-between p-3 rounded-xl border border-success-200 bg-success-50/40">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Cloud className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Cloud WhatsApp</p>
                    <p className="text-xs text-gray-500">
                      Business account <span className="font-mono">{cloud?.business_account_id}</span>
                      {cloud?.phone_number ? ` · ${cloud.phone_number}` : ''}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={disconnectCloud}>
                  <LogOut className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ─── Hero + two option cards ─── */}
      <div className="text-center py-6">
        <h2 className="text-xl font-semibold text-gray-900">Connect WhatsApp</h2>
        <p className="text-sm text-gray-500 mt-1">Get started by connecting your WhatsApp Business account.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConnectionCard
          title="Phone WhatsApp"
          description="Connect using your existing phone number via QR code scan"
          icon={<MessageSquare className="h-8 w-8 text-green-500" />}
          iconBg="bg-green-500/10 ring-1 ring-green-500/30"
          connected={phoneConnected}
          onClick={startPhoneConnection}
        />
        <ConnectionCard
          title="Cloud WhatsApp"
          description="Connect via Meta Cloud API for high-volume enterprise messaging"
          icon={<Cloud className="h-8 w-8 text-blue-500" />}
          iconBg="bg-blue-500/10 ring-1 ring-blue-500/30"
          connected={cloudConnected}
          onClick={() => setShowCloudModal(true)}
        />
      </div>

      {/* ─── Phone QR modal ─── */}
      {showPhoneModal && (
        <QRModal
          phone={phone}
          onClose={() => setShowPhoneModal(false)}
          onRefresh={startPhoneConnection}
        />
      )}

      {/* ─── Cloud creds modal ─── */}
      {showCloudModal && (
        <CloudModal
          onClose={() => setShowCloudModal(false)}
          onConnected={(c) => {
            setCloud(c);
            setShowCloudModal(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Option card ---------- */

function ConnectionCard({
  title, description, icon, iconBg, connected, onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  connected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-8 rounded-2xl border transition-all hover:shadow-lg ${
        connected
          ? 'border-success-300 bg-success-50/30'
          : 'border-gray-200 bg-white hover:border-primary-300'
      }`}
    >
      <div className="flex flex-col items-center text-center space-y-3">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 max-w-xs">{description}</p>
        {connected && (
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-success-100 text-success-700 font-medium">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        )}
      </div>
    </button>
  );
}

/* ---------- Phone QR modal ---------- */

function QRModal({ phone, onClose, onRefresh }: {
  phone: PhoneSessionState | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const secondsLeft = phone?.qr_expires_at
    ? Math.max(0, Math.ceil((phone.qr_expires_at - Date.now()) / 1000))
    : null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative">
        <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-semibold text-gray-900">Scan QR Code</h3>
        <p className="text-sm text-gray-500 mt-1">
          Open WhatsApp on your phone, go to <strong>Settings → Linked Devices</strong>, and scan this code.
        </p>

        <div className="mt-5 flex items-center justify-center">
          {phone?.status === 'connected' ? (
            <div className="py-14 text-center">
              <div className="w-20 h-20 rounded-full bg-success-100 mx-auto flex items-center justify-center mb-3">
                <CheckCircle2 className="h-10 w-10 text-success-600" />
              </div>
              <p className="text-lg font-semibold text-gray-900">Connected!</p>
              <p className="text-sm text-gray-500 mt-1">+{phone.phone_number || 'your number'} is now linked.</p>
            </div>
          ) : phone?.qr ? (
            <div className="p-3 bg-white rounded-2xl border border-gray-200">
              <img src={phone.qr} alt="WhatsApp QR code" className="w-72 h-72" />
            </div>
          ) : phone?.status === 'expired' ? (
            <div className="py-14 text-center">
              <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">QR code expired</p>
              <p className="text-xs text-gray-500 mt-1 mb-4">Generate a new one to scan.</p>
              <Button variant="primary" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" /> New QR
              </Button>
            </div>
          ) : phone?.status === 'error' ? (
            <div className="py-14 text-center">
              <AlertCircle className="h-10 w-10 text-danger-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">Connection failed</p>
              <p className="text-xs text-gray-500 mt-1 font-mono break-all max-w-xs">{phone.error || 'unknown error'}</p>
              <Button variant="primary" size="sm" onClick={onRefresh} className="mt-3">
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </Button>
            </div>
          ) : (
            <div className="py-14 text-center">
              <Loader2 className="h-10 w-10 text-primary-500 mx-auto mb-2 animate-spin" />
              <p className="text-sm text-gray-600">Generating QR code…</p>
            </div>
          )}
        </div>

        {phone?.status === 'qr' && (
          <>
            <p className="text-xs text-gray-500 text-center mt-4">
              If QR is not scanned within the countdown, it will not work and you'll need to generate the QR again.
            </p>
            {secondsLeft != null && (
              <p className="text-sm font-medium text-primary-600 text-center mt-3">
                {secondsLeft > 0 ? `Checking status in ${secondsLeft}s…` : 'Refreshing…'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Cloud WhatsApp modal ---------- */

function CloudModal({ onClose, onConnected }: {
  onClose: () => void;
  onConnected: (c: CloudSessionState) => void;
}) {
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appId, setAppId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!businessAccountId.trim() || !accessToken.trim()) {
      setErr('WhatsApp Business Account ID and Access Token are required.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const r = await api.post('/whatsapp/cloud/connect', {
        business_account_id: businessAccountId.trim(),
        access_token: accessToken.trim(),
        app_id: appId.trim() || undefined,
        business_id: businessId.trim() || undefined,
      });
      onConnected(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Connect failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative">
        <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-semibold text-gray-900">Connect Cloud WhatsApp</h3>
        <h4 className="text-sm font-semibold text-gray-700 mt-4">Business Account ID & Access Token</h4>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          Enter your Meta credentials to connect your WhatsApp Business Account.
          Get these from <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">developers.facebook.com/apps</a>.
        </p>

        {err && (
          <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <div className="space-y-3">
          <input
            value={businessAccountId}
            onChange={(e) => setBusinessAccountId(e.target.value)}
            placeholder="WhatsApp Business Account ID"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Access Token"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="APP ID"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
          <input
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            placeholder="Business ID"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>

        <Button
          variant="gradient"
          onClick={submit}
          disabled={submitting}
          className="w-full mt-5 rounded-xl py-2.5"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </div>
  );
}
