import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBps, formatMoney } from '@/lib/money';
import { currentMonthKey, monthBounds, monthLabel, shiftMonth } from '@/lib/dates';
import { downloadBackup, downloadMonthlyStatement, downloadTransactionsCsv } from '@/lib/exporters';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useDatabase } from '@/store/LedgerProvider';
import { useToast } from '@/contexts/ToastContext';
import { useAccountReport, useMonthlyReport, useSavingsReport, useYearlyReport } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import { Segmented } from '@/components/ui/Field';
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/ui/Skeleton';
import { IconTile } from '@/components/Icon';
import {
  CategoryDonut, ChartCard, DailySpendChart, DonutLegend, IncomeExpenseChart, SavingsTrendChart,
} from '@/components/charts';

type Tab = 'monthly' | 'categories' | 'accounts' | 'savings' | 'yearly';

export function ReportsPage() {
  const user = useCurrentUser();
  const db = useDatabase();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('monthly');
  const [month, setMonth] = useState(currentMonthKey());

  const monthly = useMonthlyReport(month);
  const savings = useSavingsReport(currentMonthKey(), 12);
  const yearly = useYearlyReport(Number(month.slice(0, 4)));
  const bounds = monthBounds(month);
  const accountReport = useAccountReport(bounds.from, bounds.to);

  // Exports are built here in the tab — there is nowhere else for them to be
  // built, and nothing leaves the device.
  function download(kind: 'csv' | 'pdf' | 'json') {
    try {
      if (kind === 'csv') downloadTransactionsCsv(db);
      else if (kind === 'pdf') downloadMonthlyStatement(db, month);
      else downloadBackup(db);
      toast.success('Download ready');
    } catch {
      toast.error('That export could not be generated.');
    }
  }

  const report = monthly.data;

  return (
    <>
      <PageHeader
        title="Reports"
        description="The full picture, month by month and year by year."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => download('csv')} leftIcon={<Download className="h-4 w-4" aria-hidden />}>
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button variant="outline" onClick={() => download('pdf')} leftIcon={<FileText className="h-4 w-4" aria-hidden />}>
              <span className="hidden sm:inline">PDF</span>
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented
            ariaLabel="Report type"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'categories', label: 'Categories' },
              { value: 'accounts', label: 'Accounts' },
              { value: 'savings', label: 'Savings' },
              { value: 'yearly', label: 'Yearly' },
            ]}
            size="sm"
          />

          {(tab === 'monthly' || tab === 'categories' || tab === 'accounts') && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <span className="min-w-[10rem] text-center text-sm font-semibold text-ink">
                {monthLabel(month)}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setMonth(shiftMonth(month, 1))}
                disabled={month >= currentMonthKey()}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </PageHeader>

      {/* ── Monthly ────────────────────────────────────────────────────────── */}
      {tab === 'monthly' && (
        monthly.isError ? <ErrorState onRetry={() => void monthly.refetch()} />
        : monthly.isLoading || !report ? <ChartSkeleton height={320} />
        : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatBlock label="Income" value={report.totals.incomeMinor} currency={user.currency} tone="positive"
                delta={report.changes.incomeMinor} />
              <StatBlock label="Expenses" value={report.totals.expenseMinor} currency={user.currency} tone="negative"
                delta={report.changes.expenseMinor} invertDelta />
              <StatBlock label="Net" value={report.totals.netMinor} currency={user.currency}
                tone={report.totals.netMinor >= 0 ? 'positive' : 'negative'} delta={report.changes.netMinor} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FactCard label="Average daily spending" value={formatMoney(report.averageDailySpendMinor, user.currency)} />
              <FactCard
                label="Largest expense"
                value={report.largestExpense ? formatMoney(report.largestExpense.amountMinor, user.currency) : '—'}
                caption={report.largestExpense?.description}
              />
              <FactCard
                label="Top category"
                value={report.topCategory?.name ?? '—'}
                caption={report.topCategory ? `${formatBps(report.topCategory.shareBps, 1)} of spending` : undefined}
              />
              <FactCard label="Savings rate" value={formatBps(report.savingsRateBps, 1)} />
            </div>

            <ChartCard title="Daily spending" subtitle={monthLabel(month)} height={240}>
              <DailySpendChart data={report.daily} currency={user.currency} />
            </ChartCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard
                title="Spending by category"
                height={230}
                legend={<DonutLegend data={report.categories} currency={user.currency} />}
                empty={report.categories.length === 0 ? <EmptyState title="No expenses this month" className="py-10" /> : undefined}
              >
                <CategoryDonut data={report.categories} currency={user.currency} />
              </ChartCard>

              <Card>
                <CardHeader title="Category breakdown" subtitle="Click through to the transactions" />
                {report.categories.length === 0 ? (
                  <EmptyState title="Nothing to break down yet" className="py-10" />
                ) : (
                  <ul className="space-y-3 p-5 pt-3">
                    {report.categories.map((slice) => (
                      <li key={slice.categoryId}>
                        <Link to={`/transactions?categoryId=${slice.categoryId}`} className="group block">
                          <div className="flex items-center gap-3">
                            <IconTile icon={slice.icon} color={slice.color} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:underline">
                              {slice.name}
                            </span>
                            <span className="tnum text-sm font-semibold text-ink">
                              {formatMoney(slice.amountMinor, user.currency)}
                            </span>
                            <span className="tnum w-12 text-right text-xs text-ink-2">
                              {formatBps(slice.shareBps)}
                            </span>
                          </div>
                          <Progress valueBps={slice.shareBps} size="sm" className="mt-2" label={slice.name} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )
      )}

      {/* ── Categories ─────────────────────────────────────────────────────── */}
      {tab === 'categories' && report && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Expenses" subtitle={monthLabel(month)} />
            <CategoryTable slices={report.categories} currency={user.currency} />
          </Card>
          <Card>
            <CardHeader title="Income" subtitle={monthLabel(month)} />
            <CategoryTable slices={report.incomeCategories} currency={user.currency} />
          </Card>
        </div>
      )}

      {/* ── Accounts ───────────────────────────────────────────────────────── */}
      {tab === 'accounts' && (
        accountReport.isLoading ? <ChartSkeleton height={280} />
        : (
          <Card className="overflow-x-auto">
            <CardHeader title="Account activity" subtitle={monthLabel(month)} />
            <table className="mt-3 w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-ink-2">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Account</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Money in</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Money out</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(accountReport.data?.accounts ?? []).map((account) => (
                  <tr key={account.accountId}>
                    <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
                      <span className="flex items-center gap-2.5">
                        <IconTile icon={account.icon} color={account.color} size="sm" />
                        {account.name}
                      </span>
                    </th>
                    <td className="tnum px-5 py-3 text-right text-positive">
                      {formatMoney(account.inflowMinor, user.currency)}
                    </td>
                    <td className="tnum px-5 py-3 text-right text-negative">
                      {formatMoney(account.outflowMinor, user.currency)}
                    </td>
                    <td className="tnum px-5 py-3 text-right font-semibold text-ink">
                      {formatMoney(account.balanceMinor, user.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {/* ── Savings ────────────────────────────────────────────────────────── */}
      {tab === 'savings' && (
        savings.isLoading || !savings.data ? <ChartSkeleton height={280} />
        : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FactCard label="Total saved" value={formatMoney(savings.data.totalNetMinor, user.currency)} />
              <FactCard label="Average per month" value={formatMoney(savings.data.averageMonthlyNetMinor, user.currency)} />
              <FactCard label="Savings rate" value={formatBps(savings.data.savingsRateBps, 1)} />
              <FactCard
                label="Best month"
                value={savings.data.bestMonth ? monthLabel(savings.data.bestMonth.month, 'short') : '—'}
                caption={savings.data.bestMonth ? formatMoney(savings.data.bestMonth.netMinor, user.currency) : undefined}
              />
            </div>
            <ChartCard title="Savings trend" subtitle="Net saved each month" height={280}>
              <SavingsTrendChart data={savings.data.months} currency={user.currency} />
            </ChartCard>
            <ChartCard title="Income vs expenses" subtitle="Last twelve months" height={280}>
              <IncomeExpenseChart data={savings.data.months} currency={user.currency} />
            </ChartCard>
          </div>
        )
      )}

      {/* ── Yearly ─────────────────────────────────────────────────────────── */}
      {tab === 'yearly' && (
        yearly.isLoading || !yearly.data ? <ChartSkeleton height={280} />
        : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <FactCard label={`${yearly.data.year} income`} value={formatMoney(yearly.data.totals.incomeMinor, user.currency)} />
              <FactCard label={`${yearly.data.year} expenses`} value={formatMoney(yearly.data.totals.expenseMinor, user.currency)} />
              <FactCard label="Net" value={formatMoney(yearly.data.totals.netMinor, user.currency)} />
              <FactCard label="Average monthly spend" value={formatMoney(yearly.data.averageMonthlyExpenseMinor, user.currency)} />
            </div>
            <ChartCard title={`${yearly.data.year} by month`} height={300}>
              <IncomeExpenseChart data={yearly.data.months} currency={user.currency} />
            </ChartCard>
            <Card>
              <CardHeader title="Categories for the year" />
              <CategoryTable slices={yearly.data.categories} currency={user.currency} />
            </Card>
          </div>
        )
      )}

      <Card className="mt-6 p-5">
        <h2 className="text-base font-semibold text-ink">Export your data</h2>
        <p className="mt-1 text-sm text-ink-2">
          Take a copy of everything you have recorded. Exported files contain your full
          financial history in plain text — keep them somewhere private.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download('csv')} leftIcon={<Download className="h-4 w-4" aria-hidden />}>
            Transactions (CSV)
          </Button>
          <Button variant="outline" onClick={() => download('pdf')} leftIcon={<FileText className="h-4 w-4" aria-hidden />}>
            Monthly statement (PDF)
          </Button>
          <Button variant="outline" onClick={() => download('json')} leftIcon={<Download className="h-4 w-4" aria-hidden />}>
            Full backup (JSON)
          </Button>
        </div>
      </Card>
    </>
  );
}

function StatBlock({
  label, value, currency, tone, delta, invertDelta = false,
}: {
  label: string;
  value: number;
  currency: string;
  tone: 'positive' | 'negative';
  delta: number;
  invertDelta?: boolean;
}) {
  const better = invertDelta ? delta < 0 : delta > 0;
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">{label}</p>
      <p className={cn('tnum mt-1.5 text-2xl font-bold tracking-tight', tone === 'positive' ? 'text-positive' : 'text-negative')}>
        {formatMoney(value, currency)}
      </p>
      {delta !== 0 && (
        <p className={cn('mt-1 text-xs font-medium', better ? 'text-positive' : 'text-ink-2')}>
          {formatMoney(Math.abs(delta), currency)} {delta > 0 ? 'more' : 'less'} than last month
        </p>
      )}
    </Card>
  );
}

function FactCard({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">{label}</p>
      <p className="tnum mt-1.5 truncate text-xl font-bold tracking-tight text-ink">{value}</p>
      {caption && <p className="mt-1 truncate text-xs text-ink-2">{caption}</p>}
    </Card>
  );
}

function CategoryTable({
  slices, currency,
}: {
  slices: { categoryId: string; name: string; icon: string; color: string; amountMinor: number; shareBps: number; transactionCount: number }[];
  currency: string;
}) {
  if (slices.length === 0) return <EmptyState title="Nothing recorded for this period" className="py-10" />;
  return (
    <ul className="divide-y divide-line">
      {slices.map((slice) => (
        <li key={slice.categoryId} className="flex items-center gap-3 px-5 py-3">
          <IconTile icon={slice.icon} color={slice.color} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{slice.name}</span>
            <span className="block text-xs text-ink-2">
              {slice.transactionCount} {slice.transactionCount === 1 ? 'entry' : 'entries'}
            </span>
          </span>
          <span className="text-right">
            <span className="tnum block text-sm font-semibold text-ink">
              {formatMoney(slice.amountMinor, currency)}
            </span>
            <span className="tnum block text-xs text-ink-2">{formatBps(slice.shareBps, 1)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
