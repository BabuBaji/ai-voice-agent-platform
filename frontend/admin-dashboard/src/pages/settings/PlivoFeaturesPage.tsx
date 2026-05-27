import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Settings, Phone, Puzzle, Users, CreditCard, KeyRound, ScrollText,
  MessageSquare, Radio, Search, Shield, DollarSign, Mic, PhoneCall,
  Send, Loader2, AlertCircle, CheckCircle2, Trash2, Play, RefreshCw,
  Wrench, Hash,
} from 'lucide-react';
import api from '@/services/api';

const settingsNav = [
  { label: 'General',        path: '/settings',                icon: Settings, end: true },
  { label: 'Phone Numbers',  path: '/settings/phone-numbers',  icon: Phone },
  { label: 'Integrations',   path: '/settings/integrations',   icon: Puzzle },
  { label: 'WhatsApp',       path: '/settings/whatsapp',       icon: MessageSquare },
  { label: 'Plivo',          path: '/settings/plivo',          icon: Radio },
  { label: 'Plivo Features', path: '/settings/plivo-features', icon: Wrench },
  { label: 'API',            path: '/settings/api',            icon: KeyRound },
  { label: 'Team',           path: '/settings/team',           icon: Users },
  { label: 'Billing',        path: '/settings/billing',        icon: CreditCard },
  { label: 'Audit Log',      path: '/settings/audit-log',      icon: ScrollText },
];

type Tab = 'account' | 'lookup' | 'sms' | 'mms' | 'otp' | 'recordings' | 'pricing' | 'numbers';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'account',    label: 'Account',       icon: DollarSign },
  { key: 'lookup',     label: 'Number Lookup', icon: Search },
  { key: 'sms',        label: 'Send SMS',      icon: Send },
  { key: 'mms',        label: 'Send MMS',      icon: Send },
  { key: 'otp',        label: 'OTP Verify',    icon: Shield },
  { key: 'recordings', label: 'Recordings',    icon: Mic },
  { key: 'pricing',    label: 'Pricing',       icon: DollarSign },
  { key: 'numbers',    label: 'Owned Numbers', icon: Hash },
];

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,.08)', marginBottom: 16,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
  borderRadius: 8, fontSize: 14, outline: 'none',
};
const btnPrimary: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnDanger: React.CSSProperties = {
  ...btnPrimary, background: '#ef4444',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151',
};
const pre: React.CSSProperties = {
  background: '#f3f4f6', borderRadius: 8, padding: 16, fontSize: 13,
  overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
};

