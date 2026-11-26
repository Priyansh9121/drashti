// The workflows' safety rules (Session 30), checked in CI's checks job:
//   - every action pinned to a 40-character commit SHA, with its version in a comment;
//   - every checkout without kept credentials (persist-credentials: false);
//   - no ${{ … }} inside a run: script (an input or a branch name could become a command): through env:;
//   - no pull_request_target (it runs a stranger's pull request with this repository's secrets);
//   - the release build without caches (a poisoned cache could reach an installer); since Session 58 (X2b) a
//     cache step (actions/cache, its restore or save) only after its job has uploaded what it built
//     (actions/upload-artifact), never a setup action's cache: (restored before the build).
//   - release signing's environment only on the guarded Mac job, never from a PR, with unconditional cleanup;
//     since the signing review (QA24-SIGN-1), in every workflow: an environment only on release.yml's build-mac,
//     the Mac signing secrets (MAC_SIGN_P12_*) only in its import step, and its key deleted (--delete-key) in
//     the step straight after verify-signing, before any step runs the packaged programs.
//
//   node scripts/check-workflows.mjs            check .github/workflows/*.yml; exit 1 with what is wrong
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/u;

/** The lines [start, end) of one job under jobs:, or null. */
function jobLines(lines, job) {
  const jobs = lines.findIndex((l) => /^jobs:\s*$/u.test(l));
  const start = jobs < 0 ? -1 : lines.findIndex((l, i) => i > jobs && l.trimEnd() === `  ${job}:`);
  if (start < 0) return null;
  let end = start + 1;
  // Up to the next job or top-level key (a comment or a blank line belongs to the job).
  while (end < lines.length && !/^ {0,2}[^\s#]/u.test(lines[end] ?? '')) end += 1;
  return [start, end];
}

/** The lines [start, end) of the step (at six spaces, as this repository writes them) holding `line`, or null. */
function stepLines(lines, [start, end], line) {
  const at = lines.findIndex((l, i) => i > start && i < end && l.trim() === line);
  if (at < 0) return null;
  let first = at;
  while (first > start && !/^ {6}-\s/u.test(lines[first] ?? '')) first -= 1;
  let last = at + 1;
  while (last < end && !/^ {6}-\s/u.test(lines[last] ?? '')) last += 1;
  return [first, last];
}

const within = (span, i) => span !== null && i >= span[0] && i < span[1];

/** What is wrong with one workflow file (empty when nothing). `name` is its file name. */
export function checkWorkflow(text, name) {
  const problems = [];
  const lines = text.split(/\r?\n/u);
  const indent = (l) => l.length - l.trimStart().length;
  let run = null;
  let checkout = null;
  // Whether this job has uploaded what it built yet (each job starts afresh: a line `  <job>:`).
  let kept = false;
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
    if (/^ {2}[\w-]+:\s*$/u.test(line)) kept = false;
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
      if (/^actions\/upload-artifact@/u.test(ref)) kept = true;
      const cache = /^(actions\/cache(?:\/restore|\/save)?)@/u.exec(ref)?.[1];
      if (name === 'release.yml' && cache && !kept)
        problems.push(
          `${name}:${String(at)}: the release build uses a cache before its job has kept what it built (${cache})`,
        );
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
  // The release environment and its signing secrets reach only release.yml's build-mac, and the secrets only its
  // import step: anywhere else a job, and every action and dependency it runs, would get the signing key.
  const macJob = name === 'release.yml' ? jobLines(lines, 'build-mac') : null;
  const importer = macJob && stepLines(lines, macJob, 'run: node scripts/mac-sign-keychain.mjs');
  lines.forEach((line, i) => {
    if (/^\s*#/u.test(line)) return;
    if (/\benvironment\s*:/u.test(line) && !(within(macJob, i) && /^ {4}environment:/u.test(line)))
      problems.push(`${name}:${String(i + 1)}: only release.yml's build-mac may name an environment`);
    if (line.includes('MAC_SIGN_P12_') && !within(importer, i))
      problems.push(
        `${name}:${String(i + 1)}: the Mac signing secrets (MAC_SIGN_P12_*) belong to release.yml's build-mac import step alone`,
      );
  });
  if (name === 'release.yml' && /environment:|mac-sign-keychain/u.test(text)) {
    const guard =
      "(github.event_name == 'workflow_dispatch' || github.event_name == 'push') && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/release-dry-run')";
    const jobs = [...text.matchAll(/^ {2}([\w-]+):\s*\n([\s\S]*?)(?=^ {2}[\w-]+:|$(?![\s\S]))/gmu)];
    const mac = jobs.find((j) => j[1] === 'build-mac')?.[2] ?? '';
    const fail = (why) => problems.push(`${name}: release signing: ${why}`);
    if (/\bpull_request(?:_target)?\b/u.test(text.replace(/#.*$/gmu, '')))
      fail('no pull request events or workflow sources');
    if (!mac.split('\n').includes(`    if: ${guard}`))
      fail('build-mac must guard event and branch before any step');
    if (!/^ {4}environment: release$/mu.test(mac)) fail('build-mac must use environment release');
    if (/^\s+ref:/mu.test(text)) fail('checkout must use the guarded run commit');
    if (!mac.includes('run: node scripts/mac-sign-keychain.mjs\n')) fail('missing keychain import');
    if (!mac.includes('        if: always()\n        run: node scripts/mac-sign-keychain.mjs --cleanup'))
      fail('keychain cleanup must always run');
    // The key goes before the packaged app or its bundled programs run (the signing review's SHOULD 1): the
    // very next step, comments between allowed.
    if (
      !/^ {8}run: node scripts\/verify-signing\.mjs\n(?: {6}#[^\n]*\n)* {6}- name: [^\n]*\n(?: {8}if: always\(\)\n)? {8}run: node scripts\/mac-sign-keychain\.mjs --delete-key$/mu.test(
        mac,
      )
    )
      fail('the signing key must be deleted (--delete-key) in the step straight after verify-signing');
  }
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
