/**
 * Decimal-safe money handling.
 *
 * Money is represented everywhere — in storage, in the UI, in every
 * calculation — as a signed integer count of *minor units* (paise for INR,
 * cents for USD). There is no floating-point arithmetic in the money path at
 * all: `0.1 + 0.2 !== 0.3` in IEEE-754, and in a ledger that error compounds
 * until the balance stops matching the sum of its parts.
 *
 * Why an integer `number` rather than `bigint`:
 *   `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 paise, which is about
 *   ₹90,071,992,547,409 — roughly ninety trillion rupees. Every arithmetic
 *   operation in this module asserts the result stayed inside that range, so an
 *   overflow raises rather than silently losing precision. This keeps JSON
 *   serialisation simple while remaining exact.
 */

export type MinorUnits = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Number of minor units in one major unit, by ISO-4217 code. */
const MINOR_UNIT_EXPONENT: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, AED: 2,
  CHF: 2, CNY: 2, HKD: 2, NZD: 2, ZAR: 2, SEK: 2, MYR: 2, THB: 2,
  JPY: 0, KRW: 0, VND: 0, IDR: 2,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3,
};

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_UNIT_EXPONENT).sort();

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;
}

export function isSupportedCurrency(currency: string): boolean {
  return Object.prototype.hasOwnProperty.call(MINOR_UNIT_EXPONENT, currency.toUpperCase());
}

