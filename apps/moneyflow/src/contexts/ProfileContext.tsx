/**
 * The current user's profile.
 *
 * There are no accounts and no sign-in: the data lives in this browser, so
 * whoever has the browser is the user. What remains of "who is using this" is
 * a name, a currency, a theme and a set of preferences — which is what this
 * exposes.
 *
 * It reads straight from the ledger rather than holding its own copy, so a
 * currency change in Settings is reflected by every formatted amount on the
 * next render, with nothing to refresh.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { MinorUnits, MoneyPurpose, Theme } from '../core/types';
import { useLedger } from '../store/LedgerProvider';

export interface CurrentUser {
  name: string;
  /** Kept as an alias so components can read whichever reads better in place. */
  fullName: string;
  currency: string;
  theme: Theme;
  moneyPurpose: MoneyPurpose | null;
  notificationPrefs: Record<string, boolean>;
  largeExpenseThresholdMinor: MinorUnits;
  setupCompleted: boolean;
  createdAt: string;
}

const ProfileContext = createContext<CurrentUser | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }): JSX.Element {
  const { db } = useLedger();
  const profile = db.profile;

  const value = useMemo<CurrentUser>(
    () => ({
      name: profile.name,
      fullName: profile.name,
      currency: profile.currency,
      theme: profile.theme,
      moneyPurpose: profile.moneyPurpose,
      notificationPrefs: profile.notificationPrefs,
      largeExpenseThresholdMinor: profile.largeExpenseThresholdMinor,
      setupCompleted: Boolean(profile.setupCompletedAt),
      createdAt: profile.createdAt,
    }),
    [profile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useCurrentUser must be used inside <ProfileProvider>.');
  return context;
}
