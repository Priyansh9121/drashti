import { defineConfig } from '@playwright/test';

/**
 * The soak test, started by hand (the Soak workflow; README, "Soak test"): one test, for
 * DRASHTI_SOAK_MINUTES (180) with time to spare. No traces or screenshots: hours of them would
 * fill the runner; the test writes its own report to test-results/soak.
 */
const minutes = Math.max(5, Number(process.env['DRASHTI_SOAK_MINUTES'] ?? '180') || 180);

export default defineConfig({
  testDir: 'tests/soak',
  globalSetup: './tests/global-setup.ts',
  outputDir: 'test-results/soak-playwright',
  timeout: (minutes + 45) * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off' },
});
