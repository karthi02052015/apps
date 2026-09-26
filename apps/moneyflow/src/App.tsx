/**
 * Routes and providers.
 *
 * Three decisions here are worth explaining:
 *
 * **Hash routing.** GitHub Pages — and any other static host — serves files,
 * not routes. Opening `/transactions` directly would ask the host for a file
 * that does not exist and return a 404. `HashRouter` keeps the path after a
 * `#`, which the host never sees, so every deep link, bookmark and refresh
 * works with no server configuration at all.
 *
 * **The ledger lives inside the gate.** `LedgerProvider` is mounted only once
 * an account is unlocked, and is keyed on that account. Logging out unmounts
 * it, which is what takes the decrypted ledger out of memory — there is no
 * "logged out but still loaded" state for a stale render to leak. Switching
 * accounts changes the key, so the same remount swaps one ledger for the
 * other.
 *
 * **Setup is a gate, not a route.** The first-run wizard renders in place of
 * the app until an opening balance exists, so there is no URL a new account
 * can reach that would show it an empty, meaningless dashboard.
 */
import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FullPageSpinner } from '@/components/ui/FullPageSpinner';
import { ProfileProvider, useCurrentUser } from '@/contexts/ProfileContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { SessionProvider, useSession } from '@/store/SessionProvider';
import { LedgerProvider, useLedger } from '@/store/LedgerProvider';
import { AppShell } from '@/layouts/AppShell';
import { AuthPage } from '@/pages/AuthPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { TransactionsPage } from '@/pages/TransactionsPage';
import { SetupWizard } from '@/pages/SetupWizard';
import { NotFoundPage } from '@/pages/NotFoundPage';

/*
 * The dashboard and the transaction list are what people open the app for, so
 * they are in the main bundle. Everything else is split out — it keeps the
 * first paint fast on a phone, which is where a money tracker gets used.
 */
const AccountsPage = lazy(() => import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const BudgetsPage = lazy(() => import('@/pages/BudgetsPage').then((m) => ({ default: m.BudgetsPage })));
const GoalsPage = lazy(() => import('@/pages/GoalsPage').then((m) => ({ default: m.GoalsPage })));
const RecurringPage = lazy(() => import('@/pages/RecurringPage').then((m) => ({ default: m.RecurringPage })));
const DebtsPage = lazy(() => import('@/pages/DebtsPage').then((m) => ({ default: m.DebtsPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const CalendarPage = lazy(() => import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

/** Holds the app back until the ledger has been decrypted and read. */
function RequireSetup({ children }: { children: JSX.Element }): JSX.Element {
  const { status } = useLedger();
  const user = useCurrentUser();

  if (status !== 'ready') return <FullPageSpinner label="Opening your records" />;
  // Rendered in place rather than redirected to, so there is no URL that skips it.
  if (!user.setupCompleted) return <SetupWizard />;
  return children;
}

function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="recurring" element={<RecurringPage />} />
        <Route path="debts" element={<DebtsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/**
 * Everything that needs a decrypted ledger.
 *
 * The `key` on the provider matters: switching accounts remounts it, so no
 * state from the previous account can survive into the next one.
 */
function Unlocked(): JSX.Element {
  const session = useSession();

  if (session.status === 'loading') return <FullPageSpinner label="Looking for your account" />;
  // `addingAccount` shows the log-in screen over a live session, so a second
  // account can be opened without closing the first.
  if (session.addingAccount) return <AuthPage />;
  if (session.status !== 'unlocked' || !session.account || !session.key) return <AuthPage />;

  return (
    <LedgerProvider key={session.account.id} accountId={session.account.id} vaultKey={session.key}>
      <ProfileProvider>
        <RequireSetup>
          <Suspense fallback={<FullPageSpinner inline label="Loading" />}>
            <AppRoutes />
          </Suspense>
        </RequireSetup>
      </ProfileProvider>
    </LedgerProvider>
  );
}

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <ThemeProvider>
          <ToastProvider>
            <HashRouter>
              <Unlocked />
            </HashRouter>
          </ToastProvider>
        </ThemeProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
