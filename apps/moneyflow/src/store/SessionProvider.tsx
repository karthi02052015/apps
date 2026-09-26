/**
 * Accounts, logging in, and logging out.
 *
 * What an account means here is different from what it means in an app with a
 * server, and the difference is the whole design:
 *
 *   • **Nothing authenticates you.** There is no service to ask. Your password
 *     is the key that decrypts your ledger, so the only possible outcomes are
 *     "the bytes decrypt" and "they don't".
 *   • **Nothing can reset it.** A recovery path would have to be able to read
 *     your data without your password, which is precisely what the encryption
 *     is for. The sign-up screen says so before you commit.
 *   • **Accounts are per-browser.** Two accounts on one laptop are two separate
 *     vaults; the same person on a phone is a different device with its own
 *     storage. Backups move data between them.
 *
 * Several accounts can be logged in at once, which is what makes a shared
 * laptop bearable: unlock each one, then switch between them instantly from
 * the menu. Each unlocked account contributes one key; logging out drops that
 * key and nothing else.
 *
 * Keys live in memory while you are logged in. They are mirrored into
 * `sessionStorage` so a page refresh does not throw you out, and into
 * `localStorage` only for accounts that asked to stay logged in. Both are
 * cleared on log-out, and Settings explains the trade-off rather than hiding
 * it.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { Database } from '../core/types';
import { emptyDatabase } from '../core/schema';
import { newId } from '../core/operations';
import {
  CryptoUnavailableError, MINIMUM_PASSWORD_LENGTH, WrongPasswordError, assessPassword,
  deriveKey, exportKey, importKey, isCryptoAvailable, newKdfParams,
} from '../core/crypto';
import { AppError } from '../lib/errors';
import {
  localStore, looksLikeEmail, toSummary, type AccountSummary, type StorageKind,
} from './persistence';

const SESSION_KEY = 'moneyflow:session';
const REMEMBER_KEY = 'moneyflow:remember';
const AUTOLOCK_KEY = 'moneyflow:autolock-minutes';

/** Long enough not to nag, short enough to matter on a shared laptop. */
export const DEFAULT_AUTOLOCK_MINUTES = 15;

/** Exported keys, by account id, plus which one is in front. */
interface StoredSession {
  activeId: string | null;
  keys: Record<string, string>;
}

export type SessionStatus = 'loading' | 'signed-out' | 'unlocked' | 'unsupported';

export interface SessionState {
  status: SessionStatus;
  /** Every account on this device, logged in or not. */
  accounts: AccountSummary[];
  /** The accounts currently unlocked, most recently used first. */
  signedIn: AccountSummary[];
  account: AccountSummary | null;
  key: CryptoKey | null;
  storageKind: StorageKind;
  /** An unencrypted ledger from before accounts existed, waiting to be adopted. */
  legacyLedger: Database | null;
  /** True while the browser cannot encrypt — an insecure page, usually. */
  unsupportedReason: string | null;
  /** True while the log-in screen is showing over an active session. */
  addingAccount: boolean;

  signUp: (input: {
    name: string;
    email: string;
    password: string;
    /** Move the pre-accounts ledger into this new account instead of starting empty. */
    adoptLegacy?: boolean;
    remember?: boolean;
  }) => Promise<void>;
  /** Logging in the usual way: type the address, type the password. */
  signIn: (email: string, password: string, remember?: boolean) => Promise<void>;
  /** Logging in by picking an account already on this device. */
  signInAs: (accountId: string, password: string, remember?: boolean) => Promise<void>;
  /** Brings an already-unlocked account to the front. No password needed. */
  switchTo: (accountId: string) => void;
  /** Logs one account out — the active one unless another is named. */
  logOut: (accountId?: string) => void;
  logOutAll: () => void;
  beginAddAccount: () => void;
  cancelAddAccount: () => void;
  changeEmail: (email: string) => Promise<void>;
  changePassword: (current: string, next: string, db: Database) => Promise<void>;
  renameAccount: (name: string) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  discardLegacy: () => Promise<void>;
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => void;
}

