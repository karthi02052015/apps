import { expect, test } from '@playwright/test';
import { PASSWORD, register } from './helpers';

test.describe('authentication', () => {
  test('redirects anonymous users to sign in and back after login', async ({ page }) => {
    const email = await register(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/upcoming');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/upcoming$/);
    await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
  });

  test('shows friendly validation and credential errors', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  });

  test('keeps the session across a full page reload (refresh cookie)', async ({ page }) => {
    await register(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  });
});
