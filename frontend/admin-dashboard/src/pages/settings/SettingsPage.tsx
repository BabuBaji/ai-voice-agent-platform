import { useEffect, useState } from 'react';
import { User as UserIcon, Lock, Globe, Loader2, Save } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { profileApi, type UserProfile } from '@/services/settings.api';
import api from '@/services/api';

const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (GMT+5:30)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GMT+4)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (GMT+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (GMT+9)' },
  { value: 'Europe/London', label: 'Europe/London (GMT+0)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (GMT+1)' },
  { value: 'America/New_York', label: 'New York (GMT-5)' },
  { value: 'America/Chicago', label: 'Chicago (GMT-6)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (GMT-8)' },
  { value: 'UTC', label: 'UTC' },
];

export function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    profileApi.getMe()
      .then(setProfile)
      .catch((e) => toast.addToast(e?.response?.data?.error || 'Failed to load profile', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-white dark:bg-gradient-to-br dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 transition-colors">
      <div className="max-w-3xl mx-auto p-6 lg:p-10 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-gray-400 dark:text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
          </div>
        ) : profile ? (
          <>
            <PersonalInformationCard profile={profile} onUpdated={setProfile} />
            <SecurityCard />
            <PreferencesCard profile={profile} onUpdated={setProfile} />
          </>
        ) : null}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Building blocks
// ────────────────────────────────────────────────

function Card({
  icon: Icon, title, subtitle, children, footer,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/80 overflow-hidden transition-colors">
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-300">
          <Icon className="h-4 w-4" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">{subtitle}</p>
      </div>
      <div className="px-6 pb-6 space-y-4">{children}</div>
      {footer && (
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          {footer}
        </div>
      )}
    </div>
  );
}

function Field({
  label, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">{label}</label>
      <input
        {...rest}
        className="w-full h-10 px-3.5 rounded-lg bg-white dark:bg-gray-950/60 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:border-cyan-500 dark:focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900/40"
      />
    </div>
  );
}

function SaveBtn({
  loading, disabled, onClick, children,
}: { loading?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold bg-cyan-500/90 hover:bg-cyan-400 text-gray-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────
// 1. Personal Information
// ────────────────────────────────────────────────

function PersonalInformationCard({
  profile, onUpdated,
}: { profile: UserProfile; onUpdated: (p: UserProfile) => void }) {
  const toast = useToast();
  const [firstName, setFirstName] = useState(profile.first_name || '');
  const [lastName, setLastName] = useState(profile.last_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [saving, setSaving] = useState(false);

  const fullName = `${firstName} ${lastName}`.trim();
  const dirty =
    firstName !== profile.first_name ||
    lastName !== (profile.last_name || '') ||
    phone !== (profile.phone || '');

  async function save() {
    setSaving(true);
    try {
      const parts = fullName.trim().split(/\s+/);
      const fn = parts[0] || '';
      const ln = parts.slice(1).join(' ') || '';
      const updated = await profileApi.updateMe({
        firstName: fn,
        lastName: ln,
        phone: phone || null,
      });
      onUpdated(updated);
      toast.addToast('Saved', 'success');
    } catch (e: any) {
      toast.addToast(e?.response?.data?.error || 'Save failed', 'error');
    } finally { setSaving(false); }
  }

  function setName(name: string) {
    const parts = name.trim().split(/\s+/);
    setFirstName(parts[0] || '');
    setLastName(parts.slice(1).join(' '));
  }

  return (
    <Card
      icon={UserIcon}
      title="Personal Information"
      subtitle="Update your name and phone number"
      footer={<SaveBtn onClick={save} loading={saving} disabled={!dirty || !fullName}>Save changes</SaveBtn>}
    >
      <Field label="Name" value={fullName} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
      <Field label="Email" value={profile.email} disabled />
      <Field label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your phone number" />
    </Card>
  );
}

// ────────────────────────────────────────────────
// 2. Security
// ────────────────────────────────────────────────

function SecurityCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  async function change() {
    if (newPw.length < 8) {
      toast.addToast('New password must be at least 8 characters', 'error');
      return;
    }
    if (newPw !== confirm) {
      toast.addToast('New passwords do not match', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: newPw });
      toast.addToast('Password changed', 'success');
      setCurrent(''); setNewPw(''); setConfirm('');
    } catch (e: any) {
      toast.addToast(e?.response?.data?.error || 'Change failed', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Card
      icon={Lock}
      title="Security"
      subtitle="Change your account password"
      footer={
        <SaveBtn
          onClick={change}
          loading={saving}
          disabled={!current || newPw.length < 8 || newPw !== confirm}
        >
          Change password
        </SaveBtn>
      }
    >
      <Field label="Current Password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Enter current password" />
      <Field label="New Password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Enter new password" />
      <Field label="Confirm New Password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" />
    </Card>
  );
}

// ────────────────────────────────────────────────
// 3. Preferences (Timezone)
// ────────────────────────────────────────────────

function PreferencesCard({
  profile, onUpdated,
}: { profile: UserProfile; onUpdated: (p: UserProfile) => void }) {
  const toast = useToast();
  const [timezone, setTimezone] = useState(profile.timezone || 'Asia/Kolkata');
  const [saving, setSaving] = useState(false);

  const dirty = timezone !== profile.timezone;

  async function save() {
    setSaving(true);
    try {
      const updated = await profileApi.updateMe({ timezone });
      onUpdated(updated);
      toast.addToast('Saved', 'success');
    } catch (e: any) {
      toast.addToast(e?.response?.data?.error || 'Save failed', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Card
      icon={Globe}
      title="Preferences"
      subtitle="Manage your timezone and display settings"
      footer={<SaveBtn onClick={save} loading={saving} disabled={!dirty}>Save timezone</SaveBtn>}
    >
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">Timezone</label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full h-10 px-3 rounded-lg bg-white dark:bg-gray-950/60 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
        >
          {TIMEZONES.map((tz) => (<option key={tz.value} value={tz.value}>{tz.label}</option>))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">This will be used for displaying dates and times throughout the application.</p>
      </div>
    </Card>
  );
}
