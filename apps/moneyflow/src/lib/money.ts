/**
 * Money helpers for the UI.
 *
 * Formatting lives in `lib/format`, arithmetic and parsing in `core/money`.
 * This re-exports both under one import so a component never has to know which
 * side of that line a helper sits on — and, more usefully, so no component is
 * ever tempted to do its own arithmetic on a formatted string.
 */
export {
  CURRENCY_SYMBOL, formatBps, formatMoney, formatSigned, parseAmount, symbolFor, toAmountInput,
  type FormatOptions,
} from './format';

export {
  MoneyError, SUPPORTED_CURRENCIES, absMinor, addMinor, allocateMinor, assertMinor,
  decomposeMinor, isSupportedCurrency, minorToDecimalString, minorUnitExponent, negateMinor,
  parseAmountToMinor, ratioBps, scaleMinor, subMinor, sumMinor, type MinorUnits,
} from '../core/money';
