import { CalendarCheck, CalendarClock, CheckCheck, Hash, Inbox, MoreHorizontal, Pencil, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { ProjectDTO } from '@taskflow/shared';
import { Kbd } from '../components/ui/Spinner';
import { Logo } from '../components/ui/Logo';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../components/ui/Menu';
import { ProjectDialog } from '../features/projects/ProjectDialog';
import { useProjectMutations, useProjects, useTags } from '../features/projects/hooks';
import { useStats } from '../features/tasks/hooks';
import { cn } from '../lib/cn';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
    isActive ? 'bg-surface-3/70 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
  );

function Count({ n, tone }: { n?: number; tone?: 'danger' }) {
  if (!n) return null;
  return <span className={cn('ml-auto text-[12px] tabular-nums', tone === 'danger' ? 'font-medium text-danger' : 'text-subtle')}>{n}</span>;
}

export function Sidebar({ onSearch, onNavigate }: { onSearch: () => void; onNavigate?: () => void }) {
  const { data: stats } = useStats();
  const { data: projects = [] } = useProjects();
  const { data: tags = [] } = useTags();
  const { remove } = useProjectMutations();
  const [dialog, setDialog] = useState<{ open: boolean; project?: ProjectDTO }>({ open: false });

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto px-3 pb-4 pt-4" aria-label="Main" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}>
      <div className="mb-3 px-2">
        <Logo />
      </div>

      <button
        type="button"
        onClick={onSearch}
        className="mb-3 flex h-9 items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-subtle shadow-soft transition-colors hover:text-muted"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <Kbd>⌘K</Kbd>
      </button>

      <NavLink to="/inbox" className={linkCls}>
        <Inbox className="size-4 text-accent" aria-hidden /> Inbox <Count n={stats?.inbox} />
      </NavLink>
      <NavLink to="/today" className={linkCls}>
        <CalendarCheck className="size-4 text-success" aria-hidden /> Today <Count n={stats?.today} />
      </NavLink>
      <NavLink to="/upcoming" className={linkCls}>
        <CalendarClock className="size-4 text-[#8b5cf6]" aria-hidden /> Upcoming <Count n={stats?.upcoming} />
      </NavLink>
      <NavLink to="/overdue" className={linkCls}>
        <TriangleAlert className="size-4 text-danger" aria-hidden /> Overdue <Count n={stats?.overdue} tone="danger" />
      </NavLink>
      <NavLink to="/completed" className={linkCls}>
        <CheckCheck className="size-4 text-muted" aria-hidden /> Completed
      </NavLink>

      <div className="mb-1 mt-5 flex items-center justify-between px-2.5">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-subtle">Projects</h2>
        <button
          type="button"
          onClick={() => setDialog({ open: true })}
          className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg"
          aria-label="New project"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {projects.length === 0 ? <p className="px-2.5 py-1 text-[12.5px] text-subtle">No projects yet</p> : null}
      {projects.map((p) => (
        <div key={p.id} className="group relative">
          <NavLink to={`/projects/${p.id}`} className={linkCls}>
            <span className="grid size-4 place-items-center" aria-hidden>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            </span>
            <span className="truncate">{p.name}</span>
            <span className="ml-auto text-[12px] tabular-nums text-subtle group-hover:opacity-0">{p.openTaskCount || ''}</span>
          </NavLink>
          <Menu>
            <MenuTrigger
              className="absolute right-1 top-1 rounded-md p-1 text-subtle opacity-0 hover:bg-surface-3 hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Options for ${p.name}`}
            >
              <MoreHorizontal className="size-3.5" />
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem icon={<Pencil />} onSelect={() => setDialog({ open: true, project: p })}>
                Edit project
              </MenuItem>
              <MenuItem icon={<Trash2 />} danger onSelect={() => remove.mutate(p.id)}>
                Delete project
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ))}

      {tags.length ? (
        <>
          <h2 className="mb-1 mt-5 px-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-subtle">Tags</h2>
          {tags.slice(0, 12).map((t) => (
            <NavLink key={t.id} to={`/tags/${encodeURIComponent(t.name)}`} className={linkCls}>
              <Hash className="size-4 text-subtle" aria-hidden />
              <span className="truncate">{t.name}</span>
              <Count n={t.taskCount} />
            </NavLink>
          ))}
        </>
      ) : null}

      <div className="mt-auto pt-4">
        <NavLink to="/trash" className={linkCls}>
          <Trash2 className="size-4" aria-hidden /> Trash
        </NavLink>
      </div>

      <ProjectDialog open={dialog.open} project={dialog.project} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </nav>
  );
}
