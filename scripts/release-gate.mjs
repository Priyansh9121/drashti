// The release gate (Session 30, Q6). Before a release is published: its tag must be new; its commit must be
// origin/main; a CI run from a push of that very commit must have passed every app job, since Session 58 each part of
// each system's end-to-end suite (a manual quick run never counts); every file must match SHA256SUMS.txt and the
// update manifest's sha512 and size; and (Session 54) the access list's address and public key built in must be
// real, never placeholders. A dry run reports what it finds and goes on; a publish stops at any failure. Since Session 58 a job GitHub never started (no runner: it
// ran no step, and its annotation says so) is named as such, never as a test failure; it has not passed either
// (.github/workflows/rerun-unstarted.yml re-runs one by itself).
//
//   node scripts/release-gate.mjs --dir release-files --sha <commit> --repo <owner/repo> [--report]
//
// It asks git (ls-remote, no credentials: the repository is public) and the GitHub CLI (the workflow's own
// token, with actions: read and checks: read) and runs neither through a shell.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The jobs a release's commit must have passed, from a push: since Session 58 (the owner: a faster gate, without
 * running less) each system's end-to-end suite in three parts side by side, the Mac's (part 1 with the installers),
 * Windows' (the same) and Windows' in Black (Session 41); every part must pass (ci.yml; scripts/e2e-parts.mjs
 * checks that the parts hold the whole suite).
 */
export const APP_JOBS = [
  'End-to-end and installers (macos-latest)',
  'End-to-end, part 2 of 3 (macos-latest)',
  'End-to-end, part 3 of 3 (macos-latest)',
  'End-to-end and installers (windows-latest)',
  'End-to-end, part 2 of 3 (windows-latest)',
  'End-to-end, part 3 of 3 (windows-latest)',
  'End-to-end in Black, part 1 of 3 (windows-latest)',
  'End-to-end in Black, part 2 of 3 (windows-latest)',
  'End-to-end in Black, part 3 of 3 (windows-latest)',
];
/** How the gate's lines name each job: today's, and the jobs before Session 58 (so a run from before reads right). */
const JOB_SAYS = {
  'End-to-end and installers (macos-latest)': 'macOS part 1',
  'End-to-end, part 2 of 3 (macos-latest)': 'macOS part 2',
  'End-to-end, part 3 of 3 (macos-latest)': 'macOS part 3',
  'End-to-end and installers (windows-latest)': 'Windows part 1',
  'End-to-end, part 2 of 3 (windows-latest)': 'Windows part 2',
  'End-to-end, part 3 of 3 (windows-latest)': 'Windows part 3',
  'End-to-end in Black, part 1 of 3 (windows-latest)': 'Windows in Black part 1',
  'End-to-end in Black, part 2 of 3 (windows-latest)': 'Windows in Black part 2',
  'End-to-end in Black, part 3 of 3 (windows-latest)': 'Windows in Black part 3',
  'End-to-end in Black (windows-latest)': 'Windows in Black',
  'End-to-end, second half (macos-latest)': 'macOS second half',
};

const short = (sha) => String(sha).slice(0, 7);

/** A web app's address as Apps Script makes one, and the start and end of an RSA 2048 key as SPKI in base64. */
const LIST_URL =
  /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]{10,200}\/exec$/u;
const SPKI_START = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';

/**
 * The access list Drashti asks (Session 54, src/shared/access-config.ts, given as its text): its address and public
 * key must be the owner's real ones, never placeholders, or every Drashti it reached would stay locked: a release is
 * never made without the lock, nor with a lock nobody can open. The same rules as accessConfigReal.
 */
export function accessCheck(configText) {
  const url = /ACCESS_LIST_URL\s*=\s*'([^']*)'/u.exec(configText)?.[1] ?? '';
  const key = /ACCESS_LIST_PUBLIC_KEY\s*=\s*'([^']*)'/u.exec(configText)?.[1] ?? '';
  const urlOk = LIST_URL.test(url) && !url.toUpperCase().includes('PLACEHOLDER');
  const keyOk =
    key.length === 392 &&
    key.startsWith(SPKI_START) &&
    key.endsWith('IDAQAB') &&
    /^[A-Za-z0-9+/]+$/u.test(key);
  if (urlOk && keyOk) return { ok: true, line: 'The access list’s address and public key are built in.' };
  const missing = urlOk ? 'public key is' : keyOk ? 'address is' : 'address and public key are';
  return {
    ok: false,
    line: `The access list’s ${missing} not built in (src/shared/access-config.ts): put in the line the owner’s Set up… shows.`,
  };
}

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
 * What a job's annotation says when GitHub gave it no runner and cancelled it (Session 58: GitHub short of Mac
 * runners on 12-13 Nov 2026, "The job was not acquired by Runner of type hosted even after multiple attempts").
 */
export const NO_RUNNER_SAID = /\bThe job was not acquired by Runner\b/u;
/** What a run cancelled by a newer push of its branch says (ci.yml's concurrency: a push cancels its branch's run). */
const NEWER_PUSH_SAID = /\bCanceling since a higher priority waiting request\b/u;

