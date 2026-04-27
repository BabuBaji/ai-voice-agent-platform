import { useState } from 'react';
import { Shield, CheckCircle2, AlertCircle } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';
import { useAuthStore } from '@/stores/auth.store';

export function SuperAdmin2FAPage() {
  const user = useAuthStore((s) => s.user);
  const [secret, setSecret] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    const r = await superAdminApi.setup2fa();
    setSecret(r.secret);
    setQrUrl(r.qr_url);
  };
  const verify = async () => {
    setError(null);
    try {
      await superAdminApi.verify2fa(token);
      setEnabled(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Code rejected');
    }
  };
  const disable = async () => {
    if (!confirm('Disable 2FA? You will be able to log in with just password again.')) return;
    await superAdminApi.disable2fa();
    setEnabled(false); setSecret(null); setQrUrl(null); setToken('');
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Shield className="h-6 w-6 text-amber-500" /> Two-factor authentication
        </h1>
        <p className="text-sm text-slate-500 mt-1">Protect <code className="bg-slate-100 px-1 rounded">{user?.email}</code> with a time-based code</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        {enabled ? (
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-slate-900">2FA enabled</p>
              <p className="text-xs text-slate-500 mt-1">Future logins will require the 6-digit code from your authenticator app.</p>
              <button onClick={disable} className="mt-3 text-xs px-3 py-1.5 rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100">Disable 2FA</button>
            </div>
          </div>
        ) : !secret ? (
          <div>
            <p className="text-sm text-slate-700 mb-4">Use Google Authenticator, Authy, 1Password, or any other TOTP app. Click to generate your secret.</p>
            <button onClick={start} className="text-sm px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600">Set up 2FA</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">1. Scan this QR with your authenticator app (or paste the secret manually):</p>
            {qrUrl && <img src={qrUrl} alt="TOTP QR" className="rounded-lg border border-slate-200" />}
            <div className="text-xs text-slate-500">
              Manual secret: <code className="bg-slate-100 px-2 py-1 rounded font-mono break-all">{secret}</code>
            </div>
            <p className="text-sm text-slate-700 mt-3">2. Enter the 6-digit code your app shows:</p>
            <div className="flex gap-2">
              <input value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="text-lg font-mono tracking-widest border border-slate-200 rounded-lg px-3 py-2 w-40 text-center" />
              <button onClick={verify} disabled={token.length !== 6} className="text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">Verify & enable</button>
            </div>
            {error && <div className="flex items-center gap-2 text-xs text-rose-700"><AlertCircle className="h-3.5 w-3.5" /> {error}</div>}
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500">
        Note: 2FA setup is wired but login enforcement is not yet activated for super-admin sessions in this round —
        the code path validates correctly via <code className="bg-slate-100 px-1 rounded">/super-admin/2fa/verify</code>.
        Login-flow enforcement ships in the next round.
      </div>
    </div>
  );
}
