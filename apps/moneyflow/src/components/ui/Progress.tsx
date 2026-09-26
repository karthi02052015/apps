import { cn } from '@/lib/cn';

export type ProgressTone = 'brand' | 'positive' | 'caution' | 'negative';

const FILL: Record<ProgressTone, string> = {
  brand: 'bg-brand',
  positive: 'bg-positive',
  caution: 'bg-caution',
  negative: 'bg-negative',
};

export function Progress({
  /** Basis points: 10 000 = 100%. */
  valueBps,
  tone = 'brand',
  size = 'md',
  label,
  className,
}: {
  valueBps: number;
  tone?: ProgressTone;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(valueBps, 10_000));
  const height = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';

  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-surface-3', height, className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped / 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', FILL[tone])}
        style={{ width: `${clamped / 100}%` }}
      />
    </div>
  );
}
