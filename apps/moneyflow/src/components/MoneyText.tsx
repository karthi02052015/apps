import { cn } from '@/lib/cn';
import { formatMoney, formatSigned } from '@/lib/money';
import type { TransactionType } from '@/types/api';

/**
 * Money on screen.
 *
 * Colour is never the only carrier of meaning (section 54): an amount always
 * shows an explicit + or − sign, and the surrounding row always names the
 * transaction type. The `aria-label` spells the value out so a screen reader
 * says "minus 15,000 rupees" rather than reading a bare glyph.
 */
export function MoneyText({
  minor,
  currency,
  type,
  tone,
  className,
  abbreviate = false,
  compactDecimals = true,
}: {
  minor: number;
  currency: string;
  type?: TransactionType;
  tone?: 'positive' | 'negative' | 'neutral' | 'auto';
  className?: string;
  abbreviate?: boolean;
  compactDecimals?: boolean;
}) {
  const text = type
    ? formatSigned(minor, type, currency)
    : formatMoney(minor, currency, { abbreviate, compactDecimals });

  const resolvedTone =
    tone === 'auto' || tone === undefined
      ? type === 'income'
        ? 'positive'
        : type === 'expense'
          ? 'negative'
          : type === 'transfer'
            ? 'neutral'
            : minor < 0
              ? 'negative'
              : 'neutral'
      : tone;

  const spoken = `${minor < 0 || type === 'expense' ? 'minus ' : ''}${formatMoney(
    Math.abs(minor),
    currency,
    { bare: true },
  )} ${currency}`;

  return (
    <span
      className={cn(
        'tnum font-semibold',
        resolvedTone === 'positive' && 'text-positive',
        resolvedTone === 'negative' && 'text-negative',
        resolvedTone === 'neutral' && 'text-ink',
        className,
      )}
      aria-label={spoken}
    >
      {text}
    </span>
  );
}

/** A large hero figure for the balance card. */
/**
 * The headline balance.
 *
 * Two things shrink it, because a clipped balance is the single worst thing
 * this app could show:
 *
 *   • **Length.** ₹1,49,306 needs far more room than ₹500, and a rupee balance
 *     reaches seven figures quickly.
 *   • **Its column.** The card is full width on a phone and one of four on a
 *     wide screen, so the largest size is dropped again at `xl`, where the card
 *     is at its narrowest.
 *
 * Stepping on the rendered string covers currency symbols and grouping without
 * measuring anything at runtime.
 */
function heroSize(text: string): string {
  if (text.length > 12) return 'text-2xl sm:text-3xl xl:text-2xl';
  if (text.length > 8) return 'text-3xl sm:text-4xl xl:text-3xl';
  return 'text-4xl sm:text-5xl xl:text-4xl';
}

export function MoneyHero({
  minor, currency, className,
}: {
  minor: number;
  currency: string;
  className?: string;
}) {
  const text = formatMoney(minor, currency, { compactDecimals: true });
  return (
    <p
      className={cn('tnum font-bold tracking-tight tabular-nums', heroSize(text), className)}
      aria-label={`${formatMoney(minor, currency, { bare: true })} ${currency}`}
    >
      {text}
    </p>
  );
}
