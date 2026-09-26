import type { ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { dayLabel, monthLabel } from '@/lib/dates';
import { seriesColor, swatch } from '@/lib/tokens';
import { Card, CardHeader } from './ui/Card';

/**
 * Chart building blocks.
 *
 * Shared conventions: money axes are abbreviated (₹1.2L) so labels never
 * collide, grids are faint, tooltips are a real card rather than the library
 * default, and every chart degrades to an explicit empty state rather than an
 * empty box.
 */

const AXIS = {
  stroke: 'rgb(var(--ink-3))',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({
  active, payload, label, currency, labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[];
  label?: string;
  currency: string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
      {label !== undefined && (
        <p className="mb-1 text-xs font-medium text-ink-2">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden />
          <span className="text-ink-2">{entry.name}</span>
          <span className="tnum ml-auto font-semibold text-ink">
            {formatMoney(entry.value ?? 0, currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * A card with a fixed-height plotting area.
 *
 * The `ResponsiveContainer` lives inside each chart component rather than here.
 * `ResponsiveContainer` measures itself and injects `width`/`height` into its
 * immediate child, so it has to wrap the Recharts element directly — wrapping a
 * custom component instead leaves the chart with no dimensions and it renders
 * nothing at all, silently.
 */
export function ChartCard({
  title, subtitle, action, children, className, height = 260, empty, legend,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: number;
  empty?: ReactNode;
  /** Rendered under the plot — used to name what the colours mean. */
  legend?: ReactNode;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div className="px-2 pb-4 pt-4 sm:px-4">
        {empty ?? (
          <>
            <div style={{ height }}>{children}</div>
            {legend}
          </>
        )}
      </div>
    </Card>
  );
}

const abbreviate = (currency: string) => (value: number) =>
  formatMoney(value, currency, { abbreviate: true, compactDecimals: true });

export function IncomeExpenseChart({
  data, currency,
}: {
  data: { month: string; incomeMinor: number; expenseMinor: number }[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
  <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
        <XAxis dataKey="month" {...AXIS} tickFormatter={(value: string) => monthLabel(value, 'short').split(' ')[0] ?? value} />
        <YAxis {...AXIS} tickFormatter={abbreviate(currency)} width={56} />
        <Tooltip
          cursor={{ fill: 'rgb(var(--surface-3) / 0.5)' }}
          content={<ChartTooltip currency={currency} labelFormatter={(value) => monthLabel(value)} />}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="incomeMinor" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expenseMinor" name="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailySpendChart({
  data, currency,
}: {
  data: { date: string; expenseMinor: number }[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
  <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
        <XAxis
          dataKey="date"
          {...AXIS}
          interval="preserveStartEnd"
          minTickGap={24}
          tickFormatter={(value: string) => value.slice(-2)}
        />
        <YAxis {...AXIS} tickFormatter={abbreviate(currency)} width={56} />
        <Tooltip
          cursor={{ fill: 'rgb(var(--surface-3) / 0.5)' }}
          content={<ChartTooltip currency={currency} labelFormatter={dayLabel} />}
        />
        <Bar dataKey="expenseMinor" name="Spent" fill="#6366f1" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceTimelineChart({
  data, currency,
}: {
  data: { date: string; balanceMinor: number }[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
  <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
        <XAxis
          dataKey="date"
          {...AXIS}
          interval="preserveStartEnd"
          minTickGap={32}
          tickFormatter={(value: string) => dayLabel(`${value}T00:00:00Z`)}
        />
        <YAxis {...AXIS} tickFormatter={abbreviate(currency)} width={56} />
        <Tooltip
          content={<ChartTooltip currency={currency} labelFormatter={(value) => dayLabel(`${value}T00:00:00Z`)} />}
        />
        <Area
          type="monotone"
          dataKey="balanceMinor"
          name="Balance"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#balanceFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SavingsTrendChart({
  data, currency,
}: {
  data: { month: string; netMinor: number }[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
  <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
        <XAxis dataKey="month" {...AXIS} tickFormatter={(value: string) => monthLabel(value, 'short').split(' ')[0] ?? value} />
        <YAxis {...AXIS} tickFormatter={abbreviate(currency)} width={56} />
        <Tooltip content={<ChartTooltip currency={currency} labelFormatter={(value) => monthLabel(value)} />} />
        <Line
          type="monotone"
          dataKey="netMinor"
          name="Net saved"
          stroke="#10b981"
          strokeWidth={2.5}
          dot={{ r: 3, fill: '#10b981' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * A legend for the donut.
 *
 * Without it the chart carries its meaning in colour alone, which is exactly
 * what section 54 rules out. Each entry names the category and states its
 * share, so the chart is still readable in greyscale or to a colour-blind user.
 */
export function DonutLegend({
  data, currency, limit = 6,
}: {
  data: { categoryId: string; name: string; amountMinor: number; color: string; shareBps: number }[];
  currency: string;
  limit?: number;
}) {
  if (data.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 px-2">
      {data.slice(0, limit).map((slice) => (
        <li key={slice.categoryId} className="flex items-center gap-1.5 text-xs">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: swatch(slice.color).hex }}
            aria-hidden
          />
          <span className="text-ink-2">{slice.name}</span>
          <span className="tnum font-semibold text-ink">
            {formatMoney(slice.amountMinor, currency, { abbreviate: true })}
          </span>
        </li>
      ))}
      {data.length > limit && (
        <li className="text-xs text-ink-3">+{data.length - limit} more</li>
      )}
    </ul>
  );
}

export function CategoryDonut({
  data, currency, onSelect,
}: {
  data: { categoryId: string; name: string; amountMinor: number; color: string }[];
  currency: string;
  onSelect?: (categoryId: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
  <PieChart>
        <Pie
          data={data}
          dataKey="amountMinor"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="58%"
          outerRadius="86%"
          paddingAngle={2}
          strokeWidth={0}
          onClick={(entry: { payload?: { categoryId?: string } }) => {
            const id = entry?.payload?.categoryId;
            if (id && onSelect) onSelect(id);
          }}
          className={onSelect ? 'cursor-pointer' : undefined}
        >
          {data.map((slice, index) => (
            <Cell key={slice.categoryId} fill={swatch(slice.color).hex || seriesColor(index)} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip currency={currency} />} />
      </PieChart>
    </ResponsiveContainer>
  );
}
