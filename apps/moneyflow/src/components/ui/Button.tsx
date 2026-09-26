import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant =
  | 'primary' | 'secondary' | 'ghost' | 'danger' | 'positive' | 'outline' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-sm hover:bg-brand/90 active:bg-brand/95 disabled:bg-brand/50',
  secondary:
    'bg-surface-3 text-ink hover:bg-line/70 active:bg-line',
  outline:
    'border border-line bg-surface text-ink hover:bg-surface-2 active:bg-surface-3',
  ghost:
    'text-ink-2 hover:bg-surface-3 hover:text-ink active:bg-line/60',
  danger:
    'bg-negative text-white shadow-sm hover:bg-negative/90 active:bg-negative/95',
  positive:
    'bg-positive text-white shadow-sm hover:bg-positive/90 active:bg-positive/95',
  link:
    'text-brand underline-offset-4 hover:underline p-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * The one button. `loading` disables interaction *and* announces busy state,
 * so a slow save cannot be double-submitted by an impatient click or by a
 * screen-reader user who has no spinner to see.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon,
    fullWidth, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
