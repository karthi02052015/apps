#!/usr/bin/env node
/**
 * End-to-end verification in a real browser.
 *
 *   npm run build && npm run preview     # in one terminal
 *   node scripts/verify.mjs
 *
 * Unit tests prove the engine is right. This proves the *application* is: that
 * an account can be created and signed back into, that what lands in IndexedDB
 * is genuinely unreadable ciphertext, that charts actually draw, and — the
 * thing no unit test can check — that a hard reload brings everything back.
 *
 * It fails on any console error or failed network request, because a silent
 * exception in a money app is a defect even when the page still looks right.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_BASE ?? 'http://localhost:4173';
const PASSWORD = 'correct-horse-battery-staple-7';
const EMAIL = 'karthi@example.com';
const NEXT_PASSWORD = 'a-different-long-passphrase-9';

let passed = 0;
let failed = 0;
const consoleErrors = [];
const failedRequests = [];
// Requests are expected to fail while the network is deliberately switched
// off, so those are not counted against the run.
let offline = false;

function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \u001b[31m✗\u001b[0m ${label}\n      expected ${expected}, got ${actual}`);
  }
}

function checkTruthy(label, value) {
  check(label, Boolean(value), true);
}

/** Reads the raw account records straight out of IndexedDB, as an attacker would. */
const readVaults = async (page) =>
  page.evaluate(async () => {
    const request = indexedDB.open('moneyflow');
    const db = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const read = (store, method, key) =>
      new Promise((resolve) => {
        const tx = db.transaction(store, 'readonly');
        const query = key === undefined
          ? tx.objectStore(store)[method]()
          : tx.objectStore(store)[method](key);
        query.onsuccess = () => resolve(query.result);
        query.onerror = () => resolve(undefined);
      });

    const accounts = (await read('accounts', 'getAll')) ?? [];
    const legacy = await read('state', 'get', 'database');
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        email: account.email ?? null,
        iterations: account.kdf?.iterations ?? 0,
        saltLength: account.kdf?.salt?.length ?? 0,
        ivLength: account.vault?.iv?.length ?? 0,
        // Decoded so the caller can search the actual stored bytes for
        // plaintext, which is the only honest way to check "it is encrypted".
        plaintext: atob(account.vault?.data ?? ''),
      })),
      hasLegacyPlaintext: Boolean(legacy),
    };
  });

