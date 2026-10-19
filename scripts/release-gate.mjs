// The release gate (Session 30, Q6). Before a release is published: its tag must be new; its commit must be
// origin/main; a CI run from a push of that very commit must have passed every app job (a manual quick run
// never counts); and every file must match SHA256SUMS.txt and the update manifest's sha512 and size. A dry
// run reports what it finds and goes on; a publish stops at any failure.
//
//   node scripts/release-gate.mjs --dir release-files --sha <commit> --repo <owner/repo> [--report]
//
// It asks git (ls-remote, no credentials: the repository is public) and the GitHub CLI (the workflow's own
// token, with actions: read) and runs neither through a shell.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The jobs a release's commit must have passed, from a push: the Mac's, Windows', and Windows' in Black (Session 41). */
export const APP_JOBS = [
  'End-to-end and installers (macos-latest)',
  'End-to-end and installers (windows-latest)',
  'End-to-end in Black (windows-latest)',
];
/** How the gate's lines name them. */
const JOB_NAMES = ['macOS', 'Windows', 'Windows in Black'];

const short = (sha) => String(sha).slice(0, 7);

/** `git ls-remote --tags origin refs/tags/v<version>`: nothing there, or the tag. */
export function tagCheck(lsRemote, version) {
  const ok = lsRemote.trim() === '';
  return ok
    ? { ok, line: `The tag v${version} is new.` }
    : { ok, line: `The tag v${version} exists already: bump the version before releasing.` };
}

/** `git ls-remote origin refs/heads/main`: main's commit. */
export function mainCheck(lsRemote, sha) {
  const main = lsRemote.trim().split(/\s+/u)[0] ?? '';
  if (main === '') return { ok: false, line: 'main could not be found on origin.' };
  return main === sha
    ? { ok: true, line: `${short(sha)} is main.` }
    : {
        ok: false,
        line: `${short(sha)} is not main (main is ${short(main)}): a release is made from main only.`,
      };
}

/**
 * The CI runs for the commit (the API's workflow_runs) and each run's jobs (by run id): passed when a run from
 * a push of exactly this commit passed every app job. A run passed on a re-run still counts, and says so.
 */
export function ciCheck(runs, jobsOf, sha) {
  const pushed = runs.filter((r) => r.event === 'push' && r.head_sha === sha);
  if (pushed.length === 0)
    return {
      ok: false,
      line: `No CI run from a push of ${short(sha)}: push it and wait for CI (a run started by hand never counts).`,
    };
  const states = [];
  for (const run of [...pushed].sort((a, b) => Number(b.id) - Number(a.id))) {
    const jobs = jobsOf[run.id] ?? [];
    const of = (name) => jobs.find((j) => j.name === name)?.conclusion ?? 'missing';
    const got = APP_JOBS.map(of);
    if (got.every((c) => c === 'success')) {
      const again =
        Number(run.run_attempt ?? 1) > 1 ? ` (on attempt ${String(run.run_attempt)}: a re-run counts)` : '';
      return {
        ok: true,
        line: `CI run ${String(run.id)}, from a push of ${short(sha)}, passed every app job${again}.`,
      };
    }
    states.push(`run ${String(run.id)}: ${got.map((c, i) => `${JOB_NAMES[i] ?? ''} ${c}`).join(', ')}`);
  }
  return {
    ok: false,
    line: `No CI run from a push of ${short(sha)} passed every app job (${states.join('; ')}).`,
  };
}

const hashOf = (file, algorithm, encoding) =>
  new Promise((resolve, reject) => {
    const h = createHash(algorithm);
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest(encoding)));
  });

/** Every file against SHA256SUMS.txt, and the update's files against the manifest. */
export async function filesCheck(dir) {
  const problems = [];
  const sumsFile = join(dir, 'SHA256SUMS.txt');
  if (!existsSync(sumsFile)) return [{ ok: false, line: 'SHA256SUMS.txt is missing.' }];
  const sums = new Map();
  for (const line of readFileSync(sumsFile, 'utf8').split(/\r?\n/u)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line.trim());
    if (m) sums.set(m[2], m[1]);
  }
  const files = readdirSync(dir).filter((n) => n !== 'SHA256SUMS.txt' && statSync(join(dir, n)).isFile());
  for (const name of files.sort()) {
    const want = sums.get(name);
    if (!want) problems.push(`${name} is not in SHA256SUMS.txt.`);
    else if ((await hashOf(join(dir, name), 'sha256', 'hex')) !== want)
      problems.push(`${name} does not match its SHA-256 in SHA256SUMS.txt.`);
  }
  for (const name of sums.keys())
    if (!files.includes(name)) problems.push(`${name} is in SHA256SUMS.txt but not here.`);
  const manifestFile = join(dir, 'drashti-update.json');
  if (!existsSync(manifestFile)) problems.push('drashti-update.json is missing.');
  else {
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    } catch {
      // Said, never thrown: a dry run reports it and carries on.
      problems.push('drashti-update.json cannot be read (not JSON).');
    }
    for (const f of manifest?.files ?? []) {
      const file = join(dir, f.name);
      if (!existsSync(file)) problems.push(`${f.name}, in the update manifest, is not here.`);
      else if (statSync(file).size !== f.size || (await hashOf(file, 'sha512', 'base64')) !== f.sha512)
        problems.push(`${f.name} does not match the update manifest's size and SHA-512.`);
    }
  }
  return problems.length === 0
    ? [
        {
          ok: true,
          line: `Every file (${String(files.length)}) matches SHA256SUMS.txt and the update manifest.`,
        },
      ]
    : problems.map((line) => ({ ok: false, line }));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args[0] ?? ''} failed: ${(r.stderr ?? '').trim().slice(0, 300)}`);
  return r.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : '';
  };
  const report = args.includes('--report');
  const dir = arg('--dir');
  const sha = arg('--sha');
  const repo = arg('--repo');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const results = [];
  results.push(tagCheck(run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`]), version));
  results.push(mainCheck(run('git', ['ls-remote', 'origin', 'refs/heads/main']), sha));
  const runs = JSON.parse(
    run('gh', ['api', `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=20`]),
  ).workflow_runs;
  const jobsOf = {};
  for (const r of runs)
    jobsOf[r.id] = JSON.parse(
      run('gh', ['api', `repos/${repo}/actions/runs/${String(r.id)}/jobs?per_page=50`]),
    ).jobs;
  results.push(ciCheck(runs, jobsOf, sha));
  results.push(...(await filesCheck(dir)));
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`The release gate for Drashti ${version} (${short(sha)}):\n`);
  for (const r of results) process.stdout.write(`  ${r.ok ? 'passed' : 'FAILED'}  ${r.line}\n`);
  if (failed.length === 0) process.stdout.write('It may be published.\n');
  else if (report)
    process.stdout.write(`A dry run: ${String(failed.length)} would stop a publish. Nothing is published.\n`);
  else {
    process.stdout.write(`${String(failed.length)} failed: not published.\n`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
