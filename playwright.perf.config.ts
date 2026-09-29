import { defineConfig } from '@playwright/test';

/** The performance check, started by hand: pnpm test:perf (README, "Performance check"). */
export default defineConfig({
  testDir: 'tests/perf',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
});
