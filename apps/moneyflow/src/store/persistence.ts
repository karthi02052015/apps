/**
 * Where the data lives.
 *
 * There is no server, so the browser *is* the database. Each account is one
 * record holding its salt and its encrypted vault; the ledger inside that
 * vault is unreadable without the account's password. This file never sees a
 * password — it takes a key that someone else derived, or ciphertext it cannot
 * open.
 *
 * Durability is this file's other job, and it takes it seriously:
 *
 *  • **IndexedDB first.** Asynchronous, no practical size limit for a dataset
 *    like this, and stores structured objects rather than strings.
 *  • **localStorage as a fallback.** Private windows, locked-down enterprise
 *    profiles and a few older browsers refuse IndexedDB outright. A money
 *    tracker that throws on open is worse than one with a 5 MB ceiling. The
 *    vault is base64 either way, so nothing is lost but headroom.
 *  • **Writes are debounced and coalesced.** Typing in a form can produce
 *    dozens of state changes a second, and each save costs an encryption pass.
 *    The latest value always wins, and `flush()` forces a write before the tab
 *    closes.
 *
 * Nothing here ever throws at the caller for a storage failure. It degrades to
 * "works until you reload", which the UI surfaces — it does not lose the
 * user's work mid-session.
 */
import type { Database } from '../core/types';
import { parseDatabase } from '../core/schema';
import {
  decryptJson, encryptJson, newKdfParams, type Encrypted, type KdfParams,
} from '../core/crypto';

const DB_NAME = 'moneyflow';
/** v2 added the `accounts` store. v1 held a single unencrypted ledger. */
const DB_VERSION = 2;
const LEGACY_STORE = 'state';
const LEGACY_KEY = 'database';
const ACCOUNTS_STORE = 'accounts';
const LEGACY_LOCAL_KEY = 'moneyflow:database';
const ACCOUNTS_LOCAL_KEY = 'moneyflow:accounts';

/** How long to wait for further changes before writing. */
const WRITE_DELAY_MS = 500;

export type StorageKind = 'indexeddb' | 'localstorage' | 'memory';

/**
 * One account, as stored.
 *
 * Everything here except `vault` is readable by anyone with access to the
 * browser profile — the name and the dates are not secret, and the salt is not
 * meant to be. `vault` is the ledger, and it is not readable at all.
 */
export interface AccountRecord {
  id: string;
  name: string;
  /**
   * The address you sign in with.
   *
   * Nothing is ever sent to it — there is nowhere to send from. It is an
   * identifier, chosen because it is the one people already remember and
   * because typing it is how signing in is supposed to feel. Optional on the
   * type because accounts created before sign-up asked for one still open
   * from the picker.
   */
  email?: string;
  kdf: KdfParams;
  vault: Encrypted;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

/** What the sign-in screen shows: everything but the ciphertext. */
export type AccountSummary = Omit<AccountRecord, 'vault' | 'kdf'>;

export function toSummary(record: AccountRecord): AccountSummary {
  const { vault, kdf, ...summary } = record;
  void vault;
  void kdf;
  return summary;
}

// ── IndexedDB plumbing ──────────────────────────────────────────────────────

function openIndexedDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let idb: IDBFactory | undefined;
    try {
      idb = globalThis.indexedDB;
    } catch {
      resolve(null);
      return;
    }
    if (!idb) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: IDBDatabase | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // Firefox in private mode fires neither success nor error on a blocked
    // open, so an unanswered request must not hang the app forever.
    const timer = setTimeout(() => finish(null), 3000);

