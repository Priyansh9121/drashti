import { defineConfig } from 'vitest/config';

/**
 * The speed tests time the main process's own work against a budget. They
 * run after every other unit test, one file at a time: each fills a library
 * of 5,000 presentations first, and a full run used to time one while the
 * other was filling its library on another worker (CI's runners have 2 to 4
 * cores). What they measure, and their budgets, are the same either way.
 */
// The colour sweep is CPU-heavy too: keep it out of the concurrent FFmpeg/filesystem tests.
// Its per-test timeout and every accent checked stay the same.
const SERIAL_TESTS = [
  'src/main/db/library-list.test.ts',
  'src/main/db/search-budget.test.ts',
  'src/shared/appearance/derive.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // CI's runners stall now and then for several seconds (a Windows runner took 10 to 13 s over
    // tests that write to disk and take 2 s): 20 s, not the default 5, before a test counts as hung.
    // Budgets are checked by the tests that time things, never by this.
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: SERIAL_TESTS,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'speed',
          include: SERIAL_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