async function completeSetupWizard(page, name = 'Karthi') {
  await page.waitForSelector('text=What is your current balance?', { timeout: 15_000 });
  await page.getByLabel('What should we call you?').fill(name);
  await page.locator('input[inputmode="decimal"]').first().fill('10000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Personal/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // The goal step is optional; skip it.
  await page.getByRole('button', { name: /Skip|Finish|No thanks/ }).first().click();
  await page.waitForSelector('text=Good', { timeout: 15_000 });
}

async function main() {
  console.log('\n\u001b[1mMONEYFLOW — browser verification\u001b[0m\n');

  // The container ships a Chromium build; point Playwright at it rather than
  // downloading another copy.
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (offline) return;
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });

  // ── 1. Signing up ─────────────────────────────────────────────────────────
  console.log('1. Signing up');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Create your account', { timeout: 15_000 });
  checkTruthy('   a fresh device opens on sign-up', true);
  check(
    '   log-in tab is disabled with no accounts',
    await page.getByRole('tab', { name: 'Log in' }).isDisabled(),
    true,
  );

  await page.getByLabel('Your name').fill('Karthi');
  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForTimeout(500);
  checkTruthy(
    '   a malformed address is refused',
    await page.getByText('That does not look like an email address.').first().isVisible(),
  );
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);

  // The form must refuse to proceed until the "cannot be reset" box is ticked.
  await page.locator('input[type="checkbox"]').first().uncheck();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForTimeout(400);
  checkTruthy(
    '   refuses until the warning is acknowledged',
    await page.getByText('Please confirm you understand').first().isVisible(),
  );

  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('switch', { name: 'Stay logged in on this device' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();

  // ── 2. Setup wizard ───────────────────────────────────────────────────────
  console.log('\n2. Setup wizard');
  await completeSetupWizard(page);
  checkTruthy('   reaches the dashboard', await page.getByText('Good').first().isVisible());
  await page.waitForSelector('text=/₹\\s*10,000/', { timeout: 10_000 });
  checkTruthy('   ₹10,000 opening balance shows', true);

  // ── 3. Record a transaction ───────────────────────────────────────────────
  console.log('\n3. Recording an expense of ₹2,500');
  await page.goto(`${BASE}#/transactions`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add a transaction' }).click();
  await page.waitForSelector('[role="dialog"]');
  // The quick-add modal asks what kind of thing this is first.
  await page.locator('[role="dialog"]').getByRole('button').filter({ hasText: 'Expense' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('[role="dialog"] input[inputmode="decimal"]').first().fill('2500');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Food', exact: true }).first().click();
  await page.getByLabel('Description').fill('Test lunch');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Save expense' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(800);
  checkTruthy('   appears in the list', await page.getByText('Test lunch').first().isVisible());

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=/₹\\s*7,500/', { timeout: 10_000 });
  checkTruthy('   balance recalculated to ₹7,500', true);

  // ── 4. What is actually on disk ───────────────────────────────────────────
  console.log('\n4. What is actually stored');
  const stored = await readVaults(page);
  check('   one account record', stored.accounts.length, 1);
  const vault = stored.accounts[0];
  check('   named correctly', vault.name, 'Karthi');
  check('   email kept for signing in', vault.email, EMAIL);
  check('   PBKDF2 rounds', vault.iterations, 600_000);
  checkTruthy(`   random salt stored (${vault.saltLength} base64 chars)`, vault.saltLength >= 20);
  checkTruthy('   per-save IV stored', vault.ivLength >= 12);
  // The point of the whole exercise: the stored bytes say nothing.
  check('   ledger is not readable on disk', vault.plaintext.includes('Test lunch'), false);
  check('   no account names leak into the vault', vault.plaintext.includes('Bank Account'), false);
  check('   no unencrypted ledger left behind', stored.hasLegacyPlaintext, false);

  // ── 5. Persistence ────────────────────────────────────────────────────────
  console.log('\n5. Surviving a reload');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  checkTruthy(
    '   stays signed in',
    await page.getByText('Good').first().isVisible().catch(() => false),
  );
  await page.goto(`${BASE}#/transactions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  checkTruthy('   the transaction is still there', await page.getByText('Test lunch').first().isVisible());

  // ── 6. Logging out and back in ────────────────────────────────────────────
  console.log('\n6. Logging out and back in');
  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Account & security/ }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForSelector('text=Welcome back', { timeout: 10_000 });
  checkTruthy('   logging out returns to the log-in screen', true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/log-in.png' });
  check(
    '   the email is remembered, the password is not',
    await page.getByLabel('Email', { exact: true }).inputValue(),
    EMAIL,
  );

  await page.getByLabel('Password', { exact: true }).fill('the-wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('text=do not match an account here', { timeout: 10_000 });
  checkTruthy('   the wrong password is refused', true);

  await page.getByLabel('Email', { exact: true }).fill('nobody@example.com');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('text=do not match an account here', { timeout: 10_000 });
  checkTruthy('   an unknown address gets the same answer, not a hint', true);

  await page.getByLabel('Email', { exact: true }).fill(EMAIL.toUpperCase());
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Logging back in returns you to the page you were on, not to the dashboard.
  await page.waitForSelector('h1:has-text("Settings")', { timeout: 15_000 });
  checkTruthy('   the right details open it again, case-insensitively', true);
  await page.goto(`${BASE}#/transactions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  checkTruthy('   with the records intact', await page.getByText('Test lunch').first().isVisible());

  // ── 7. Changing the password ──────────────────────────────────────────────
  console.log('\n7. Changing the password');
  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Account & security/ }).click();
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill(NEXT_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEXT_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.waitForSelector('text=Password changed', { timeout: 20_000 });
  checkTruthy('   re-encrypts under the new password', true);

  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForSelector('text=Welcome back', { timeout: 10_000 });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('text=do not match an account here', { timeout: 15_000 });
  checkTruthy('   the old password no longer works', true);

  await page.getByLabel('Password', { exact: true }).fill(NEXT_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('h1:has-text("Settings")', { timeout: 20_000 });
  await page.goto(`${BASE}#/transactions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  checkTruthy('   and the data came through it', await page.getByText('Test lunch').first().isVisible());

  // ── 8. A second account, logged in at the same time ───────────────────────
  console.log('\n8. Two accounts logged in at once');
  const SECOND_EMAIL = 'priya@example.com';
  const SECOND_PASSWORD = 'another-long-passphrase-42';

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Karthi/ }).first().click();
  await page.getByRole('menuitem', { name: 'Add another account' }).click();
  await page.waitForSelector('text=Welcome back', { timeout: 10_000 });
  checkTruthy(
    '   adding an account offers a way back',
    await page.getByRole('button', { name: /Back to Karthi/ }).isVisible(),
  );

  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByLabel('Your name').fill('Priya');
  await page.getByLabel('Email', { exact: true }).fill(SECOND_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(SECOND_PASSWORD);
  await page.getByLabel('Confirm password').fill(SECOND_PASSWORD);
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: 'Create account' }).click();

  // A brand-new account lands in its own setup wizard, not the first one's data.
  await completeSetupWizard(page, 'Priya');
  checkTruthy('   the second account starts empty', true);
  await page.goto(`${BASE}#/transactions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check(
    "   it cannot see the first account's records",
    await page.getByText('Test lunch').first().isVisible().catch(() => false),
    false,
  );

  // Switching back is instant — no password, because the key is still held.
  await page.getByRole('button', { name: /Priya/ }).first().click();
  await page.getByRole('menuitem', { name: 'Karthi' }).click();
  await page.waitForTimeout(1200);
  checkTruthy(
    '   switching back needs no password',
    await page.getByText('Test lunch').first().isVisible().catch(() => false),
  );

  await page.getByRole('button', { name: /Karthi/ }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/account-switcher.png' });
  checkTruthy(
    '   the menu offers logging out of both',
    await page.getByRole('menuitem', { name: /Log out of all 2 accounts/ }).isVisible(),
  );
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.waitForTimeout(1200);
  // Logging one out hands the app to the other, rather than to the login screen.
  checkTruthy(
    '   logging one out leaves the other open',
    await page.getByRole('button', { name: /Priya/ }).first().isVisible().catch(() => false),
  );

  await page.getByRole('button', { name: /Priya/ }).first().click();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.waitForSelector('text=Welcome back', { timeout: 10_000 });
  checkTruthy('   logging the last one out returns to log-in', true);

  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(NEXT_PASSWORD);
  await page.getByRole('switch', { name: 'Stay logged in on this device' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForTimeout(2000);

  // ── 9. Charts ─────────────────────────────────────────────────────────────
  console.log('\n9. Charts render');
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const chartPaths = await page.locator('.recharts-surface path').count();
  checkTruthy(`   recharts drew ${chartPaths} paths`, chartPaths > 0);

  // ── 9. Every page loads ───────────────────────────────────────────────────
  console.log('\n10. Every route');
  for (const route of ['accounts', 'budgets', 'goals', 'recurring', 'debts', 'reports', 'calendar', 'settings']) {
    await page.goto(`${BASE}#/${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const heading = await page.locator('h1').first().textContent();
    checkTruthy(`   /${route} → "${heading?.trim()}"`, Boolean(heading?.trim()));
  }

  // ── 10. Export ────────────────────────────────────────────────────────────
  console.log('\n11. Exports are produced in the browser');
  await page.goto(`${BASE}#/reports`, { waitUntil: 'networkidle' });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.getByRole('button', { name: /CSV/i }).first().click(),
  ]);
  checkTruthy(`   downloaded ${download.suggestedFilename()}`, download.suggestedFilename().endsWith('.csv'));

  // ── 11. Offline ───────────────────────────────────────────────────────────
  console.log('\n12. Works with the network switched off');
  offline = true;
  await context.setOffline(true);
  await page.goto(`${BASE}#/transactions`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  checkTruthy('   still shows the ledger', await page.getByText('Test lunch').first().isVisible().catch(() => false));
  await context.setOffline(false);
  offline = false;

  // ── 12. Sample data ───────────────────────────────────────────────────────
  console.log('\n13. Sample data');
  // Start from a clean ledger, using the app's own reset — which verifies that
  // control at the same time.
  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Data & backups/ }).click();
  await page.getByRole('button', { name: 'Erase all my data' }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"]').getByLabel('Confirmation phrase').fill('ERASE MY DATA');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Erase everything' }).click();
  await page.waitForTimeout(1500);
  checkTruthy(
    '   reset returns to the setup wizard',
    await page.getByText('What is your current balance?').first().isVisible().catch(() => false),
  );

  await completeSetupWizard(page);
  await page.getByRole('button', { name: 'Show me an example' }).click();
  await page.waitForSelector('text=Sample data is showing.', { timeout: 15_000 });
  await page.waitForTimeout(1200);
  const sampleRows = await page.locator('text=Sample').count();
  checkTruthy(`   sample entries appear (${sampleRows} badges on screen)`, sampleRows > 3);

  // ── 13. Screenshots ───────────────────────────────────────────────────────
  console.log('\n14. Screenshots');
  // Let the success toasts fade before capturing anything.
  await page.waitForTimeout(6000);
  for (const [route, name] of [['', 'dashboard'], ['transactions', 'transactions'], ['reports', 'reports'], ['budgets', 'budgets']]) {
    await page.goto(`${BASE}#/${route}`, { waitUntil: 'networkidle' });
    // Park the cursor off-canvas so no chart tooltip is hovered open.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `screenshots/${name}.png` });
  }
  checkTruthy('   captured desktop screenshots', true);

  // The sign-up screen, for the README — captured in its own context so it has
  // no accounts on it.
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(BASE, { waitUntil: 'networkidle' });
  await guestPage.waitForSelector('text=Create your account', { timeout: 15_000 });
  await guestPage.getByLabel('Your name').fill('Karthi');
  await guestPage.getByLabel('Email', { exact: true }).fill(EMAIL);
  await guestPage.waitForTimeout(600);
  await guestPage.screenshot({ path: 'screenshots/sign-up.png' });
  await guest.close();

  // ── 14. Mobile ────────────────────────────────────────────────────────────
  console.log('\n15. Mobile layout');
  // Same page, so it keeps the sample data rather than meeting sign-up again.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('   no horizontal overflow at 390px', overflow <= 0, true);
  await page.screenshot({ path: 'screenshots/mobile-dashboard.png' });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── 15. Result ────────────────────────────────────────────────────────────
  console.log('\n16. Clean run');
  check('   console errors', consoleErrors.length, 0);
  if (consoleErrors.length) consoleErrors.slice(0, 5).forEach((line) => console.log(`      ${line}`));
  check('   failed requests', failedRequests.length, 0);
  if (failedRequests.length) failedRequests.slice(0, 5).forEach((line) => console.log(`      ${line}`));

  await browser.close();

  console.log(
    `\n\u001b[1m${failed === 0 ? '\u001b[32mALL CHECKS PASSED' : '\u001b[31mFAILURES'}\u001b[0m` +
      `  —  ${passed} passed, ${failed} failed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n\u001b[31mVerification run failed:\u001b[0m ${error.stack}\n`);
  process.exit(1);
});
