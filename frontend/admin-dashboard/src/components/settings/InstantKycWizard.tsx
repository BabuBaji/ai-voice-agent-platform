import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Loader2, Phone, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  phoneNumberApi,
  type KycSession,
  type KycStep,
  type PhoneNumberRecord,
} from '@/services/phoneNumber.api';
import { useAuthStore } from '@/stores/auth.store';

const STEPS: { id: KycStep; label: string }[] = [
  { id: 'register', label: 'Register' },
  { id: 'otp', label: 'OTP' },
  { id: 'pan', label: 'PAN' },
  { id: 'aadhaar', label: 'Aadhar' },
  { id: 'gstin', label: 'GST' },
  { id: 'complete', label: 'Complete' },
];

interface Props {
  open: boolean;
  session: KycSession | null;
  onClose: () => void;
  onCompleted: (rec: PhoneNumberRecord) => void;
}

export function InstantKycWizard({ open, session: initialSession, onClose, onCompleted }: Props) {
  const [session, setSession] = useState<KycSession | null>(initialSession);
  // Hoisted so dev OTPs surfaced during step 1 stay visible during step 2.
  const [devOtps, setDevOtps] = useState<{ email?: string | null; mobile?: string | null } | null>(null);
  const [aadhaarDevOtp, setAadhaarDevOtp] = useState<string | null>(null);

  useEffect(() => { setSession(initialSession); setDevOtps(null); setAadhaarDevOtp(null); }, [initialSession]);

  if (!open || !session) return null;

  const updateSession = (s: KycSession) => setSession(s);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl text-gray-900 my-8 ring-1 ring-gray-200" onClick={(e) => e.stopPropagation()}>
        <Header session={session} onClose={onClose} />
        <Stepper currentStep={session.current_step} session={session} />
        <div className="px-8 pb-8">
          {session.current_step === 'register' && <RegisterStep session={session} onAdvance={updateSession} onDevOtps={setDevOtps} />}
          {session.current_step === 'otp' && <OtpStep session={session} onAdvance={updateSession} devOtps={devOtps} setDevOtps={setDevOtps} />}
          {session.current_step === 'pan' && <PanStep session={session} onAdvance={updateSession} />}
          {session.current_step === 'aadhaar' && <AadhaarStep session={session} onAdvance={updateSession} devOtp={aadhaarDevOtp} setDevOtp={setAadhaarDevOtp} />}
          {session.current_step === 'gstin' && <GstinStep session={session} onAdvance={updateSession} />}
          {session.current_step === 'complete' && <CompleteStep session={session} onAdvance={updateSession} onCompleted={onCompleted} />}
        </div>
      </div>
    </div>
  );
}

function Header({ session, onClose }: { session: KycSession; onClose: () => void }) {
  return (
    <div className="px-8 pt-6 pb-4 flex items-start justify-between border-b border-gray-100">
      <div>
        <h3 className="text-xl font-semibold text-gray-900">Instant KYC Verification</h3>
        <div className="text-sm text-gray-500 font-mono mt-0.5">{session.number}</div>
      </div>
      <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center">
        <X className="h-4 w-4 text-gray-500" />
      </button>
    </div>
  );
}

