import { expect, test } from '@playwright/test';
import { quickAdd, register, row } from './helpers';

test.beforeEach(async ({ page }) => {
  await register(page);
});

test('new users see a guided starter project', async ({ page }) => {
  await expect(row(page, 'Welcome to TaskFlow')).toBeVisible();
  await expect(page.getByRole('link', { name: /Getting started/ })).toBeVisible();
});

test('natural-language quick add creates a fully-specified task', async ({ page }) => {
  await page.goto('/inbox');
  const input = page.getByTestId('quick-add');
  await input.fill('Pay rent tomorrow 9am #home !high');
  await expect(page.getByText('Tomorrow 9:00 AM')).toBeVisible(); // live preview chip
  await input.press('Enter');

  const task = row(page, 'Pay rent');
  await expect(task).toBeVisible();
  await expect(task).toContainText('#home');
  await expect(task).toContainText('Tomorrow 9:00 AM');
  await expect(task.getByLabel('High priority')).toBeVisible();
});

test('edit details, add subtasks, complete and undo', async ({ page }) => {
  await page.goto('/inbox');
  await quickAdd(page, 'Write launch blog post');
  await row(page, 'Write launch blog post').click();

  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Priority').selectOption('urgent');
  await sheet.getByLabel('Add subtask').fill('Outline');
  await sheet.getByLabel('Add subtask').press('Enter');
  await sheet.getByLabel('Add subtask').fill('First draft');
  await sheet.getByLabel('Add subtask').press('Enter');
  await expect(sheet.getByText('0 of 2')).toBeVisible();
  await sheet.getByRole('checkbox', { name: 'Complete "Outline"' }).click();
  await expect(sheet.getByText('1 of 2')).toBeVisible();

  await sheet.getByLabel('Notes').fill('Target: Hacker News + newsletter');
  await sheet.getByLabel('Task title').click(); // blur notes to save
  await page.keyboard.press('Escape');

  const task = row(page, 'Write launch blog post');
  await expect(task).toContainText('1/2');
  await expect(task.getByLabel('Urgent priority')).toBeVisible();

  await task.getByRole('checkbox', { name: /Complete "Write launch blog post"/ }).click();
  await expect(page.getByText('Task completed')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Write launch blog post')).toBeVisible();

  await row(page, 'Write launch blog post').getByRole('checkbox', { name: /Complete/ }).click();
  await page.getByRole('link', { name: 'Completed' }).click();
  await expect(row(page, 'Write launch blog post')).toBeVisible();
});

test('delete moves to trash and restore brings it back', async ({ page }) => {
  await page.goto('/inbox');
  await quickAdd(page, 'Disposable task');
  await row(page, 'Disposable task').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Moved to trash')).toBeVisible();
  await expect(row(page, 'Disposable task')).toHaveCount(0);

  await page.getByRole('link', { name: 'Trash' }).click();
  await row(page, 'Disposable task').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(row(page, 'Disposable task')).toBeVisible();
});

test('projects: create, add tasks, board drag between columns', async ({ page }) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Launch');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible();

  await quickAdd(page, 'Design landing page');
  await expect(row(page, 'Design landing page')).toBeVisible();

  await page.getByRole('radio', { name: 'Board' }).click();
  const card = page.getByTestId('board-card').filter({ hasText: 'Design landing page' });
  const target = page.getByRole('region', { name: 'In progress' });
  await expect(card).toBeVisible();

  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();

  await expect(target.getByTestId('board-card').filter({ hasText: 'Design landing page' })).toBeVisible();
});

test('command palette searches tasks and navigates', async ({ page }) => {
  await page.goto('/inbox');
  await quickAdd(page, 'Quarterly tax filing');
  await expect(row(page, 'Quarterly tax filing')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search tasks or type a command…').fill('tax fil');
  await page.getByRole('option', { name: /Quarterly tax filing/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Task title')).toHaveValue('Quarterly tax filing');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search tasks or type a command…').fill('upcom');
  await page.getByRole('option', { name: 'Upcoming' }).click();
  await expect(page).toHaveURL(/\/upcoming$/);
});

test('dark mode toggle persists', async ({ page }) => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
