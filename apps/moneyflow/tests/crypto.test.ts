/**
 * Encryption and the account vault.
 *
 * These are the tests that decide whether "your password protects your data"
 * is true or marketing. The properties worth pinning down:
 *
 *   • the right password gets the ledger back, byte for byte;
 *   • the wrong password gets an error, never plausible-looking rubbish;
 *   • two accounts on one device cannot read each other;
 *   • changing a password stops the old one working and keeps the data.
 */
import { describe, expect, it } from 'vitest';
import {
  WrongPasswordError, assessPassword, decryptJson, deriveKey, encryptJson, exportKey,
  fromBase64, importKey, newKdfParams, toBase64,
} from '../src/core/crypto';
import { netWorth } from '../src/core/ledger';
import { createTransaction } from '../src/core/operations';
import { parseDatabase } from '../src/core/schema';
import { looksLikeEmail, normaliseEmail } from '../src/store/persistence';
import { accountByType, categoryByName, freshDb } from './helpers';

/**
 * PBKDF2 at 600,000 rounds is deliberately slow, which is the point in
 * production and a problem in a test suite. These params keep the *shape* of
 * the real thing — random salt, same algorithms, same failure modes — without
 * spending a second per derivation.
 */
const FAST = { salt: newKdfParams().salt, iterations: 1_000 };

function ledger() {
  const base = freshDb();
  return createTransaction(base, {
    type: 'expense',
    amountMinor: 123_456,
    accountId: accountByType(base, 'bank'),
    categoryId: categoryByName(base, 'Food'),
    description: 'Dinner',
  }).db;
}

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });

  it('handles a payload far larger than the call-stack limit', () => {
    // Encoding this naively with String.fromCharCode(...bytes) throws.
    const bytes = new Uint8Array(500_000).fill(200);
    expect(fromBase64(toBase64(bytes)).length).toBe(bytes.length);
  });
});

describe('encrypting a ledger', () => {
  it('returns exactly what went in', async () => {
    const db = ledger();
    const key = await deriveKey('a-good-long-password', FAST);
    const restored = parseDatabase(await decryptJson(key, await encryptJson(key, db)));
    expect(restored.transactions).toHaveLength(1);
    expect(netWorth(restored)).toBe(netWorth(db));
  });

  it('refuses the wrong password rather than returning rubbish', async () => {
    const key = await deriveKey('a-good-long-password', FAST);
    const wrong = await deriveKey('a-good-long-passwerd', FAST);
    const payload = await encryptJson(key, ledger());
    await expect(decryptJson(wrong, payload)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('uses a fresh IV every save, so identical data encrypts differently', async () => {
    const key = await deriveKey('a-good-long-password', FAST);
    const db = ledger();
    const first = await encryptJson(key, db);
    const second = await encryptJson(key, db);
    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
    // Both still decrypt to the same thing.
    expect(await decryptJson(key, second)).toEqual(await decryptJson(key, first));
  });

  it('detects a tampered vault', async () => {
    const key = await deriveKey('a-good-long-password', FAST);
    const payload = await encryptJson(key, ledger());
    const bytes = fromBase64(payload.data);
    bytes[10] = (bytes[10] as number) ^ 0xff;
    await expect(
      decryptJson(key, { iv: payload.iv, data: toBase64(bytes) }),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('gives different accounts different keys from the same password', async () => {
    // Two accounts, same password, different salts — a common case on a shared
    // family laptop, and one vault must not open the other.
    const first = await deriveKey('shared-family-password', newKdfParams());
    const second = await deriveKey('shared-family-password', newKdfParams());
    const payload = await encryptJson(first, ledger());
    await expect(decryptJson(second, payload)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('survives being exported to keep a session and imported back', async () => {
    const key = await deriveKey('a-good-long-password', FAST);
    const payload = await encryptJson(key, ledger());
    const restored = await importKey(await exportKey(key));
    expect(parseDatabase(await decryptJson(restored, payload)).transactions).toHaveLength(1);
  });

  it('changing the password keeps the data and retires the old key', async () => {
    const db = ledger();
    const oldKey = await deriveKey('the-first-password', FAST);
    const vault = await encryptJson(oldKey, db);

    const nextKdf = { salt: newKdfParams().salt, iterations: 1_000 };
    const newKey = await deriveKey('the-second-password', nextKdf);
    const rekeyed = await encryptJson(newKey, await decryptJson(oldKey, vault));

    expect(parseDatabase(await decryptJson(newKey, rekeyed)).transactions).toHaveLength(1);
    await expect(decryptJson(oldKey, rekeyed)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('normalises unicode, so the same typed password always works', async () => {
    // "café" composed vs decomposed: identical on screen, different bytes.
    const composed = 'café-is-my-password';
    const decomposed = 'café-is-my-password';
    const key = await deriveKey(composed, FAST);
    const other = await deriveKey(decomposed, FAST);
    const payload = await encryptJson(key, ledger());
    expect(parseDatabase(await decryptJson(other, payload)).transactions).toHaveLength(1);
  });
});

describe('email as an identifier', () => {
  it('accepts ordinary addresses and rejects obvious typos', () => {
    for (const good of ['karthi@example.com', 'a.b+tag@sub.domain.co.in', 'x@y.io']) {
      expect(looksLikeEmail(good)).toBe(true);
    }
    for (const bad of ['', 'karthi', 'karthi@', '@example.com', 'a b@example.com', 'a@b']) {
      expect(looksLikeEmail(bad)).toBe(false);
    }
  });

  it('folds case and spacing, because nobody remembers how they typed it', () => {
    expect(normaliseEmail('  Karthi@Example.COM ')).toBe('karthi@example.com');
  });
});

describe('password quality', () => {
  it('rejects what an attacker would try first', () => {
    for (const bad of ['password', 'short', '12345678', 'moneyflow']) {
      expect(assessPassword(bad).acceptable).toBe(false);
    }
  });

  it('accepts a long passphrase and rates length highly', () => {
    const weak = assessPassword('abcdefghij');
    const strong = assessPassword('correct-horse-battery-staple-7');
    expect(weak.acceptable).toBe(true);
    expect(strong.acceptable).toBe(true);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.hint).toBe('');
  });

  it('says nothing at all about an empty field', () => {
    expect(assessPassword('')).toMatchObject({ label: '', hint: '', acceptable: false });
  });
});
