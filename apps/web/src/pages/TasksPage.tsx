import {
  ArrowDownUp,
  CalendarCheck,
  CalendarClock,
  CheckCheck,
  CheckSquare,
  Columns3,
  Flame,
  Inbox,
  List,
  ListTodo,
  Loader2,
  PartyPopper,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type CreateTaskInput,
  type ProjectDTO,
  type TaskDTO,
  type TaskPriority,
  type TaskStatus,
  type TaskView,
} from '@taskflow/shared';
import { ProgressRing } from '../components/ProgressRing';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../components/ui/Menu';
import { Skeleton } from '../components/ui/Spinner';
import { useProjects } from '../features/projects/hooks';
import {
  useBulkTasks,
  useCreateTask,
  useEmptyTrash,
  useStats,
  useTaskList,
  useToggleComplete,
  useUpdateTask,
} from '../features/tasks/hooks';
import { QuickAdd } from '../features/tasks/QuickAdd';
import { TaskBoard } from '../features/tasks/TaskBoard';
import { TaskDetailSheet } from '../features/tasks/TaskDetailSheet';
import { TaskList, type TaskGroup } from '../features/tasks/TaskList';
import { PRIORITY_COLOR } from '../features/tasks/meta';
import { useHotkeys } from '../hooks/useHotkeys';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { groupLabel, startOfLocalDay } from '../lib/dates';
import { keys, type TaskListParams } from '../lib/keys';
import { storage } from '../lib/storage';

const VIEW_META: Record<TaskView, { title: string; icon: typeof Inbox; empty: { title: string; description: string } }> = {
  inbox: { title: 'Inbox', icon: Inbox, empty: { title: 'Inbox zero', description: 'Everything is organised. Capture new ideas above — sort them later.' } },
  today: { title: 'Today', icon: CalendarCheck, empty: { title: 'Nothing due today', description: 'Enjoy the space — or pull something forward from Upcoming.' } },
  upcoming: { title: 'Upcoming', icon: CalendarClock, empty: { title: 'Your week is clear', description: 'Tasks with future due dates show up here, grouped by day.' } },
  overdue: { title: 'Overdue', icon: TriangleAlert, empty: { title: 'Nothing overdue', description: "You're on top of things. Keep it up!" } },
  completed: { title: 'Completed', icon: CheckCheck, empty: { title: 'No completed tasks yet', description: 'Finished tasks land here — a record of everything you got done.' } },
  all: { title: 'All tasks', icon: ListTodo, empty: { title: 'No tasks yet', description: 'Add your first task above to get started.' } },
  trash: { title: 'Trash', icon: Trash2, empty: { title: 'Trash is empty', description: 'Deleted tasks stay here for 30 days before being removed.' } },
};

const SORTS: Array<{ value: string; label: string; order: 'asc' | 'desc' }> = [
  { value: 'position', label: 'Manual', order: 'asc' },
  { value: 'dueAt', label: 'Due date', order: 'asc' },
  { value: 'priority', label: 'Priority', order: 'desc' },
  { value: 'createdAt', label: 'Newest', order: 'desc' },
  { value: 'title', label: 'Title', order: 'asc' },
];

type Layout = 'list' | 'board';

const MANUAL_ORDER_VIEWS = new Set<TaskView>(['inbox', 'all']);

