import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Briefcase, Check, GraduationCap, Laptop, Target, Users, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';
import { parseAmount, symbolFor } from '@/lib/money';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useLedger } from '@/store/LedgerProvider';
import { completeSetup } from '@/core/operations';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { AmountInput, Input } from '@/components/ui/Field';

const PURPOSES = [
  { value: 'personal', label: 'Personal', hint: 'Just my own money', icon: Wallet },
  { value: 'family', label: 'Family', hint: 'Household spending', icon: Users },
  { value: 'business', label: 'Business', hint: 'A shop or company', icon: Briefcase },
  { value: 'student', label: 'Student', hint: 'Allowance and expenses', icon: GraduationCap },
  { value: 'freelance', label: 'Freelance', hint: 'Irregular project income', icon: Laptop },
  { value: 'other', label: 'Something else', hint: '', icon: Target },
];

const STEPS = ['Your balance', 'How you use it', 'A first goal'] as const;

/**
 * First-run setup (section 6).
 *
 * Three questions, each on its own screen, and only the first is required. The
 * opening balance matters because every figure in the app is derived from it —
 * without it the dashboard would open at zero and be quietly wrong.
 */
export function SetupWizard() {
  const user = useCurrentUser();
  const { apply } = useLedger();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [purpose, setPurpose] = useState('personal');
  const [wantsGoal, setWantsGoal] = useState<boolean | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const currency = user.currency;

  function next() {
    if (step === 0) {
      const minor = parseAmount(openingBalance, currency);
      if (minor === null) {
        setErrors({ openingBalance: 'Enter the amount you have right now.' });
        return;
      }
      if (minor < 0) {
        setErrors({ openingBalance: 'Use zero if you are starting from nothing.' });
        return;
      }
    }
    setErrors({});
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  }

  function finish() {
    if (wantsGoal) {
      const found: Record<string, string> = {};
      if (!goalName.trim()) found.goalName = 'Give the goal a name.';
      const target = parseAmount(goalTarget, currency);
      if (target === null || target <= 0) found.goalTarget = 'Enter a target amount.';
      if (Object.keys(found).length) {
        setErrors(found);
        return;
      }
    }

    setPending(true);
    try {
      // One operation, so the balance, the purpose and the goal are all saved
      // together or not at all.
      apply((db) =>
        completeSetup(db, {
          openingBalanceMinor: parseAmount(openingBalance, currency) ?? 0,
          moneyPurpose: purpose as never,
          name: name.trim(),
          ...(wantsGoal
            ? {
                goal: {
                  name: goalName.trim(),
                  targetMinor: parseAmount(goalTarget, currency) ?? 0,
                  targetDate: goalDate || null,
                },
              }
            : {}),
        }));
      toast.success('You are all set', 'Start by recording what you spend today.');
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof AppError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of error.details) fieldErrors[issue.field] = issue.message;
        setErrors(fieldErrors);
        toast.error(error.message);
      } else {
        toast.error('That did not save', 'Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-5 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-lg">
        {/* Progress */}
        <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  index < step ? 'bg-positive text-white'
                    : index === step ? 'bg-brand text-white'
                    : 'bg-surface-3 text-ink-3',
                )}
                aria-current={index === step ? 'step' : undefined}
              >
                {index < step ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
              </span>
              <span className={cn('hidden text-xs font-medium sm:block', index === step ? 'text-ink' : 'text-ink-3')}>
                {label}
              </span>
              {index < STEPS.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden />}
            </li>
          ))}
        </ol>

        <div className="card p-6 sm:p-8">
          {step === 0 && (
            <div className="animate-slide-up">
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                What is your current balance?
              </h1>
              <p className="mt-2 text-sm text-ink-2">
                Add up what is in your main bank account right now. Everything you record
                from here builds on this number — and you can adjust it any time.
              </p>

              <div className="mt-6">
                <Input
                  autoFocus
                  label="What should we call you?"
                  hint="Optional — it only appears in the greeting on your dashboard."
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="given-name"
                />
              </div>

              <div className="mt-4">
                <AmountInput
                  currency={currency}
                  emphasis
                  label="Opening balance"
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                  error={errors.openingBalance}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {['0', '5000', '10000', '25000', '50000'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setOpeningBalance(preset)}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
                  >
                    {symbolFor(currency)}
                    {Number(preset).toLocaleString('en-IN')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="animate-slide-up">
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                What do you mainly use your money for?
              </h1>
              <p className="mt-2 text-sm text-ink-2">
                This only shapes the wording and suggestions you see. Nothing is locked in.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PURPOSES.map((option) => {
                  const active = purpose === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPurpose(option.value)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all',
                        active
                          ? 'border-brand bg-brand-soft ring-1 ring-brand'
                          : 'border-line bg-surface hover:border-ink-3',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                          active ? 'bg-brand text-white' : 'bg-surface-3 text-ink-2',
                        )}
                        aria-hidden
                      >
                        <option.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{option.label}</span>
                        {option.hint && <span className="block truncate text-xs text-ink-2">{option.hint}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-slide-up">
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                Would you like to set a savings goal?
              </h1>
              <p className="mt-2 text-sm text-ink-2">
                A goal gives your saving a target to aim at. You can skip this and add one later.
              </p>

              {wantsGoal === null && (
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Button size="lg" onClick={() => setWantsGoal(true)}>
                    Yes, set one up
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => { setWantsGoal(false); finish(); }}>
                    Skip for now
                  </Button>
                </div>
              )}

              {wantsGoal && (
                <div className="mt-6 space-y-4">
                  <Input
                    label="What are you saving for?"
                    placeholder="New laptop, emergency fund, a trip…"
                    autoFocus
                    value={goalName}
                    onChange={(event) => setGoalName(event.target.value)}
                    error={errors.goalName}
                    maxLength={60}
                  />
                  <AmountInput
                    currency={currency}
                    label="Target amount"
                    value={goalTarget}
                    onChange={(event) => setGoalTarget(event.target.value)}
                    error={errors.goalTarget}
                  />
                  <Input
                    label="Target date"
                    type="date"
                    hint="Optional — we will work out what to set aside each month."
                    value={goalDate}
                    onChange={(event) => setGoalDate(event.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? (
              <Button
                variant="ghost"
                onClick={() => setStep((value) => value - 1)}
                leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}
                disabled={pending}
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {step < STEPS.length - 1 ? (
              <Button onClick={next} rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
                Continue
              </Button>
            ) : wantsGoal ? (
              <Button onClick={() => finish()} loading={pending}>
                Create goal and finish
              </Button>
            ) : null}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-ink-3">
          Everything you record stays in this browser. Nothing is uploaded anywhere.
        </p>
      </div>
    </div>
  );
}
