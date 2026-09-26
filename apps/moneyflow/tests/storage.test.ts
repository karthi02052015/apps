/**
 * The storage boundary: parsing, migration, backup and export.
 *
 * With no server, this is where all the defensive work lives. Whatever comes
 * back out of IndexedDB — or out of a file a person picked — has to become a
 * usable database or be dropped, and it has to do that without ever throwing
 * the app away.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, fromBackup, migrate, parseDatabase, toBackup } from '../src/core/schema';
import { createTransaction, createAccount } from '../src/core/operations';
import { netWorth } from '../src/core/ledger';
import { backupJson, csvCell, monthlyStatementPdf, toCsv, transactionsCsv } from '../src/lib/exporters';
import { AT, accountByType, categoryByName, freshDb } from './helpers';

function populated() {
  const base = freshDb();
  const bankId = accountByType(base, 'bank');
  let db = createTransaction(base, {
    type: 'income',
    amountMinor: 5_000_000,
    accountId: bankId,
    categoryId: categoryByName(base, 'Salary'),
    description: 'Salary',
    occurredAt: AT('2026-03-01'),
  }).db;
  db = createTransaction(db, {
    type: 'expense',
    amountMinor: 1_500_000,
    accountId: bankId,
    categoryId: categoryByName(db, 'Rent'),
    description: 'Rent',
    occurredAt: AT('2026-03-03'),
  }).db;
  return db;
}

describe('parseDatabase', () => {
  it('round-trips a real database unchanged', () => {
    const db = populated();
    const restored = parseDatabase(JSON.parse(JSON.stringify(db)));
    expect(restored.transactions).toHaveLength(2);
    expect(netWorth(restored)).toBe(netWorth(db));
    expect(restored.profile.currency).toBe(db.profile.currency);
  });

  it('starts fresh rather than throwing on rubbish', () => {
    for (const rubbish of [null, undefined, 42, 'nonsense', []]) {
      const db = parseDatabase(rubbish);
      expect(db.accounts.length).toBeGreaterThan(0);
      expect(db.transactions).toHaveLength(0);
    }
  });

  it('drops records that point at things which no longer exist', () => {
    const db = populated();
    const broken = {
      ...db,
      transactions: [
        ...db.transactions,
        { ...db.transactions[0], id: 'orphan', accountId: 'deleted-account' },
        { ...db.transactions[0], id: 'bad-transfer', type: 'transfer', toAccountId: 'gone' },
      ],
    };
    const restored = parseDatabase(JSON.parse(JSON.stringify(broken)));
    expect(restored.transactions.map((t) => t.id)).not.toContain('orphan');
    expect(restored.transactions.map((t) => t.id)).not.toContain('bad-transfer');
    expect(restored.transactions).toHaveLength(2);
  });

  it('repairs a dangling category reference instead of dropping the transaction', () => {
    const db = populated();
    const broken = {
      ...db,
      transactions: db.transactions.map((t) => ({ ...t, categoryId: 'no-such-category' })),
    };
    const restored = parseDatabase(JSON.parse(JSON.stringify(broken)));
    // Losing the label is acceptable; losing the money is not.
    expect(restored.transactions).toHaveLength(2);
    expect(restored.transactions.every((t) => t.categoryId === null)).toBe(true);
    expect(netWorth(restored)).toBe(netWorth(db));
  });

  it('coerces a fractional amount back to whole minor units', () => {
    const db = populated();
    const broken = {
      ...db,
      transactions: [{ ...db.transactions[0], amountMinor: 1234.56 }],
    };
    expect(parseDatabase(broken).transactions[0]?.amountMinor).toBe(1235);
  });
});

describe('migrate', () => {
  it('brings an unversioned database forward', () => {
    const { schemaVersion, ...unversioned } = populated();
    void schemaVersion;
    expect(migrate(unversioned as never).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('accepts data written by a newer build rather than refusing to open', () => {
    const future = { ...populated(), schemaVersion: CURRENT_SCHEMA_VERSION + 5 };
    const restored = parseDatabase(future);
    expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(restored.transactions).toHaveLength(2);
  });
});

describe('backup', () => {
  it('restores everything from its own export', () => {
    const db = populated();
    const restored = fromBackup(JSON.parse(JSON.stringify(toBackup(db))));
    expect(netWorth(restored)).toBe(netWorth(db));
    expect(restored.accounts).toHaveLength(db.accounts.length);
  });

  it('also accepts a bare database, for a hand-edited file', () => {
    const db = populated();
    expect(fromBackup(JSON.parse(JSON.stringify(db))).transactions).toHaveLength(2);
  });

  it('produces JSON carrying a warning about what is in it', async () => {
    const text = await backupJson(populated()).text();
    expect(JSON.parse(text).notice).toMatch(/plain text/i);
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas', () => {
    // The attack: a description that runs when the file is opened in Excel.
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe("'-5");
    // An ordinary value is left alone.
    expect(csvCell('Groceries')).toBe('Groceries');
  });

  it('quotes cells containing delimiters', () => {
    expect(csvCell('Coffee, milk')).toBe('"Coffee, milk"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it('writes CRLF rows with a BOM for Excel', () => {
    const csv = toCsv(['A', 'B'], [[1, 2]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('exports amounts as exact decimals, never floats', async () => {
    const text = await transactionsCsv(populated()).text();
    expect(text).toContain('50000.00');
    expect(text).toContain('-15000.00'); // the signed column
    expect(text).not.toMatch(/\d\.\d{3,}/); // no float artefacts
  });
});

describe('PDF statement', () => {
  it('produces a well-formed PDF', async () => {
    const blob = monthlyStatementPdf(populated(), '2026-03');
    const text = await blob.text();
    expect(blob.type).toBe('application/pdf');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('MoneyFlow');
    // The xref offset has to point at the xref table for a reader to open it.
    const startxref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('handles a month with nothing in it', async () => {
    const text = await monthlyStatementPdf(freshDb(), '2026-07').text();
    expect(text).toContain('No expenses recorded in this period.');
  });
});

describe('accounts', () => {
  it('keeps one default account when a new default is set', () => {
    const base = freshDb();
    const created = createAccount(base, {
      name: 'New bank',
      type: 'bank',
      openingBalanceMinor: 0,
      isDefault: true,
    });
    expect(created.db.accounts.filter((a) => a.isDefault)).toHaveLength(1);
    expect(created.db.accounts.find((a) => a.isDefault)?.id).toBe(created.account.id);
  });

  it('rejects a duplicate account name', () => {
    const base = freshDb();
    expect(() => createAccount(base, { name: 'Cash', type: 'cash', openingBalanceMinor: 0 })).toThrow();
  });
});
