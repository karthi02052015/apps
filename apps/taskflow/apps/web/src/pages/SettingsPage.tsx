import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Laptop, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { changePasswordSchema, type AuditLogDTO, type Page, type SessionDTO, type UserDTO } from '@taskflow/shared';
import { toast } from 'sonner';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Spinner';
import { useAuth } from '../features/auth/AuthProvider';
import { DESKTOP_NOTIFICATIONS_KEY } from '../features/notifications/useRealtime';
import { useTheme, type ThemePref } from '../hooks/useTheme';
import { ApiError, api, errorMessage, timeZone } from '../lib/api';
import { cn } from '../lib/cn';
import { keys } from '../lib/keys';
import { storage } from '../lib/storage';

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border py-8 last:border-b-0 md:grid-cols-[220px_1fr] md:gap-10">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-8 sm:pt-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 text-[13.5px] text-muted">Manage your profile, preferences and security.</p>
      <div className="mt-4">
        <ProfileSection />
        <AppearanceSection />
        <NotificationsSection />
        <PasswordSection />
        <SessionsSection />
        <ActivitySection />
      </div>
    </div>
  );
}

function ProfileSection() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [tz, setTz] = useState(user?.timezone ?? timeZone);
  const zones = useMemo(() => {
    let list: string[] = [];
    try {
      list = Intl.supportedValuesOf('timeZone');
    } catch {
      /* older browsers */
    }
    // Make sure UTC, the device zone and the saved zone are always selectable.
    return Array.from(new Set(['UTC', timeZone, user?.timezone ?? 'UTC', ...list]));
  }, [user?.timezone]);
  const save = useMutation({
    mutationFn: () => api<{ user: UserDTO }>('/auth/me', { method: 'PATCH', body: { name, timezone: tz } }),
    onSuccess: (r) => {
      setUser(r.user);
      toast.success('Profile saved');
    },
  });

  return (
    <Section title="Profile" description="TaskFlow follows your device’s time zone automatically; this zone is the fallback for integrations and API clients.">
      <form
        className="max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email" hint="Contact support to change your email.">
          {(p) => <Input {...p} value={user?.email ?? ''} disabled />}
        </Field>
        <Field
          label="Time zone"
          action={
            tz !== timeZone ? (
              <button type="button" className="text-[12px] font-medium text-accent hover:underline" onClick={() => setTz(timeZone)}>
                Use device ({timeZone})
              </button>
            ) : null
          }
        >
          {(p) => (
            <Select {...p} value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
          Save changes
        </Button>
      </form>
    </Section>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const options: Array<[ThemePref, typeof Sun, string]> = [
    ['light', Sun, 'Light'],
    ['dark', Moon, 'Dark'],
    ['system', Monitor, 'System'],
  ];
  return (
    <Section title="Appearance" description="Choose a theme, or follow your device.">
      <div className="grid max-w-md grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
        {options.map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border p-4 text-[13px] font-medium transition-colors',
              theme === value ? 'border-accent bg-accent-soft text-fg' : 'border-border text-muted hover:border-border-strong hover:text-fg',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function NotificationsSection() {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  const [enabled, setEnabled] = useState(storage.get(DESKTOP_NOTIFICATIONS_KEY) !== 'off');

  return (
    <Section title="Notifications" description="Reminders and overdue alerts appear in-app. Desktop alerts show when TaskFlow is in the background.">
      {!supported ? (
        <p className="text-[13.5px] text-muted">This browser doesn't support desktop notifications.</p>
      ) : permission === 'granted' ? (
        <label className="flex max-w-md items-center justify-between gap-4 rounded-xl border border-border p-4">
          <span>
            <span className="block text-[13.5px] font-medium">Desktop notifications</span>
            <span className="block text-[12.5px] text-muted">Show a system alert when a reminder fires.</span>
          </span>
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              storage.set(DESKTOP_NOTIFICATIONS_KEY, e.target.checked ? 'on' : 'off');
            }}
          />
        </label>
      ) : permission === 'denied' ? (
        <p className="max-w-md text-[13.5px] text-muted">
          Desktop notifications are blocked. Enable them for this site in your browser settings, then reload.
        </p>
      ) : (
        <Button variant="outline" onClick={() => void Notification.requestPermission().then(setPermission)}>
          Enable desktop notifications
        </Button>
      )}
    </Section>
  );
}

function PasswordSection() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: form }),
    onSuccess: () => {
      toast.success('Password updated', { description: 'Other devices have been signed out.' });
      setForm({ currentPassword: '', newPassword: '' });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
    },
    meta: { silent: true },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    change.mutate();
  };
  return (
    <Section title="Password" description="Changing your password signs you out of every other device.">
      <form className="max-w-md space-y-4" onSubmit={onSubmit} noValidate>
        {change.isError && !(change.error instanceof ApiError && change.error.details) ? (
          <p role="alert" className="text-[13px] text-danger">
            {errorMessage(change.error)}
          </p>
        ) : null}
        <Field label="Current password" error={errors.currentPassword}>
          {(p) => (
            <Input {...p} type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
          )}
        </Field>
        <Field label="New password" error={errors.newPassword} hint="At least 10 characters with a letter and a number.">
          {(p) => (
            <Input {...p} type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
          )}
        </Field>
        <Button type="submit" variant="outline" loading={change.isPending}>
          Update password
        </Button>
      </form>
    </Section>
  );
}

