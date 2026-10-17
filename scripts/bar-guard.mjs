// The bar guard (Sessions 31–36, TST-8), in CI's checks job: what a change does to the bars the tests hold
// Drashti to. It reads the change against a base (main) and lists every line that lowers a bar: a time limit
// raised, a budget loosened, a check skipped, a lint rule turned off. It counts a few things that should only
// ever go down (the ratchets) and says how each moved. It reports, in the job's summary; it does not fail CI.
//
//   node scripts/bar-guard.mjs <base ref>     HEAD against the base; the job summary too when run on CI
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where bars live. */
export const WATCHED = ['src', 'tests', 'scripts', 'eslint.config.mjs', 'playwright.config.ts', '.github'];

/** Files whose numbers are budgets: any number changed in them is said. */
export const BUDGETS = [
  'tests/e2e/operator.spec.ts',
  'tests/e2e/nodes-show.spec.ts',
  'tests/e2e/keyfill.spec.ts',
  'src/main/perftest.ts',
  'tests/e2e/a11y.ts',
];

/** What only ever goes down, counted in the whole tree: [name, pattern for git grep -E, paths]. */
export const RATCHETS = [
  ['lint rules turned off (eslint-disable)', 'eslint-disable', ['src', 'tests', 'scripts']],
  ['tests skipped (.skip, .fixme, skipIf)', '\\.(skip|fixme)\\(|skipIf\\(', ['src', 'tests']],
  ['raw waits in end-to-end tests (waitForTimeout)', 'waitForTimeout\\(', ['tests/e2e']],
  [
    'type checks turned off (@ts-ignore, @ts-expect-error)',
    '@ts-(ignore|expect-error)',
    ['src', 'tests', 'scripts'],
  ],
];

const NUMBER = /\d[\d_]*(\.\d+)?/gu;
const numbersIn = (line) => [...line.matchAll(NUMBER)].map((m) => Number(m[0].replace(/_/gu, '')));
const shape = (line) => line.replace(NUMBER, '#').trim();

/** One changed line's finding, or null. `was` is the line it replaced (same shape, other numbers), if any. */
function lowered(file, line, was) {
  const text = line.trim();
  if (/eslint-disable/u.test(text) && !(was && /eslint-disable/u.test(was))) return 'a lint rule turned off';
  if (/\.(skip|fixme)\(|skipIf\(/u.test(text) && !(was && /\.(skip|fixme)\(|skipIf\(/u.test(was)))
    return 'a test skipped';
  if (/\bretries\b/u.test(text) && was !== null && shape(was) === shape(text) && was.trim() !== text)
    return 'retries changed';
  if (was === null || shape(was) !== shape(text)) return null;
  const before = numbersIn(was);
  const after = numbersIn(text);
  const up = after.some((n, i) => n > (before[i] ?? n));
  const down = after.some((n, i) => n < (before[i] ?? n));
  if (/timeout/iu.test(text) && up) return 'a time limit raised';
  if (/toBeLessThan|MAX_|_MAX\b|BUDGET|LIMIT/u.test(text) && up) return 'a budget loosened';
  if (/toBeGreaterThan|MIN_|_MIN\b/u.test(text) && down) return 'a budget loosened';
  if (BUDGETS.includes(file) && (up || down)) return 'a watched budget changed';
  return null;
}

/** The bars a unified diff (git diff -U0) lowers: "file:line: what — the line". */
export function barsLowered(diff) {
  const found = [];
  let file = '';
  let at = 0;
  let removed = [];
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//u, '');
      continue;
    }
    if (raw.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
    if (hunk) {
      at = Number(hunk[1]);
      removed = [];
      continue;
    }
    if (raw.startsWith('-')) {
      removed.push(raw.slice(1));
      continue;
    }
    if (raw.startsWith('+')) {
      const line = raw.slice(1);
      // The removed line it replaced: the first of the hunk's with the same shape.
      const i = removed.findIndex((r) => shape(r) === shape(line));
      const was = i >= 0 ? (removed.splice(i, 1)[0] ?? null) : null;
      const what = lowered(file, line, was);
      if (what) found.push(`${file}:${String(at)}: ${what}: ${line.trim()}`);
      at++;
    }
  }
  return found;
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** How many lines match a pattern in a tree (a commit). */
export function countIn(ref, pattern, paths) {
  try {
    return git(['grep', '-c', '-E', pattern, ref, '--', ...paths])
      .split('\n')
      .filter((l) => l !== '')
      .reduce((sum, l) => sum + Number(l.slice(l.lastIndexOf(':') + 1)), 0);
  } catch {
    return 0; // git grep finds nothing: exit 1
  }
}

/** The report, as Markdown. */
export function report(base, head = 'HEAD') {
  const diff = git(['diff', '-U0', base, head, '--', ...WATCHED]);
  const bars = barsLowered(diff);
  const lines = [`### The bar guard: ${head} against ${base}`, ''];
  if (bars.length === 0) lines.push('No bar is lowered.');
  else {
    lines.push(`${String(bars.length)} line(s) lower a bar (said, not refused, for now):`, '');
    for (const b of bars) lines.push(`- ${b}`);
  }
  lines.push('', '| Ratchet (only ever down) | Base | Now | Change |', '|---|---:|---:|---:|');
  for (const [name, pattern, paths] of RATCHETS) {
    const was = countIn(base, pattern, paths);
    const now = countIn(head, pattern, paths);
    const change = now - was;
    lines.push(
      `| ${name} | ${String(was)} | ${String(now)} | ${change > 0 ? `+${String(change)} (up)` : String(change)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = process.argv[2];
  if (!base) {
    process.stderr.write('Usage: node scripts/bar-guard.mjs <base ref>\n');
    process.exit(2);
  }
  const text = report(base);
  process.stdout.write(text);
  if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], text);
}
