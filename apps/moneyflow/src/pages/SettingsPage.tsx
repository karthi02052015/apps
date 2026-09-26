import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, Database as DatabaseIcon, Download, HardDrive, KeyRound, Laptop, Lock,
  LogOut, Monitor, Moon, Palette, Plus, Shield, Sun, Tag, Trash2, Upload, User as UserIcon,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { toAmountInput } from '@/lib/money';
import { downloadBackup, downloadTransactionsCsv } from '@/lib/exporters';
import { fromBackup } from '@/core/schema';
import type { Database } from '@/core/types';
import { MINIMUM_PASSWORD_LENGTH, PBKDF2_ITERATIONS, assessPassword } from '@/core/crypto';
import { messageFor } from '@/lib/errors';
import { useSession } from '@/store/SessionProvider';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useDatabase, useLedger } from '@/store/LedgerProvider';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import {
  useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory, useUpdateProfile,
} from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AmountInput, Input, Segmented, Select, Switch } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { IconTile } from '@/components/Icon';
import { COLOR_TOKENS, swatch } from '@/lib/tokens';
import type { Theme } from '@/types/api';

type Section = 'profile' | 'account' | 'storage' | 'appearance' | 'notifications' | 'categories' | 'data';

const SECTIONS: { id: Section; label: string; icon: typeof UserIcon }[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'account', label: 'Account & security', icon: Shield },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'data', label: 'Data & backups', icon: DatabaseIcon },
];

const CURRENCIES = [
  'INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CHF', 'MYR', 'THB',
];