function deviceLabel(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: `${browser}${os ? ` on ${os}` : ''}`, mobile };
}

function SessionsSection() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const sessions = useQuery({ queryKey: keys.sessions, queryFn: () => api<{ items: SessionDTO[] }>('/auth/sessions').then((r) => r.items) });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast.success('Session signed out'),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.sessions }),
  });
  const logoutAll = useMutation({
    mutationFn: () => api('/auth/logout-all', { method: 'POST' }),
    onSuccess: () => void logout(),
  });

  return (
    <Section title="Active sessions" description="Devices currently signed in to your account.">
      <div className="max-w-xl space-y-2">
        {sessions.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          sessions.data?.map((s) => {
            const d = deviceLabel(s.userAgent);
            const Icon = d.mobile ? Smartphone : Laptop;
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <span className="grid size-9 place-items-center rounded-lg bg-surface-2 text-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">
                    {d.label}
                    {s.current ? <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">This device</span> : null}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {s.ip ?? 'Unknown IP'} · active {formatDistanceToNow(new Date(s.lastUsedAt), { addSuffix: true })}
                  </p>
                </div>
                {!s.current ? (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                    Sign out
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
        <Button variant="outline" className="mt-2 text-danger" loading={logoutAll.isPending} onClick={() => logoutAll.mutate()}>
          Sign out of all devices
        </Button>
      </div>
    </Section>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'auth.register': 'Created account',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out everywhere',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.account_locked': 'Account temporarily locked',
  'auth.change_password': 'Changed password',
  'auth.refresh_reuse_detected': 'Suspicious session activity blocked',
  'auth.revoke_session': 'Signed out a device',
  'task.create': 'Created a task',
  'task.update': 'Edited a task',
  'task.complete': 'Completed a task',
  'task.delete': 'Moved a task to trash',
  'task.restore': 'Restored a task',
  'task.purge': 'Permanently deleted a task',
  'project.create': 'Created a project',
  'project.update': 'Edited a project',
  'project.delete': 'Deleted a project',
};

function ActivitySection() {
  const audit = useQuery({ queryKey: keys.audit, queryFn: () => api<Page<AuditLogDTO>>('/audit-logs', { query: { limit: 25 } }) });
  return (
    <Section title="Recent activity" description="A security log of recent actions on your account.">
      {audit.isPending ? (
        <Skeleton className="h-32 w-full max-w-xl" />
      ) : (
        <ul className="max-w-xl divide-y divide-border rounded-xl border border-border">
          {audit.data?.items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
              <span className={cn(a.action.includes('failed') || a.action.includes('reuse') || a.action.includes('locked') ? 'text-danger' : '')}>
                {ACTION_LABELS[a.action] ?? a.action}
              </span>
              <span className="shrink-0 text-[12px] text-subtle">{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
