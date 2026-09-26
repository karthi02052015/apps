import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight, ArrowLeftRight, ArrowUpRight, Banknote, CalendarClock, Landmark,
  Lightbulb, Minus, PiggyBank, Plus, Receipt, Sparkles, Target, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBps, formatMoney } from '@/lib/money';
import { currentMonthKey, greeting, monthLabel } from '@/lib/dates';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import { useClearSampleData, useLoadSampleData, useDashboard, useInsights } from '@/hooks/queries';
import { PageHeader } from '@/layouts/AppShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { ChartSkeleton, EmptyState, ErrorState, RowSkeleton, StatSkeleton } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { TransactionItem } from '@/components/TransactionItem';
import { TransactionDetail } from '@/components/TransactionDetail';
import { MoneyHero } from '@/components/MoneyText';
import { IconTile } from '@/components/Icon';
import {
  BalanceTimelineChart, CategoryDonut, ChartCard, DailySpendChart, DonutLegend, IncomeExpenseChart,
} from '@/components/charts';
import { QuickAdd } from '@/components/QuickAdd';
import type { Transaction } from '@/types/api';

export function DashboardPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useDashboard(30);
  const { data: insights = [] } = useInsights(currentMonthKey());
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const clearSamples = useClearSampleData();
  const loadSamples = useLoadSampleData();

  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title={greeting(user.fullName)} description="Your money overview" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <StatSkeleton key={index} />)}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2"><RowSkeleton /></Card>
          <Card className="p-5"><ChartSkeleton height={220} /></Card>
        </div>
      </>
    );
  }

  const { currency } = data;
  const monthNet = data.thisMonth.totals.netMinor;
  const changeExpense = data.thisMonth.changeVsLastMonth.expenseMinor;

  return (
    <>
      <PageHeader
        title={`${greeting(user.fullName)} 👋`}
        description="Here is where your money stands today."
        action={
          <Button
            onClick={() => setQuickAddOpen(true)}
            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
            className="hidden lg:inline-flex"
          >
            Add transaction
          </Button>
        }
      />

      {data.hasSampleData && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-brand/25 bg-brand-soft px-4 py-3 sm:flex-row sm:items-center">
          <Sparkles className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-brand-ink">
            <strong className="font-semibold">Sample data is showing.</strong>{' '}
            These entries are examples so the charts have something to draw — remove them whenever you like.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 self-start sm:self-auto"
            loading={clearSamples.isPending}
            onClick={() =>
              clearSamples.mutate(undefined, {
                onSuccess: (result) => toast.success(`Removed ${result.deleted} sample entries`),
              })
            }
          >
            Remove samples
          </Button>
        </div>
      )}

      {/* ── The three questions from section 58 ───────────────────────────── */}
      <section aria-label="Money overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="relative overflow-hidden bg-gradient-to-br from-brand to-indigo-600 text-white sm:col-span-2 xl:col-span-1">
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Current balance</p>
            <MoneyHero minor={data.currentBalanceMinor} currency={currency} className="mt-2" />
            <p className="mt-2 flex items-center gap-1.5 text-sm text-white/85">
              {monthNet >= 0 ? <TrendingUp className="h-4 w-4" aria-hidden /> : <TrendingDown className="h-4 w-4" aria-hidden />}
              {formatMoney(monthNet, currency, { signed: true })} this month
            </p>
          </div>
        </Card>

        <StatCard
          label="Total received"
          value={data.lifetime.receivedMinor}
          currency={currency}
          icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
          tone="positive"
          caption={`${formatMoney(data.thisMonth.totals.incomeMinor, currency)} this month`}
        />
        <StatCard
          label="Total spent"
          value={data.lifetime.spentMinor}
          currency={currency}
          icon={<ArrowDownRight className="h-4 w-4" aria-hidden />}
          tone="negative"
          caption={
            changeExpense === 0
              ? `${formatMoney(data.thisMonth.totals.expenseMinor, currency)} this month`
              : `${formatMoney(Math.abs(changeExpense), currency)} ${changeExpense > 0 ? 'more' : 'less'} than last month`
          }
        />
        <StatCard
          label="Net saved"
          value={data.lifetime.savedMinor}
          currency={currency}
          icon={<PiggyBank className="h-4 w-4" aria-hidden />}
          tone={data.lifetime.savedMinor >= 0 ? 'positive' : 'negative'}
          caption={
            data.thisMonth.totals.incomeMinor > 0
              ? `${formatBps(data.thisMonth.savingsRateBps)} savings rate this month`
              : 'All time'
          }
        />
      </section>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <section aria-label="Quick actions" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickAction icon={Plus} label="Add money" onClick={() => setQuickAddOpen(true)} tone="positive" />
        <QuickAction icon={Minus} label="Add expense" onClick={() => setQuickAddOpen(true)} tone="negative" />
        <QuickAction icon={ArrowLeftRight} label="Transfer" onClick={() => setQuickAddOpen(true)} tone="brand" />
        <QuickAction icon={Target} label="Add to goal" onClick={() => setQuickAddOpen(true)} tone="caution" />
      </section>

      {data.isEmpty ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Receipt className="h-6 w-6" aria-hidden />}
            title="No transactions yet"
            description="Start tracking your money by adding your first transaction. It takes a few seconds."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={() => setQuickAddOpen(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
                  Add your first transaction
                </Button>
                {/* An empty money tracker is impossible to judge. Three months of
                    plausible activity makes every chart and report real, and the
                    banner above offers a one-click way back out. */}
                <Button
                  variant="outline"
                  loading={loadSamples.isPending}
                  onClick={() =>
                    loadSamples.mutate(undefined, {
                      onSuccess: () =>
                        toast.success('Sample data loaded', 'Remove it whenever you like.'),
                    })
                  }
                  leftIcon={<Sparkles className="h-4 w-4" aria-hidden />}
                >
                  Show me an example
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {/* ── Where the money sits ───────────────────────────────────────── */}
          <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Recent transactions"
                subtitle="Your latest activity"
                action={
                  <Link
                    to="/transactions"
                    className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand-soft"
                  >
                    View all
                  </Link>
                }
              />
              <div className="mt-2 divide-y divide-line">
                {data.recentTransactions.map((transaction) => (
                  <TransactionItem
                    key={transaction.id}
                    transaction={transaction}
                    onClick={setSelected}
                    showDate
                  />
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Where it sits" subtitle="Balance by account" />
              <div className="space-y-1 p-3">
                {data.accounts.map((account) => (
                  <Link
                    key={account.id}
                    to="/accounts"
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <IconTile icon={account.icon} color={account.color} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{account.name}</span>
                      <span className="block text-xs capitalize text-ink-3">{account.type.replace('_', ' ')}</span>
                    </span>
                    <span
                      className={cn(
                        'tnum shrink-0 text-sm font-semibold',
                        account.balanceMinor < 0 ? 'text-negative' : 'text-ink',
                      )}
                    >
                      {formatMoney(account.balanceMinor, currency)}
                    </span>
                  </Link>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-line p-4">
                <SummaryChip icon={Banknote} label="Available cash" value={data.summary.cashMinor} currency={currency} />
                <SummaryChip icon={Landmark} label="In the bank" value={data.summary.bankMinor} currency={currency} />
              </div>
            </Card>
          </section>

          {/* ── This month ─────────────────────────────────────────────────── */}
          <h2 className="mb-3 mt-8 text-lg font-semibold text-ink">
            {monthLabel(data.thisMonth.month)}
          </h2>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Income vs expenses"
              subtitle="Last six months"
              height={240}
            >
              <IncomeExpenseChart data={data.monthlyTrend} currency={currency} />
            </ChartCard>

            <ChartCard
              title="Spending by category"
              subtitle={`${formatMoney(data.thisMonth.totals.expenseMinor, currency)} this month`}
              height={200}
              legend={<DonutLegend data={data.categoryBreakdown} currency={currency} />}
              empty={
                data.categoryBreakdown.length === 0 ? (
                  <EmptyState title="No spending recorded yet this month" className="py-10" />
                ) : undefined
              }
            >
              <CategoryDonut data={data.categoryBreakdown} currency={currency} />
            </ChartCard>
          </section>

          {data.categoryBreakdown.length > 0 && (
            <Card className="mt-4">
              <CardHeader title="Where it went" subtitle="This month, largest first" />
              <ul className="space-y-3 p-5 pt-3">
                {data.categoryBreakdown.slice(0, 6).map((slice) => (
                  <li key={slice.categoryId}>
                    <Link to={`/transactions?categoryId=${slice.categoryId}`} className="group block">
                      <div className="flex items-center gap-3">
                        <IconTile icon={slice.icon} color={slice.color} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:underline">
                          {slice.name}
                        </span>
                        <span className="tnum shrink-0 text-sm font-semibold text-ink">
                          {formatMoney(slice.amountMinor, currency)}
                        </span>
                        <span className="tnum w-12 shrink-0 text-right text-xs text-ink-2">
                          {formatBps(slice.shareBps)}
                        </span>
                      </div>
                      <Progress valueBps={slice.shareBps} className="mt-2" size="sm" label={`${slice.name} share`} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Balance over time" subtitle="Last 30 days" height={220}>
              <BalanceTimelineChart data={data.balanceTimeline} currency={currency} />
            </ChartCard>
            <ChartCard title="Daily spending" subtitle="This month" height={220}>
              <DailySpendChart data={data.dailySpending} currency={currency} />
            </ChartCard>
          </section>

          {/* ── Budgets, goals, what's coming ──────────────────────────────── */}
          <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {data.budgets.length > 0 && (
              <Card>
                <CardHeader
                  title="Budgets"
                  action={<Link to="/budgets" className="text-sm font-medium text-brand hover:underline">Manage</Link>}
                />
                <ul className="space-y-4 p-5 pt-3">
                  {data.budgets.slice(0, 4).map((budget) => (
                    <li key={budget.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{budget.name}</span>
                        <span className="tnum shrink-0 text-xs text-ink-2">
                          {formatMoney(budget.spentMinor, currency, { abbreviate: true })} /{' '}
                          {formatMoney(budget.limitMinor, currency, { abbreviate: true })}
                        </span>
                      </div>
                      <Progress
                        valueBps={budget.usedBps}
                        className="mt-1.5"
                        size="sm"
                        tone={budget.status === 'exceeded' ? 'negative' : budget.status === 'warning' ? 'caution' : 'positive'}
                        label={`${budget.name} budget`}
                      />
                      {budget.status !== 'on_track' && (
                        <p className={cn('mt-1 text-xs font-medium', budget.status === 'exceeded' ? 'text-negative' : 'text-caution')}>
                          {budget.status === 'exceeded'
                            ? `Over by ${formatMoney(budget.spentMinor - budget.limitMinor, currency)}`
                            : `You've used ${formatBps(budget.usedBps)} of your ${budget.name} budget.`}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {data.goals.length > 0 && (
              <Card>
                <CardHeader
                  title="Savings goals"
                  action={<Link to="/goals" className="text-sm font-medium text-brand hover:underline">Manage</Link>}
                />
                <ul className="space-y-4 p-5 pt-3">
                  {data.goals.map((goal) => (
                    <li key={goal.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{goal.name}</span>
                        <span className="tnum shrink-0 text-xs text-ink-2">{formatBps(goal.progressBps)}</span>
                      </div>
                      <Progress valueBps={goal.progressBps} className="mt-1.5" size="sm" tone="positive" label={goal.name} />
                      <p className="mt-1 text-xs text-ink-2">
                        {formatMoney(goal.savedMinor, currency)} of {formatMoney(goal.targetMinor, currency)}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <CardHeader
                title="Coming up"
                subtitle="Next 14 days"
                action={<Link to="/recurring" className="text-sm font-medium text-brand hover:underline">Manage</Link>}
              />
              {data.upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="h-6 w-6" aria-hidden />}
                  title="Nothing scheduled"
                  description="Recurring bills and subscriptions will show up here."
                  className="py-8"
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.upcoming.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink-2" aria-hidden>
                        <CalendarClock className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{item.description}</span>
                        <span className="block text-xs text-ink-2">Due {item.dueOn}</span>
                      </span>
                      <span className={cn('tnum text-sm font-semibold', item.type === 'income' ? 'text-positive' : 'text-ink')}>
                        {formatMoney(item.amountMinor, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {(data.debts.iOweMinor > 0 || data.debts.owedToMeMinor > 0) && (
                <div className="grid grid-cols-2 gap-3 border-t border-line p-4">
                  <div>
                    <p className="text-xs text-ink-2">You owe</p>
                    <p className="tnum text-sm font-semibold text-negative">
                      {formatMoney(data.debts.iOweMinor, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-2">Owed to you</p>
                    <p className="tnum text-sm font-semibold text-positive">
                      {formatMoney(data.debts.owedToMeMinor, currency)}
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </section>

          {/* ── Insights ───────────────────────────────────────────────────── */}
          {insights.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-caution" aria-hidden />
                <h2 className="text-lg font-semibold text-ink">What we noticed</h2>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} currency={currency} />
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-3">
                These are observations drawn from the transactions you recorded — not financial advice.
              </p>
            </section>
          )}
        </>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Transaction"
        size="lg"
      >
        {selected && <TransactionDetail transaction={selected} onClose={() => setSelected(null)} />}
      </Modal>

      <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </>
  );
}

function StatCard({
  label, value, currency, icon, tone, caption,
}: {
  label: string;
  value: number;
  currency: string;
  icon: React.ReactNode;
  tone: 'positive' | 'negative';
  caption: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">{label}</p>
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg',
            tone === 'positive' ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative',
          )}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <p className="tnum mt-2 text-2xl font-bold tracking-tight text-ink">
        {formatMoney(value, currency)}
      </p>
      <p className="mt-1 text-xs text-ink-2">{caption}</p>
    </Card>
  );
}

function QuickAction({
  icon: Icon, label, onClick, tone,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  tone: 'positive' | 'negative' | 'brand' | 'caution';
}) {
  const tones = {
    positive: 'bg-positive-soft text-positive',
    negative: 'bg-negative-soft text-negative',
    brand: 'bg-brand-soft text-brand',
    caution: 'bg-caution-soft text-caution',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="card flex items-center gap-3 p-3.5 text-left transition-all hover:border-brand/40 hover:shadow-lift active:scale-[0.99]"
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tones[tone])} aria-hidden>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="truncate text-sm font-semibold text-ink">{label}</span>
    </button>
  );
}

function SummaryChip({
  icon: Icon, label, value, currency,
}: {
  icon: typeof Wallet;
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </p>
      <p className="tnum mt-1 text-sm font-semibold text-ink">{formatMoney(value, currency)}</p>
    </div>
  );
}

/**
 * Renders an insight.
 *
 * The server sends a sentence with `{{placeholders}}` plus the raw numbers it
 * used. Formatting happens here so amounts follow the user's currency, and the
 * facts stay visible — an insight the user cannot check is not worth showing.
 */
function InsightCard({
  insight, currency,
}: {
  insight: { id: string; tone: string; title: string; detail: string; facts: Record<string, number | string | null> };
  currency: string;
}) {
  const fill = (template: string) =>
    template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const facts = insight.facts;
      const minorKey = `${key}Minor`;
      if (typeof facts[minorKey] === 'number') return formatMoney(facts[minorKey], currency);
      if (key === 'share' && typeof facts.shareBps === 'number') return formatBps(facts.shareBps, 1);
      if (key === 'progress' && typeof facts.progressBps === 'number') return formatBps(facts.progressBps);
      if (key === 'rate' && typeof facts.savingsRateBps === 'number') return formatBps(facts.savingsRateBps);
      const value = facts[key];
      return value === null || value === undefined ? '' : String(value);
    });

  const toneClass =
    insight.tone === 'positive' ? 'border-positive/25 bg-positive-soft/40'
    : insight.tone === 'caution' ? 'border-caution/25 bg-caution-soft/40'
    : 'border-line bg-surface';

  return (
    <div className={cn('rounded-2xl border p-4', toneClass)}>
      <p className="text-sm font-semibold text-ink">{fill(insight.title)}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{fill(insight.detail)}</p>
      {typeof insight.facts.category === 'string' && (
        <Badge className="mt-2.5" tone="neutral">{insight.facts.category}</Badge>
      )}
    </div>
  );
}
