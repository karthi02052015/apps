/**
 * The money primitives.
 *
 * These are the tests that stop a rounding bug reaching a balance. Everything
 * the app shows is built on `parseAmountToMinor` and the integer arithmetic
 * around it, so a defect here would be invisible until someone's total was
 * quietly wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  MoneyError, allocateMinor, assertMinor, minorToDecimalString, parseAmountToMinor, ratioBps,
  scaleMinor, sumMinor,
} from '../src/core/money';

describe('parseAmountToMinor', () => {
  it('reads plain decimals exactly', () => {
    expect(parseAmountToMinor('10', 'INR')).toBe(1000);
    expect(parseAmountToMinor('10.5', 'INR')).toBe(1050);
    expect(parseAmountToMinor('10.55', 'INR')).toBe(1055);
    expect(parseAmountToMinor('0.01', 'INR')).toBe(1);
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; parsing the text avoids it.
    expect(parseAmountToMinor('0.1', 'INR') + parseAmountToMinor('0.2', 'INR')).toBe(
      parseAmountToMinor('0.3', 'INR'),
    );
    expect(parseAmountToMinor('1234567.89', 'INR')).toBe(123_456_789);
  });

  it('accepts grouped input in both conventions', () => {
    expect(parseAmountToMinor('1,00,000', 'INR')).toBe(10_000_000);
    expect(parseAmountToMinor('1,000.50', 'USD')).toBe(100_050);
    expect(parseAmountToMinor('1.000,50', 'EUR')).toBe(100_050);
  });

  it('rejects ambiguity rather than guessing', () => {
    // The bug this exists to prevent: "1.2.3" once parsed as 1.23.
    expect(() => parseAmountToMinor('1.2.3', 'INR')).toThrow(MoneyError);
    expect(() => parseAmountToMinor('', 'INR')).toThrow(MoneyError);
    expect(() => parseAmountToMinor('abc', 'INR')).toThrow(MoneyError);
    // These once silently became 15 and 1234 by having their letters deleted.
    expect(() => parseAmountToMinor('1e5', 'INR')).toThrow(MoneyError);
    expect(() => parseAmountToMinor('12abc34', 'INR')).toThrow(MoneyError);
  });

  it('refuses to silently drop sub-unit precision', () => {
    expect(() => parseAmountToMinor('10.555', 'INR')).toThrow(MoneyError);
    // JPY has no minor unit at all.
    expect(() => parseAmountToMinor('10.5', 'JPY')).toThrow(MoneyError);
    expect(parseAmountToMinor('10', 'JPY')).toBe(10);
  });
});

describe('minorToDecimalString', () => {
  it('round-trips through parsing', () => {
    for (const value of [0, 1, 99, 100, 123_456_789, -4_500]) {
      expect(parseAmountToMinor(minorToDecimalString(value, 'INR'), 'INR')).toBe(value);
    }
  });

  it('pads the fraction to the currency exponent', () => {
    expect(minorToDecimalString(5, 'INR')).toBe('0.05');
    expect(minorToDecimalString(1000, 'INR')).toBe('10.00');
    expect(minorToDecimalString(1000, 'JPY')).toBe('1000');
  });
});

describe('assertMinor', () => {
  it('rejects anything that is not a whole number of minor units', () => {
    expect(() => assertMinor(10.5)).toThrow(MoneyError);
    expect(() => assertMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => assertMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => assertMinor('100' as unknown)).toThrow(MoneyError);
    expect(assertMinor(-250)).toBe(-250);
  });
});

describe('scaleMinor', () => {
  it('requires the caller to choose a rounding mode', () => {
    // 0.125 is exact in binary, so the only thing under test is the rounding.
    expect(scaleMinor(1001, 0.125, 'floor')).toBe(125);
    expect(scaleMinor(1001, 0.125, 'ceil')).toBe(126);
    expect(scaleMinor(1004, 0.125, 'half-up')).toBe(126); // 125.5
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(scaleMinor(-1004, 0.125, 'half-up')).toBe(-126);
  });
});

describe('allocateMinor', () => {
  it('splits without losing or inventing a single unit', () => {
    const parts = allocateMinor(1000, 3);
    expect(sumMinor(parts)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });

  it('handles a negative total the same way', () => {
    const parts = allocateMinor(-1000, 3);
    expect(sumMinor(parts)).toBe(-1000);
  });
});

describe('ratioBps', () => {
  it('reports hundredths of a percent', () => {
    expect(ratioBps(50, 100)).toBe(5000);
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(0, 0)).toBe(0); // no division by zero
  });
});
