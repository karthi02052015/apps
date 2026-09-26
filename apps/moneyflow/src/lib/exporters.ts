/**
 * Getting the data back out.
 *
 * Nothing here talks to a server: the file is built in the tab and handed to
 * the browser's download machinery. That is the point of the app — the data is
 * the user's, and they can take all of it at any time, in a format other
 * software can read.
 *
 * Two details carried over from the server build and worth keeping:
 *
 *   **CSV injection.** A cell beginning with `=`, `+`, `-`, `@`, tab or CR is
 *   treated as a formula by Excel, Numbers and LibreOffice. A transaction
 *   described as `=HYPERLINK(...)` would then execute when the file is opened.
 *   Every cell starting with one of those characters is prefixed with an
 *   apostrophe — the standard OWASP mitigation, and necessary here because the
 *   content is entirely user-written.
 *
 *   **Money is written as an exact decimal string** derived from the integer
 *   minor units, never as a float.
 */
import type { Database, MinorUnits } from '../core/types';
import { LOCAL_TIMEZONE, monthBounds, toDateKey } from '../core/dates';
import { minorToDecimalString } from '../core/money';
import { signedAmount, byDateDescending } from '../core/ledger';
import { monthlyReport } from '../core/analytics';
import { toBackup } from '../core/schema';
import { PdfBuilder } from './pdf';

// ── Download plumbing ───────────────────────────────────────────────────────

/**
 * Hands a blob to the browser as a download.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * needs the URL to still resolve when it processes the synthetic click.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** RFC 4180 quoting plus spreadsheet formula neutralisation. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // A UTF-8 BOM makes Excel open non-ASCII characters correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export interface ExportRange {
  from?: string;
  to?: string;
}

export function transactionsCsv(db: Database, range: ExportRange = {}): Blob {
  const timeZone = LOCAL_TIMEZONE;
  const currency = db.profile.currency;
  const accounts = new Map(db.accounts.map((a) => [a.id, a.name]));
  const categories = new Map(db.categories.map((c) => [c.id, c.name]));

  const rows = db.transactions
    .filter((transaction) => {
      if (!range.from && !range.to) return true;
      const day = toDateKey(transaction.occurredAt, timeZone);
      if (range.from && day < range.from) return false;
      if (range.to && day > range.to) return false;
      return true;
    })
    .slice()
    .sort(byDateDescending)
    .map((transaction) => {
      const when = new Date(transaction.occurredAt);
      return [
        toDateKey(transaction.occurredAt, timeZone),
        new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(when),
        transaction.type,
        transaction.description,
        transaction.categoryId ? (categories.get(transaction.categoryId) ?? '') : '',
        accounts.get(transaction.accountId) ?? '',
        transaction.toAccountId ? (accounts.get(transaction.toAccountId) ?? '') : '',
        transaction.paymentMethod,
        minorToDecimalString(transaction.amountMinor, currency),
        minorToDecimalString(signedAmount(transaction.type, transaction.amountMinor), currency),
        currency,
        transaction.notes ?? '',
        transaction.source,
      ];
    });

  const csv = toCsv(
    ['Date', 'Time', 'Type', 'Description', 'Category', 'Account', 'To Account',
      'Payment Method', 'Amount', 'Signed Amount', 'Currency', 'Notes', 'Source'],
    rows,
  );
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

// ── Backup ──────────────────────────────────────────────────────────────────

/**
 * The complete, restorable snapshot.
 *
 * It is the whole database, unredacted, in plain text — which is exactly what
 * makes it a real backup and exactly why the Settings page warns about where
 * it gets stored.
 */