export function TasksPage() {
  const { view: viewParam, projectId, tag } = useParams();
  const view: TaskView = projectId || tag ? 'all' : ((viewParam as TaskView) ?? 'today');
  const [search, setSearch] = useSearchParams();
  const openId = search.get('task');

  const { data: projects = [] } = useProjects();
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const project = projectId ? projectMap.get(projectId) : undefined;

  const scope = projectId ? `project:${projectId}` : tag ? `tag:${tag}` : view;
  const [layout, setLayoutState] = useState<Layout>(() => (storage.get(`taskflow.layout.${scope}`) as Layout) ?? 'list');
  useEffect(() => setLayoutState((storage.get(`taskflow.layout.${scope}`) as Layout) ?? 'list'), [scope]);
  const setLayout = (l: Layout) => {
    storage.set(`taskflow.layout.${scope}`, l);
    setLayoutState(l);
  };

  const [sort, setSort] = useState(SORTS[0]!);
  const [priorities, setPriorities] = useState<TaskPriority[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setPriorities([]);
    setSort(SORTS[0]!);
  }, [scope]);

  const canBoard = view !== 'trash' && view !== 'completed';
  const effectiveLayout: Layout = canBoard ? layout : 'list';

  const params: TaskListParams = {
    view,
    projectId,
    tag,
    priority: priorities.length ? priorities : undefined,
    sort: sort.value,
    order: sort.order,
    includeCompleted: effectiveLayout === 'board' ? true : undefined,
  };
  const listKey = keys.tasks.list(params);
  const query = useTaskList(params);
  const tasks = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const { data: stats } = useStats();

  const create = useCreateTask(listKey);
  const update = useUpdateTask();
  const toggle = useToggleComplete();
  const bulk = useBulkTasks();
  const emptyTrash = useEmptyTrash();
  const quickAddRef = useRef<HTMLInputElement>(null);

  useHotkeys({ n: () => quickAddRef.current?.focus(), escape: () => selecting && setSelecting(false) });

  const openTask = useCallback(
    (id: string) => {
      if (id.startsWith('temp-')) return;
      setSearch((s) => {
        const next = new URLSearchParams(s);
        next.set('task', id);
        return next;
      });
    },
    [setSearch],
  );
  const closeTask = () =>
    setSearch((s) => {
      const next = new URLSearchParams(s);
      next.delete('task');
      return next;
    });

  const onSelect = useCallback(
    (id: string) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const defaults: Partial<CreateTaskInput> = {
    ...(projectId ? { projectId } : {}),
    ...(tag ? { tags: [tag] } : {}),
    ...(view === 'today' ? { dueAt: startOfLocalDay(0).toISOString(), allDay: true } : {}),
    ...(view === 'upcoming' ? { dueAt: startOfLocalDay(1).toISOString(), allDay: true } : {}),
  };

  const groups = useMemo<TaskGroup[]>(() => buildGroups(view, tasks, sort.value), [view, tasks, sort.value]);
  const meta = VIEW_META[view];
  const title = project?.name ?? (tag ? `#${tag}` : meta.title);
  const openCount = tasks.filter((t) => t.status !== 'done').length;
  const todayDone = view === 'today' ? tasks.filter((t) => t.status === 'done').length : 0;

  return (
    <div
      className={cn('mx-auto w-full px-4 pb-32 pt-6 sm:px-8 sm:pt-10', effectiveLayout === 'board' ? 'max-w-6xl' : 'max-w-3xl')}
      data-layout={effectiveLayout}
    >
      {/* Header */}
      <header className="mb-6 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            {project ? <span className="size-3 rounded-full" style={{ backgroundColor: project.color }} aria-hidden /> : null}
            <h1 className="truncate text-[24px] font-semibold tracking-[-0.02em] sm:text-[26px]">{title}</h1>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {view === 'today'
              ? new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
              : query.isSuccess
                ? `${openCount} open task${openCount === 1 ? '' : 's'}`
                : ' '}
            {view === 'today' && stats?.streakDays ? (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-warning">
                <Flame className="size-3.5" aria-hidden /> {stats.streakDays}-day streak
              </span>
            ) : null}
          </p>
        </div>
        {view === 'today' && tasks.length ? <ProgressRing value={todayDone} total={tasks.length} /> : null}
      </header>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {view !== 'trash' && view !== 'completed' ? (
          <div className="flex-1 basis-full sm:basis-auto">
            <QuickAdd
              ref={quickAddRef}
              projects={projects}
              defaults={defaults}
              onCreate={(input) => create.mutate(input)}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        {canBoard ? (
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Layout">
            {(
              [
                ['list', List, 'List'],
                ['board', Columns3, 'Board'],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={effectiveLayout === value}
                onClick={() => setLayout(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                  effectiveLayout === value ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex-1" />

        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Filter by priority">
              <SlidersHorizontal className="size-3.5" />
              <span className="hidden sm:inline">Filter</span>
              {priorities.length ? <span className="rounded bg-accent px-1 text-[11px] text-accent-contrast">{priorities.length}</span> : null}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Priority</MenuLabel>
            {[...TASK_PRIORITIES].reverse().map((p) => (
              <MenuItem
                key={p}
                onSelect={() => setPriorities((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
                icon={<span className="block size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[p] }} />}
                shortcut={priorities.includes(p) ? '✓' : undefined}
              >
                {TASK_PRIORITY_LABELS[p]}
              </MenuItem>
            ))}
            {priorities.length ? (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => setPriorities([])}>Clear filters</MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Sort">
              <ArrowDownUp className="size-3.5" />
              <span className="hidden sm:inline">{sort.label}</span>
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Sort by</MenuLabel>
            {SORTS.map((s) => (
              <MenuItem key={s.value} onSelect={() => setSort(s)} shortcut={s.value === sort.value ? '✓' : undefined}>
                {s.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        {effectiveLayout === 'list' && view !== 'trash' ? (
          <Button
            variant={selecting ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setSelecting((s) => !s);
              setSelected(new Set());
            }}
            aria-pressed={selecting}
          >
            <CheckSquare className="size-3.5" />
            <span className="hidden sm:inline">{selecting ? 'Done' : 'Select'}</span>
          </Button>
        ) : null}

        {view === 'trash' && tasks.length ? (
          <Button variant="ghost" size="sm" className="text-danger" loading={emptyTrash.isPending} onClick={() => emptyTrash.mutate()}>
            Empty trash
          </Button>
        ) : null}
      </div>

      {/* Content */}
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <EmptyState
          icon={<TriangleAlert />}
          title="Couldn't load tasks"
          description={errorMessage(query.error)}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={priorities.length ? <SlidersHorizontal /> : view === 'today' || view === 'overdue' ? <PartyPopper /> : <meta.icon />}
          title={priorities.length ? 'No tasks match these filters' : meta.empty.title}
          description={priorities.length ? 'Try clearing a filter.' : project ? 'Add the first task for this project above.' : meta.empty.description}
          action={priorities.length ? <Button variant="outline" onClick={() => setPriorities([])}>Clear filters</Button> : undefined}
        />
      ) : effectiveLayout === 'board' ? (
        <TaskBoard
          tasks={tasks}
          projects={projectMap}
          onOpen={openTask}
          onToggle={toggle}
          onMove={(id, status: TaskStatus) => update.mutate({ id, input: { status } })}
        />
      ) : (
        <TaskList
          groups={groups}
          projects={projectMap}
          showProject={!projectId}
          // Manual ordering only where the server actually orders by position (date views sort by due date).
          sortable={sort.value === 'position' && MANUAL_ORDER_VIEWS.has(view) && groups.length === 1 && !priorities.length}
          onOpen={openTask}
          onToggle={toggle}
          onReorder={(id, position) => update.mutate({ id, input: { position } })}
          selecting={selecting}
          selected={selected}
          onSelect={onSelect}
        />
      )}

      {query.hasNextPage ? <LoadMore onVisible={() => void query.fetchNextPage()} loading={query.isFetchingNextPage} /> : null}

      <BulkBar
        count={selected.size}
        projects={projects}
        onClear={() => setSelected(new Set())}
        onAction={(action, extra) => {
          const ids = [...selected];
          if (action === 'move') bulk.mutate({ action, ids, projectId: (extra as string | null) ?? null });
          else if (action === 'priority') bulk.mutate({ action, ids, priority: extra as TaskPriority });
          else bulk.mutate({ action, ids });
          setSelected(new Set());
          setSelecting(false);
        }}
      />

      <TaskDetailSheet taskId={openId} projects={projects} onClose={closeTask} />
    </div>
  );
}

function buildGroups(view: TaskView, tasks: TaskDTO[], sort: string): TaskGroup[] {
  if (view === 'today') {
    const now = Date.now();
    const startToday = startOfLocalDay(0).getTime();
    const isOverdue = (t: TaskDTO) => !!t.dueAt && (t.allDay ? new Date(t.dueAt).getTime() < startToday : new Date(t.dueAt).getTime() < now);
    const open = tasks.filter((t) => t.status !== 'done');
    return [
      { key: 'overdue', label: 'Overdue', tone: 'danger' as const, tasks: open.filter(isOverdue) },
      { key: 'today', label: 'Today', tasks: open.filter((t) => !isOverdue(t)) },
      { key: 'done', label: 'Completed today', tasks: tasks.filter((t) => t.status === 'done') },
    ].filter((g) => g.tasks.length);
  }
  if (view === 'upcoming' && (sort === 'position' || sort === 'dueAt')) {
    const map = new Map<string, TaskDTO[]>();
    for (const t of tasks) {
      const label = groupLabel(t.dueAt);
      map.set(label, [...(map.get(label) ?? []), t]);
    }
    return [...map.entries()].map(([label, ts]) => ({ key: label, label, tasks: ts }));
  }
  return [{ key: 'all', label: '', tasks }];
}

function ListSkeleton() {
  return (
    <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading tasks">
      {[0.8, 0.6, 0.7, 0.5, 0.65].map((w, i) => (
        <div key={i} className="flex items-center gap-3 px-3">
          <Skeleton className="size-[18px] shrink-0 rounded-full" />
          <div className="flex-1">
            <div style={{ width: `${w * 100}%` }}>
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadMore({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onVisible(), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible]);
  return (
    <div ref={ref} className="flex justify-center py-6">
      {loading ? <Loader2 className="size-5 animate-spin text-muted" aria-label="Loading more" /> : null}
    </div>
  );
}

function BulkBar({
  count,
  projects,
  onClear,
  onAction,
}: {
  count: number;
  projects: ProjectDTO[];
  onClear: () => void;
  onAction: (action: 'complete' | 'delete' | 'move' | 'priority', extra?: unknown) => void;
}) {
  return (
    <AnimatePresence>
      {count > 0 ? (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-1 rounded-2xl border border-border bg-surface p-1.5 shadow-pop"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="px-2.5 text-[13px] font-medium tabular-nums">{count} selected</span>
          <Button size="sm" variant="ghost" onClick={() => onAction('complete')}>
            <CheckCheck className="size-3.5" /> <span className="hidden sm:inline">Complete</span>
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="ghost">
                Move
              </Button>
            </MenuTrigger>
            <MenuContent align="center">
              <MenuItem onSelect={() => onAction('move', null)} icon={<Inbox />}>
                Inbox
              </MenuItem>
              {projects.map((p) => (
                <MenuItem key={p.id} onSelect={() => onAction('move', p.id)} icon={<span className="block size-2.5 rounded-full" style={{ backgroundColor: p.color }} />}>
                  {p.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="ghost">
                Priority
              </Button>
            </MenuTrigger>
            <MenuContent align="center">
              {[...TASK_PRIORITIES].reverse().map((p) => (
                <MenuItem key={p} onSelect={() => onAction('priority', p)} icon={<span className="block size-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[p] }} />}>
                  {TASK_PRIORITY_LABELS[p]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onAction('delete')} aria-label="Delete selected">
            <Trash2 className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
            <X className="size-3.5" />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