function Stepper({ currentStep, session }: { currentStep: KycStep; session: KycSession }) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  const isCompleted = (id: KycStep, idx: number): boolean => {
    if (id === 'register') return Boolean(session.full_name);
    if (id === 'otp') return session.email_verified && session.mobile_verified;
    if (id === 'pan') return session.pan_verified;
    if (id === 'aadhaar') return session.aadhaar_verified;
    if (id === 'gstin') return session.gstin_verified || session.gstin_skipped;
    if (id === 'complete') return session.status === 'completed';
    return idx < currentIdx;
  };

  return (
    <div className="px-8 pt-6 pb-6">
      <div className="flex items-center justify-between gap-1">
        {STEPS.map((s, i) => {
          const done = isCompleted(s.id, i);
          const active = s.id === currentStep;
          return (
            <div key={s.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  done && !active ? 'bg-teal-500 text-white' :
                  active ? 'bg-teal-500 text-white ring-4 ring-teal-500/20' :
                  'bg-gray-200 text-gray-500'
                }`}>
                  {done && !active ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <div className={`text-[11px] mt-1.5 ${active ? 'text-teal-600 font-medium' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                  {s.label}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-1 mb-5 transition-colors ${
                  isCompleted(STEPS[i + 1].id, i + 1) || done ? 'bg-teal-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step 1: Register
// ────────────────────────────────────────────────────────────────────────
function RegisterStep({ session, onAdvance, onDevOtps }: { session: KycSession; onAdvance: (s: KycSession) => void; onDevOtps: (d: { email?: string | null; mobile?: string | null } | null) => void }) {
  // Prefill from logged-in user so the user never has to retype their name/email
  const authUser = useAuthStore((s) => s.user);
  const [fullName, setFullName] = useState(session.full_name || authUser?.name || '');
  const [email, setEmail] = useState(session.email || authUser?.email || '');
  const [mobile, setMobile] = useState((session.mobile || '').replace(/^\+91/, ''));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<{ email: boolean; mobile: boolean } | null>(null);

  const submit = async () => {
    setErr(null);
    onDevOtps(null);
    setSentInfo(null);
    if (!fullName || fullName.trim().length < 2) { setErr('Enter your full name'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('Enter a valid email'); return; }
    const m = mobile.replace(/\s/g, '');
    if (!/^\d{10}$/.test(m)) { setErr('Enter a 10-digit Indian mobile number'); return; }

    setSubmitting(true);
    try {
      const r = await phoneNumberApi.wizard.register(session.id, {
        full_name: fullName.trim(),
        email: email.trim(),
        mobile: '+91' + m,
      });
      setSentInfo({ email: !!r.otp_sent?.email, mobile: !!r.otp_sent?.mobile });
      // Hoist dev OTPs to the parent so they persist into the OTP step
      if (r.dev_otp) onDevOtps(r.dev_otp);
      // Pause briefly so user can see the delivery status, then advance to OTP step
      setTimeout(() => onAdvance(r.data), 800);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Failed to register');
    } finally { setSubmitting(false); }
  };

  return (
    <Panel title="Your Details" subtitle="Confirm your details — we've prefilled them from your account">
      <Field label="Full Name" hint="Enter your name exactly as it appears on your PAN card">
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-input" />
      </Field>
      <Field label="Email Address" hint="Used for OTP verification — we'll send a 6-digit code">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-input" />
      </Field>
      <Field label="Mobile Number" hint="We'll text a 6-digit OTP to this number">
        <div className="flex gap-2">
          <span className="px-3 py-2 rounded-lg bg-gray-50 text-gray-600 text-sm border border-gray-200">+91</span>
          <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} className="w-input flex-1" />
        </div>
      </Field>
      {err && <ErrorBanner>{err}</ErrorBanner>}
      {sentInfo && <DeliveryBanner email={sentInfo.email} mobile={sentInfo.mobile} />}
      <ContinueBtn onClick={submit} disabled={submitting} label="Send OTPs & continue" />
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step 2: OTP
// ────────────────────────────────────────────────────────────────────────
function OtpStep({ session, onAdvance, devOtps, setDevOtps }: { session: KycSession; onAdvance: (s: KycSession) => void; devOtps: { email?: string | null; mobile?: string | null } | null; setDevOtps: (d: { email?: string | null; mobile?: string | null } | null) => void }) {
  const [emailOtp, setEmailOtp] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async () => {
    setErr(null); setFieldErrs({});
    if (!/^\d{6}$/.test(emailOtp)) { setFieldErrs({ email_otp: 'Enter 6 digits' }); return; }
    if (!/^\d{6}$/.test(mobileOtp)) { setFieldErrs({ mobile_otp: 'Enter 6 digits' }); return; }
    setSubmitting(true);
    try {
      const data = await phoneNumberApi.wizard.verifyOtp(session.id, { email_otp: emailOtp, mobile_otp: mobileOtp });
      onAdvance(data);
    } catch (e: any) {
      const data = e?.response?.data;
      if (Array.isArray(data?.details)) {
        const fe: Record<string, string> = {};
        data.details.forEach((d: any) => { if (d.field) fe[d.field] = d.message; });
        setFieldErrs(fe);
      }
      setErr(data?.message || 'Invalid OTP');
    } finally { setSubmitting(false); }
  };

  const resend = async () => {
    setResending(true); setErr(null); setDevOtps(null);
    try {
      const r = await phoneNumberApi.wizard.resendOtp(session.id, 'all');
      if (r.dev_otp) setDevOtps(r.dev_otp);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Resend failed');
    } finally { setResending(false); }
  };

  return (
    <Panel title="Verify your codes" subtitle={`Email code sent to ${session.email}. Mobile code is read aloud on a phone call to ${session.mobile} — answer the call to hear the digits.`}>
      <Field label="Email OTP" hint="6-digit code from your inbox" err={fieldErrs.email_otp}>
        <input value={emailOtp} onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" placeholder="123456" className="w-input font-mono tracking-[0.5em] text-center" maxLength={6} />
      </Field>
      <Field label="Mobile OTP (from the phone call)" hint="Answer the call — the system speaks the digits twice" err={fieldErrs.mobile_otp}>
        <input value={mobileOtp} onChange={(e) => setMobileOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" placeholder="123456" className="w-input font-mono tracking-[0.5em] text-center" maxLength={6} />
      </Field>
      <button onClick={resend} disabled={resending}
        className="text-xs text-teal-600 hover:text-teal-700 disabled:opacity-50 font-medium">
        {resending ? 'Resending…' : "Didn't get it? Resend & call again"}
      </button>
      {devOtps && (devOtps.email || devOtps.mobile) && (
        <DevOtpBanner label="Your codes (local dev mode)" emailOtp={devOtps.email || undefined} mobileOtp={devOtps.mobile || undefined} />
      )}
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <ContinueBtn onClick={submit} disabled={submitting} label="Verify codes" />
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step 3: PAN
// ────────────────────────────────────────────────────────────────────────
function PanStep({ session, onAdvance }: { session: KycSession; onAdvance: (s: KycSession) => void }) {
  const [pan, setPan] = useState(session.pan || '');
  const [name, setName] = useState(session.pan_holder_name || session.full_name || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const submit = async () => {
    setErr(null); setFieldErrs({});
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) {
      setFieldErrs({ pan: 'PAN must match AAAAA9999A format' });
      return;
    }
    if (!name || name.trim().length < 2) { setFieldErrs({ name_on_pan: 'Required' }); return; }
    setSubmitting(true);
    try {
      const data = await phoneNumberApi.wizard.pan(session.id, { pan: pan.toUpperCase(), name_on_pan: name.trim() });
      onAdvance(data);
    } catch (e: any) {
      const data = e?.response?.data;
      if (Array.isArray(data?.details)) {
        const fe: Record<string, string> = {};
        data.details.forEach((d: any) => { if (d.field) fe[d.field] = d.message; });
        setFieldErrs(fe);
      }
      setErr(data?.message || 'PAN verification failed');
    } finally { setSubmitting(false); }
  };

  return (
    <Panel title="PAN Details" subtitle="We use your PAN to verify your identity with NSDL standards">
      <Field label="PAN Number" err={fieldErrs.pan} hint="Format: 5 letters + 4 digits + 1 letter (e.g., ABCDE1234F)">
        <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
          placeholder="ABCDE1234F" className="w-input font-mono uppercase tracking-wider" maxLength={10} />
      </Field>
      <Field label="Name on PAN card" err={fieldErrs.name_on_pan} hint="Must match the name printed on your PAN">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-input" />
      </Field>
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <ContinueBtn onClick={submit} disabled={submitting} />
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step 4: Aadhaar
// ────────────────────────────────────────────────────────────────────────
function AadhaarStep({ session, onAdvance, devOtp, setDevOtp }: { session: KycSession; onAdvance: (s: KycSession) => void; devOtp: string | null; setDevOtp: (s: string | null) => void }) {
  const [aadhaar, setAadhaar] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  const sendOtp = async () => {
    setErr(null); setFieldErrs({}); setDevOtp(null);
    if (!/^\d{12}$/.test(aadhaar)) { setFieldErrs({ aadhaar: 'Enter the 12-digit Aadhaar number' }); return; }
    setSubmitting(true);
    try {
      const r = await phoneNumberApi.wizard.aadhaarInit(session.id, aadhaar);
      setOtpSent(true);
      setHint(r.mobile_hint || null);
      if (r.dev_otp) setDevOtp(r.dev_otp);
    } catch (e: any) {
      const data = e?.response?.data;
      if (Array.isArray(data?.details)) {
        const fe: Record<string, string> = {};
        data.details.forEach((d: any) => { if (d.field) fe[d.field] = d.message; });
        setFieldErrs(fe);
      }
      setErr(data?.message || 'Aadhaar verification failed');
    } finally { setSubmitting(false); }
  };

  const verify = async () => {
    setErr(null); setFieldErrs({});
    if (!/^\d{6}$/.test(otp)) { setFieldErrs({ otp: 'Enter 6 digits' }); return; }
    setSubmitting(true);
    try {
      const data = await phoneNumberApi.wizard.aadhaarVerify(session.id, otp);
      onAdvance(data);
    } catch (e: any) {
      const data = e?.response?.data;
      if (Array.isArray(data?.details)) {
        const fe: Record<string, string> = {};
        data.details.forEach((d: any) => { if (d.field) fe[d.field] = d.message; });
        setFieldErrs(fe);
      }
      setErr(data?.message || 'OTP verification failed');
    } finally { setSubmitting(false); }
  };

  return (
    <Panel title="Aadhaar Verification" subtitle="We'll call the mobile number linked to your Aadhaar and read the OTP aloud">
      <Field label="Aadhaar Number" err={fieldErrs.aadhaar} hint="12-digit number — only the last 4 digits are stored">
        <input value={aadhaar} onChange={(e) => { setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12)); setOtpSent(false); }}
          placeholder="123412341234" className="w-input font-mono tracking-wider" maxLength={12} disabled={otpSent} />
      </Field>
      {!otpSent ? (
        <ContinueBtn onClick={sendOtp} disabled={submitting} label="Send OTP" />
      ) : (
        <>
          {hint && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-800">
              <Phone className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {hint}
            </div>
          )}
          {devOtp && <DevOtpBanner label="Aadhaar OTP (dev fallback)" mobileOtp={devOtp} />}
          <Field label="Enter OTP" err={fieldErrs.otp}>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" placeholder="123456" className="w-input font-mono tracking-[0.5em] text-center" maxLength={6} />
          </Field>
          <button onClick={() => { setOtpSent(false); setOtp(''); setDevOtp(null); }} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
            Change Aadhaar number
          </button>
          {err && <ErrorBanner>{err}</ErrorBanner>}
          <ContinueBtn onClick={verify} disabled={submitting} label="Verify OTP" />
        </>
      )}
      {err && !otpSent && <ErrorBanner>{err}</ErrorBanner>}
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step 5: GSTIN (optional)
// ────────────────────────────────────────────────────────────────────────
function GstinStep({ session, onAdvance }: { session: KycSession; onAdvance: (s: KycSession) => void }) {
  const [gstin, setGstin] = useState(session.gstin || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  const submit = async (skip: boolean) => {
    setErr(null); setFieldErrs({});
    if (!skip && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin.toUpperCase())) {
      setFieldErrs({ gstin: 'GSTIN must be 15 chars (state+PAN+entity+Z+checksum)' });
      return;
    }
    setSubmitting(true);
    try {
      const data = await phoneNumberApi.wizard.gstin(session.id, skip ? { skip: true } : { gstin: gstin.toUpperCase() });
      onAdvance(data);
    } catch (e: any) {
      const data = e?.response?.data;
      if (Array.isArray(data?.details)) {
        const fe: Record<string, string> = {};
        data.details.forEach((d: any) => { if (d.field) fe[d.field] = d.message; });
        setFieldErrs(fe);
      }
      setErr(data?.message || 'GSTIN verification failed');
    } finally { setSubmitting(false); }
  };

  return (
    <Panel title="GSTIN (Optional)" subtitle="Skip if you don't have a GSTIN — required only for businesses">
      <Field label="GST Number" err={fieldErrs.gstin} hint="15 chars: 2 state + 10 PAN + 1 entity + 1 Z + 1 checksum">
        <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().slice(0, 15))}
          placeholder="22ABCDE1234F1Z5" className="w-input font-mono uppercase tracking-wider" maxLength={15} />
      </Field>
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={() => submit(true)} disabled={submitting}
          className="flex-1 rounded-lg">
          Skip
        </Button>
        <Button variant="primary" onClick={() => submit(false)} disabled={submitting || !gstin}
          className="flex-1 !bg-teal-500 hover:!bg-teal-600 !text-white font-semibold rounded-lg">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Verify GSTIN
        </Button>
      </div>
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step 6: Complete
// ────────────────────────────────────────────────────────────────────────
function CompleteStep({ session, onAdvance, onCompleted }: { session: KycSession; onAdvance: (s: KycSession) => void; onCompleted: (rec: PhoneNumberRecord) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const done_already = session.status === 'completed';
  const summary = useMemo(() => ([
    { label: 'Full name', value: session.full_name },
    { label: 'Email', value: session.email },
    { label: 'Mobile', value: session.mobile },
    { label: 'PAN', value: session.pan },
    { label: 'Aadhaar', value: session.aadhaar_last4 ? `XXXX-XXXX-${session.aadhaar_last4}` : null },
    { label: 'GSTIN', value: session.gstin || (session.gstin_skipped ? 'Skipped' : null) },
  ].filter((r) => r.value)), [session]);

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const r = await phoneNumberApi.wizard.complete(session.id);
      onAdvance(r.session);
      setDone(true);
      setTimeout(() => onCompleted(r.data), 1500);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Failed to complete purchase');
    } finally { setSubmitting(false); }
  };

  if (done_already || done) {
    return (
      <Panel title="KYC Complete" subtitle={`${session.number} has been added to your account`}>
        <div className="flex flex-col items-center py-6">
          <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-9 w-9 text-teal-600" />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900">All done!</div>
            <div className="text-sm text-gray-500 mt-1">Your number is being activated. This may take a few minutes.</div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Review & Confirm" subtitle="Review your KYC details and complete the purchase">
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
        {summary.map((r) => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-gray-500">{r.label}</span>
            <span className="text-gray-900 font-medium">{r.value}</span>
          </div>
        ))}
        <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
          <span className="text-gray-500">Number</span>
          <span className="text-gray-900 font-mono font-semibold">{session.number}</span>
        </div>
        {session.monthly_rate != null && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Monthly rate</span>
            <span className="text-gray-900 font-medium">${session.monthly_rate.toFixed(3)}/mo</span>
          </div>
        )}
      </div>
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <ContinueBtn onClick={submit} disabled={submitting} label="Complete Purchase" icon={<ShieldCheck className="h-4 w-4" />} />
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ────────────────────────────────────────────────────────────────────────
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-gray-900">{title}</h4>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
      <style>{`
        .w-input {
          width: 100%;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 0.625rem 0.875rem;
          color: #111827;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .w-input::placeholder { color: #9ca3af; }
        .w-input:focus {
          border-color: #14b8a6;
          box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
        }
        .w-input:disabled {
          background: #f9fafb;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}

function Field({ label, hint, err, children }: { label: string; hint?: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
      {!err && hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

function ContinueBtn({ onClick, disabled, label, icon }: { onClick: () => void; disabled?: boolean; label?: string; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full mt-2 py-3 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
      {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label || 'Continue'}
    </button>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function DevOtpBanner({ label, emailOtp, mobileOtp }: { label: string; emailOtp?: string; mobileOtp?: string }) {
  // Sized up and visually loud — this is the dev-mode shortcut so the user
  // can copy codes off the screen instead of hunting through spam folders or
  // waiting for a Plivo top-up.
  return (
    <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-300 shadow-sm">
      <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">{label}</div>
      <div className="space-y-2">
        {emailOtp && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-amber-700">Email code</span>
            <code className="text-2xl font-mono font-bold tracking-[0.3em] text-amber-900 bg-white px-3 py-1 rounded border border-amber-200 select-all">{emailOtp}</code>
          </div>
        )}
        {mobileOtp && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-amber-700">Mobile code</span>
            <code className="text-2xl font-mono font-bold tracking-[0.3em] text-amber-900 bg-white px-3 py-1 rounded border border-amber-200 select-all">{mobileOtp}</code>
          </div>
        )}
      </div>
      <div className="text-[10px] mt-2.5 text-amber-700/80 leading-snug">
        Local-dev shortcut — codes are echoed here because SMTP delivery may be spam-filtered and Plivo voice calls need account credit. Tap a code to select, or paste it in the field above.
      </div>
    </div>
  );
}

function DeliveryBanner({ email, mobile }: { email: boolean; mobile: boolean }) {
  const allOk = email && mobile;
  const tone = allOk ? 'bg-teal-50 border-teal-200 text-teal-800'
    : (email || mobile) ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-red-50 border-red-200 text-red-700';
  return (
    <div className={`p-3 rounded-lg border text-xs ${tone}`}>
      <div className="font-medium">
        {allOk ? 'Email sent and phone call placed — answer the call to hear your code' : 'Partial delivery — check the channels that succeeded'}
      </div>
      <div className="mt-1 text-[11px]">
        Email OTP: {email ? '✓ sent' : '✗ failed'} · Mobile OTP call: {mobile ? '✓ ringing your phone' : '✗ failed'}
      </div>
    </div>
  );
}
