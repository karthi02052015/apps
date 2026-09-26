import { useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { currentMonthKey, monthLabel, shiftMonth, todayKey } from '@/lib/dates';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useCalendar, useTransactions } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/ui/Skeleton';
import { TransactionItem } from '@/components/TransactionItem';
import { Modal } from '@/components/ui/Modal';
import { TransactionDetail } from '@/components/TransactionDetail';
import type { Transaction } from '@/types/api';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The financial calendar (section 27).
 *
 * Each cell shows the day's net movement; selecting one loads that day's
 * transactions. The grid starts on Monday, which is how most of the world reads
 * a calendar and how the weekly budget period is defined.
 */
export function CalendarPage() {
  const user = useCurrentUser();
  const [month, setMonth] = useState(currentMonthKey());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const { data, isLoading, isError, refetch } = useCalendar(month);
  const dayTransactions = useTransactions(
    { from: selectedDate ?? undefined, to: selectedDate ?? undefined, pageSize: 50, sort: 'date_asc' },
    { enabled: selectedDate !== null },
  );

  const cells = useMemo(() => {
    if (!data) return [];
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
    const byDate = new Map(data.days.map((day) => [day.date, day]));
    const upcomingByDate = new Map<string, number>();
    for (const item of data.upcoming) {
      upcomingByDate.set(item.dueOn, (upcomingByDate.get(item.dueOn) ?? 0) + 1);
    }

    const list: ({ date: string; income: number; expense: number; net: number; count: number; upcoming: number } | null)[] =
      Array.from({ length: firstWeekday }, () => null);

    for (const day of data.days) {
      list.push({
        date: day.date,
        income: day.incomeMinor,
        expense: day.expenseMinor,
        net: day.netMinor,
        count: day.transactionCount,
        upcoming: upcomingByDate.get(day.date) ?? 0,
      });
    }
    void byDate;
    return list;
  }, [data, month]);

  const monthNet = data?.days.reduce((sum, day) => sum + day.netMinor, 0) ?? 0;
  const today = todayKey();

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Your month at a glance — what came in, what went out, what is coming."
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-[10rem] text-center text-sm font-semibold text-ink">{monthLabel(month)}</span>
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <p className="text-sm text-ink-2">
            Net{' '}
            <span className={cn('tnum font-semibold', monthNet >= 0 ? 'text-positive' : 'text-negative')}>
              {formatMoney(monthNet, user.currency, { signed: true })}
            </span>
          </p>
        </div>
      </PageHeader>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <ChartSkeleton height={420} />
      ) : (
        <Card className="overflow-hidden p-2 sm:p-4">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                <span className="hidden sm:inline">{weekday}</span>
                <span className="sm:hidden">{weekday[0]}</span>
              </div>
            ))}

            {cells.map((cell, index) =>
              cell === null ? (
                <div key={`blank-${index}`} aria-hidden />
              ) : (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDate(cell.date)}
                  aria-label={`${cell.date}, ${cell.count} transactions, net ${formatMoney(cell.net, user.currency)}`}
                  className={cn(
                    'flex min-h-[4.25rem] flex-col rounded-lg border p-1.5 text-left transition-colors sm:min-h-[5.5rem] sm:p-2',
                    cell.date === today
                      ? 'border-brand bg-brand-soft/50'
                      : cell.count > 0
                        ? 'border-line bg-surface-2 hover:border-brand/40'
                        : 'border-transparent hover:bg-surface-2',
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        cell.date === today ? 'text-brand' : 'text-ink-2',
                      )}
                    >
                      {Number(cell.date.slice(-2))}
                    </span>
                    {cell.upcoming > 0 && (
                      <CalendarClock className="h-3 w-3 text-caution" aria-label="Payment due" />
                    )}
                  </span>

                  {cell.income > 0 && (
                    <span className="tnum mt-auto block truncate text-[10px] font-semibold text-positive sm:text-xs">
                      +{formatMoney(cell.income, user.currency, { abbreviate: true, bare: true })}
                    </span>
                  )}
                  {cell.expense > 0 && (
                    <span className="tnum block truncate text-[10px] font-semibold text-negative sm:text-xs">
                      −{formatMoney(cell.expense, user.currency, { abbreviate: true, bare: true })}
                    </span>
                  )}
                </button>
              ),
            )}
          </div>
        </Card>
      )}

      {data && data.upcoming.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Scheduled this month" subtitle="Recurring entries due in this period" />
          <ul className="divide-y divide-line">
            {data.upcoming.map((item) => (
              <li key={`${item.id}-${item.dueOn}`} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-caution-soft text-caution" aria-hidden>
                  <CalendarClock className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.description}</span>
                  <span className="block text-xs text-ink-2">Due {item.dueOn}</span>
                </span>
                <span className={cn('tnum text-sm font-semibold', item.type === 'income' ? 'text-positive' : 'text-ink')}>
                  {formatMoney(item.amountMinor, user.currency)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={selectedDate !== null}
        onClose={() => setSelectedDate(null)}
        title={selectedDate ?? ''}
        description="Everything recorded on this day"
        size="lg"
      >
        {dayTransactions.isLoading ? (
          <ChartSkeleton height={160} />
        ) : (dayTransactions.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Nothing recorded on this day" className="py-8" />
        ) : (
          <div className="-mx-2 divide-y divide-line">
            {dayTransactions.data?.items.map((transaction) => (
              <TransactionItem
                key={transaction.id}
                transaction={transaction}
                onClick={setSelectedTransaction}
                dense
              />
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={selectedTransaction !== null}
        onClose={() => setSelectedTransaction(null)}
        title="Transaction"
        size="lg"
      >
        {selectedTransaction && (
          <TransactionDetail transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
        )}
      </Modal>
    </>
  );
}
