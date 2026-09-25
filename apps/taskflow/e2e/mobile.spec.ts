import { expect, test } from '@playwright/test';
import { quickAdd, register, row } from './helpers';

test('mobile: navigate with the drawer and manage tasks', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();

  await quickAdd(page, 'Buy groceries');
  await row(page, 'Buy groceries').click();
  await expect(page.getByRole('dialog').getByLabel('Task title')).toHaveValue('Buy groceries');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // No horizontal overflow at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
