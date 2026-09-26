import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Download, Filter, Plus, Receipt, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { DATE_PRESETS, resolvePreset, type DatePresetId } from '@/lib/dates';
import { downloadTransactionsCsv } from '@/lib/exporters';
import { useDebounce } from '@/hooks/useDebounce';
import { useAccounts, useCategories, useTransactions } from '@/hooks/queries';
import { useCurrentUser } from '@/contexts/ProfileContext';
import { useDatabase } from '@/store/LedgerProvider';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader } from '@/layouts/AppShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Segmented, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, RowSkeleton } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { TransactionItem, groupByDay } from '@/components/TransactionItem';
import { TransactionDetail } from '@/components/TransactionDetail';
import { QuickAdd } from '@/components/QuickAdd';
import type { Transaction, TransactionType } from '@/types/api';

const PAGE_SIZE = 25;

type TypeFilter = 'all' | TransactionType;

/**
 * The full ledger (sections 13, 24, 25).
 *
 * All filtering happens server-side: the client sends the criteria and receives
 * one page. That is what keeps the page fast for someone with ten years of
 * history, and it means the totals shown alongside the list are computed over
 * the whole filtered set rather than the visible rows.
 */
export function TransactionsPage() {
  const user = useCurrentUser();
  const db = useDatabase();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [preset, setPreset] = useState<DatePresetId>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') ?? '');
  const [accountId, setAccountId] = useState(searchParams.get('accountId') ?? '');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const { data: categories = [] } = useCategories();
  const { data: accountData } = useAccounts(true);
  const accounts = accountData?.accounts ?? [];

  // A category arriving in the URL (from a dashboard click) widens the window,
  // otherwise the user lands on a filtered view that looks empty.
  useEffect(() => {
    if (searchParams.get('categoryId')) setPreset('this_year');
  }, [searchParams]);

  const range = useMemo(() => {
    if (preset === 'custom') {
      return {
        ...(customFrom ? { from: customFrom } : {}),
        ...(customTo ? { to: customTo } : {}),
      };
    }
    return resolvePreset(preset);
  }, [preset, customFrom, customTo]);

  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      sort,
      withRunningBalance: sort.startsWith('date'),
      ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
      ...(typeFilter !== 'all' ? { type: [typeFilter] } : {}),
      ...(categoryId ? { categoryId: [categoryId] } : {}),
      ...(accountId ? { accountId: [accountId] } : {}),
      ...(minAmount ? { minAmount } : {}),
      ...(maxAmount ? { maxAmount } : {}),
      ...range,
    }),
    [page, sort, debouncedSearch, typeFilter, categoryId, accountId, minAmount, maxAmount, range],
  );

  const { data, isLoading, isFetching, isError, refetch } = useTransactions(filters);

  // Any change to the criteria resets to the first page.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, categoryId, accountId, minAmount, maxAmount, preset, customFrom, customTo, sort]);

  const items = data?.items ?? [];
  const meta = data?.meta;
  const total = meta?.total ?? 0;
  const totalPages = meta?.totalPages ?? 1;
  const netMinor = meta?.netAmountMinor ?? 0;

  const activeFilterCount =
    (typeFilter !== 'all' ? 1 : 0) + (categoryId ? 1 : 0) + (accountId ? 1 : 0) +
    (minAmount ? 1 : 0) + (maxAmount ? 1 : 0) + (preset !== 'this_month' ? 1 : 0);

  function clearFilters() {
    setTypeFilter('all');
    setCategoryId('');
    setAccountId('');
    setMinAmount('');
    setMaxAmount('');
    setPreset('this_month');
    setCustomFrom('');
    setCustomTo('');
    setSearchParams({}, { replace: true });
  }

  function handleExport() {
    try {
      downloadTransactionsCsv(db, range);
      toast.success('Export ready', 'Your CSV has been downloaded.');
    } catch {
      toast.error('That export could not be generated.');
    }
  }

  const groups = groupByDay(items);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything that has come in and gone out."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void handleExport()}
              leftIcon={<Download className="h-4 w-4" aria-hidden />}
            >
              <span className="hidden sm:inline">Export</span>
            </Button>
            <Button onClick={() => setQuickAddOpen(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
              Add
            </Button>
          </div>
        }
      />

      {/* ── Search and filters ─────────────────────────────────────────────── */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <Input
              type="search"
              placeholder="Search description, category, account or amount…"
              aria-label="Search transactions"
              leftIcon={<Search className="h-4 w-4" aria-hidden />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              rightSlot={
                search ? (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearch('')} aria-label="Clear search">
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                ) : undefined
              }
            />
          </div>

          <Segmented
            ariaLabel="Filter by type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'income', label: 'In' },
              { value: 'expense', label: 'Out' },
              { value: 'transfer', label: 'Transfers' },
            ]}
            className="w-full lg:w-auto"
          />

          <Button
            variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
            onClick={() => setFiltersOpen(true)}
            leftIcon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}
            className="shrink-0"
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {activeFilterCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {preset !== 'this_month' && (
              <Badge tone="brand">{DATE_PRESETS.find((item) => item.id === preset)?.label}</Badge>
            )}
            {typeFilter !== 'all' && <Badge tone="brand">{typeFilter}</Badge>}
            {categoryId && (
              <Badge tone="brand">{categories.find((item) => item.id === categoryId)?.name ?? 'Category'}</Badge>
            )}
            {accountId && (
              <Badge tone="brand">{accounts.find((item) => item.id === accountId)?.name ?? 'Account'}</Badge>
            )}
            {(minAmount || maxAmount) && (
              <Badge tone="brand">
                {minAmount || '0'} – {maxAmount || '∞'}
              </Badge>
            )}
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-brand hover:underline">
              Clear all
            </button>
          </div>
        )}
      </Card>

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      {!isLoading && total > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-sm text-ink-2">
            <span className="font-semibold text-ink">{total.toLocaleString()}</span>{' '}
            {total === 1 ? 'transaction' : 'transactions'}
            {netMinor !== 0 && (
              <>
                {' · net '}
                <span className={cn('tnum font-semibold', netMinor >= 0 ? 'text-positive' : 'text-negative')}>
                  {formatMoney(netMinor, user.currency, { signed: true })}
                </span>
              </>
            )}
          </p>
          <Select
            aria-label="Sort transactions"
            className="h-9 w-auto text-sm"
            options={[
              { value: 'date_desc', label: 'Newest first' },
              { value: 'date_asc', label: 'Oldest first' },
              { value: 'amount_desc', label: 'Largest first' },
              { value: 'amount_asc', label: 'Smallest first' },
            ]}
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          />
        </div>
      )}

      {/* ── The list ───────────────────────────────────────────────────────── */}
      <Card className={cn('overflow-hidden transition-opacity', isFetching && !isLoading && 'opacity-60')}>
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : isLoading ? (
          <RowSkeleton count={8} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-6 w-6" aria-hidden />}
            title={activeFilterCount > 0 || search ? 'Nothing matches those filters' : 'No transactions yet'}
            description={
              activeFilterCount > 0 || search
                ? 'Try widening the date range or clearing a filter.'
                : 'Start tracking your money by adding your first transaction.'
            }
            action={
              activeFilterCount > 0 || search ? (
                <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
              ) : (
                <Button onClick={() => setQuickAddOpen(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
                  Add a transaction
                </Button>
              )
            }
          />
        ) : (
          <div>
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="sticky top-14 z-10 border-y border-line bg-surface-2/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2 backdrop-blur sm:px-5">
                  {group.label}
                </h2>
                <div className="divide-y divide-line">
                  {group.items.map((transaction) => (
                    <TransactionItem
                      key={transaction.id}
                      transaction={transaction}
                      onClick={setSelected}
                      showBalance={sort.startsWith('date')}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
          <Button
            variant="outline"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            leftIcon={<ChevronLeft className="h-4 w-4" aria-hidden />}
          >
            Previous
          </Button>
          <p className="text-sm text-ink-2" aria-live="polite">
            Page <span className="font-semibold text-ink">{page}</span> of {totalPages}
          </p>
          <Button
            variant="outline"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
            rightIcon={<ChevronRight className="h-4 w-4" aria-hidden />}
          >
            Next
          </Button>
        </nav>
      )}

      {/* ── Filter sheet ───────────────────────────────────────────────────── */}
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        description="Narrow the list down to exactly what you want to see."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={clearFilters}>Reset</Button>
            <Button onClick={() => setFiltersOpen(false)}>Show {total.toLocaleString()} results</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Date range"
            options={DATE_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
            value={preset}
            onChange={(event) => setPreset(event.target.value as DatePresetId)}
          />

          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              <Input label="To" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </div>
          )}

          <Select
            label="Category"
            placeholder="Any category"
            options={categories.map((category) => ({
              value: category.id,
              label: `${category.kind === 'income' ? '↓' : '↑'} ${category.name}`,
            }))}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          />

          <Select
            label="Account"
            placeholder="Any account"
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Minimum amount"
              inputMode="decimal"
              placeholder="0"
              value={minAmount}
              onChange={(event) => setMinAmount(event.target.value.replace(/[^\d.]/g, ''))}
            />
            <Input
              label="Maximum amount"
              inputMode="decimal"
              placeholder="Any"
              value={maxAmount}
              onChange={(event) => setMaxAmount(event.target.value.replace(/[^\d.]/g, ''))}
            />
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
            <Filter className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Filters apply to the whole history, not just this page — the count and net
              total above reflect everything that matches.
            </p>
          </div>
        </div>
      </Modal>

      <Modal open={selected !== null} onClose={() => setSelected(null)} title="Transaction" size="lg">
        {selected && <TransactionDetail transaction={selected} onClose={() => setSelected(null)} />}
      </Modal>

      <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </>
  );
}
