// The architecture's invariants (Sessions 31–36, ARCH-6), listed in the README under "How it fits together":
// each line names the code that holds it and the test that shows it, as `path` ("a phrase in it"). This
// checks that every path named there is a file of the repository and holds its phrase, and that every line
// names both its code ("held by") and its test ("tested by"), so the list cannot drift from the code
// unnoticed. Its unit test (src/main/release-checks/invariants.test.ts) runs it on the README.
//
//   node scripts/check-invariants.mjs        prints what does not hold; exits 1 if anything
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The README's invariant lines: the list under the paragraph that starts "**Invariants**". */
export function invariantLines(readme) {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l.startsWith('**Invariants**'));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('- ')) out.push(line);
    else if (out.length > 0 && line.trim() === '') break;
  }
  return out;
}

/** Every `path` ("phrase") a line names, in order. */
export function namedIn(line) {
  return [...line.matchAll(/`([^`]+)`(?: \("([^"]+)"\))?/gu)].map((m) => ({
    path: m[1] ?? '',
    phrase: m[2],
  }));
}

/** What does not hold in the README's list, read against the files under `root`: one message each. */
export function invariantProblems(readme, root) {
  const lines = invariantLines(readme);
  if (lines.length === 0) return ['The README has no "**Invariants**" list.'];
  const problems = [];
  for (const line of lines) {
    const rule = /^- \*\*(.+?)\*\*/u.exec(line)?.[1] ?? line.slice(2, 60);
    const held = line.indexOf('Held by ');
    const tested = line.indexOf('tested by ');
    if (held < 0 || tested < held) {
      problems.push(`"${rule}": it must say "Held by" its code, then "tested by" its test.`);
      continue;
    }
    const code = namedIn(line.slice(held, tested));
    const tests = namedIn(line.slice(tested));
    if (code.length === 0) problems.push(`"${rule}": no code named.`);
    if (tests.length === 0) problems.push(`"${rule}": no test named.`);
    for (const { path, phrase } of [...code, ...tests]) {
      const file = join(root, path);
      if (!existsSync(file) || !statSync(file).isFile()) {
        problems.push(`"${rule}": ${path} is not a file.`);
        continue;
      }
      if (phrase !== undefined && !readFileSync(file, 'utf8').includes(phrase))
        problems.push(`"${rule}": ${path} does not hold "${phrase}".`);
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const problems = invariantProblems(readFileSync(join(root, 'README.md'), 'utf8'), root);
  for (const p of problems) process.stdout.write(`${p}\n`);
  process.stdout.write(
    problems.length === 0 ? 'Every invariant names its code and its test, and they are there.\n' : '',
  );
  process.exit(problems.length === 0 ? 0 : 1);
}
