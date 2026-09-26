/**
 * The single source of truth for one signed-in account.
 *
 * Where a server-backed build had a request cache, this has one immutable
 * `Database` object in React state. Every read is a pure function of it, so
 * there is no cache to invalidate and no possibility of two screens
 * disagreeing — the dashboard and the transaction list are computed from the
 * same object in the same render.
 *
 * Every write goes through `apply`, which:
 *   1. runs the operation, which either returns a new database or throws,
 *   2. lets the notification rules react to the result,
 *   3. commits it to React state,
 *   4. queues a debounced, encrypted save to this account's vault.
 *
 * Because the operation is pure, a validation failure leaves the previous
 * state completely untouched — there is no half-applied write to clean up.
 *
 * The provider is mounted *inside* the sign-in gate and keyed on the account,
 * so signing out unmounts it and the decrypted ledger leaves memory with it.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { Database } from '../core/types';
import { emptyDatabase } from '../core/schema';
import { todayKey } from '../core/dates';
import { postDueOccurrences } from '../core/recurring';
import { runScheduledChecks } from '../core/notifications';
import { localStore, type StorageKind } from './persistence';

export interface LedgerState {
  db: Database;
  status: 'loading' | 'ready';
  storageKind: StorageKind;
  /** Non-null when data is not being saved — the UI shows a persistent warning. */
  storageError: string | null;
  /** Runs an operation and commits the result. Throws what the operation throws. */
  apply: <T>(operation: (db: Database) => Database | ({ db: Database } & T)) => T | undefined;
  /** Replaces the whole ledger — import, restore. */
  replace: (db: Database) => Promise<void>;
  /** Empties this account's ledger without deleting the account. */
  reset: () => Promise<void>;
  /** Forces a write, then reports the stored size. */
  storageSize: () => Promise<number>;
}

const LedgerContext = createContext<LedgerState | null>(null);

/**
 * Work that has to happen when the ledger opens, and again when the date rolls
 * over: post anything the schedules owe, then re-run the alert rules.
 *
 * Both are idempotent — posting is keyed on `(rule, date)` and every alert
 * carries a dedupe key — so running this more often than necessary is free.
 */
function catchUp(db: Database): Database {
  const posted = postDueOccurrences(db);
  return runScheduledChecks(posted.db);
}

export function LedgerProvider({
  accountId, vaultKey, children,
}: {
  accountId: string;
  vaultKey: CryptoKey;
  children: ReactNode;
}): JSX.Element {
  const [db, setDb] = useState<Database | null>(null);
  const [storageKind, setStorageKind] = useState<StorageKind>(localStore.storageKind());
  const [storageError, setStorageError] = useState<string | null>(null);

  // `apply` must see the current database without being re-created on every
  // change, or every consumer of the context would re-render on every keystroke.
  const latest = useRef<Database | null>(null);
  latest.current = db;

  /*
   * The key is read through a ref rather than closed over.
   *
   * Changing your password hands down a new key for the same account. The
   * decrypted ledger has not changed, so re-reading the vault would only throw
   * the screen back to a spinner and lose whatever the person was doing — it
   * is the *next save* that needs the new key, and that is what the ref gives
   * it. The vault is re-read only when the account itself changes.
   */
  const keyRef = useRef(vaultKey);
  keyRef.current = vaultKey;

  useEffect(() => {
    let cancelled = false;
    setDb(null);
    void (async () => {
      const record = await localStore.getAccount(accountId);
      if (cancelled) return;
      if (!record) {
        setStorageError('That account is no longer on this device.');
        setDb(emptyDatabase());
        return;
      }
      let loaded: Database;
      try {
        loaded = await localStore.openVault(record, keyRef.current);
      } catch (error) {
        // The gate only mounts this with a key that already opened the vault,
        // so reaching here means the stored bytes changed underneath us.
        setStorageError(error instanceof Error ? error.message : 'Your data could not be read.');
        setDb(emptyDatabase());
        return;
      }
      if (cancelled) return;

      // Only catch up on a ledger that has been through setup: a brand-new
      // account has no schedules, and alerts before anything is entered would
      // be noise.
      const ready = loaded.profile.setupCompletedAt ? catchUp(loaded) : loaded;
      setDb(ready);
      setStorageKind(localStore.storageKind());
      if (ready !== loaded) localStore.save(accountId, ready, keyRef.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const commit = useCallback(
    (next: Database) => {
      latest.current = next;
      setDb(next);
      localStore.save(accountId, next, keyRef.current);
      setStorageError(localStore.lastError);
    },
    [accountId],
  );

  const apply = useCallback(
    <T,>(operation: (current: Database) => Database | ({ db: Database } & T)): T | undefined => {
      const current = latest.current;
      if (!current) throw new Error('The app is still loading.');
      const result = operation(current);
      // Operations either return a database or `{ db, ...created }`; both are
      // supported so callers can get at the record they just made.
      if ('schemaVersion' in result) {
        commit(result as Database);
        return undefined;
      }
      const { db: next, ...rest } = result as { db: Database } & T;
      commit(next);
      return rest as T;
    },
    [commit],
  );

  const replace = useCallback(
    async (next: Database) => {
      commit(next);
      await localStore.flush();
    },
    [commit],
  );

  const reset = useCallback(async () => {
    const fresh = emptyDatabase();
    commit(fresh);
    await localStore.flush();
  }, [commit]);

  const storageSize = useCallback(async () => {
    await localStore.flush();
    return localStore.approximateBytes(accountId);
  }, [accountId]);

  // A tab left open overnight must not keep showing yesterday. When the day
  // changes — or the tab is revealed after being hidden — catch up again.
  useEffect(() => {
    if (!db?.profile.setupCompletedAt) return undefined;
    let day = todayKey();

    const check = (): void => {
      const current = todayKey();
      if (current === day) return;
      day = current;
      const now = latest.current;
      if (now) commit(catchUp(now));
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check();
      else void localStore.flush();
    };
    const onHide = (): void => {
      void localStore.flush();
    };

    const interval = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, [db?.profile.setupCompletedAt, commit]);

  const value = useMemo<LedgerState>(
    () => ({
      db: db ?? emptyDatabase(),
      status: db ? 'ready' : 'loading',
      storageKind,
      storageError,
      apply,
      replace,
      reset,
      storageSize,
    }),
    [db, storageKind, storageError, apply, replace, reset, storageSize],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerState {
  const context = useContext(LedgerContext);
  if (!context) throw new Error('useLedger must be used inside <LedgerProvider>.');
  return context;
}

/** The current database. Every read hook is built on this. */
export function useDatabase(): Database {
  return useLedger().db;
}
