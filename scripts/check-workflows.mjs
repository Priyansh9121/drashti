// The workflows' safety rules (Session 30), checked in CI's checks job:
//   - every action pinned to a 40-character commit SHA, with its version in a comment;
//   - every checkout without kept credentials (persist-credentials: false);
//   - no ${{ … }} inside a run: script (an input or a branch name could become a command): through env:;
//   - no pull_request_target (it runs a stranger's pull request with this repository's secrets);
//   - the release build without caches (a poisoned cache could reach an installer).
//
//   node scripts/check-workflows.mjs            check .github/workflows/*.yml; exit 1 with what is wrong
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/u;

/** What is wrong with one workflow file (empty when nothing). `name` is its file name. */
export function checkWorkflow(text, name) {
  const problems = [];
  const lines = text.split(/\r?\n/u);
  const indent = (l) => l.length - l.trimStart().length;
  let run = null;
  let checkout = null;
  const endCheckout = () => {
    if (checkout && !checkout.persist)
      problems.push(
        `${name}:${String(checkout.line)}: a checkout keeps its credentials: add persist-credentials: false`,
      );
    checkout = null;
  };
  lines.forEach((line, i) => {
    const at = i + 1;
    const trimmed = line.trim();
    const ind = indent(line);
    // A step's end: a new step (a dash) at the checkout step's own indentation, or less.
    if (checkout && trimmed !== '' && ind <= checkout.indent) endCheckout();
    if (run && trimmed !== '' && ind <= run) run = null;
    if (/\bpull_request_target\b/u.test(line.replace(/#.*$/u, '')))
      problems.push(
        `${name}:${String(at)}: pull_request_target runs others' pull requests with this repository's secrets`,
      );
    const uses = /^(\s*)(-\s+)?uses:\s*(\S+)\s*(#\s*(\S+))?/u.exec(line);
    if (uses) {
      const ref = uses[3] ?? '';
      if (!ref.startsWith('./')) {
        if (!PINNED.test(ref))
          problems.push(`${name}:${String(at)}: ${ref} is not pinned to a 40-character commit SHA`);
        else if (!/^v\d+(\.\d+){0,2}$/u.test(uses[5] ?? ''))
          problems.push(`${name}:${String(at)}: ${ref} has no version comment (# vX.Y.Z)`);
      }
      if (/^actions\/checkout@/u.test(ref))
        checkout = { line: at, indent: (uses[1] ?? '').length, persist: false };
      if (name === 'release.yml' && /^actions\/cache@/u.test(ref))
        problems.push(`${name}:${String(at)}: the release build uses a cache`);
    }
    if (checkout && /^persist-credentials:\s*false\b/u.test(trimmed)) checkout.persist = true;
    if (name === 'release.yml' && /^cache:\s*\S/u.test(trimmed))
      problems.push(`${name}:${String(at)}: the release build uses a cache (${trimmed})`);
    const r = /^(\s*)(-\s+)?run:\s*(.*)$/u.exec(line);
    if (r) {
      const rest = r[3] ?? '';
      if (rest.includes('${{'))
        problems.push(`${name}:${String(at)}: \${{ … }} inside run: (pass it through env:)`);
      run = /^[|>][-+]?$/u.test(rest) ? (r[1] ?? '').length + (r[2] ? 2 : 0) : null;
      return;
    }
    if (run !== null && line.includes('${{'))
      problems.push(`${name}:${String(at)}: \${{ … }} inside run: (pass it through env:)`);
  });
  endCheckout();
  return problems;
}

/** Every workflow in a folder. */
export function checkWorkflows(dir) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/u.test(f))
    .sort()
    .flatMap((f) => checkWorkflow(readFileSync(join(dir, f), 'utf8'), f));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
  const problems = checkWorkflows(dir);
  if (problems.length > 0) {
    process.stderr.write(
      `The workflows break their rules (scripts/check-workflows.mjs):\n${problems.join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write('The workflows keep their rules.\n');
}
