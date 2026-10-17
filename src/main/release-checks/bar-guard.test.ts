import { describe, expect, it } from 'vitest';
import { barsLowered } from '../../../scripts/bar-guard.mjs';

/*
 * The bar guard (Sessions 31–36, TST-8): what a change does to the bars the tests hold Drashti to, said in CI's
 * job summary. Fed planted diffs here: a time limit raised, a budget loosened, a lint rule turned off and a
 * test skipped are each said; a bar raised, or a plain change, is not.
 */

const diff = (file: string, removed: string[], added: string[]) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -10,${String(removed.length)} +10,${String(added.length)} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join('\n');

describe('the bar guard', () => {
  it('says a raised time limit, a loosened budget, a lint rule turned off and a skipped test', () => {
    const found = barsLowered(
      [
        diff('tests/e2e/x.spec.ts', ['  test.setTimeout(90_000);'], ['  test.setTimeout(180_000);']),
        diff(
          'tests/e2e/x.spec.ts',
          ['  expect(median).toBeLessThanOrEqual(17);'],
          ['  expect(median).toBeLessThanOrEqual(25);'],
        ),
        diff('tests/e2e/x.spec.ts', [], ['  // eslint-disable-next-line no-restricted-syntax -- planted']),
        diff('tests/e2e/x.spec.ts', [], ["  test.skip(true, 'planted');"]),
        diff(
          'src/main/perftest.ts',
          ['export const MAX_BLOCK_MS = 150;'],
          ['export const MAX_BLOCK_MS = 200;'],
        ),
      ].join('\n'),
    );
    expect(found).toEqual([
      'tests/e2e/x.spec.ts:10: a time limit raised: test.setTimeout(180_000);',
      'tests/e2e/x.spec.ts:10: a budget loosened: expect(median).toBeLessThanOrEqual(25);',
      'tests/e2e/x.spec.ts:10: a lint rule turned off: // eslint-disable-next-line no-restricted-syntax -- planted',
      "tests/e2e/x.spec.ts:10: a test skipped: test.skip(true, 'planted');",
      'src/main/perftest.ts:10: a budget loosened: export const MAX_BLOCK_MS = 200;',
    ]);
  });

  it('says nothing of a bar raised, or of a plain change', () => {
    expect(
      barsLowered(
        [
          diff('tests/e2e/x.spec.ts', ['  test.setTimeout(180_000);'], ['  test.setTimeout(90_000);']),
          diff(
            'tests/e2e/x.spec.ts',
            ['  expect(median).toBeLessThanOrEqual(25);'],
            ['  expect(median).toBeLessThanOrEqual(17);'],
          ),
          diff('src/main/x.ts', ["  const name = 'Placeholder';"], ["  const name = 'Placeholder two';"]),
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});
