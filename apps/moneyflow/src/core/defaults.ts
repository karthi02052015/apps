/**
 * The starter set of categories and accounts every new user receives.
 *
 * These are created as *real, editable rows owned by the user* rather than
 * global system records. A user can rename "Food" to "Eating out", archive
 * categories they do not use, or add their own — without any special-casing for
 * "system" rows elsewhere in the codebase. `is_system` only marks which ones
 * came from this list, which the UI uses to warn before deletion.
 *
 * Icon names are lucide-react identifiers; colours are design-system tokens
 * resolved by the client (see client/src/utils/tokens.ts).
 */

export interface CategorySeed {
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  // ── Income ────────────────────────────────────────────────────────────────
  { name: 'Salary', kind: 'income', icon: 'briefcase', color: 'emerald' },
  { name: 'Freelance', kind: 'income', icon: 'laptop', color: 'teal' },
  { name: 'Business', kind: 'income', icon: 'store', color: 'cyan' },
  { name: 'Investment', kind: 'income', icon: 'trending-up', color: 'green' },
  { name: 'Bonus', kind: 'income', icon: 'award', color: 'lime' },
  { name: 'Gift', kind: 'income', icon: 'gift', color: 'pink' },
  { name: 'Refund', kind: 'income', icon: 'undo-2', color: 'sky' },
  { name: 'Rental', kind: 'income', icon: 'key-round', color: 'amber' },
  { name: 'Interest', kind: 'income', icon: 'percent', color: 'emerald' },
  { name: 'Other Income', kind: 'income', icon: 'circle-plus', color: 'slate' },

  // ── Expense ───────────────────────────────────────────────────────────────
  { name: 'Food', kind: 'expense', icon: 'utensils', color: 'orange' },
  { name: 'Groceries', kind: 'expense', icon: 'shopping-basket', color: 'lime' },
  { name: 'Rent', kind: 'expense', icon: 'home', color: 'violet' },
  { name: 'Electricity', kind: 'expense', icon: 'zap', color: 'yellow' },
  { name: 'Water', kind: 'expense', icon: 'droplets', color: 'sky' },
  { name: 'Internet', kind: 'expense', icon: 'wifi', color: 'blue' },
  { name: 'Mobile', kind: 'expense', icon: 'smartphone', color: 'indigo' },
  { name: 'Shopping', kind: 'expense', icon: 'shopping-bag', color: 'pink' },
  { name: 'Travel', kind: 'expense', icon: 'plane', color: 'cyan' },
  { name: 'Fuel', kind: 'expense', icon: 'fuel', color: 'red' },
  { name: 'Education', kind: 'expense', icon: 'graduation-cap', color: 'teal' },
  { name: 'Medical', kind: 'expense', icon: 'heart-pulse', color: 'rose' },
  { name: 'Entertainment', kind: 'expense', icon: 'clapperboard', color: 'fuchsia' },
  { name: 'EMI', kind: 'expense', icon: 'landmark', color: 'stone' },
  { name: 'Insurance', kind: 'expense', icon: 'shield-check', color: 'emerald' },
  { name: 'Household', kind: 'expense', icon: 'lamp', color: 'amber' },
  { name: 'Subscriptions', kind: 'expense', icon: 'repeat', color: 'purple' },
  { name: 'Personal Care', kind: 'expense', icon: 'sparkles', color: 'rose' },
  { name: 'Gifts & Donations', kind: 'expense', icon: 'hand-heart', color: 'pink' },
  { name: 'Taxes', kind: 'expense', icon: 'receipt', color: 'slate' },
  { name: 'Other', kind: 'expense', icon: 'circle-ellipsis', color: 'slate' },
];

export interface AccountSeed {
  name: string;
  type: 'cash' | 'bank' | 'wallet' | 'credit_card' | 'savings' | 'investment' | 'other';
  icon: string;
  color: string;
  isDefault?: boolean;
}

/**
 * Two accounts is the right starting point: enough for transfers to be
 * meaningful on day one, few enough that the setup wizard stays a single step.
 */
export const DEFAULT_ACCOUNTS: AccountSeed[] = [
  { name: 'Cash', type: 'cash', icon: 'banknote', color: 'emerald' },
  { name: 'Bank Account', type: 'bank', icon: 'landmark', color: 'indigo', isDefault: true },
];

/** Categories the insight engine treats as essential when commenting on spend. */
export const ESSENTIAL_CATEGORY_NAMES = new Set([
  'Rent', 'Electricity', 'Water', 'Internet', 'Mobile', 'Groceries', 'EMI', 'Insurance', 'Medical',
]);