export function backupJson(db: Database): Blob {
  const payload = {
    ...toBackup(db),
    notice:
      'This file contains your complete financial history in plain text. ' +
      'Store it somewhere private — anyone who opens it can read every transaction.',
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

// ── PDF statement ───────────────────────────────────────────────────────────

const INK: [number, number, number] = [0.06, 0.09, 0.16];
const MUTED: [number, number, number] = [0.39, 0.45, 0.55];
const POSITIVE: [number, number, number] = [0.02, 0.47, 0.34];
const NEGATIVE: [number, number, number] = [0.73, 0.11, 0.11];

function symbolFor(currency: string): string {
  const symbols: Record<string, string> = { INR: 'Rs. ', USD: '$', EUR: 'EUR ', GBP: 'GBP ' };
  return symbols[currency] ?? `${currency} `;
}

function grouped(amount: MinorUnits, currency: string): string {
  const decimal = minorToDecimalString(Math.abs(amount), currency);
  const [whole, fraction] = decimal.split('.');
  const withSeparators = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}${symbolFor(currency)}${withSeparators}${fraction ? `.${fraction}` : ''}`;
}

/** A month's statement: summary band, key figures, category table. */
export function monthlyStatementPdf(db: Database, month: string): Blob {
  const report = monthlyReport(db, month, LOCAL_TIMEZONE);
  const currency = db.profile.currency;
  const pdf = new PdfBuilder();
  const left = 48;
  const right = pdf.width - 48;
  const contentWidth = right - left;

  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  pdf.text('MoneyFlow', left, 40, { font: 'Helvetica-Bold', size: 22, color: INK });
  pdf.text(`Monthly statement - ${monthLabel}`, left, 70, { size: 10, color: MUTED });
  pdf.text(
    `${db.profile.name || 'Your records'} - generated ${timestampStamp()}`,
    left, 84, { size: 10, color: MUTED },
  );

  // Summary band -------------------------------------------------------------
  const bandTop = 112;
  const columnWidth = contentWidth / 3;
  const cells: [string, string, [number, number, number]][] = [
    ['INCOME', grouped(report.totals.incomeMinor, currency), POSITIVE],
    ['EXPENSES', grouped(report.totals.expenseMinor, currency), NEGATIVE],
    ['NET', grouped(report.totals.netMinor, currency), report.totals.netMinor >= 0 ? POSITIVE : NEGATIVE],
  ];
  cells.forEach(([label, value, color], index) => {
    const x = left + index * columnWidth;
    pdf.text(label, x, bandTop, { size: 9, color: MUTED });
    pdf.text(value, x, bandTop + 14, { font: 'Helvetica-Bold', size: 15, color });
  });
  pdf.rule(left, right, bandTop + 48);

  // Key figures --------------------------------------------------------------
  let y = bandTop + 70;
  pdf.text('At a glance', left, y, { font: 'Helvetica-Bold', size: 12, color: INK });
  y += 22;

  const facts: [string, string][] = [
    ['Average daily spending', grouped(report.averageDailySpendMinor, currency)],
    ['Largest expense', report.largestExpense
      ? `${report.largestExpense.description} - ${grouped(report.largestExpense.amountMinor, currency)}`
      : 'None recorded'],
    ['Top spending category', report.topCategory
      ? `${report.topCategory.name} (${(report.topCategory.shareBps / 100).toFixed(1)}%)`
      : 'None recorded'],
    ['Savings rate', `${(report.savingsRateBps / 100).toFixed(1)}%`],
    ['Transactions', String(report.totals.incomeCount + report.totals.expenseCount)],
  ];
  for (const [label, value] of facts) {
    pdf.text(label, left, y, { size: 10, color: MUTED });
    pdf.text(value, left + 180, y, { size: 10, color: INK });
    y += 16;
  }

  // Category table -----------------------------------------------------------
  y += 16;
  pdf.text('Spending by category', left, y, { font: 'Helvetica-Bold', size: 12, color: INK });
  y += 22;

  const columns = [contentWidth * 0.45, contentWidth * 0.2, contentWidth * 0.15, contentWidth * 0.2];
  const columnX = (index: number): number =>
    left + columns.slice(0, index).reduce((a, b) => a + b, 0);

  const headings = ['CATEGORY', 'AMOUNT', 'SHARE', 'TRANSACTIONS'];
  headings.forEach((heading, index) => {
    pdf.text(heading, columnX(index), y, {
      size: 9,
      color: MUTED,
      width: columns[index] as number,
      align: index === 0 ? 'left' : 'right',
    });
  });
  y += 14;
  pdf.rule(left, right, y);
  y += 10;

  if (report.categories.length === 0) {
    pdf.text('No expenses recorded in this period.', left, y, { size: 10, color: MUTED });
  } else {
    for (const slice of report.categories) {
      pdf.y = y;
      if (pdf.needsPage(20)) {
        pdf.addPage();
        y = 48;
      }
      const values = [
        slice.name,
        grouped(slice.amountMinor, currency),
        `${(slice.shareBps / 100).toFixed(1)}%`,
        String(slice.transactionCount),
      ];
      values.forEach((value, index) => {
        pdf.text(value, columnX(index), y, {
          size: 10,
          color: INK,
          width: columns[index] as number,
          align: index === 0 ? 'left' : 'right',
        });
      });
      y += 16;
    }
  }

  pdf.text(
    `MoneyFlow statement - ${monthLabel} - figures are derived from the transactions you recorded. ` +
      'This is not financial advice.',
    left,
    pdf.height - 40,
    { size: 8, color: MUTED, width: contentWidth, align: 'center' },
  );

  return pdf.build();
}

// ── Convenience wrappers used by the pages ──────────────────────────────────

export function downloadTransactionsCsv(db: Database, range: ExportRange = {}): void {
  saveBlob(transactionsCsv(db, range), `moneyflow-transactions-${timestampStamp()}.csv`);
}

export function downloadBackup(db: Database): void {
  saveBlob(backupJson(db), `moneyflow-backup-${timestampStamp()}.json`);
}

export function downloadMonthlyStatement(db: Database, month: string): void {
  saveBlob(monthlyStatementPdf(db, month), `moneyflow-${month}.pdf`);
}

export { monthBounds };