const SessionContext = createContext<SessionState | null>(null);

// ── Session storage ─────────────────────────────────────────────────────────

function readJson<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Storage blocked, or a half-written value.
    return fallback;
  }
}

function writeJson(store: Storage | undefined, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // A session that cannot be persisted still works for this page view.
  }
}

/**
 * Rebuilds the stored session from what is in memory.
 *
 * `remembered` is the subset that asked to survive the tab closing; everything
 * else is written only to `sessionStorage`, where it dies with the tab.
 */
function persistSession(
  keys: Map<string, string>,
  activeId: string | null,
  remembered: Set<string>,
): void {
  const all: StoredSession = { activeId, keys: Object.fromEntries(keys) };
  writeJson(globalThis.sessionStorage, SESSION_KEY, all);

  const durable: Record<string, string> = {};
  for (const id of remembered) {
    const value = keys.get(id);
    if (value) durable[id] = value;
  }
  if (Object.keys(durable).length === 0) {
    try {
      globalThis.localStorage?.removeItem(REMEMBER_KEY);
    } catch {
      // Nothing to do.
    }
  } else {
    writeJson(globalThis.localStorage, REMEMBER_KEY, durable);
  }
}

function clearStoredSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(SESSION_KEY);
    globalThis.localStorage?.removeItem(REMEMBER_KEY);
  } catch {
    // Nothing to do.
  }
}

