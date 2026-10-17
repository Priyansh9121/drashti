import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // One temporary folder for the run, removed at the end (tests/global-setup.ts).
  globalSetup: './tests/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // On CI (Sessions 31–36, TST-3): a .only left in fails the run, and so does a test that passes only on
  // its retry (the retry stays, so the first attempt's trace and screenshots are kept).
  forbidOnly: Boolean(process.env['CI']),
  failOnFlakyTests: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
