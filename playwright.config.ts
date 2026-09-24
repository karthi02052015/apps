import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 5174;

/**
 * End-to-end tests run the real API (embedded, in-memory Postgres) and the
 * real web app, then drive a browser through the core workflows.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npm run dev -w @taskflow/api',
      url: `http://127.0.0.1:${API_PORT}/readyz`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        PGLITE_DATA_DIR: 'memory://',
        JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123456',
        CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT}`,
        AUTH_RATE_LIMIT_MAX: '1000',
        RATE_LIMIT_MAX: '10000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `npm run dev -w @taskflow/web -- --port ${WEB_PORT} --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
