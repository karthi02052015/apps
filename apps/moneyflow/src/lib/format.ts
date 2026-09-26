/**
 * Client-side money formatting.
 *
 * The API only ever sends integer minor units. Formatting happens here, and
 * only here, so a figure can never be accidentally rendered as a raw float or
 * rounded twice. Nothing in the client does arithmetic on money beyond adding
 * integers that the API has already reconciled.
 */
const MINOR_EXPONENT: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, AED: 2, CHF: 2,
  CNY: 2, HKD: 2, NZD: 2, ZAR: 2, SEK: 2, MYR: 2, THB: 2, IDR: 2,
  JPY: 0, KRW: 0, VND: 0,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3,
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
  SGD: 'S$', AED: 'د.إ', CHF: 'CHF', CNY: '¥', HKD: 'HK$', NZD: 'NZ$',
  ZAR: 'R', SEK: 'kr', MYR: 'RM', THB: '฿', IDR: 'Rp', KRW: '₩', VND: '₫',
  KWD: 'KD', BHD: 'BD', OMR: 'OMR', JOD: 'JD',
};

/** Indian currency uses the 2,2,3 grouping; everything else uses its own locale. */
const LOCALE: Record<string, string> = { INR: 'en-IN' };

export function symbolFor(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

export interface FormatOptions {
  /** Drop the decimal part when the amount is whole. Default true. */
  compactDecimals?: boolean;
  /** Always prefix with + or −. */
  signed?: boolean;
  /** Omit the currency symbol. */
  bare?: boolean;
  /** Abbreviate large figures — 12.4L, 3.2Cr for INR; 1.2M elsewhere. */
  abbreviate?: boolean;
}

export function formatMoney(
  minor: number | null | undefined,
  currency = 'INR',
  options: FormatOptions = {},
): string {
  const { compactDecimals = true, signed = false, bare = false, abbreviate = false } = options;
  const value = minor ?? 0;
  const exponent = MINOR_EXPONENT[currency] ?? 2;
  const divisor = 10 ** exponent;
  const negative = value < 0;
  const magnitude = Math.abs(value);
  const locale = LOCALE[currency] ?? 'en-US';
  const symbol = bare ? '' : symbolFor(currency);
  const sign = negative ? '−' : signed ? '+' : '';

  if (abbreviate) {
    const abbreviated = abbreviateMajor(magnitude / divisor, currency, locale);
    if (abbreviated) return `${sign}${symbol}${abbreviated}`;
  }

  const whole = Math.floor(magnitude / divisor);
  const fraction = magnitude % divisor;
  const showFraction = exponent > 0 && (!compactDecimals || fraction !== 0);

  const wholeText = whole.toLocaleString(locale, { maximumFractionDigits: 0 });
  const fractionText = showFraction ? `.${String(fraction).padStart(exponent, '0')}` : '';

  return `${sign}${symbol}${wholeText}${fractionText}`;
}

function abbreviateMajor(major: number, currency: string, locale: string): string | null {
  if (currency === 'INR') {
    if (major >= 10_000_000) return `${trim(major / 10_000_000)} Cr`;
    if (major >= 100_000) return `${trim(major / 100_000)} L`;
    if (major >= 1_000) return `${trim(major / 1_000)} K`;
    return null;
  }
  if (major >= 1_000_000_000) return `${trim(major / 1_000_000_000)}B`;
  if (major >= 1_000_000) return `${trim(major / 1_000_000)}M`;
  if (major >= 1_000) return `${trim(major / 1_000)}K`;
  void locale;
  return null;
}

const trim = (value: number) =>
  value >= 100 ? value.toFixed(0) : value.toFixed(value % 1 === 0 ? 0 : 1);

/** Signed display for a transaction row: +₹50,000 / −₹15,000 / ₹5,000 for a transfer. */
export function formatSigned(
  minor: number,
  type: 'income' | 'expense' | 'transfer' | 'adjustment',
  currency: string,
): string {
  if (type === 'transfer') return formatMoney(minor, currency);
  if (type === 'expense') return `−${formatMoney(minor, currency)}`;
  if (type === 'adjustment') return formatMoney(minor, currency, { signed: minor > 0 });
  return `+${formatMoney(minor, currency)}`;
}

/** Basis points (10 000 = 100%) as a readable percentage. */
export function formatBps(bps: number, decimals = 0): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

/**
 * Parses what a user typed into minor units, exactly — digit by digit, with no
 * floating-point step. Returns null when the input is not a valid amount.
 */
export function parseAmount(input: string, currency = 'INR'): number | null {
  const exponent = MINOR_EXPONENT[currency] ?? 2;
  const cleaned = input.trim().replace(/[\s,₹$€£¥]/g, '');
  if (!cleaned) return null;
  if (!/^-?\d*(?:\.\d*)?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole = '', fraction = ''] = unsigned.split('.');
  if (whole === '' && fraction === '') return null;
  if (fraction.length > exponent) return null;

  const digits = `${whole || '0'}${fraction.padEnd(exponent, '0')}`;
  const magnitude = Number(digits);
  if (!Number.isSafeInteger(magnitude)) return null;
  return negative ? -magnitude : magnitude;
}

/** Minor units back into an editable decimal string for a form field. */
export function toAmountInput(minor: number, currency = 'INR'): string {
  const exponent = MINOR_EXPONENT[currency] ?? 2;
  const divisor = 10 ** exponent;
  const negative = minor < 0;
  const magnitude = Math.abs(minor);
  const whole = Math.floor(magnitude / divisor);
  const fraction = magnitude % divisor;
  const text = exponent === 0 || fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(exponent, '0')}`;
  return negative ? `-${text}` : text;
}
