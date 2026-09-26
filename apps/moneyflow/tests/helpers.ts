/**
 * Shared fixtures.
 *
 * Every test starts from a real `emptyDatabase()` — the same starter accounts
 * and categories a new user gets — rather than a hand-written object. A test
 * that builds its own fixture can drift from what the app actually creates;
 * this one cannot.
 */
import type { Database } from '../src/core/types';
import { emptyDatabase } from '../src/core/schema';

export function freshDb(overrides: Partial<Database['profile']> = {}): Database {
  const db = emptyDatabase(overrides);
  return { ...db, profile: { ...db.profile, setupCompletedAt: '2026-01-01T00:00:00.000Z' } };
}

export function accountByType(db: Database, type: string): string {
  const account = db.accounts.find((a) => a.type === type);
  if (!account) throw new Error(`No ${type} account in the fixture.`);
  return account.id;
}

export function categoryByName(db: Database, name: string): string {
  const category = db.categories.find((c) => c.name === name);
  if (!category) throw new Error(`No category named ${name} in the fixture.`);
  return category.id;
}

/** A fixed instant, so nothing in a test depends on when it runs. */
export const AT = (day: string): string => `${day}T12:00:00.000Z`;