function readAutoLockMinutes(): number {
  try {
    const raw = globalThis.localStorage?.getItem(AUTOLOCK_KEY);
    if (raw === null || raw === undefined) return DEFAULT_AUTOLOCK_MINUTES;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_AUTOLOCK_MINUTES;
  } catch {
    return DEFAULT_AUTOLOCK_MINUTES;
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

interface Unlocked {
  /** Live keys, by account id. */
  keys: Map<string, CryptoKey>;
  activeId: string | null;
}

const NOBODY: Unlocked = { keys: new Map(), activeId: null };

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [booted, setBooted] = useState(false);
  const [unlocked, setUnlocked] = useState<Unlocked>(NOBODY);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [legacyLedger, setLegacyLedger] = useState<Database | null>(null);
  const [storageKind, setStorageKind] = useState<StorageKind>('memory');
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(DEFAULT_AUTOLOCK_MINUTES);

  // The exported form of each live key, kept alongside so persisting does not
  // have to re-export (an async operation) on every change.
  const exported = useRef<Map<string, string>>(new Map());
  const remembered = useRef<Set<string>>(new Set());

  const refreshAccounts = useCallback(async () => {
    const list = await localStore.listAccounts();
    setAccounts(list);
    return list;
  }, []);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isCryptoAvailable()) {
        if (cancelled) return;
        setUnsupportedReason(new CryptoUnavailableError().message);
        setBooted(true);
        return;
      }

      setAutoLockMinutesState(readAutoLockMinutes());
      const list = await localStore.listAccounts();
      if (cancelled) return;
      setAccounts(list);
      setStorageKind(localStore.storageKind());

      // Only look for a pre-accounts ledger when there is nowhere else it could
      // have gone — otherwise it has already been adopted or declined.
      if (list.length === 0) {
        const legacy = await localStore.readLegacy();
        if (cancelled) return;
        if (legacy && legacy.transactions.length + legacy.accounts.length > 0) {
          setLegacyLedger(legacy);
        }
      }

      // Accounts that chose to stay logged in, plus anything this tab already
      // had open. The tab's copy wins where they overlap.
      const durable = readJson<Record<string, string>>(globalThis.localStorage, REMEMBER_KEY, {});
      const session = readJson<StoredSession>(
        globalThis.sessionStorage, SESSION_KEY, { activeId: null, keys: {} },
      );
      remembered.current = new Set(Object.keys(durable));

      const live = new Map<string, CryptoKey>();
      const raw = new Map<string, string>();
      const known = new Set(list.map((item) => item.id));
      for (const [id, value] of Object.entries({ ...durable, ...session.keys })) {
        if (!known.has(id)) continue; // the account was deleted since
        try {
          live.set(id, await importKey(value));
          raw.set(id, value);
        } catch {
          // A corrupt stored key just means logging in again.
        }
      }
      if (cancelled) return;

      exported.current = raw;
      const activeId = session.activeId && live.has(session.activeId)
        ? session.activeId
        // No active account recorded — fall back to whichever was used last,
        // which `listAccounts` already sorts to the front.
        : (list.find((item) => live.has(item.id))?.id ?? null);

      setUnlocked({ keys: live, activeId });
      if (activeId) void localStore.touch(activeId);
      persistSession(raw, activeId, remembered.current);
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Deriving the view ─────────────────────────────────────────────────────

  const account = useMemo(
    () => accounts.find((item) => item.id === unlocked.activeId) ?? null,
    [accounts, unlocked.activeId],
  );
  const signedIn = useMemo(
    () => accounts.filter((item) => unlocked.keys.has(item.id)),
    [accounts, unlocked.keys],
  );
  const key = unlocked.activeId ? (unlocked.keys.get(unlocked.activeId) ?? null) : null;

  const status: SessionStatus = unsupportedReason
    ? 'unsupported'
    : !booted
      ? 'loading'
      : account && key
        ? 'unlocked'
        : 'signed-out';

  // ── Logging in and out ────────────────────────────────────────────────────

  const addSession = useCallback(
    async (accountId: string, derived: CryptoKey, remember: boolean) => {
      const raw = await exportKey(derived);
      exported.current.set(accountId, raw);
      if (remember) remembered.current.add(accountId);
      else remembered.current.delete(accountId);

      setUnlocked((current) => {
        const keys = new Map(current.keys);
        keys.set(accountId, derived);
        persistSession(exported.current, accountId, remembered.current);
        return { keys, activeId: accountId };
      });
      setAddingAccount(false);
      await localStore.touch(accountId);
      await refreshAccounts();
      setStorageKind(localStore.storageKind());
    },
    [refreshAccounts],
  );

  const forget = useCallback((ids: string[]) => {
    setUnlocked((current) => {
      const keys = new Map(current.keys);
      for (const id of ids) {
        keys.delete(id);
        exported.current.delete(id);
        remembered.current.delete(id);
      }
      // Hand the front to whoever is still logged in.
      const activeId = current.activeId && keys.has(current.activeId)
        ? current.activeId
        : ([...keys.keys()][0] ?? null);
      if (keys.size === 0) clearStoredSession();
      else persistSession(exported.current, activeId, remembered.current);
      return { keys, activeId };
    });
    setAddingAccount(false);
  }, []);

  const logOut = useCallback<SessionState['logOut']>(
    (accountId) => {
      const target = accountId ?? unlocked.activeId;
      if (target) forget([target]);
    },
    [forget, unlocked.activeId],
  );

  const logOutAll = useCallback(() => {
    forget([...unlocked.keys.keys()]);
  }, [forget, unlocked.keys]);

  const switchTo = useCallback<SessionState['switchTo']>((accountId) => {
    setUnlocked((current) => {
      if (!current.keys.has(accountId)) return current;
      persistSession(exported.current, accountId, remembered.current);
      return { ...current, activeId: accountId };
    });
    setAddingAccount(false);
    void localStore.touch(accountId);
    void refreshAccounts();
  }, [refreshAccounts]);

  // ── Auto log-out ──────────────────────────────────────────────────────────
  const logOutAllRef = useRef(logOutAll);
  logOutAllRef.current = logOutAll;

  useEffect(() => {
    if (status !== 'unlocked' || autoLockMinutes <= 0) return undefined;
    const limit = autoLockMinutes * 60_000;
    let last = Date.now();

    const touch = (): void => {
      last = Date.now();
    };
    // A timer rather than a single timeout, so a laptop that was asleep logs
    // out on wake instead of waiting out the remainder of a stale timeout.
    const interval = setInterval(() => {
      if (Date.now() - last >= limit) logOutAllRef.current();
    }, 15_000);

    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'];
    for (const event of events) document.addEventListener(event, touch, { passive: true });
    return () => {
      clearInterval(interval);
      for (const event of events) document.removeEventListener(event, touch);
    };
  }, [status, autoLockMinutes]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const signUp = useCallback<SessionState['signUp']>(
    async ({ name, email, password, adoptLegacy = false, remember = false }) => {
      const trimmed = name.trim();
      const address = email.trim();
      if (!trimmed) throw AppError.field('name', 'What should we call you?');
      if (!address) throw AppError.field('email', 'Enter an email address.');
      if (!looksLikeEmail(address)) throw AppError.field('email', 'That does not look like an email address.');
      if (password.length < MINIMUM_PASSWORD_LENGTH) {
        throw AppError.field(
          'password',
          `Use at least ${MINIMUM_PASSWORD_LENGTH} characters — this password cannot be reset.`,
        );
      }
      if (!assessPassword(password).acceptable) {
        throw AppError.field('password', 'Choose something harder to guess.');
      }
      if (await localStore.findByEmail(address)) {
        throw AppError.field('email', 'There is already an account with that address on this device.');
      }

      const kdf = newKdfParams();
      const derived = await deriveKey(password, kdf);
      const ledger = adoptLegacy && legacyLedger ? legacyLedger : emptyDatabase({ name: trimmed });

      const record = await localStore.createAccount({
        id: newId(),
        name: trimmed,
        email: address,
        key: derived,
        kdf,
        db: ledger,
      });

      // The plaintext copy only goes once its encrypted replacement is stored.
      if (adoptLegacy && legacyLedger) {
        await localStore.clearLegacy();
        setLegacyLedger(null);
      }

      setAccounts((current) => [toSummary(record), ...current]);
      await addSession(record.id, derived, remember);
    },
    [legacyLedger, addSession],
  );

  const signInAs = useCallback<SessionState['signInAs']>(
    async (accountId, password, remember = false) => {
      const record = await localStore.getAccount(accountId);
      if (!record) throw new AppError('That account is no longer on this device.');

      const derived = await deriveKey(password, record.kdf);
      // Opening the vault *is* the password check — there is nothing else to
      // check against, and a wrong key fails GCM authentication.
      try {
        await localStore.openVault(record, derived);
      } catch (error) {
        if (error instanceof WrongPasswordError) {
          throw AppError.field('password', 'That password is not right.');
        }
        throw error;
      }

      await addSession(record.id, derived, remember);
    },
    [addSession],
  );

  /**
   * Logging in by address.
   *
   * An unknown address and a wrong password give the same message. There is no
   * server to probe and every account is already on this device, so hiding it
   * buys little — but telling someone "no account with that address" still
   * invites them to go fishing through a shared laptop, and the vaguer answer
   * costs an honest user nothing they cannot see in the account list.
   */
  const signIn = useCallback<SessionState['signIn']>(
    async (email, password, remember = false) => {
      const address = email.trim();
      if (!address) throw AppError.field('email', 'Enter your email address.');
      const record = await localStore.findByEmail(address);
      if (!record) {
        throw AppError.field('password', 'That email and password do not match an account here.');
      }
      try {
        await signInAs(record.id, password, remember);
      } catch (error) {
        if (error instanceof AppError && error.fieldError('password')) {
          throw AppError.field('password', 'That email and password do not match an account here.');
        }
        throw error;
      }
    },
    [signInAs],
  );

  const changeEmail = useCallback<SessionState['changeEmail']>(
    async (email) => {
      if (!account) return;
      const address = email.trim();
      if (!looksLikeEmail(address)) {
        throw AppError.field('email', 'That does not look like an email address.');
      }
      const clash = await localStore.findByEmail(address);
      if (clash && clash.id !== account.id) {
        throw AppError.field('email', 'Another account on this device already uses that address.');
      }
      const record = await localStore.getAccount(account.id);
      if (!record) return;
      await localStore.putAccount({ ...record, email: address });
      await refreshAccounts();
    },
    [account, refreshAccounts],
  );

  const changePassword = useCallback<SessionState['changePassword']>(
    async (current, next, db) => {
      if (!account) throw new AppError('No account is open.');
      const record = await localStore.getAccount(account.id);
      if (!record) throw new AppError('That account is no longer on this device.');

      const currentKey = await deriveKey(current, record.kdf);
      try {
        await localStore.openVault(record, currentKey);
      } catch {
        throw AppError.field('currentPassword', 'That is not your current password.');
      }
      if (next.length < MINIMUM_PASSWORD_LENGTH) {
        throw AppError.field(
          'newPassword',
          `Use at least ${MINIMUM_PASSWORD_LENGTH} characters — this password cannot be reset.`,
        );
      }

      const kdf = newKdfParams();
      const nextKey = await deriveKey(next, kdf);
      // The current in-memory ledger is re-encrypted, not the stored copy, so
      // nothing typed in the last few seconds is lost to the rekey.
      await localStore.rekey(account.id, db, { key: nextKey, kdf });
      await addSession(account.id, nextKey, remembered.current.has(account.id));
    },
    [account, addSession],
  );

  const renameAccount = useCallback<SessionState['renameAccount']>(
    async (name) => {
      if (!account) return;
      const trimmed = name.trim();
      if (!trimmed) throw AppError.field('name', 'Give this account a name.');
      const record = await localStore.getAccount(account.id);
      if (!record) return;
      await localStore.putAccount({ ...record, name: trimmed });
      await refreshAccounts();
    },
    [account, refreshAccounts],
  );

  const deleteAccount = useCallback<SessionState['deleteAccount']>(
    async (accountId) => {
      await localStore.deleteAccount(accountId);
      forget([accountId]);
      await refreshAccounts();
    },
    [forget, refreshAccounts],
  );

  const discardLegacy = useCallback(async () => {
    await localStore.clearLegacy();
    setLegacyLedger(null);
  }, []);

  const setAutoLockMinutes = useCallback((minutes: number) => {
    setAutoLockMinutesState(minutes);
    try {
      globalThis.localStorage?.setItem(AUTOLOCK_KEY, String(minutes));
    } catch {
      // A preference that cannot be saved still applies for this session.
    }
  }, []);

  const beginAddAccount = useCallback(() => setAddingAccount(true), []);
  const cancelAddAccount = useCallback(() => setAddingAccount(false), []);

  const value = useMemo<SessionState>(
    () => ({
      status,
      accounts,
      signedIn,
      account,
      key,
      storageKind,
      legacyLedger,
      unsupportedReason,
      addingAccount,
      signUp,
      signIn,
      signInAs,
      switchTo,
      logOut,
      logOutAll,
      beginAddAccount,
      cancelAddAccount,
      changeEmail,
      changePassword,
      renameAccount,
      deleteAccount,
      discardLegacy,
      autoLockMinutes,
      setAutoLockMinutes,
    }),
    [
      status, accounts, signedIn, account, key, storageKind, legacyLedger, unsupportedReason,
      addingAccount, signUp, signIn, signInAs, switchTo, logOut, logOutAll, beginAddAccount,
      cancelAddAccount, changeEmail, changePassword, renameAccount, deleteAccount, discardLegacy,
      autoLockMinutes, setAutoLockMinutes,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');
  return context;
}
