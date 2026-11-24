import { defineConfig } from 'vitest/config';

/**
 * The captions bench (CAP-CI-1; scripts/captions-bench.mjs): one measuring run, never part of the unit suite. Its
 * file is not a *.test.ts, so only this list names it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['src/main/speech/captions-bench.run.ts'],
    fileParallelism: false,
    testTimeout: 3_600_000,
  },
});