/** Throws unless `value` is a safe integer. Every public helper funnels through this. */
export function assertMinor(value: unknown, label = 'amount'): MinorUnits {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number of minor units`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of minor units (got ${value})`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range`);
  }
  return value;
}

/** Adds minor-unit amounts, refusing to return a silently-truncated result. */
export function addMinor(...values: MinorUnits[]): MinorUnits {
  let total = 0;
  for (const value of values) total += assertMinor(value);
  return assertMinor(total, 'sum');
}

export function subMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return assertMinor(assertMinor(a) - assertMinor(b), 'difference');
}

export function negateMinor(a: MinorUnits): MinorUnits {
  return assertMinor(-assertMinor(a));
}

export function absMinor(a: MinorUnits): MinorUnits {
  return Math.abs(assertMinor(a));
}

export function sumMinor(values: readonly MinorUnits[]): MinorUnits {
  return addMinor(...values);
}

/**
 * Multiplies money by a plain ratio (for example a budget's 80% threshold).
 * The caller must choose a rounding mode explicitly — money is never rounded
 * implicitly anywhere in this codebase (Rule 10).
 */
export function scaleMinor(
  amount: MinorUnits,
  factor: number,
  rounding: 'floor' | 'ceil' | 'half-up' = 'half-up',
): MinorUnits {
  assertMinor(amount);
  if (!Number.isFinite(factor)) throw new MoneyError('scale factor must be finite');
  const exact = amount * factor;
  if (!Number.isFinite(exact)) throw new MoneyError('scaled amount overflowed');
  let result: number;
  switch (rounding) {
    case 'floor':
      result = Math.floor(exact);
      break;
    case 'ceil':
      result = Math.ceil(exact);
      break;
    default:
      // Half-up away from zero, so -2.5 -> -3 and 2.5 -> 3 (symmetric).
      result = exact < 0 ? -Math.round(-exact) : Math.round(exact);
  }
  return assertMinor(result, 'scaled amount');
}

/**
 * Basis points (1/100th of a percent) of `part` relative to `whole`.
 * Integer maths only; returns 0 when `whole` is 0 rather than NaN/Infinity.
 */
export function ratioBps(part: MinorUnits, whole: MinorUnits): number {
  assertMinor(part);
  assertMinor(whole);
  if (whole === 0) return 0;
  return Math.round((part * 10_000) / whole);
}

const DECIMAL_INPUT = /^-?\d{1,15}(?:\.\d{0,6})?$/;

/**
 * Resolves which separators are grouping marks and which one is the decimal
 * point, and rejects anything that is neither.
 *
 * The rules, in order:
 *   • Grouping marks must all be the same character.
 *   • Several identical separators with no different final one means they are
 *     all grouping marks and there is no fractional part ("12,34,567").
 *   • Otherwise the final separator is the decimal point.
 *   • Every group after the first must be two or three digits, which covers
 *     both Western (1,234,567) and Indian (12,34,567) grouping and rejects
 *     malformed input such as "1.2.3".
 *
 * Being strict here matters: silently reading "1.2.3" as 1.23 would put a
 * wrong number into someone's ledger.
 */
function normaliseSeparators(cleaned: string, original: string): string {
  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  if (body.includes('-')) throw new MoneyError(`"${original}" is not a valid amount`);

  const separators = body.match(/[.,]/g) ?? [];
  const sign = negative ? '-' : '';

  if (separators.length === 0) return `${sign}${body}`;

  const lastIndex = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
  const lastChar = body[lastIndex] as string;
  const leading = separators.slice(0, -1);

  if (leading.length > 0 && new Set(leading).size > 1) {
    throw new MoneyError(`"${original}" is not a valid amount`);
  }

  const groupingChar = leading[0];
  // All separators identical and more than one: every one is a grouping mark.
  const lastIsGrouping = groupingChar !== undefined && groupingChar === lastChar;

  const wholeSource = lastIsGrouping ? body : body.slice(0, lastIndex);
  const fraction = lastIsGrouping ? '' : body.slice(lastIndex + 1);

  if (/[.,]/.test(fraction)) throw new MoneyError(`"${original}" is not a valid amount`);

  const groups = wholeSource.split(/[.,]/);
  if (groups.length > 1) {
    const [first, ...rest] = groups as [string, ...string[]];
    if (!/^\d{1,3}$/.test(first)) throw new MoneyError(`"${original}" is not a valid amount`);
    for (const group of rest) {
      if (!/^\d{2,3}$/.test(group)) throw new MoneyError(`"${original}" is not a valid amount`);
    }
  }

  const whole = groups.join('');
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * Parses user input ("1,234.56", "1234.5", "₹1 200") into minor units, exactly.
 *
 * The fractional part is parsed digit-by-digit rather than via `parseFloat`, so
 * there is no binary-floating-point step anywhere. More fractional digits than
 * the currency supports is an error, not a silent rounding (Rule 10).
 */
export function parseAmountToMinor(input: string | number, currency = 'INR'): MinorUnits {
  const exponent = minorUnitExponent(currency);

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('Amount must be a finite number');
    return parseAmountToMinor(input.toFixed(exponent), currency);
  }

  /*
   * Currency symbols and surrounding spacing are stripped, and what is left has
   * to be *entirely* digits, separators and an optional sign.
   *
   * Deleting every unrecognised character instead would turn "1e5" into 15 and
   * "12abc34" into 1234 — a silently wrong amount, which is the one outcome
   * this function exists to prevent. Rejecting is the only safe answer to input
   * nobody can interpret with confidence.
   */
  const stripped = String(input)
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/^[^\d,.-]+/, '')
    .replace(/[^\d,.]+$/, '');

  if (!stripped) throw new MoneyError('Amount is required');
  if (!/^-?[\d.,]+$/.test(stripped)) throw new MoneyError(`"${input}" is not a valid amount`);
  const cleaned = stripped;

  const normalised = normaliseSeparators(cleaned, String(input));

  if (!DECIMAL_INPUT.test(normalised)) {
    throw new MoneyError(`"${input}" is not a valid amount`);
  }

  const negative = normalised.startsWith('-');
  const unsigned = negative ? normalised.slice(1) : normalised;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  if (fraction.length > exponent) {
    throw new MoneyError(
      `${currency} supports at most ${exponent} decimal place${exponent === 1 ? '' : 's'}`,
    );
  }

  const paddedFraction = fraction.padEnd(exponent, '0');
  const digits = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  const magnitude = Number(digits === '' ? '0' : digits);

  if (!Number.isSafeInteger(magnitude)) throw new MoneyError('Amount is too large');
  return negative ? -magnitude : magnitude;
}

/** Splits minor units into the parts needed for display. */
export function decomposeMinor(amount: MinorUnits, currency = 'INR') {
  assertMinor(amount);
  const exponent = minorUnitExponent(currency);
  const divisor = 10 ** exponent;
  const negative = amount < 0;
  const magnitude = Math.abs(amount);
  return {
    negative,
    whole: Math.floor(magnitude / divisor),
    fraction: magnitude % divisor,
    exponent,
  };
}

/** Plain decimal string, no grouping or symbol — used for CSV and API detail. */
export function minorToDecimalString(amount: MinorUnits, currency = 'INR'): string {
  const { negative, whole, fraction, exponent } = decomposeMinor(amount, currency);
  const sign = negative ? '-' : '';
  if (exponent === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(fraction).padStart(exponent, '0')}`;
}

/**
 * Splits `amount` into `parts` shares that sum back to exactly `amount`.
 * The remainder is distributed one minor unit at a time, so nothing is lost.
 */
export function allocateMinor(amount: MinorUnits, parts: number): MinorUnits[] {
  assertMinor(amount);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError('parts must be a positive integer');
  }
  const base = Math.trunc(amount / parts);
  const remainder = amount - base * parts;
  const step = remainder >= 0 ? 1 : -1;
  const shares = new Array<number>(parts).fill(base);
  for (let i = 0; i < Math.abs(remainder); i += 1) {
    shares[i] = (shares[i] as number) + step;
  }
  return shares;
}

/**
 * Reads a money value that came from storage or an imported file.
 *
 * Anything that is not an exact integer is rejected rather than coerced — a
 * corrupt or hand-edited backup should fail loudly at the boundary, not turn
 * into a wrong balance deep inside a report.
 */
export function minorFromStorage(
  value: string | number | null | undefined,
  fallback = 0,
): MinorUnits {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MoneyError(`Stored value is not a number: ${String(value)}`);
  }
  return assertMinor(parsed, 'stored amount');
}
