/**
 * Sign up, or log in.
 *
 * This screen carries one message most sign-up forms never have to: the
 * password *is* the key. Nobody holds a copy, nothing can reset it, and
 * forgetting it means the data is gone. Saying that once, plainly, before the
 * account exists is worth more than any amount of reassurance afterwards.
 *
 * The email address is an identifier, not a channel — nothing is ever sent to
 * it, because there is nowhere to send from. It earns its place by being the
 * thing people already remember about their own accounts, and by making
 * logging in work the way logging in is supposed to.
 *
 * It also handles the one-time case of a ledger recorded before accounts
 * existed: rather than stranding it behind a login the person has never seen,
 * the first account offers to take it in.
 */
import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, AtSign, Eye, EyeOff, Lock, ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError, messageFor } from '@/lib/errors';
import { MINIMUM_PASSWORD_LENGTH, assessPassword } from '@/core/crypto';
import { useSession } from '@/store/SessionProvider';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { Input, Switch, type InputProps } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import type { AccountSummary } from '@/store/persistence';

type Mode = 'log-in' | 'sign-up' | 'pick';

export function AuthPage() {
  const session = useSession();
  // A device with accounts on it opens on the log-in form; a fresh one opens
  // on sign-up, because there is nothing to log in to yet.
  const [mode, setMode] = useState<Mode | null>(null);
  const [picked, setPicked] = useState<AccountSummary | null>(null);

  useEffect(() => {
    if (session.status === 'loading' || mode !== null) return;
    setMode(session.accounts.length > 0 ? 'log-in' : 'sign-up');
  }, [session.status, session.accounts.length, mode]);

  if (session.status === 'unsupported') return <UnsupportedNotice reason={session.unsupportedReason} />;
  if (mode === null) return <Shell>{null}</Shell>;

  return (
    <Shell
      // Shown only when a second account is being opened over a live session,
      // so there is somewhere to go back to.
      onCancel={session.addingAccount ? session.cancelAddAccount : undefined}
      cancelLabel={session.account ? `Back to ${session.account.name}` : undefined}
    >
      {mode === 'pick' && picked ? (
        <UnlockForm account={picked} onBack={() => setMode('log-in')} />
      ) : (
        <>
          <Tabs
            mode={mode === 'sign-up' ? 'sign-up' : 'log-in'}
            onChange={(next) => setMode(next)}
            canLogIn={session.accounts.length > 0}
          />
          {mode === 'sign-up' ? (
            <SignUpForm onDone={() => setMode('log-in')} />
          ) : (
            <LogInForm
              accounts={session.accounts}
              onPick={(account) => {
                setPicked(account);
                setMode('pick');
              }}
              onSignUp={() => setMode('sign-up')}
            />
          )}
        </>
      )}
    </Shell>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

function Shell({
  children, onCancel, cancelLabel,
}: {
  children: ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col justify-center bg-canvas px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-md">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-brand hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {cancelLabel ?? 'Back'}
          </button>
        )}
        <div className="mb-7 flex items-center gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-white"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16 L10 10 L14 14 L20 7" />
              <circle cx="20" cy="7" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">MoneyFlow</h1>
            <p className="text-sm text-ink-2">Your money, kept on your device.</p>
          </div>
        </div>

        <div className="card p-6 sm:p-7">{children}</div>

        <p className="mt-5 text-center text-xs text-ink-3">
          Nothing is uploaded. Accounts, passwords and records all stay in this browser.
        </p>
      </div>
    </div>
  );
}

