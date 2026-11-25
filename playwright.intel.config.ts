import { defineConfig } from '@playwright/test';

/**
 * The hall's video playback on an Intel Mac (alpha.23, a22-intelplay; the owner's QA23-INTELPLAY-1): run only by
 * performance.yml's intel_playback job on GitHub's Intel Mac runner, never by CI's end-to-end parts or the release gate
 * (they read tests/e2e, playwright.config.ts). No retry: a video that plays only on a second try is a finding.
 */
export default defineConfig({
  testDir: 'tests/intel-playback',
  globalSetup: './tests/global-setup.ts',
  timeout: 360_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  preserveOutput: 'failures-only',
});
