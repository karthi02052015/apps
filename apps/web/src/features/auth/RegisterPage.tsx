import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerSchema } from '@taskflow/shared';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

/** Lightweight strength estimate — guidance only; the server enforces the real policy. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
  if (/^(.)\1+$/.test(pw) || /password|123456|qwerty/i.test(pw)) score = Math.min(score, 1);
  return Math.max(1, score) as 1 | 2 | 3 | 4;
}
const STRENGTH = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const STRENGTH_COLOR = ['', 'bg-danger', 'bg-warning', 'bg-accent', 'bg-success'] as const;

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await register(parsed.data);
      navigate('/today', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free, fast, and focused. Takes 20 seconds."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13.5px] text-danger">
            {formError}
          </div>
        ) : null}
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" autoFocus value={form.name} onChange={set('name')} placeholder="Ada Lovelace" />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@company.com" />}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 10 characters with a letter and a number.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        {form.password ? (
          <div className="flex items-center gap-3" aria-live="polite">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className={cn('h-1 flex-1 rounded-full bg-surface-3 transition-colors', i <= strength && STRENGTH_COLOR[strength])} />
              ))}
            </div>
            <span className="w-12 text-right text-[12px] text-muted">{STRENGTH[strength]}</span>
          </div>
        ) : null}
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
