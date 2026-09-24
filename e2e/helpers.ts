import { expect, type Page } from '@playwright/test';

export const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
export const PASSWORD = 'e2e-password-123';

export async function register(page: Page, name = 'E2E Tester') {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/today$/);
  return email;
}

export async function quickAdd(page: Page, text: string) {
  const input = page.getByTestId('quick-add');
  await input.fill(text);
  await input.press('Enter');
}

export const row = (page: Page, title: string | RegExp) => page.getByTestId('task-row').filter({ hasText: title });
