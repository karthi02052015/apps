import {
  forwardRef, useId, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { symbolFor } from '@/lib/money';

/**
 * Form primitives.
 *
 * Every control is wired for accessibility by construction: a real `<label>`
 * bound by id, `aria-invalid` when there is an error, and `aria-describedby`
 * pointing at the hint *and* the error so a screen reader reads both. Nothing
 * here relies on placeholder text to label a field.
 */

const CONTROL =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-ink placeholder:text-ink-3 ' +
  'transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3';

const INVALID = 'border-negative focus:border-negative focus:ring-negative/25';

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-negative" aria-hidden>*</span>}
        </label>
      )}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftIcon, rightSlot, className, containerClassName, required, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden>
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            required={required}
            className={cn(
              CONTROL, 'h-11',
              leftIcon && 'pl-10',
              rightSlot && 'pr-11',
              invalid && INVALID,
              className,
            )}
            {...props}
          />
          {rightSlot && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{rightSlot}</span>
          )}
        </div>
      )}
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, required, rows = 3, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required={required}
          className={cn(CONTROL, 'resize-y py-2.5', invalid && INVALID, className)}
          {...props}
        />
      )}
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, required, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required={required}
          className={cn(
            CONTROL, 'h-11 appearance-none bg-no-repeat pr-10',
            invalid && INVALID,
            className,
          )}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
            backgroundPosition: 'right 0.85rem center',
          }}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
});

export interface AmountInputProps extends Omit<InputProps, 'leftIcon' | 'type' | 'inputMode'> {
  currency: string;
  /** Rendered much larger — used as the hero field of the quick-add sheet. */
  emphasis?: boolean;
}

/**
 * The amount field.
 *
 * `inputMode="decimal"` gives phones a numeric keypad with a decimal point,
 * which is the single biggest factor in hitting the "expense recorded in under
 * ten seconds" target from section 44. Input is filtered to digits and one
 * separator as it is typed, so an invalid amount can never be submitted.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { currency, emphasis = false, className, onChange, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0"
      leftIcon={
        <span className={cn('font-semibold', emphasis ? 'text-2xl text-ink-2' : 'text-base')}>
          {symbolFor(currency)}
        </span>
      }
      onChange={(event) => {
        const cleaned = event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
        if (cleaned !== event.target.value) event.target.value = cleaned;
        onChange?.(event);
      }}
      className={cn(
        'tnum',
        emphasis ? 'h-16 pl-12 text-3xl font-bold' : 'pl-9 text-base font-semibold',
        className,
      )}
      {...props}
    />
  );
});

export function Switch({
  checked, onChange, label, description, disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-ink-2">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-surface-3',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** A compact radio group rendered as a segmented control. */
export function Segmented<T extends string>({
  value, onChange, options, className, size = 'md', ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-xl bg-surface-3 p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
              active
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
