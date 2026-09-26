import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { swatch } from '@/lib/tokens';

export type BadgeTone = 'neutral' | 'brand' | 'positive' | 'negative' | 'caution';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  caution: 'bg-caution-soft text-caution',
};

export function Badge({
  children, tone = 'neutral', className, icon,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * A category chip. Colour is never the only signal — the name is always
 * present, which is what keeps this readable for colour-blind users (section 54).
 */
export function CategoryBadge({
  name, color, className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium',
        swatch(color).chip,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', swatch(color).dot)} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}
