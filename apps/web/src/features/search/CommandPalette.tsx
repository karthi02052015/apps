import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { CalendarCheck, CalendarClock, CheckCheck, Inbox, LogOut, Moon, Plus, Search, Settings, Sun, Trash2, TriangleAlert } from 'lucide-react';
import * as RD from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Page, TaskDTO } from '@taskflow/shared';
import { useTheme } from '../../hooks/useTheme';
import { useDebounce } from '../../hooks/useDebounce';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useProjects } from '../projects/hooks';
import { DueBadge } from '../tasks/meta';

const NAV = [
  { to: '/today', label: 'Today', icon: CalendarCheck },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/upcoming', label: 'Upcoming', icon: CalendarClock },
  { to: '/overdue', label: 'Overdue', icon: TriangleAlert },
  { to: '/completed', label: 'Completed', icon: CheckCheck },
  { to: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const itemCls =
  'flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13.5px] text-fg data-[selected=true]:bg-surface-2 [&>svg]:size-4 [&>svg]:text-muted';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { resolved, setTheme } = useTheme();
  const { data: projects = [] } = useProjects();
  const [q, setQ] = useState('');
  const debounced = useDebounce(q.trim(), 200);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => api<Page<TaskDTO>>('/tasks', { query: { q: debounced, limit: 8, includeCompleted: 'true' }, signal }),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const navItems = NAV.filter((n) => matches(q, n.label));
  const projectItems = projects.filter((p) => matches(q, p.name));
  const showTheme = matches(q, 'theme dark light mode');
  const showLogout = matches(q, 'sign out log out');

  const go = (to: string) => {
    onOpenChange(false);
    setQ('');
    navigate(to);
  };

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RD.Content className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop data-[state=open]:animate-fade-in">
          <RD.Title className="sr-only">Search and commands</RD.Title>
          <RD.Description className="sr-only">Search tasks, jump to views and run commands</RD.Description>
          <Command shouldFilter={false} loop label="Command palette">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 text-subtle" aria-hidden />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Search tasks or type a command…"
                className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-subtle"
              />
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13.5px] text-muted">
                {results.isFetching ? 'Searching…' : 'No results.'}
              </Command.Empty>

              {debounced.length >= 2 && results.data?.items.length ? (
                <Command.Group heading="Tasks" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle">
                  {results.data.items.map((t) => (
                    <Command.Item key={t.id} value={`task-${t.id}`} onSelect={() => go(`/${t.status === 'done' ? 'completed' : 'all'}?task=${t.id}`)} className={itemCls}>
                      <CheckCheck className={t.status === 'done' ? '' : 'opacity-0'} />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <DueBadge task={t} />
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {matches(q, 'new task add create') ? (
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle">
                  <Command.Item value="new-task" onSelect={() => go('/inbox')} className={itemCls}>
                    <Plus /> New task in Inbox
                  </Command.Item>
                </Command.Group>
              ) : null}

              {navItems.length || projectItems.length ? (
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle">
                {navItems.map((n) => (
                  <Command.Item key={n.to} value={n.to} onSelect={() => go(n.to)} className={itemCls}>
                    <n.icon /> {n.label}
                  </Command.Item>
                ))}
                {projectItems.map((p) => (
                    <Command.Item key={p.id} value={`project-${p.id}`} onSelect={() => go(`/projects/${p.id}`)} className={itemCls}>
                      <span className="mx-1 size-2.5 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
                      {p.name}
                    </Command.Item>
                  ))}
              </Command.Group>
              ) : null}

              {showTheme || showLogout ? (
              <Command.Group heading="Preferences" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle">
                {showTheme ? (
                  <Command.Item value="toggle-theme" onSelect={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} className={itemCls}>
                    {resolved === 'dark' ? <Sun /> : <Moon />} Switch to {resolved === 'dark' ? 'light' : 'dark'} mode
                  </Command.Item>
                ) : null}
                {showLogout ? (
                  <Command.Item value="logout" onSelect={() => void logout()} className={itemCls}>
                    <LogOut /> Sign out
                  </Command.Item>
                ) : null}
              </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

const matches = (q: string, text: string) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