function Tabs({
  mode, onChange, canLogIn,
}: {
  mode: 'log-in' | 'sign-up';
  onChange: (mode: 'log-in' | 'sign-up') => void;
  canLogIn: boolean;
}) {
  const options: { value: 'log-in' | 'sign-up'; label: string }[] = [
    { value: 'log-in', label: 'Log in' },
    { value: 'sign-up', label: 'Sign up' },
  ];
  return (
    <div className="mb-6 flex gap-1 rounded-xl bg-surface-3 p-1" role="tablist" aria-label="Log in or sign up">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={mode === option.value}
          disabled={option.value === 'log-in' && !canLogIn}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
            mode === option.value
              ? 'bg-surface text-ink shadow-sm'
              : 'text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-ink-2',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function UnsupportedNotice({ reason }: { reason: string | null }) {
  return (
    <Shell>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" aria-hidden />
        <div className="text-sm">
          <h2 className="font-semibold text-ink">MoneyFlow cannot protect your data here</h2>
          <p className="mt-1.5 text-ink-2">{reason}</p>
          <p className="mt-2 text-ink-2">
            Browsers only allow encryption on a secure page. Open the app over{' '}
            <strong className="font-medium text-ink">https://</strong> — a GitHub Pages address
            works — or on <strong className="font-medium text-ink">localhost</strong> while
            developing.
          </p>
        </div>
      </div>
    </Shell>
  );
}

// ── Logging in ──────────────────────────────────────────────────────────────

function LogInForm({
  accounts, onPick, onSignUp,
}: {
  accounts: AccountSummary[];
  onPick: (account: AccountSummary) => void;
  onSignUp: () => void;
}) {
  const session = useSession();
  // Prefilled with whoever used this device last — but not while a second
  // account is being added, where the obvious guess is the wrong one.
  const [email, setEmail] = useState(
    session.addingAccount
      ? ''
      : (accounts.find((item) => !session.signedIn.some((open) => open.id === item.id))?.email ?? ''),
  );
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setPending(true);
    try {
      await session.signIn(email, password, remember);
      setPassword('');
    } catch (caught) {
      if (caught instanceof AppError && caught.details.length > 0) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of caught.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
      } else {
        setErrors({ password: messageFor(caught, 'That did not work.') });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-ink">Welcome back</h2>
      <p className="mt-1 text-sm text-ink-2">Your password unlocks the records on this device.</p>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          leftIcon={<AtSign className="h-4 w-4" aria-hidden />}
          placeholder="you@example.com"
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />

        <Switch
          checked={remember}
          onChange={setRemember}
          label="Stay logged in on this device"
          description="Skip the password next time. Only do this on a device that is yours alone."
        />

        <Button type="submit" className="w-full" loading={pending} disabled={!email || !password}>
          Log in
        </Button>
      </form>

      {accounts.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-xs font-medium text-ink-2">Accounts on this device</p>
          <ul className="mt-2 space-y-1.5">
            {accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() =>
                    (session.signedIn.some((item) => item.id === account.id)
                      ? session.switchTo(account.id)
                      : onPick(account))
                  }
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left transition-all hover:border-brand/40 hover:bg-surface-2"
                >
                  <Initials name={account.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{account.name}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {session.signedIn.some((item) => item.id === account.id)
                        ? 'Already logged in — tap to switch'
                        : (account.email ?? lastSeen(account))}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-5 text-center text-xs text-ink-2">
        No account yet?{' '}
        <button type="button" onClick={onSignUp} className="font-semibold text-brand hover:underline">
          Sign up
        </button>
      </p>
    </>
  );
}

/** The password box for an account picked from the list, so no email is retyped. */
function UnlockForm({ account, onBack }: { account: AccountSummary; onBack: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, [account.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    try {
      await session.signInAs(account.id, password, remember);
      setPassword('');
    } catch (caught) {
      setError(
        caught instanceof AppError
          ? (caught.fieldError('password') ?? caught.message)
          : messageFor(caught, 'That did not work.'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Initials name={account.name} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{account.name}</h2>
          <p className="truncate text-sm text-ink-2">
            {account.email ?? 'Enter your password to unlock'}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <PasswordInput
          ref={passwordRef}
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error}
        />

        <Switch
          checked={remember}
          onChange={setRemember}
          label="Stay logged in on this device"
          description="Skip the password next time. Only do this on a device that is yours alone."
        />

        <Button type="submit" className="w-full" loading={pending} disabled={!password}>
          Unlock
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 text-xs">
        <button type="button" onClick={onBack} className="font-medium text-brand hover:underline">
          Back
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="font-medium text-negative hover:underline"
        >
          Delete this account
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await session.deleteAccount(account.id);
          setConfirmDelete(false);
          onBack();
          toast.success('Account deleted', 'Its records have been removed from this browser.');
        }}
        title={`Delete "${account.name}"?`}
        message={
          'Everything recorded under this account is erased from this browser. Without the ' +
          'password the records cannot be read anyway, so there is nothing to recover and no undo.'
        }
        confirmLabel="Delete account"
      />
    </>
  );
}

function Initials({ name }: { name: string }) {
  const initials = (name || '?')
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink"
      aria-hidden
    >
      {initials}
    </span>
  );
}

function lastSeen(account: AccountSummary): string {
  const when = account.lastOpenedAt ?? account.createdAt;
  const days = Math.floor((Date.now() - Date.parse(when)) / 86_400_000);
  if (days <= 0) return 'Last opened today';
  if (days === 1) return 'Last opened yesterday';
  if (days < 30) return `Last opened ${days} days ago`;
  return `Last opened ${new Date(when).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
}

// ── Signing up ──────────────────────────────────────────────────────────────

function SignUpForm({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const toast = useToast();
  const legacy = session.legacyLedger;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const strength = useMemo(() => assessPassword(password), [password]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'What should we call you?';
    if (!email.trim()) found.email = 'Enter an email address.';
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      found.password = `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
    } else if (!strength.acceptable) {
      found.password = 'Choose something harder to guess.';
    }
    if (confirm !== password) found.confirm = 'The two passwords do not match.';
    if (!acknowledged) found.acknowledged = 'Please confirm you understand this cannot be reset.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      await session.signUp({ name, email, password, adoptLegacy: Boolean(legacy), remember });
      toast.success(
        legacy ? 'Your records are now protected' : 'Account created',
        legacy ? 'Everything you had recorded is inside this account.' : undefined,
      );
      onDone();
    } catch (caught) {
      if (caught instanceof AppError && caught.details.length > 0) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of caught.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
      } else {
        setErrors({ name: messageFor(caught, 'That account could not be created.') });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-ink">
        {legacy ? 'Protect what you have already recorded' : 'Create your account'}
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        {legacy
          ? 'MoneyFlow now locks your records behind a password. Sign up and everything you ' +
            'have already entered moves into this account.'
          : 'Your password encrypts everything you record. It never leaves this device.'}
      </p>

      {legacy && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-soft p-3 text-xs text-brand-ink">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {legacy.transactions.length} transaction{legacy.transactions.length === 1 ? '' : 's'} across{' '}
          {legacy.accounts.length} account{legacy.accounts.length === 1 ? '' : 's'} will be encrypted
          and kept.
        </p>
      )}

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Input
          label="Your name"
          autoComplete="name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          leftIcon={<UserIcon className="h-4 w-4" aria-hidden />}
          maxLength={60}
        />

        <Input
          label="Email"
          type="email"
          autoComplete="username"
          hint="Used to log in on this device. No mail is ever sent — there is no server to send it."
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          leftIcon={<AtSign className="h-4 w-4" aria-hidden />}
          placeholder="you@example.com"
        />

        <div>
          <PasswordInput
            label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />
          {password && !errors.password && <StrengthMeter assessment={strength} />}
        </div>

        <PasswordInput
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors.confirm}
        />

        {/* The one thing someone must not discover later. */}
        <label
          className={cn(
            'flex cursor-pointer gap-3 rounded-xl border p-3.5 text-xs transition-colors',
            errors.acknowledged ? 'border-negative bg-negative-soft' : 'border-caution/40 bg-caution-soft',
          )}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
          />
          <span className="text-caution">
            <strong className="font-semibold">I understand this password cannot be reset.</strong>{' '}
            It is the key to my records, not a login. If I forget it, nobody — including me — can
            read them again.
          </span>
        </label>
        {errors.acknowledged && (
          <p className="-mt-2 text-xs font-medium text-negative">{errors.acknowledged}</p>
        )}

        <Switch
          checked={remember}
          onChange={setRemember}
          label="Stay logged in on this device"
          description="Skip the password next time. Only do this on a device that is yours alone."
        />

        <Button type="submit" className="w-full" loading={pending}>
          {legacy ? 'Protect my records' : 'Create account'}
        </Button>
      </form>
    </>
  );
}

function StrengthMeter({ assessment }: { assessment: ReturnType<typeof assessPassword> }) {
  const tone =
    assessment.score >= 4 ? 'bg-positive' :
      assessment.score >= 3 ? 'bg-brand' :
        assessment.score >= 2 ? 'bg-caution' : 'bg-negative';
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index < assessment.score ? tone : 'bg-line',
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-2">
        <span className="font-medium text-ink">{assessment.label}</span>
        {assessment.hint && <> — {assessment.hint}</>}
      </p>
    </div>
  );
}

// ── A password field that can be revealed ───────────────────────────────────

/**
 * A password field with a show/hide toggle.
 *
 * Revealing matters more here than on an ordinary login: a typo in a password
 * that cannot be reset is expensive, and this is the only chance to catch one.
 */
const PasswordInput = forwardRef<HTMLInputElement, InputProps>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Input
        {...props}
        ref={ref}
        type={visible ? 'text' : 'password'}
        leftIcon={<Lock className="h-4 w-4" aria-hidden />}
        rightSlot={
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:text-ink"
            aria-label={visible ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        }
      />
    );
  },
);
