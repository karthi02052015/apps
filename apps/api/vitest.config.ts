import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each file boots its own in-memory Postgres (PGlite) — isolated and parallel-safe.
    pool: 'forks',
  },
});
