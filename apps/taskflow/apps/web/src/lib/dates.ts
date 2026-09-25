import { differenceInCalendarDays, format, isThisYear } from 'date-fns';
import type { TaskDTO } from '@taskflow/shared';

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'done';

export interface DueLabel {
  label: string;
  tone: DueTone;
}

/** Human, glanceable due labels: "Today 3:00 PM", "Tomorrow", "Fri", "12 Oct", "2 days late". */
export function dueLabel(task: Pick<TaskDTO, 'dueAt' | 'allDay' | 'status'>, now = new Date()): DueLabel | null {
  if (!task.dueAt) return null;
  const due = new Date(task.dueAt);
  const days = differenceInCalendarDays(due, now);
  const time = task.allDay ? '' : ` ${format(due, 'p')}`;
  const overdue = task.allDay ? days < 0 : due.getTime() < now.getTime();

  let label: string;
  if (days === 0) label = `Today${time}`;
  else if (days === 1) label = `Tomorrow${time}`;
  else if (days === -1) label = `Yesterday${time}`;
  else if (days > 1 && days < 7) label = `${format(due, 'EEE')}${time}`;
  else label = `${format(due, isThisYear(due) ? 'd MMM' : 'd MMM yyyy')}${time}`;

  const tone: DueTone =
    task.status === 'done' ? 'done' : overdue ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : 'later';
  return { label, tone };
}

/** yyyy-MM-dd and HH:mm strings for native inputs, in local time. */
export const toDateInput = (iso: string | null) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '');
export const toTimeInput = (iso: string | null, allDay: boolean) => (iso && !allDay ? format(new Date(iso), 'HH:mm') : '');

/** Combine native date/time input values into an ISO instant (local time). */
export function fromInputs(date: string, time: string): { dueAt: string | null; allDay: boolean } {
  if (!date) return { dueAt: null, allDay: false };
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (!time) return { dueAt: new Date(y, m - 1, d).toISOString(), allDay: true };
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return { dueAt: new Date(y, m - 1, d, hh, mm).toISOString(), allDay: false };
}

export const startOfLocalDay = (offsetDays = 0) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays);
};

export function groupLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  const days = differenceInCalendarDays(d, now);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return format(d, 'EEEE');
  return format(d, isThisYear(d) ? 'EEEE, d MMMM' : 'd MMMM yyyy');
}
