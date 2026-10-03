import { defineConfig } from 'vitest/config';

/**
 * The speed tests time the main process's own work against a budget. They
 * run after every other unit test, one file at a time: each fills a library
 * of 5,000 presentations first, and a full run used to time one while the
 * other was filling its library on another worker (CI's runners have 2 to 4
 * cores). What they measure, and their budgets, are the same either way.
 */
const SPEED_TESTS = ['src/main/db/library-list.test.ts', 'src/main/db/search-budget.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: SPEED_TESTS,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'speed',
          include: SPEED_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
