import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARTS, partsCover, testsOf } from '../../../scripts/e2e-parts.mjs';
import { APP_JOBS } from '../../../scripts/release-gate.mjs';

/*
 * The end-to-end suite in parts (Session 58, the owner: "a faster gate, without running less"). Each system's suite
 * runs in PARTS jobs side by side (Playwright's --shard, whole spec files); before part 1 runs, CI checks on that
 * system that the parts hold exactly the whole suite (scripts/e2e-parts.mjs --check). Here: that check's rule, and
 * that ci.yml runs every part on every system (macOS, Windows, Windows in Black) and the release gate counts each.
 */

const CI = readFileSync(join(__dirname, '..', '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
/** One job of ci.yml: from its key to the next job's. */
function jobBlock(key: string): string {
  const start = CI.indexOf(`\n  ${key}:\n`);
  if (start < 0) throw new Error(`no job ${key} in ci.yml`);
  const next = CI.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/u);
  return next < 0 ? CI.slice(start) : CI.slice(start, start + 1 + next);
}

const t = (file: string, line: number, title: string) => `${file}:${String(line)}:1 ${title} []`;
const a1 = t('a.spec.ts', 10, 'one');
const a2 = t('a.spec.ts', 20, 'two');
const b1 = t('b.spec.ts', 5, 'three');
const c1 = t('c.spec.ts', 7, 'four');

describe('the end-to-end suite in parts (Session 58)', () => {
  it('passes only when the parts hold exactly the whole suite, every spec file whole in one part', () => {
    expect(partsCover([a1, a2, b1, c1], [[a1, a2], [b1], [c1]])).toEqual({
      ok: true,
      lines: [
        'The whole suite: 4 tests in 3 files.',
        'Part 1 of 3: 2 tests in 1 files.',
        'Part 2 of 3: 1 tests in 1 files.',
        'Part 3 of 3: 1 tests in 1 files.',
        'Every test is in exactly one part, every spec file whole in one.',
      ],
    });
    // A new spec no part took: it falls out, and the check says so.
    const d1 = t('d.spec.ts', 3, 'a new spec');
    const fellOut = partsCover([a1, a2, b1, c1, d1], [[a1, a2], [b1], [c1]]);
    expect(fellOut.ok).toBe(false);
    expect(fellOut.lines).toContain(`In no part: ${d1}`);
    // A test run twice, a spec file split, a test not in the suite, an empty part.
    expect(partsCover([a1, a2, b1, c1], [[a1, a2, b1], [b1], [c1]]).lines).toContain(
      `In parts 1 and 2: ${b1}`,
    );
    expect(partsCover([a1, a2, b1, c1], [[a1], [a2, b1], [c1]]).lines).toContain(
      'a.spec.ts is split between parts 1 and 2.',
    );
    expect(partsCover([a1, b1, c1], [[a1, a2], [b1], [c1]]).lines).toContain(
      `In a part but not the suite: ${a2}`,
    );
    expect(partsCover([a1, a2, b1], [[a1, a2], [b1], []]).lines).toContain('Part 3 holds no test.');
  });

  it('reads every test of a Playwright listing, in describe blocks and made in a loop, each once', () => {
    const listing = {
      suites: [
        {
          title: 'a.spec.ts',
          specs: [
            { title: 'one', file: 'a.spec.ts', line: 10, column: 1, tests: [{ projectName: '' }] },
            {
              title: 'the editor at 1280 x 720',
              file: 'a.spec.ts',
              line: 30,
              column: 3,
              tests: [{ projectName: '' }],
            },
            {
              title: 'the editor at 1920 x 1080',
              file: 'a.spec.ts',
              line: 30,
              column: 3,
              tests: [{ projectName: '' }],
            },
          ],
          suites: [
            {
              title: 'a group',
              specs: [
                { title: 'inside', file: 'a.spec.ts', line: 50, column: 5, tests: [{ projectName: '' }] },
              ],
            },
          ],
        },
      ],
    };
    expect(testsOf(listing)).toEqual([
      'a.spec.ts:10:1 one []',
      'a.spec.ts:30:3 the editor at 1280 x 720 []',
      'a.spec.ts:30:3 the editor at 1920 x 1080 []',
      'a.spec.ts:50:5 a group › inside []',
    ]);
  });

  it('ci.yml runs every part on every system, checks the parts first, and the gate counts each', () => {
    expect(PARTS).toBe(3);
    const parts = Array.from({ length: PARTS }, (_, i) => i + 1);
    // Part 1 with the installers, on macOS and Windows, after the check.
    const app = jobBlock('app');
    expect(app).toContain('name: End-to-end and installers (${{ matrix.os }})');
    expect(app).toContain('run: node scripts/e2e-parts.mjs --check');
    expect(app).toContain(`run: pnpm test:e2e --shard=1/${String(PARTS)}`);
    expect(app.indexOf('e2e-parts.mjs --check')).toBeLessThan(app.indexOf('pnpm test:e2e --shard'));
    // The other parts on both systems.
    const rest = jobBlock('app-parts');
    expect(rest).toContain(
      `name: End-to-end, part \${{ matrix.part }} of ${String(PARTS)} (\${{ matrix.os }})`,
    );
    expect(rest).toContain(`part: [${parts.slice(1).join(', ')}]`);
    expect(rest).toContain('\'["macos-latest","windows-latest"]\'');
    expect(rest).toContain(`run: pnpm test:e2e "--shard=$PART/${String(PARTS)}"`);
    // Every part in Black, part 1 after the check (in Black, as the parts run there).
    const black = jobBlock('app-black');
    expect(black).toContain(
      `name: End-to-end in Black, part \${{ matrix.part }} of ${String(PARTS)} (windows-latest)`,
    );
    expect(black).toContain(`part: [${parts.join(', ')}]`);
    expect(black).toContain('DRASHTI_TEST_APPEARANCE: black');
    expect(black).toMatch(/if: matrix\.part == 1\n\s+run: node scripts\/e2e-parts\.mjs --check/u);
    expect(black).toContain(`run: pnpm test:e2e "--shard=$PART/${String(PARTS)}"`);
    // No other job runs end-to-end tests.
    expect(CI.match(/pnpm test:e2e/gu)).toHaveLength(3);
    // The release gate counts exactly these jobs, by the names ci.yml gives them.
    const named = [
      'End-to-end and installers (macos-latest)',
      ...parts.slice(1).map((p) => `End-to-end, part ${String(p)} of ${String(PARTS)} (macos-latest)`),
      'End-to-end and installers (windows-latest)',
      ...parts.slice(1).map((p) => `End-to-end, part ${String(p)} of ${String(PARTS)} (windows-latest)`),
      ...parts.map((p) => `End-to-end in Black, part ${String(p)} of ${String(PARTS)} (windows-latest)`),
    ];
    expect(APP_JOBS).toEqual(named);
  });
});