    let request: IDBOpenDBRequest;
    try {
      request = idb.open(DB_NAME, DB_VERSION);
    } catch {
      clearTimeout(timer);
      finish(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      // The legacy store is kept, not dropped: it may still hold an
      // unencrypted ledger from before accounts existed, and that is someone's
      // financial history. `readLegacy` migrates it, and only then is it removed.
      if (!database.objectStoreNames.contains(LEGACY_STORE)) database.createObjectStore(LEGACY_STORE);
      if (!database.objectStoreNames.contains(ACCOUNTS_STORE)) {
        database.createObjectStore(ACCOUNTS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      finish(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      finish(null);
    };
  });
}

function request<T>(build: (store: IDBObjectStore) => IDBRequest<T>, store: IDBObjectStore): Promise<T> {
  return new Promise((resolve, reject) => {
    const pending = build(store);
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

// ── The store ───────────────────────────────────────────────────────────────

export class LocalStore {
  private handle: IDBDatabase | null = null;

  private kind: StorageKind = 'memory';

  private opened = false;

  private pending: { accountId: string; db: Database; key: CryptoKey } | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;

  private writing = false;

  /** Set when the last write failed, so the UI can say data is not being saved. */
  lastError: string | null = null;

  storageKind(): StorageKind {
    return this.kind;
  }

  private async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    this.handle = await openIndexedDb();
    if (this.handle) {
      this.kind = 'indexeddb';
      return;
    }
    try {
      globalThis.localStorage?.getItem(ACCOUNTS_LOCAL_KEY);
      this.kind = 'localstorage';
    } catch {
      this.kind = 'memory';
    }
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  private readLocalAccounts(): Record<string, AccountRecord> {
    try {
      const raw = globalThis.localStorage?.getItem(ACCOUNTS_LOCAL_KEY);
      return raw ? (JSON.parse(raw) as Record<string, AccountRecord>) : {};
    } catch {
      return {};
    }
  }

  private writeLocalAccounts(accounts: Record<string, AccountRecord>): void {
    globalThis.localStorage?.setItem(ACCOUNTS_LOCAL_KEY, JSON.stringify(accounts));
  }

  async listAccounts(): Promise<AccountSummary[]> {
    await this.open();
    const records = await this.allAccounts();
    return records
      .map(toSummary)
      // Most recently used first: the person signing in is usually the last one
      // who did.
      .sort((a, b) =>
        (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt));
  }

  private async allAccounts(): Promise<AccountRecord[]> {
    if (this.handle) {
      try {
        const tx = this.handle.transaction(ACCOUNTS_STORE, 'readonly');
        return await request<AccountRecord[]>((store) => store.getAll(), tx.objectStore(ACCOUNTS_STORE));
      } catch (error) {
        this.lastError = describe(error);
        return [];
      }
    }
    return Object.values(this.readLocalAccounts());
  }

  /** Finds the account an address belongs to, case-insensitively. */
  async findByEmail(email: string): Promise<AccountRecord | null> {
    await this.open();
    const wanted = normaliseEmail(email);
    const found = (await this.allAccounts()).find(
      (record) => record.email && normaliseEmail(record.email) === wanted,
    );
    return found ?? null;
  }

  async getAccount(id: string): Promise<AccountRecord | null> {
    await this.open();
    if (this.handle) {
      try {
        const tx = this.handle.transaction(ACCOUNTS_STORE, 'readonly');
        const found = await request<AccountRecord | undefined>(
          (store) => store.get(id),
          tx.objectStore(ACCOUNTS_STORE),
        );
        return found ?? null;
      } catch {
        return null;
      }
    }
    return this.readLocalAccounts()[id] ?? null;
  }

  async putAccount(record: AccountRecord): Promise<void> {
    await this.open();
    if (this.handle) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.handle!.transaction(ACCOUNTS_STORE, 'readwrite');
        tx.objectStore(ACCOUNTS_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return;
    }
    const accounts = this.readLocalAccounts();
    accounts[record.id] = record;
    this.writeLocalAccounts(accounts);
  }

  async deleteAccount(id: string): Promise<void> {
    await this.open();
    if (this.pending?.accountId === id) this.pending = null;
    if (this.handle) {
      await new Promise<void>((resolve) => {
        const tx = this.handle!.transaction(ACCOUNTS_STORE, 'readwrite');
        tx.objectStore(ACCOUNTS_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      return;
    }
    const accounts = this.readLocalAccounts();
    delete accounts[id];
    this.writeLocalAccounts(accounts);
  }

  // ── Creating and opening a vault ──────────────────────────────────────────

  /** Encrypts a fresh ledger into a new account record. */
  async createAccount(
    input: { id: string; name: string; email: string; key: CryptoKey; kdf: KdfParams; db: Database },
  ): Promise<AccountRecord> {
    const timestamp = new Date().toISOString();
    const record: AccountRecord = {
      id: input.id,
      name: input.name,
      email: input.email,
      kdf: input.kdf,
      vault: await encryptJson(input.key, input.db),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };
    await this.putAccount(record);
    return record;
  }

  /**
   * Decrypts an account's ledger, or throws `WrongPasswordError`.
   *
   * The parse afterwards is the same boundary every other load goes through:
   * decryption proves the bytes are ours, it does not prove they are
   * well-formed.
   */
  async openVault(record: AccountRecord, key: CryptoKey): Promise<Database> {
    const raw = await decryptJson<unknown>(key, record.vault);
    return parseDatabase(raw);
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  /** Queues a save. The newest value wins; earlier queued ones are dropped. */
  save(accountId: string, db: Database, key: CryptoKey): void {
    this.pending = { accountId, db, key };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.drain(), WRITE_DELAY_MS);
  }

  /** Writes any queued value immediately — used on tab hide and before export. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.writing) return;
    const queued = this.pending;
    if (!queued) return;
    this.pending = null;
    this.writing = true;
    try {
      await this.write(queued.accountId, queued.db, queued.key);
      this.lastError = null;
    } catch (error) {
      this.lastError = describe(error);
      // Put it back so the next flush retries rather than dropping the write.
      this.pending = this.pending ?? queued;
    } finally {
      this.writing = false;
    }
    if (this.pending) await this.drain();
  }

  private async write(accountId: string, db: Database, key: CryptoKey): Promise<void> {
    const existing = await this.getAccount(accountId);
    if (!existing) return; // account was deleted mid-session; nothing to write to
    await this.putAccount({
      ...existing,
      vault: await encryptJson(key, db),
      updatedAt: new Date().toISOString(),
    });
  }

  /** Re-encrypts an existing ledger under a new password. */
  async rekey(
    accountId: string,
    db: Database,
    next: { key: CryptoKey; kdf: KdfParams },
  ): Promise<void> {
    const existing = await this.getAccount(accountId);
    if (!existing) throw new Error('That account no longer exists.');
    await this.putAccount({
      ...existing,
      kdf: next.kdf,
      vault: await encryptJson(next.key, db),
      updatedAt: new Date().toISOString(),
    });
  }

  async touch(accountId: string): Promise<void> {
    const existing = await this.getAccount(accountId);
    if (!existing) return;
    await this.putAccount({ ...existing, lastOpenedAt: new Date().toISOString() });
  }

  // ── The pre-accounts ledger ───────────────────────────────────────────────

  /**
   * The unencrypted ledger written by a build from before accounts existed.
   *
   * Returned so the app can offer to move it into a new account rather than
   * silently abandoning someone's financial history behind a login screen they
   * have never seen.
   */
  async readLegacy(): Promise<Database | null> {
    await this.open();
    if (this.handle) {
      try {
        const tx = this.handle.transaction(LEGACY_STORE, 'readonly');
        const raw = await request<unknown>((store) => store.get(LEGACY_KEY), tx.objectStore(LEGACY_STORE));
        if (raw) return parseDatabase(raw);
      } catch {
        // Fall through to localStorage.
      }
    }
    try {
      const raw = globalThis.localStorage?.getItem(LEGACY_LOCAL_KEY);
      if (raw) return parseDatabase(JSON.parse(raw));
    } catch {
      return null;
    }
    return null;
  }

  /** Called only once the legacy ledger is safely inside an encrypted account. */
  async clearLegacy(): Promise<void> {
    if (this.handle) {
      await new Promise<void>((resolve) => {
        const tx = this.handle!.transaction(LEGACY_STORE, 'readwrite');
        tx.objectStore(LEGACY_STORE).delete(LEGACY_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }
    try {
      globalThis.localStorage?.removeItem(LEGACY_LOCAL_KEY);
    } catch {
      // Nothing to do.
    }
  }

  /** Rough size of one account's stored vault, for the Settings page. */
  async approximateBytes(accountId: string): Promise<number> {
    const record = await this.getAccount(accountId);
    if (!record) return 0;
    // Base64 carries four characters per three bytes.
    return Math.round((record.vault.data.length * 3) / 4);
  }
}

export function newKdf(): KdfParams {
  return newKdfParams();
}

/** Addresses are compared folded — nobody remembers how they capitalised it. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A deliberately loose check.
 *
 * Nothing is ever delivered to this address, so the only job is to catch a
 * typo or a missing @ before it becomes the thing someone has to type
 * correctly forever. Rejecting unusual but valid addresses would be worse
 * than accepting an odd one.
 */
export function looksLikeEmail(email: string): boolean {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) && trimmed.length <= 254;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') {
      return 'Your browser has run out of storage space for this site.';
    }
    return error.message;
  }
  return 'Storage is unavailable in this browser.';
}

export const localStore = new LocalStore();
