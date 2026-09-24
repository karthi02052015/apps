import * as RD from '@radix-ui/react-dialog';
import { LogOut, Menu as MenuIcon, Monitor, Moon, Settings, Sun, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Dialog';
import { Kbd } from '../components/ui/Spinner';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../components/ui/Menu';
import { useAuth } from '../features/auth/AuthProvider';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useRealtime } from '../features/notifications/useRealtime';
import { CommandPalette } from '../features/search/CommandPalette';
import { useHotkeys } from '../hooks/useHotkeys';
import { useOnline } from '../hooks/useOnline';
import { useTheme } from '../hooks/useTheme';
import { Sidebar } from './Sidebar';

const SHORTCUTS: Array<[string, string]> = [
  ['⌘ K', 'Search & commands'],
  ['N', 'New task'],
  ['G then T / I / U', 'Go to Today / Inbox / Upcoming'],
  ['Enter', 'Open focused task'],
  ['Space', 'Complete focused task'],
  ['?', 'Show shortcuts'],
];

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const online = useOnline();
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [goPending, setGoPending] = useState(false);
  useRealtime();

  useHotkeys({
    'mod+k': () => setPaletteOpen((o) => !o),
    '?': () => setHelpOpen(true),
    g: () => {
      setGoPending(true);
      setTimeout(() => setGoPending(false), 1200);
    },
    t: () => goPending && navigate('/today'),
    i: () => goPending && navigate('/inbox'),
    u: () => goPending && navigate('/upcoming'),
  });

  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 border-r border-border bg-surface/60 backdrop-blur md:block">
        <Sidebar onSearch={() => setPaletteOpen(true)} />
      </aside>

      {/* Mobile drawer */}
      <RD.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-fade-in md:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[300px] border-r border-border bg-surface shadow-pop data-[state=open]:animate-fade-in md:hidden">
            <RD.Title className="sr-only">Navigation</RD.Title>
            <RD.Description className="sr-only">Views, projects and tags</RD.Description>
            <Sidebar
              onSearch={() => {
                setDrawerOpen(false);
                setPaletteOpen(true);
              }}
              onNavigate={() => setDrawerOpen(false)}
            />
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b border-border/60 bg-bg/80 px-2 backdrop-blur-md sm:px-4">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
            <MenuIcon className="size-[18px]" />
          </Button>
          <div className="flex-1" />
          <NotificationBell />
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                className="ml-1 grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#8b8bfa] to-[#5b5bf0] text-[12px] font-semibold text-white shadow-soft"
                aria-label="Account menu"
              >
                {initials}
              </button>
            </MenuTrigger>
            <MenuContent>
              <div className="px-2.5 py-2">
                <p className="truncate text-[13.5px] font-medium">{user?.name}</p>
                <p className="truncate text-[12.5px] text-muted">{user?.email}</p>
              </div>
              <MenuSeparator />
              <MenuLabel>Theme</MenuLabel>
              {(
                [
                  ['light', Sun, 'Light'],
                  ['dark', Moon, 'Dark'],
                  ['system', Monitor, 'System'],
                ] as const
              ).map(([value, Icon, label]) => (
                <MenuItem key={value} icon={<Icon />} onSelect={() => setTheme(value)} shortcut={theme === value ? '✓' : undefined}>
                  {label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem icon={<Settings />} onSelect={() => navigate('/settings')}>
                Settings
              </MenuItem>
              <MenuItem icon={<span className="text-[13px] font-semibold">?</span>} onSelect={() => setHelpOpen(true)}>
                Keyboard shortcuts
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<LogOut />} danger onSelect={() => void logout()}>
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        </header>

        <AnimatePresence>
          {!online ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              role="status"
              className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-[13px] font-medium text-warning"
            >
              <WifiOff className="size-4" aria-hidden /> You're offline — changes are saved and will sync when you reconnect.
            </motion.div>
          ) : null}
        </AnimatePresence>

        <main id="main" className="flex-1" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Modal open={helpOpen} onOpenChange={setHelpOpen} title="Keyboard shortcuts">
        <ul className="divide-y divide-border">
          {SHORTCUTS.map(([keysLabel, label]) => (
            <li key={label} className="flex items-center justify-between py-2.5 text-[13.5px]">
              <span>{label}</span>
              <span className="flex gap-1">
                {keysLabel.split(' ').map((k, i) => (k === 'then' || k === '/' ? <span key={i} className="px-0.5 text-subtle">{k}</span> : <Kbd key={i}>{k}</Kbd>))}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