export function SettingsPage() {
  const [section, setSection] = useState<Section>('profile');

  return (
    <>
      <PageHeader
        title="Settings"
        description="How the app looks, what it tells you, and where your data lives."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((item) => (
              <li key={item.id} className="shrink-0 lg:w-full">
                <button
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    section === item.id ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          {section === 'profile' && <ProfileSection />}
          {section === 'account' && <AccountSection />}
          {section === 'storage' && <StorageSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'categories' && <CategoriesSection />}
          {section === 'data' && <DataSection />}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────── profile ───

function ProfileSection() {
  const user = useCurrentUser();
  const toast = useToast();
  const updateProfile = useUpdateProfile();

  const [form, setForm] = useState({
    fullName: user.fullName,
    currency: user.currency,
  });
  const [confirmCurrency, setConfirmCurrency] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(patch: Record<string, unknown>) {
    try {
      await updateProfile.mutateAsync(patch);
      toast.success('Saved');
      setErrors({});
    } catch (error) {
      if (error instanceof AppError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of error.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
        toast.error(error.message);
      }
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Your details" subtitle="Only used for the greeting on your dashboard" />
        <form
          className="space-y-4 p-5 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save({ fullName: form.fullName.trim() });
          }}
        >
          <Input
            label="Full name"
            value={form.fullName}
            onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            error={errors.fullName}
            maxLength={120}
          />
          <Button type="submit" loading={updateProfile.isPending}>Save changes</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Currency" subtitle="What symbol and grouping your amounts use" />
        <div className="p-5 pt-3">
          <Select
            label="Display currency"
            options={CURRENCIES.map((code) => ({ value: code, label: code }))}
            value={form.currency}
            onChange={(event) => {
              const next = event.target.value;
              setForm({ ...form, currency: next });
              if (next !== user.currency) setConfirmCurrency(next);
            }}
          />
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-caution-soft p-3 text-xs text-caution">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Changing the currency relabels your existing amounts. It does not convert
            them — ₹1,000 becomes $1,000, not its exchange-rate equivalent.
          </p>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmCurrency !== null}
        onClose={() => {
          setConfirmCurrency(null);
          setForm({ ...form, currency: user.currency });
        }}
        onConfirm={async () => {
          if (confirmCurrency) await save({ currency: confirmCurrency });
          setConfirmCurrency(null);
        }}
        title="Change your currency?"
        message={`Every existing amount will be relabelled from ${user.currency} to ${confirmCurrency}. No amount is converted.`}
        confirmLabel="Change currency"
        tone="primary"
        loading={updateProfile.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────── security ───

/**
 * The account itself: its name, its password, and how long it stays unlocked.
 *
 * Changing the password re-encrypts the whole ledger under a new key. There is
 * nothing on a server to update and nothing to invalidate — the old key simply
 * stops opening anything.
 */
function AccountSection() {
  const session = useSession();
  const db = useDatabase();
  const toast = useToast();

  const [name, setName] = useState(session.account?.name ?? '');
  const [email, setEmail] = useState(session.account?.email ?? '');
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const strength = assessPassword(form.newPassword);
  const remembered = (() => {
    try {
      return Boolean(globalThis.localStorage?.getItem('moneyflow:remember'));
    } catch {
      return false;
    }
  })();

  async function saveIdentity(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      if (name !== session.account?.name) await session.renameAccount(name);
      if (email !== (session.account?.email ?? '')) await session.changeEmail(email);
      toast.success('Saved');
    } catch (error) {
      if (error instanceof AppError && error.details.length > 0) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of error.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
      } else {
        setErrors({ name: messageFor(error, 'That could not be saved.') });
      }
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    if (form.newPassword !== form.confirmPassword) {
      setErrors({ confirmPassword: 'The two passwords do not match.' });
      return;
    }
    if (!strength.acceptable) {
      setErrors({ newPassword: strength.hint || 'Choose something harder to guess.' });
      return;
    }
    setPending(true);
    try {
      await session.changePassword(form.currentPassword, form.newPassword, db);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed', 'Your records have been re-encrypted with the new one.');
    } catch (error) {
      if (error instanceof AppError && error.details.length > 0) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of error.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
      } else {
        setErrors({ currentPassword: messageFor(error, 'That did not work.') });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="This account" subtitle="How you log in on this device" />
        <form className="space-y-4 p-5 pt-3" onSubmit={saveIdentity}>
          <Input
            label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={60}
          />
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            hint="What you type to log in. No mail is ever sent to it."
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
          />
          <Button type="submit">Save changes</Button>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Change password"
          subtitle="Re-encrypts everything under the new one"
        />
        <form className="space-y-4 p-5 pt-3" onSubmit={changePassword}>
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
            error={errors.currentPassword}
            leftIcon={<Lock className="h-4 w-4" aria-hidden />}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={`At least ${MINIMUM_PASSWORD_LENGTH} characters. Like the first one, it cannot be reset.`}
            value={form.newPassword}
            onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
            error={errors.newPassword}
            leftIcon={<Lock className="h-4 w-4" aria-hidden />}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            error={errors.confirmPassword}
            leftIcon={<Lock className="h-4 w-4" aria-hidden />}
          />
          <Button type="submit" loading={pending}>Change password</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Staying logged in" subtitle="What happens when you walk away" />
        <div className="space-y-4 p-5 pt-3">
          <Select
            label="Log out automatically after"
            options={[
              { value: '0', label: 'Never' },
              { value: '5', label: '5 minutes' },
              { value: '15', label: '15 minutes' },
              { value: '30', label: '30 minutes' },
              { value: '60', label: '1 hour' },
            ]}
            value={String(session.autoLockMinutes)}
            onChange={(event) => {
              session.setAutoLockMinutes(Number(event.target.value));
              toast.success('Saved');
            }}
            hint="Logging out clears every unlocked account's key from memory. Your password opens it again."
          />

          <div className="rounded-xl bg-surface-2 p-3.5 text-xs text-ink-2">
            <p className="font-medium text-ink">
              {remembered ? 'Staying signed in on this device' : 'Asking for your password each visit'}
            </p>
            <p className="mt-1">
              {remembered
                ? 'Your key is stored in this browser so you are not asked again. Anyone who can ' +
                  'use this device can open your records — log out below to stop that.'
                : 'Your key is held only while this tab is open. Closing it means typing the ' +
                  'password next time.'}
            </p>
          </div>

          {session.signedIn.length > 1 && (
            <div className="rounded-xl bg-surface-2 p-3.5 text-xs text-ink-2">
              <p className="font-medium text-ink">
                {session.signedIn.length} accounts are logged in on this device
              </p>
              <p className="mt-1">
                {session.signedIn.map((item) => item.name).join(', ')}. Switch between them from
                the menu at the bottom of the sidebar — no password needed while they are open.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => session.logOut()}
              leftIcon={<LogOut className="h-4 w-4" aria-hidden />}
            >
              Log out
            </Button>
            {session.signedIn.length > 1 && (
              <Button variant="outline" onClick={() => session.logOutAll()}>
                Log out of all {session.signedIn.length}
              </Button>
            )}
            <Button variant="outline" onClick={() => session.beginAddAccount()}>
              Add another account
            </Button>
          </div>
        </div>
      </Card>

      <Card className="border-negative/30">
        <CardHeader title="Delete this account" subtitle="Permanent, and immediate" />
        <div className="p-5 pt-3">
          <p className="text-sm text-ink-2">
            This removes the account and its encrypted records from this browser. Without the
            password they could not be read anyway, so there is nothing to recover — export a
            backup first if you might want the data back.
          </p>
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => setConfirmDelete(true)}
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            Delete account
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          setConfirmText('');
        }}
        title="Delete this account?"
        description="The account and everything in it is removed from this browser."
        size="sm"
      >
        <p className="text-sm text-ink-2">
          Type <strong className="font-mono font-semibold text-ink">DELETE ACCOUNT</strong> to confirm.
        </p>
        <Input
          className="mt-3"
          data-autofocus
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          aria-label="Confirmation phrase"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={confirmText !== 'DELETE ACCOUNT'}
            onClick={async () => {
              if (!session.account) return;
              await session.deleteAccount(session.account.id);
            }}
          >
            Delete account
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * Where the data lives.
 *
 * With no server there is nothing to sign in to and no session to end, so this
 * section answers the question that replaces those: where exactly is my money
 * data, and what could make it disappear? It is deliberately specific — a
 * vague reassurance would be worse than nothing when the honest answer is
 * "in this browser, and clearing site data would delete it".
 */
function StorageSection() {
  const { storageKind, storageError, db, storageSize } = useLedger();
  const [bytes, setBytes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void storageSize().then((size) => {
      if (!cancelled) setBytes(size);
    });
    return () => {
      cancelled = true;
    };
  }, [storageSize, db]);

  const backend =
    storageKind === 'indexeddb'
      ? 'IndexedDB'
      : storageKind === 'localstorage'
        ? 'Local storage'
        : 'Memory only';

  return (
    <>
      {storageError && (
        <Card className="border-negative/40">
          <div className="flex gap-3 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold text-ink">Your changes are not being saved</p>
              <p className="mt-1 text-ink-2">{storageError}</p>
              <p className="mt-1 text-ink-2">
                Export a backup now — anything you record will be lost when this tab closes.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Where your data is" subtitle="All of it, and only here" />
        <div className="space-y-2.5 p-5 pt-3 text-sm text-ink-2">
          <p className="flex gap-2.5">
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
            Stored in this browser using <strong className="font-medium text-ink">{backend}</strong>
            {bytes !== null && <> — about {formatBytes(bytes)} so far</>}.
          </p>
          <p className="flex gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
            Encrypted with AES-256-GCM under a key stretched from your password
            ({PBKDF2_ITERATIONS.toLocaleString('en-IN')} PBKDF2 rounds). Someone with the files but
            not the password has nothing readable.
          </p>
          <p className="flex gap-2.5">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
            Nothing is uploaded. There is no server and no analytics — the app works with the
            network switched off.
          </p>
          <p className="flex gap-2.5">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
            MoneyFlow never connects to your bank. Everything here is what you entered.
          </p>
        </div>
      </Card>

      <Card className="border-caution/30">
        <CardHeader title="What would delete it" subtitle="Worth knowing before it happens" />
        <ul className="space-y-2 p-5 pt-3 text-sm text-ink-2">
          <li className="flex gap-2.5">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
            Clearing your browsing data, cookies or site data for this site.
          </li>
          <li className="flex gap-2.5">
            <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
            Using a different browser, a different device, or a private window — each one
            keeps its own separate copy.
          </li>
          <li className="flex gap-2.5">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
            Uninstalling the browser, or a "storage cleaner" tool sweeping the site.
          </li>
          <li className="flex gap-2.5">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
            Forgetting your password. The records would still be here, but nothing could read
            them — not this app, not another one, not us.
          </li>
        </ul>
        <p className="px-5 pb-5 text-sm text-ink-2">
          The fix for all of these is the same: export a backup now and again, and keep the
          file somewhere you trust.
        </p>
      </Card>
    </>
  );
}

/** Bytes as something a person can read. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ────────────────────────────────────────────────────────────── appearance ───

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const updateProfile = useUpdateProfile();

  const apply = (next: Theme) => {
    setTheme(next);
    updateProfile.mutate({ theme: next });
  };

  return (
    <Card>
      <CardHeader title="Theme" subtitle="Light, dark, or whatever your device is using" />
      <div className="grid grid-cols-1 gap-3 p-5 pt-3 sm:grid-cols-3">
        {([
          { value: 'light' as const, label: 'Light', icon: Sun },
          { value: 'dark' as const, label: 'Dark', icon: Moon },
          { value: 'system' as const, label: 'Match device', icon: Monitor },
        ]).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => apply(option.value)}
            aria-pressed={theme === option.value}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
              theme === option.value
                ? 'border-brand bg-brand-soft ring-1 ring-brand'
                : 'border-line hover:border-ink-3',
            )}
          >
            <option.icon className={cn('h-6 w-6', theme === option.value ? 'text-brand' : 'text-ink-2')} aria-hidden />
            <span className="text-sm font-medium text-ink">{option.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────── notifications ───

function NotificationsSection() {
  const user = useCurrentUser();
  const toast = useToast();
  const updateProfile = useUpdateProfile();

  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    budgetAlerts: true, recurringReminders: true, debtReminders: true,
    goalMilestones: true, largeExpenses: true,
    ...user.notificationPrefs,
  });
  const [threshold, setThreshold] = useState(
    toAmountInput(user.largeExpenseThresholdMinor, user.currency),
  );

  const toggle = (key: string, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    updateProfile.mutate({ notificationPrefs: next });
  };

  return (
    <>
      <Card>
        <CardHeader title="What we tell you about" subtitle="All notifications stay inside the app" />
        <div className="space-y-4 p-5 pt-3">
          <Switch
            checked={prefs.budgetAlerts !== false}
            onChange={(value) => toggle('budgetAlerts', value)}
            label="Budget warnings"
            description="When you approach or pass a budget limit."
          />
          <Switch
            checked={prefs.recurringReminders !== false}
            onChange={(value) => toggle('recurringReminders', value)}
            label="Upcoming payments"
            description="A day or two before a recurring entry is due."
          />
          <Switch
            checked={prefs.debtReminders !== false}
            onChange={(value) => toggle('debtReminders', value)}
            label="Debt due dates"
            description="When a repayment is coming up or overdue."
          />
          <Switch
            checked={prefs.goalMilestones !== false}
            onChange={(value) => toggle('goalMilestones', value)}
            label="Goal milestones"
            description="At 25%, 50%, 75% and when a goal is reached."
          />
          <Switch
            checked={prefs.largeExpenses !== false}
            onChange={(value) => toggle('largeExpenses', value)}
            label="Large expenses"
            description="When a single expense is unusually big."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Large expense threshold" subtitle="What counts as unusually big for you" />
        <form
          className="flex flex-col gap-3 p-5 pt-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            updateProfile.mutate(
              { largeExpenseThreshold: threshold },
              {
                onSuccess: () => toast.success('Threshold updated'),
              },
            );
          }}
        >
          <AmountInput
            currency={user.currency}
            label="Alert me above"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            containerClassName="flex-1"
          />
          <Button type="submit" loading={updateProfile.isPending}>Save</Button>
        </form>
      </Card>
    </>
  );
}

// ────────────────────────────────────────────────────────────── categories ───

function CategoriesSection() {
  const toast = useToast();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const { data: categories = [], isLoading } = useCategories(kind, true);
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('slate');
  const [deleting, setDeleting] = useState<(typeof categories)[number] | null>(null);

  return (
    <>
      <Card>
        <CardHeader
          title="Categories"
          subtitle="Rename, recolour, archive — they are yours to shape"
          action={
            <Button size="sm" onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
              New
            </Button>
          }
        />
        <div className="px-5 pt-3">
          <Segmented
            ariaLabel="Category type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Expenses' },
              { value: 'income', label: 'Income' },
            ]}
            className="w-full"
          />
        </div>

        {isLoading ? (
          <RowSkeleton count={5} />
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {categories.map((category) => (
              <li key={category.id} className={cn('flex items-center gap-3 px-5 py-3', category.isArchived && 'opacity-55')}>
                <IconTile icon={category.icon} color={category.color} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{category.name}</span>
                  <span className="block text-xs text-ink-2">
                    {category.usageCount} {category.usageCount === 1 ? 'transaction' : 'transactions'}
                    {category.isArchived && ' · archived'}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateMutation.mutate({ id: category.id, patch: { isArchived: !category.isArchived } })
                  }
                >
                  {category.isArchived ? 'Restore' : 'Archive'}
                </Button>
                {category.usageCount === 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-negative hover:bg-negative-soft"
                    onClick={() => setDeleting(category)}
                    aria-label={`Delete ${category.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="New category" size="sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            createMutation.mutate(
              { name: name.trim(), kind, color, icon: 'tag' },
              {
                onSuccess: () => {
                  toast.success('Category created');
                  setName('');
                  setCreating(false);
                },
                onError: (error) => toast.error(error instanceof AppError ? error.message : 'That did not save.'),
              },
            );
          }}
        >
          <Input
            label="Name"
            required
            data-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
          />
          <div>
            <span className="mb-2 block text-sm font-medium text-ink">Colour</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category colour">
              {COLOR_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  role="radio"
                  aria-checked={color === token}
                  aria-label={token}
                  onClick={() => setColor(token)}
                  className={cn(
                    'h-7 w-7 rounded-full transition-transform',
                    swatch(token).dot,
                    color === token ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'hover:scale-105',
                  )}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteMutation.mutateAsync({ id: deleting.id });
            toast.success('Category deleted');
          } catch (error) {
            toast.error(error instanceof AppError ? error.message : 'That could not be deleted.');
          }
          setDeleting(null);
        }}
        title="Delete this category?"
        message={`"${deleting?.name}" is not used by any transaction, so deleting it is safe.`}
        confirmLabel="Delete category"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────── data/privacy ───

/**
 * Export, restore, and start over.
 *
 * Because the data is local, these are the only ways it moves anywhere — which
 * makes them the most important controls in the app rather than an afterthought
 * at the bottom of Settings.
 */
function DataSection() {
  const toast = useToast();
  const { replace, reset } = useLedger();
  const db = useDatabase();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [pendingImport, setPendingImport] = useState<Database | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function download(kind: 'csv' | 'json') {
    try {
      if (kind === 'csv') downloadTransactionsCsv(db);
      else downloadBackup(db);
      toast.success('Download ready', 'Keep the file somewhere private.');
    } catch {
      toast.error('That export could not be generated.');
    }
  }

  async function handleFile(file: File) {
    try {
      const restored = fromBackup(JSON.parse(await file.text()));
      // The confirmation shows what the file actually contains, so a wrong
      // file is obvious before it replaces anything.
      setPendingImport(restored);
    } catch {
      toast.error('That file could not be read', 'It should be a MoneyFlow backup (.json).');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Export and backup" subtitle="Your records, in formats you can keep" />
        <div className="p-5 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => download('csv')} leftIcon={<Download className="h-4 w-4" aria-hidden />}>
              Transactions (CSV)
            </Button>
            <Button variant="outline" onClick={() => download('json')} leftIcon={<Download className="h-4 w-4" aria-hidden />}>
              Full backup (JSON)
            </Button>
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-caution-soft p-3 text-xs text-caution">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Exported files contain your complete financial history in plain text. Anyone who
            opens one can read every transaction — store it somewhere encrypted, and think
            twice before emailing it.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Restore from a backup"
          subtitle="Moving to a new browser, or recovering after a clear-out"
        />
        <div className="p-5 pt-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            leftIcon={<Upload className="h-4 w-4" aria-hidden />}
          >
            Choose a backup file
          </Button>
          <p className="mt-3 text-sm text-ink-2">
            Restoring replaces everything currently in this browser. You will see what the
            file contains before anything changes.
          </p>
        </div>
      </Card>

      <Card className="border-negative/30">
        <CardHeader title="Start over" subtitle="Empties this account's records" />
        <div className="p-5 pt-3">
          <p className="text-sm text-ink-2">
            This empties this account — every money account, transaction, budget, goal and debt —
            and returns it to its first-run state. Your sign-in and password stay as they are.
            There is no undo and no copy kept anywhere, so export a backup first if you might
            want it back.
          </p>
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => setConfirmReset(true)}
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            Erase all my data
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        onConfirm={async () => {
          if (!pendingImport) return;
          await replace(pendingImport);
          setPendingImport(null);
          toast.success('Backup restored', 'Everything from the file is now in this browser.');
        }}
        title="Restore this backup?"
        message={
          pendingImport
            ? `The file holds ${pendingImport.transactions.length} transactions across ` +
              `${pendingImport.accounts.length} accounts. Restoring replaces everything ` +
              'currently stored in this browser.'
            : ''
        }
        confirmLabel="Replace my data"
        tone="primary"
      />

      <Modal
        open={confirmReset}
        onClose={() => {
          setConfirmReset(false);
          setConfirmText('');
        }}
        title="Erase everything?"
        description="Every record in this account will be removed permanently."
        size="sm"
      >
        <p className="text-sm text-ink-2">
          Type <strong className="font-mono font-semibold text-ink">ERASE MY DATA</strong> to confirm.
        </p>
        <Input
          className="mt-3"
          data-autofocus
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          aria-label="Confirmation phrase"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={confirmText !== 'ERASE MY DATA'}
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                await reset();
                setConfirmReset(false);
                setConfirmText('');
                toast.success('Everything erased', 'MoneyFlow is back to its first run.');
              } catch {
                toast.error('That did not work. Please try again.');
              } finally {
                setPending(false);
              }
            }}
          >
            Erase everything
          </Button>
        </div>
      </Modal>
    </>
  );
}