/**
 * Whether a job ended without passing having run nothing: no step ran and it had no runner (GitHub's API gives an
 * empty name and runner 0, or none). Either GitHub never started it, or it was cancelled before it began (by a newer
 * push, or by hand): its annotations tell which.
 */
export function ranNothing(job) {
  return (
    job.status === 'completed' &&
    (job.conclusion === 'cancelled' || job.conclusion === 'failure') &&
    Array.isArray(job.steps) &&
    job.steps.length === 0 &&
    !job.runner_name &&
    !job.runner_id
  );
}

/**
 * Whether GitHub never started a job: it ran nothing (ranNothing) and its annotation says GitHub gave it no runner.
 * Nothing was tested: it is not a test failure.
 */
export function neverStarted(job, annotations = []) {
  return (
    ranNothing(job) &&
    annotations.some((a) => a.annotation_level === 'failure' && NO_RUNNER_SAID.test(a.message ?? ''))
  );
}

/**
 * What became of a CI job, from its own data (a run's jobs from GitHub's API, and its check run's annotations):
 * 'never-started' (GitHub gave it no runner), 'newer-push' (cancelled by a newer push of its branch), 'running'
 * (queued or still going), 'missing' (no such job), else its conclusion as GitHub says it ('success', 'failure', a
 * flaky test's too since CI fails on one, 'cancelled', 'skipped', 'timed_out'…).
 */
export function jobState(job, annotations = []) {
  if (!job) return 'missing';
  if (job.status !== undefined && job.status !== 'completed') return 'running';
  if (neverStarted(job, annotations)) return 'never-started';
  if (job.conclusion === 'cancelled' && annotations.some((a) => NEWER_PUSH_SAID.test(a.message ?? '')))
    return 'newer-push';
  return job.conclusion ?? 'unknown';
}

/** How the gate's lines say a job's state. */
const SAID = {
  'never-started': 'never started by GitHub (no runner)',
  'newer-push': 'cancelled by a newer push',
  running: 'still running',
};

/**
 * The CI runs for the commit (the API's workflow_runs), each run's jobs (by run id) and the annotations of any job
 * that may never have started (by job id): passed when a run from a push of exactly this commit passed every app
 * job. A run passed on a re-run still counts, and says so. A job GitHub never started (no runner) is named as such,
 * never as a test failure, but a run with one has not passed: nothing it should have tested was.
 */
export function ciCheck(runs, jobsOf, sha, annotationsOf = {}, appJobs = APP_JOBS) {
  const pushed = runs.filter((r) => r.event === 'push' && r.head_sha === sha);
  if (pushed.length === 0)
    return {
      ok: false,
      line: `No CI run from a push of ${short(sha)}: push it and wait for CI (a run started by hand never counts).`,
    };
  const states = [];
  let newest = null;
  for (const run of [...pushed].sort((a, b) => Number(b.id) - Number(a.id))) {
    const jobs = jobsOf[run.id] ?? [];
    const of = (name) => {
      const job = jobs.find((j) => j.name === name);
      return jobState(job, job ? (annotationsOf[job.id] ?? []) : []);
    };
    const got = appJobs.map(of);
    if (got.every((c) => c === 'success')) {
      const again =
        Number(run.run_attempt ?? 1) > 1 ? ` (on attempt ${String(run.run_attempt)}: a re-run counts)` : '';
      return {
        ok: true,
        line: `CI run ${String(run.id)}, from a push of ${short(sha)}, passed every app job${again}.`,
      };
    }
    newest ??= { run, got };
    states.push(
      `run ${String(run.id)}: ${got.map((c, i) => `${JOB_SAYS[appJobs[i] ?? ''] ?? appJobs[i] ?? ''} ${SAID[c] ?? c}`).join(', ')}`,
    );
  }
  // The newest run's jobs that did not pass were only ones GitHub never started (or still going): not a test failure.
  const notPassed = newest?.got.filter((c) => c !== 'success') ?? [];
  const whatNext =
    notPassed.length > 0 && notPassed.every((c) => c === 'never-started' || c === 'running')
      ? notPassed.includes('never-started')
        ? ' A job GitHub never started is not a test failure, and its re-run is not the one re-run a failure gets (nothing was tested): re-run it (CI re-runs such a job by itself as its run ends: .github/workflows/rerun-unstarted.yml) and wait for that attempt.'
        : ' Wait for it.'
      : '';
  return {
    ok: false,
    line: `No CI run from a push of ${short(sha)} passed every app job (${states.join('; ')}).${whatNext}`,
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
  const annotationsOf = {};
  for (const r of runs) {
    jobsOf[r.id] = JSON.parse(
      run('gh', ['api', `repos/${repo}/actions/runs/${String(r.id)}/jobs?per_page=50`]),
    ).jobs;
    // A job that ran nothing: whether GitHub never started it, from what its annotations say.
    for (const job of jobsOf[r.id])
      if (ranNothing(job))
        annotationsOf[job.id] = JSON.parse(
          run('gh', ['api', `repos/${repo}/check-runs/${String(job.id)}/annotations?per_page=50`]),
        );
  }
  results.push(ciCheck(runs, jobsOf, sha, annotationsOf));
  results.push(...(await filesCheck(dir)));
  results.push(accessCheck(readFileSync('src/shared/access-config.ts', 'utf8')));
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
