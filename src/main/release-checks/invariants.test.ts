import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invariantProblems } from '../../../scripts/check-invariants.mjs';

/*
 * The architecture's invariants (Sessions 31–36, ARCH-6): the README's list names, for each, the code that
 * holds it and the test that shows it, each with a phrase in it. Every one is there; a line naming a file
 * that is gone, a phrase no longer in its file, or no test, is said.
 */

const ROOT = join(__dirname, '..', '..', '..');

describe("the README's invariants", () => {
  it('name code and tests that are there, each holding its phrase', () => {
    expect(invariantProblems(readFileSync(join(ROOT, 'README.md'), 'utf8'), ROOT)).toEqual([]);
  });

  it('say a file that is gone, a phrase that is not in its file, and a line with no test', () => {
    const readme = [
      '**Invariants** (planted):',
      '',
      '- **Gone.** Held by `src/main/no-such-file.ts`; tested by `src/main/lifecycle.test.ts`.',
      '- **Moved.** Held by `src/main/lifecycle.ts` ("a phrase never written there"); tested by `src/main/lifecycle.test.ts`.',
      '- **Untested.** Held by `src/main/lifecycle.ts`.',
      '',
    ].join('\n');
    expect(invariantProblems(readme, ROOT)).toEqual([
      '"Gone.": src/main/no-such-file.ts is not a file.',
      '"Moved.": src/main/lifecycle.ts does not hold "a phrase never written there".',
      '"Untested.": it must say "Held by" its code, then "tested by" its test.',
    ]);
  });
});
