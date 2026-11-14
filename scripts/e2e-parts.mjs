// The end-to-end suite in parts (Session 58, the owner: "a faster gate, without running less"). On each system
// (macOS, Windows, Windows in Black) CI runs the suite in PARTS jobs side by side, each `playwright test
// --shard=<i>/<PARTS>` (.github/workflows/ci.yml): with fullyParallel off, Playwright gives each part whole spec
// files. Before the first part runs, CI checks here that the parts together hold exactly the whole suite: every test
// in one part and one only, every spec file whole in one part, nothing in a part that is not in the suite. The parts
// are made from the suite as it is listed then, so a new spec is in one of them by itself; this proves it.
//
//   node scripts/e2e-parts.mjs --check            list the whole suite and each part (no test runs), and compare
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** How many parts each system's end-to-end suite runs in (ci.yml's jobs and the release gate's APP_JOBS agree). */
export const PARTS = 3;

/**
 * Every test in a Playwright JSON listing (`playwright test --list --reporter=json`), each as
 * `<file>:<line>:<column> <title path> [<project>]`: one entry per test, a test made in a loop by its own title.
 */
export function testsOf(listing) {
  const out = [];
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      const title = [...path, spec.title].join(' › ');
      for (const test of spec.tests ?? [{ projectName: '' }])
        out.push(
          `${String(spec.file)}:${String(spec.line)}:${String(spec.column)} ${title} [${String(test.projectName ?? '')}]`,
        );
    }
    for (const inner of suite.suites ?? []) walk(inner, inner.title ? [...path, inner.title] : path);
  };
  for (const file of listing.suites ?? []) walk(file, []);
  return out;
}

const fileOf = (test) => test.slice(0, test.indexOf(':'));

/**
 * Whether the parts (each a list of tests as testsOf gives them) hold exactly the whole suite: `{ ok, lines }`, the
 * lines saying how many tests and files each part holds, then anything wrong: a test in no part or in two, a test in
 * a part but not in the suite, a spec file split between parts, an empty part.
 */
export function partsCover(whole, parts) {
  const problems = [];
  const where = new Map();
  parts.forEach((part, i) => {
    if (part.length === 0) problems.push(`Part ${String(i + 1)} holds no test.`);
    for (const test of part) {
      const seen = where.get(test) ?? [];
      seen.push(i + 1);
      where.set(test, seen);
    }
  });
  const inWhole = new Set(whole);
  for (const test of whole) {
    const at = where.get(test) ?? [];
    if (at.length === 0) problems.push(`In no part: ${test}`);
    else if (at.length > 1) problems.push(`In parts ${at.join(' and ')}: ${test}`);
  }
  for (const test of where.keys())
    if (!inWhole.has(test)) problems.push(`In a part but not the suite: ${test}`);
  const partsOfFile = new Map();
  parts.forEach((part, i) => {
    for (const test of part)
      partsOfFile.set(fileOf(test), new Set([...(partsOfFile.get(fileOf(test)) ?? []), i + 1]));
  });
  for (const [file, at] of partsOfFile)
    if (at.size > 1) problems.push(`${file} is split between parts ${[...at].join(' and ')}.`);
  const files = (tests) => new Set(tests.map(fileOf)).size;
  const lines = [
    `The whole suite: ${String(whole.length)} tests in ${String(files(whole))} files.`,
    ...parts.map(
      (part, i) =>
        `Part ${String(i + 1)} of ${String(parts.length)}: ${String(part.length)} tests in ${String(files(part))} files.`,
    ),
  ];
  return problems.length === 0
    ? { ok: true, lines: [...lines, 'Every test is in exactly one part, every spec file whole in one.'] }
    : { ok: false, lines: [...lines, ...problems] };
}

/** The suite as Playwright lists it (no test runs), whole or one part. */
function list(shard) {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const args = [cli, 'test', '--list', '--reporter=json', ...(shard ? [`--shard=${shard}`] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0)
    throw new Error(`playwright test --list ${shard ?? ''} failed: ${(r.stderr ?? '').trim().slice(0, 500)}`);
  return testsOf(JSON.parse(r.stdout));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--check')) {
    process.stderr.write('e2e-parts: give --check\n');
    process.exit(2);
  }
  const whole = list(null);
  const parts = Array.from({ length: PARTS }, (_, i) => list(`${String(i + 1)}/${String(PARTS)}`));
  const { ok, lines } = partsCover(whole, parts);
  process.stdout.write(`${lines.join('\n')}\n`);
  if (!ok) process.exit(1);
}
