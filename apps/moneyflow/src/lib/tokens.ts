/**
 * Colour tokens for user-chosen category, account, budget and goal colours.
 *
 * Tailwind cannot generate class names from runtime strings, so every possible
 * combination is listed explicitly here. That is the reason this file is a map
 * rather than a template literal — a `bg-${color}-100` would silently produce
 * no CSS at all.
 */
export type ColorToken =
  | 'slate' | 'gray' | 'zinc' | 'stone' | 'red' | 'orange' | 'amber' | 'yellow'
  | 'lime' | 'green' | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo'
  | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose';

interface Swatch {
  /** Tinted chip background + matching foreground. */
  chip: string;
  /** Solid colour for chart series and progress fills. */
  hex: string;
  /** Text-only colour. */
  text: string;
  dot: string;
}

export const SWATCHES: Record<ColorToken, Swatch> = {
  slate:   { chip: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',       hex: '#64748b', text: 'text-slate-600 dark:text-slate-300',     dot: 'bg-slate-500' },
  gray:    { chip: 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',           hex: '#6b7280', text: 'text-gray-600 dark:text-gray-300',       dot: 'bg-gray-500' },
  zinc:    { chip: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',           hex: '#71717a', text: 'text-zinc-600 dark:text-zinc-300',       dot: 'bg-zinc-500' },
  stone:   { chip: 'bg-stone-100 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300',       hex: '#78716c', text: 'text-stone-600 dark:text-stone-300',     dot: 'bg-stone-500' },
  red:     { chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',               hex: '#ef4444', text: 'text-red-600 dark:text-red-300',         dot: 'bg-red-500' },
  orange:  { chip: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',   hex: '#f97316', text: 'text-orange-600 dark:text-orange-300',   dot: 'bg-orange-500' },
  amber:   { chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',       hex: '#f59e0b', text: 'text-amber-600 dark:text-amber-300',     dot: 'bg-amber-500' },
  yellow:  { chip: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',   hex: '#eab308', text: 'text-yellow-600 dark:text-yellow-300',   dot: 'bg-yellow-500' },
  lime:    { chip: 'bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300',           hex: '#84cc16', text: 'text-lime-600 dark:text-lime-300',       dot: 'bg-lime-500' },
  green:   { chip: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',       hex: '#22c55e', text: 'text-green-600 dark:text-green-300',     dot: 'bg-green-500' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', hex: '#10b981', text: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500' },
  teal:    { chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',           hex: '#14b8a6', text: 'text-teal-600 dark:text-teal-300',       dot: 'bg-teal-500' },
  cyan:    { chip: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',           hex: '#06b6d4', text: 'text-cyan-600 dark:text-cyan-300',       dot: 'bg-cyan-500' },
  sky:     { chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',               hex: '#0ea5e9', text: 'text-sky-600 dark:text-sky-300',         dot: 'bg-sky-500' },
  blue:    { chip: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',           hex: '#3b82f6', text: 'text-blue-600 dark:text-blue-300',       dot: 'bg-blue-500' },
  indigo:  { chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',   hex: '#6366f1', text: 'text-indigo-600 dark:text-indigo-300',   dot: 'bg-indigo-500' },
  violet:  { chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',   hex: '#8b5cf6', text: 'text-violet-600 dark:text-violet-300',   dot: 'bg-violet-500' },
  purple:  { chip: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',   hex: '#a855f7', text: 'text-purple-600 dark:text-purple-300',   dot: 'bg-purple-500' },
  fuchsia: { chip: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', hex: '#d946ef', text: 'text-fuchsia-600 dark:text-fuchsia-300', dot: 'bg-fuchsia-500' },
  pink:    { chip: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',           hex: '#ec4899', text: 'text-pink-600 dark:text-pink-300',       dot: 'bg-pink-500' },
  rose:    { chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',           hex: '#f43f5e', text: 'text-rose-600 dark:text-rose-300',       dot: 'bg-rose-500' },
};

export const COLOR_TOKENS = Object.keys(SWATCHES) as ColorToken[];

export function swatch(color: string | null | undefined): Swatch {
  return SWATCHES[(color as ColorToken) ?? 'slate'] ?? SWATCHES.slate;
}

/**
 * The chart series palette. Ordered so that adjacent series stay
 * distinguishable, including for the most common forms of colour blindness,
 * and so that no single hue dominates a donut chart.
 */
export const CHART_SERIES = [
  '#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ec4899',
  '#8b5cf6', '#84cc16', '#f97316', '#0ea5e9', '#f43f5e',
  '#14b8a6', '#a855f7',
];

export function seriesColor(index: number): string {
  return CHART_SERIES[index % CHART_SERIES.length] as string;
}
