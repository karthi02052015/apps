import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight, Bell, CalendarDays, ChevronDown, CreditCard, LayoutDashboard,
  Download, LogOut, Menu, UserPlus, PieChart, Plus, Receipt, Settings, Target, Wallet, X, Repeat,
  Handshake, } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useSession } from '@/store/SessionProvider';
import { useDashboard, useNotifications } from '@/hooks/queries';
import { Button } from '@/components/ui/Button';
import { QuickAdd } from '@/components/QuickAdd';
import { NotificationPanel } from '@/components/NotificationPanel';
import { formatMoney } from '@/lib/money';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Shown in the mobile bottom bar. */
  primary?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, primary: true },
  { to: '/transactions', label: 'Transactions', icon: Receipt, primary: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/budgets', label: 'Budgets', icon: PieChart },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/debts', label: 'Debts', icon: Handshake },
  { to: '/reports', label: 'Reports', icon: CreditCard, primary: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings, primary: true },
];

function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
        <ArrowLeftRight className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="text-lg font-bold tracking-tight text-ink">MoneyFlow</span>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-soft text-brand-ink'
                : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-brand')} aria-hidden />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function BalancePill() {
  const { data } = useDashboard();
  if (!data) return null;
  return (
    <div className="mx-3 mb-3 rounded-2xl bg-gradient-to-br from-brand to-brand/80 p-4 text-white shadow-lift">
      <p className="text-xs font-medium uppercase tracking-wide text-white/70">Total balance</p>
      <p className="tnum mt-1 text-2xl font-bold">
        {formatMoney(data.currentBalanceMinor, data.currency)}
      </p>
      <p className="mt-1 text-xs text-white/80">
        {formatMoney(data.thisMonth.totals.netMinor, data.currency, { signed: true })} this month
      </p>
    </div>
  );
}

export function AppShell() {
  const user = useCurrentUser();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { data: notifications } = useNotifications();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const unread = notifications?.unread ?? 0;

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Skip link — the first thing a keyboard user reaches. */}
      <a
        href="#main"
        className="sr-only-focusable absolute left-4 top-4 z-[60] rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
      >
        Skip to content
      </a>

      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <BalancePill />
        <NavLinks />
        <div className="border-t border-line p-3">
          <UserMenu user={user} />
        </div>
      </aside>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 animate-slide-up flex-col bg-surface shadow-pop"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <Logo />
              <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <BalancePill />
            <div className="flex-1 overflow-y-auto pb-4">
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            </div>
            <div className="border-t border-line p-3">
              <UserMenu user={user} />
            </div>
          </aside>
        </div>
      )}

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </Button>

            <div className="lg:hidden">
              <Logo />
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setNotificationsOpen(true)}
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                className="relative"
              >
                <Bell className="h-5 w-5" aria-hidden />
                {unread > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Button>
              <Button
                onClick={() => setQuickAddOpen(true)}
                leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                className="hidden sm:inline-flex"
              >
                Add
              </Button>
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pb-10 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {/* ── Mobile bottom navigation ────────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Primary"
      >
        <div className="grid grid-cols-5 items-end">
          {NAV.filter((item) => item.primary).slice(0, 2).map((item) => (
            <BottomLink key={item.to} item={item} />
          ))}

          {/* The prominent central action from section 31. */}
          <div className="flex justify-center pb-1.5">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-fab transition-transform active:scale-95"
              aria-label="Add a transaction"
            >
              <Plus className="h-7 w-7" aria-hidden />
            </button>
          </div>

          {NAV.filter((item) => item.primary).slice(2).map((item) => (
            <BottomLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <NotificationPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}

function BottomLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
          isActive ? 'text-brand' : 'text-ink-3',
        )
      }
    >
      <item.icon className="h-5 w-5" aria-hidden />
      {item.label}
    </NavLink>
  );
}

function UserMenu({
  user,
}: {
  user: { fullName: string } | null;
}) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const accountName = session.account?.name ?? null;
  const others = session.signedIn.filter((item) => item.id !== session.account?.id);
  if (!user) return null;

  const initials = initialsOf(user.fullName || accountName || 'You');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-3"
      >
        <Avatar name={initials} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {user.fullName || accountName || 'Your money'}
          </span>
          {/* Which vault is open matters more than a greeting here — on a
              shared laptop it is the difference between your records and
              someone else's. The address identifies it least ambiguously; the
              account name is the fallback when there isn't one. */}
          <span className="block truncate text-xs text-ink-2">
            {session.account?.email
              ?? (accountName && accountName !== user.fullName ? accountName : 'Saved on this device')}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute bottom-full left-0 z-20 mb-2 w-full animate-scale-in overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
          >
            {/* Other accounts already unlocked. Switching is instant — their
                keys are in memory, so no password is asked for again. */}
            {others.length > 0 && (
              <div className="border-b border-line py-1">
                <p className="px-3.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Also logged in
                </p>
                {others.map((other) => (
                  <button
                    key={other.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      session.switchTo(other.id);
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-bold text-ink-2"
                      aria-hidden
                    >
                      {initialsOf(other.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{other.name}</span>
                  </button>
                ))}
              </div>
            )}

            <NavLink
              to="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Settings className="h-4 w-4" aria-hidden />
              Settings
            </NavLink>
            <NavLink
              to="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Download className="h-4 w-4" aria-hidden />
              Export or back up
            </NavLink>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                session.beginAddAccount();
              }}
              className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
              Add another account
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                session.logOut();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-negative transition-colors hover:bg-negative-soft"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Log out
            </button>
            {others.length > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  session.logOutAll();
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-negative transition-colors hover:bg-negative-soft"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Log out of all {others.length + 1} accounts
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function initialsOf(name: string): string {
  return (name || 'You')
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Initials only: there is no profile picture to fetch from anywhere. */
function Avatar({ name }: { name: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink"
      aria-hidden
    >
      {name}
    </span>
  );
}

export function PageHeader({
  title, description, action, children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
