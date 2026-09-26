/**
 * Encryption.
 *
 * There is no server, so a password cannot be *checked* by anything — there is
 * nothing to check it against and nothing to refuse you. The only way a
 * password can mean anything here is if it is the key: your ledger is
 * encrypted with a key derived from it, and without the password the stored
 * bytes are noise.
 *
 * That has a consequence worth stating plainly, because the UI says it too:
 * **a forgotten password cannot be reset.** Not by you, not by anyone. There is
 * no recovery path that would not also be a backdoor.
 *
 * The construction:
 *
 *   password ──PBKDF2-SHA-256, 600k iterations, 16-byte random salt──▶ 256-bit key
 *   ledger JSON ──AES-256-GCM, fresh 12-byte IV per save──▶ stored ciphertext
 *
 * PBKDF2 at 600,000 iterations is the OWASP recommendation for
 * PBKDF2-HMAC-SHA-256, and is what makes a stolen vault expensive to attack
 * offline. AES-GCM is authenticated, so a wrong password does not decrypt to
 * plausible-looking rubbish — it fails, which is exactly how the app knows to
 * say "that password is not right" without storing anything to compare against.
 *
 * All of this is the Web Crypto API, which needs a secure context: HTTPS, or
 * localhost. GitHub Pages is HTTPS. Opening the files over plain `http://` or
 * `file://` will not work, and `isCryptoAvailable` exists so the app can say so
 * rather than failing mysteriously.
 */

/** OWASP's recommended work factor for PBKDF2-HMAC-SHA-256. */
export const PBKDF2_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export class CryptoUnavailableError extends Error {
  constructor() {
    super(
      'This browser cannot encrypt data here. MoneyFlow needs a secure page ' +
        '(https:// or localhost) to protect your ledger.',
    );
    this.name = 'CryptoUnavailableError';
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('That password is not right.');
    this.name = 'WrongPasswordError';
  }
}

export interface KdfParams {
  /** Base64. Random per account, stored alongside the vault — it is not secret. */
  salt: string;
  iterations: number;
}

export interface Encrypted {
  /** Base64. Fresh for every save; reusing one with the same key breaks GCM. */
  iv: string;
  /** Base64 ciphertext, with the GCM authentication tag appended. */
  data: string;
}

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new CryptoUnavailableError();
  return crypto.subtle;
}

export function isCryptoAvailable(): boolean {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto.getRandomValues);
}

// ── Base64 ──────────────────────────────────────────────────────────────────

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  // Chunked: spreading a large array into String.fromCharCode overflows the
  // call stack somewhere around a hundred thousand bytes.
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) throw new CryptoUnavailableError();
  crypto.getRandomValues(bytes);
  return bytes;
}

export function newKdfParams(): KdfParams {
  return { salt: toBase64(randomBytes(SALT_BYTES)), iterations: PBKDF2_ITERATIONS };
}

// ── Keys ────────────────────────────────────────────────────────────────────

/**
 * Stretches a password into an AES-GCM key.
 *
 * Deliberately slow — roughly a quarter of a second on a phone — which is the
 * entire point: it is the cost an attacker pays for every password they guess
 * against a stolen vault.
 *
 * The key is exportable so the app can keep you signed in across a page
 * refresh without asking again (see `store/session.ts`). That is a real
 * trade-off and the Settings page names it.
 */
export async function deriveKey(password: string, params: KdfParams): Promise<CryptoKey> {
  const api = subtle();
  const material = await api.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return api.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(params.salt) as unknown as BufferSource,
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  return toBase64(await subtle().exportKey('raw', key));
}

export async function importKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey(
    'raw',
    fromBase64(raw) as unknown as BufferSource,
    { name: 'AES-GCM', length: KEY_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
}

// ── Encryption ──────────────────────────────────────────────────────────────

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Encrypted> {
  const iv = randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const data = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource,
  );
  return { iv: toBase64(iv), data: toBase64(data) };
}

/**
 * Decrypts, or throws `WrongPasswordError`.
 *
 * AES-GCM verifies the authentication tag before returning anything, so a key
 * derived from the wrong password fails here rather than producing garbage the
 * rest of the app would have to defend against.
 */
export async function decryptJson<T>(key: CryptoKey, payload: Encrypted): Promise<T> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) as unknown as BufferSource },
      key,
      fromBase64(payload.data) as unknown as BufferSource,
    );
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// ── Password quality ────────────────────────────────────────────────────────

/** Short enough to brute-force quickly, whatever the iteration count. */
export const MINIMUM_PASSWORD_LENGTH = 10;

export interface PasswordAssessment {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Shown under the field. Empty once the password is strong. */
  hint: string;
  acceptable: boolean;
}

const COMMON = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwertyuiop',
  'letmein123', 'iloveyou1', 'welcome123', 'admin12345', 'passw0rd!', 'moneyflow',
]);

/**
 * A rough, honest strength estimate.
 *
 * Length dominates, because against PBKDF2 it genuinely does. This does not
 * pretend to be zxcvbn; it exists to stop someone protecting their entire
 * financial history with "money123".
 */
export function assessPassword(password: string): PasswordAssessment {
  const length = password.length;
  if (length === 0) {
    return { score: 0, label: '', hint: '', acceptable: false };
  }
  if (COMMON.has(password.toLowerCase())) {
    return {
      score: 0,
      label: 'Too common',
      hint: 'That is one of the first passwords anyone would try.',
      acceptable: false,
    };
  }
  if (length < MINIMUM_PASSWORD_LENGTH) {
    return {
      score: length >= 7 ? 1 : 0,
      label: 'Too short',
      hint: `Use at least ${MINIMUM_PASSWORD_LENGTH} characters — there is no way to reset this one.`,
      acceptable: false,
    };
  }

  let score = 1;
  if (length >= 12) score += 1;
  if (length >= 16) score += 1;
  const variety =
    Number(/[a-z]/.test(password)) + Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) + Number(/[^A-Za-z0-9]/.test(password));
  if (variety >= 3) score += 1;

  const capped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return {
    score: capped,
    label: labels[capped] as string,
    hint:
      capped >= 3
        ? ''
        : 'A few more words, or a longer phrase, makes this much harder to break.',
    acceptable: true,
  };
}