function Flash({ type, text }: { type: 'success' | 'error'; text: string }) {
  const bg = type === 'success' ? '#ecfdf5' : '#fef2f2';
  const color = type === 'success' ? '#065f46' : '#991b1b';
  const Icon = type === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div style={{ background: bg, color, padding: '10px 14px', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
      <Icon size={16} /> {text}
    </div>
  );
}

// ─── Account Tab ─────────────────────────────────────────────────────────────

function AccountTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api.get('/api/v1/plivo/account');
      setData(r.data);
    } catch (e: any) { setErr(e.response?.data?.message || e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Plivo Account</h3>
        <button style={btnPrimary} onClick={load} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>
      {err && <Flash type="error" text={err} />}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ ...card, background: data.cashCredits < 1 ? '#fef2f2' : '#ecfdf5' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Cash Balance</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: data.cashCredits < 1 ? '#991b1b' : '#065f46' }}>
              ${data.cashCredits?.toFixed(2)}
            </div>
            {data.cashCredits < 1 && <div style={{ fontSize: 12, color: '#991b1b', marginTop: 4 }}>Low balance! Top up at console.plivo.com</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Account Info</div>
            <div style={{ marginTop: 8, fontSize: 14 }}>
              <div><strong>Type:</strong> {data.accountType}</div>
              <div><strong>State:</strong> {data.state}</div>
              <div><strong>Auto-Recharge:</strong> {data.autoRecharge ? 'Enabled' : 'Disabled'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Number Lookup Tab ───────────────────────────────────────────────────────

function LookupTab() {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const doLookup = async () => {
    if (!phone.trim()) return;
    setLoading(true); setErr(''); setResult(null);
    try {
      const r = await api.post('/api/v1/plivo/lookup', { phone_number: phone });
      setResult(r.data);
    } catch (e: any) { setErr(e.response?.data?.message || e.message); }
    setLoading(false);
  };

  return (
    <div style={card}>
      <h3 style={{ marginTop: 0, fontSize: 18 }}>Number Lookup</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={{ ...inputStyle, flex: 1 }} placeholder="+1234567890" value={phone} onChange={e => setPhone(e.target.value)} />
        <button style={btnPrimary} onClick={doLookup} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Lookup
        </button>
      </div>
      {err && <Flash type="error" text={err} />}
      {result && (
        <div style={pre}>
          <div><strong>Country:</strong> {result.country}</div>
          <div><strong>Type:</strong> {result.numberType}</div>
          <div><strong>Carrier:</strong> {result.carrier?.name || 'N/A'}</div>
          <div><strong>MCC:</strong> {result.carrier?.mobileCountryCode || 'N/A'}</div>
          <div><strong>MNC:</strong> {result.carrier?.mobileNetworkCode || 'N/A'}</div>
          <div><strong>E.164:</strong> {result.format?.e164}</div>
          <div><strong>National:</strong> {result.format?.national}</div>
          <div><strong>International:</strong> {result.format?.international}</div>
        </div>
      )}
    </div>
  );
}

// ─── SMS Tab ─────────────────────────────────────────────────────────────────

function SmsTab() {
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const send = async () => {
    setLoading(true); setFlash(null);
    try {
      const payload: any = { to, text };
      if (from.trim()) payload.from = from;
      const r = await api.post('/api/v1/plivo/sms/send', payload);
      setFlash({ type: 'success', text: `SMS queued! UUID: ${r.data.message_uuid}` });
    } catch (e: any) { setFlash({ type: 'error', text: e.response?.data?.message || e.message }); }
    setLoading(false);
  };

  return (
    <div style={card}>
      <h3 style={{ marginTop: 0, fontSize: 18 }}>Send SMS</h3>
      {flash && <Flash {...flash} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={label}>From (optional, defaults to env)</label><input style={inputStyle} placeholder="+912269981101" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label style={label}>To *</label><input style={inputStyle} placeholder="+919876543210" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div><label style={label}>Message *</label><textarea style={{ ...inputStyle, minHeight: 80 }} value={text} onChange={e => setText(e.target.value)} /></div>
        <button style={btnPrimary} onClick={send} disabled={loading || !to || !text}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send SMS
        </button>
      </div>
    </div>
  );
}

// ─── MMS Tab ─────────────────────────────────────────────────────────────────

function MmsTab() {
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [mediaUrls, setMediaUrls] = useState('');
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const send = async () => {
    setLoading(true); setFlash(null);
    try {
      const urls = mediaUrls.split('\n').map(u => u.trim()).filter(Boolean);
      const payload: any = { to, text, media_urls: urls };
      if (from.trim()) payload.from = from;
      const r = await api.post('/api/v1/plivo/mms/send', payload);
      setFlash({ type: 'success', text: `MMS queued! UUID: ${r.data.message_uuid}` });
    } catch (e: any) { setFlash({ type: 'error', text: e.response?.data?.message || e.message }); }
    setLoading(false);
  };

  return (
    <div style={card}>
      <h3 style={{ marginTop: 0, fontSize: 18 }}>Send MMS</h3>
      {flash && <Flash {...flash} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={label}>From (optional)</label><input style={inputStyle} value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label style={label}>To *</label><input style={inputStyle} placeholder="+1234567890" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div><label style={label}>Message *</label><textarea style={{ ...inputStyle, minHeight: 60 }} value={text} onChange={e => setText(e.target.value)} /></div>
        <div><label style={label}>Media URLs (one per line) *</label><textarea style={{ ...inputStyle, minHeight: 60 }} placeholder="https://example.com/image.jpg" value={mediaUrls} onChange={e => setMediaUrls(e.target.value)} /></div>
        <button style={btnPrimary} onClick={send} disabled={loading || !to || !text || !mediaUrls.trim()}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send MMS
        </button>
      </div>
    </div>
  );
}

// ─── OTP Verify Tab ──────────────────────────────────────────────────────────

function OtpTab() {
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<'sms' | 'call'>('sms');
  const [sessionUuid, setSessionUuid] = useState('');
  const [code, setCode] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const sendOtp = async () => {
    setSendLoading(true); setFlash(null); setSessionUuid('');
    try {
      const r = await api.post('/api/v1/plivo/verify/send', { phone_number: phone, channel });
      setSessionUuid(r.data.session_uuid);
      setFlash({ type: 'success', text: `OTP sent via ${channel}! Session: ${r.data.session_uuid}` });
    } catch (e: any) { setFlash({ type: 'error', text: e.response?.data?.message || e.message }); }
    setSendLoading(false);
  };

  const checkOtp = async () => {
    setCheckLoading(true); setFlash(null);
    try {
      const r = await api.post('/api/v1/plivo/verify/check', { session_uuid: sessionUuid, code });
      setFlash({ type: r.data.valid ? 'success' : 'error', text: r.data.valid ? 'OTP verified successfully!' : `Invalid OTP (status: ${r.data.status})` });
    } catch (e: any) { setFlash({ type: 'error', text: e.response?.data?.message || e.message }); }
    setCheckLoading(false);
  };

  return (
    <div style={card}>
      <h3 style={{ marginTop: 0, fontSize: 18 }}>Phone Verification (OTP)</h3>
      {flash && <Flash {...flash} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...card, background: '#f9fafb' }}>
          <h4 style={{ marginTop: 0 }}>Step 1: Send OTP</h4>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="+919876543210" value={phone} onChange={e => setPhone(e.target.value)} />
            <select style={{ ...inputStyle, width: 100 }} value={channel} onChange={e => setChannel(e.target.value as any)}>
              <option value="sms">SMS</option>
              <option value="call">Call</option>
            </select>
          </div>
          <button style={btnPrimary} onClick={sendOtp} disabled={sendLoading || !phone}>
            {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send Code
          </button>
        </div>
        <div style={{ ...card, background: '#f9fafb', opacity: sessionUuid ? 1 : 0.5 }}>
          <h4 style={{ marginTop: 0 }}>Step 2: Verify Code</h4>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="Enter 6-digit code" value={code} onChange={e => setCode(e.target.value)} maxLength={8} />
          </div>
          <button style={btnPrimary} onClick={checkOtp} disabled={checkLoading || !sessionUuid || !code}>
            {checkLoading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />} Verify
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Recordings Tab ──────────────────────────────────────────────────────────

function RecordingsTab() {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api.get('/api/v1/plivo/recordings');
      setRecordings(r.data.data || []);
    } catch (e: any) { setErr(e.response?.data?.message || e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    if (!confirm('Delete this recording?')) return;
    try {
      await api.delete(`/api/v1/plivo/recordings/${id}`);
      setRecordings(prev => prev.filter(r => r.recordingId !== id));
    } catch (e: any) { setErr(e.response?.data?.message || e.message); }
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Call Recordings</h3>
        <button style={btnPrimary} onClick={load} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>
      {err && <Flash type="error" text={err} />}
      {recordings.length === 0 && !loading && <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>No recordings found on Plivo</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {recordings.map(rec => (
          <div key={rec.recordingId} style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.recordingId}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Call: {rec.callUuid || 'N/A'} | Duration: {rec.duration?.toFixed(1)}s</div>
            </div>
            <button style={{ ...btnPrimary, padding: '6px 12px', fontSize: 12 }} onClick={() => setPlaying(playing === rec.recordingId ? null : rec.recordingId)}>
              <Play size={12} /> {playing === rec.recordingId ? 'Stop' : 'Play'}
            </button>
            <button style={{ ...btnDanger, padding: '6px 12px', fontSize: 12 }} onClick={() => del(rec.recordingId)}>
              <Trash2 size={12} />
            </button>
            {playing === rec.recordingId && rec.url && (
              <audio src={rec.url} autoPlay controls style={{ height: 32 }} onEnded={() => setPlaying(null)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pricing Tab ─────────────────────────────────────────────────────────────

function PricingTab() {
  const [country, setCountry] = useState('IN');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const check = async () => {
    setLoading(true); setErr(''); setData(null);
    try {
      const r = await api.get(`/api/v1/plivo/pricing/${country.toUpperCase()}`);
      setData(r.data);
    } catch (e: any) { setErr(e.response?.data?.message || e.message); }
    setLoading(false);
  };

  return (
    <div style={card}>
      <h3 style={{ marginTop: 0, fontSize: 18 }}>Pricing Lookup</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={{ ...inputStyle, width: 100 }} placeholder="IN" value={country} onChange={e => setCountry(e.target.value)} maxLength={2} />
        <button style={btnPrimary} onClick={check} disabled={loading || !country}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />} Check Pricing
        </button>
      </div>
      {err && <Flash type="error" text={err} />}
      {data && (
        <pre style={pre}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

// ─── Numbers Tab ─────────────────────────────────────────────────────────────

function NumbersTab() {
  const [numbers, setNumbers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api.get('/api/v1/plivo/numbers/owned');
      setNumbers(r.data.data || []);
    } catch (e: any) { setErr(e.response?.data?.message || e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const configureWebhooks = async () => {
    setConfiguring(true); setFlash(null);
    try {
      const r = await api.post('/api/v1/plivo/numbers/configure-webhooks');
      setFlash({ type: 'success', text: `Configured ${r.data.configured}/${r.data.total} numbers with webhook app ${r.data.app_id}` });
    } catch (e: any) { setFlash({ type: 'error', text: e.response?.data?.message || e.message }); }
    setConfiguring(false);
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Plivo Owned Numbers</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnPrimary} onClick={load} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
          <button style={{ ...btnPrimary, background: '#059669' }} onClick={configureWebhooks} disabled={configuring}>
            {configuring ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />} Auto-Configure Webhooks
          </button>
        </div>
      </div>
      {err && <Flash type="error" text={err} />}
      {flash && <Flash {...flash} />}
      {numbers.length === 0 && !loading && <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>No numbers found on Plivo account</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>Number</th>
              <th style={{ padding: '8px 12px' }}>Type</th>
              <th style={{ padding: '8px 12px' }}>Voice</th>
              <th style={{ padding: '8px 12px' }}>SMS</th>
              <th style={{ padding: '8px 12px' }}>Rate/mo</th>
              <th style={{ padding: '8px 12px' }}>Region</th>
              <th style={{ padding: '8px 12px' }}>App ID</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((n, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{n.number}</td>
                <td style={{ padding: '8px 12px' }}>{n.numberType || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{n.voiceEnabled ? <CheckCircle2 size={14} color="#059669" /> : '-'}</td>
                <td style={{ padding: '8px 12px' }}>{n.smsEnabled ? <CheckCircle2 size={14} color="#059669" /> : '-'}</td>
                <td style={{ padding: '8px 12px' }}>${n.monthlyRentalRate?.toFixed(2)}</td>
                <td style={{ padding: '8px 12px' }}>{n.region || '-'}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>{n.appId || 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function PlivoFeaturesPage() {
  const [tab, setTab] = useState<Tab>('account');

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24 }}>
      {/* Settings sidebar */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {settingsNav.map(n => (
            <NavLink
              key={n.path} to={n.path} end={n.end}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                borderRadius: 8, fontSize: 14, textDecoration: 'none',
                color: isActive ? '#3b82f6' : '#374151',
                background: isActive ? '#eff6ff' : 'transparent',
                fontWeight: isActive ? 600 : 400,
              })}
            >
              <n.icon size={16} /> {n.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ marginTop: 0, fontSize: 24, marginBottom: 4 }}>Plivo Features</h2>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
          All Plivo capabilities — messaging, verification, lookup, recordings, conferencing, and more.
        </p>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 8, border: 'none',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: tab === t.key ? '#3b82f6' : '#f3f4f6',
                color: tab === t.key ? '#fff' : '#374151',
              }}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'account' && <AccountTab />}
        {tab === 'lookup' && <LookupTab />}
        {tab === 'sms' && <SmsTab />}
        {tab === 'mms' && <MmsTab />}
        {tab === 'otp' && <OtpTab />}
        {tab === 'recordings' && <RecordingsTab />}
        {tab === 'pricing' && <PricingTab />}
        {tab === 'numbers' && <NumbersTab />}
      </div>
    </div>
  );
}

export default PlivoFeaturesPage;
