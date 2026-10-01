import { defineConfig } from '@playwright/test';

/** The performance check, started by hand: pnpm test:perf (README, "Performance check"). */
export default defineConfig({
  testDir: 'tests/perf',
  globalSetup: './tests/global-setup.ts',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
});
