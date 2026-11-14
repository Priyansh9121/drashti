// Re-running the CI jobs GitHub never started (Session 58). Short of Mac runners, GitHub cancels a job it could not
// give one ("The job was not acquired by Runner of type hosted even after multiple attempts": three Mac jobs on 12-13
// Nov 2026): no step ran and nothing was tested, yet its run reads as failed. When a CI run of a push to main or
// phase1 (the runs the release gate counts) ends without passing, .github/workflows/rerun-unstarted.yml asks this
// what to do: re-run the jobs GitHub never started when they are the run's only jobs that did not pass. Never a job
// that ran and failed (a flaky test fails CI too), nor one cancelled by a newer push or by hand; never a run of a
// branch pushed again since (its re-run would cancel the newer run: ci.yml's concurrency); never past the run's
// third attempt. The release gate (scripts/release-gate.mjs) tells such a job apart by the same rule (neverStarted).
//
//   node scripts/rerun-unstarted.mjs --run <run id> --repo <owner/repo> [--dry-run]
//
// It asks the GitHub CLI (the workflow's own token: actions write, checks read) and runs nothing through a shell.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jobState, ranNothing } from './release-gate.mjs';

/** A run is re-run automatically to its third attempt at most: two re-runs. */
export const MAX_ATTEMPTS = 3;
/** The branches whose pushes run every app job, the runs the release gate counts (ci.yml's app jobs' `if`). */
export const GATE_BRANCHES = ['main', 'phase1'];

/**
 * What to do with a CI run that has ended: `{ rerun: true, jobs, line }` to re-run `jobs` (each one GitHub never
 * started), or `{ rerun: false, line }`, `line` saying why. `run` is the run from GitHub's API, `jobs` its jobs (the
 * latest attempt's), `annotationsOf` the annotations of each job that ran nothing (by job id), `newestRunId` the id
 * of its branch's newest CI run from a push, and `repository` this repository (owner/name).
 */
export function rerunPlan({ run, jobs, annotationsOf = {}, newestRunId, repository }) {
  const no = (line) => ({ rerun: false, line });
  const attempt = Number(run.run_attempt ?? 1);
  if (run.status !== 'completed') return no(`Run ${String(run.id)} has not ended (${String(run.status)}).`);
  if (run.conclusion === 'success') return no(`Run ${String(run.id)} passed.`);
  if (run.event !== 'push' || !GATE_BRANCHES.includes(run.head_branch))
    return no(`Run ${String(run.id)} is not of a push to ${GATE_BRANCHES.join(' or ')}: left as it is.`);
  if (run.head_repository?.full_name !== repository)
    return no(`Run ${String(run.id)} is of another repository’s code: left as it is.`);
  if (newestRunId === undefined)
    return no(`Run ${String(run.id)}: ${run.head_branch}’s newest run is not known: left as it is.`);
  if (Number(newestRunId) !== Number(run.id))
    return no(
      `Run ${String(run.id)} is not ${run.head_branch}’s newest (${String(newestRunId)} is): a re-run would cancel the newer one.`,
    );
  if (attempt >= MAX_ATTEMPTS)
    return no(
      `Run ${String(run.id)} is on attempt ${String(attempt)}: it is re-run by itself to attempt ${String(MAX_ATTEMPTS)} at most; re-run it by hand.`,
    );
  const states = jobs.map((job) => ({ job, state: jobState(job, annotationsOf[job.id] ?? []) }));
  const unstarted = states.filter((s) => s.state === 'never-started').map((s) => s.job);
  const others = states.filter((s) => !['success', 'skipped', 'never-started'].includes(s.state));
  if (unstarted.length === 0)
    return no(`Run ${String(run.id)}: none of its jobs that did not pass went without a runner.`);
  if (others.length > 0)
    return no(
      `Run ${String(run.id)}: ${others.map((s) => `${s.job.name} ${s.state}`).join(', ')}: left for a person (only a run whose sole trouble is jobs GitHub never started is re-run by itself).`,
    );
  return {
    rerun: true,
    jobs: unstarted,
    line: `Run ${String(run.id)}, attempt ${String(attempt)}: ${unstarted.map((j) => j.name).join(', ')} never started (GitHub gave ${unstarted.length === 1 ? 'it' : 'them'} no runner): re-run.`,
  };
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr ?? '').trim().slice(0, 300)}`);
  return r.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : '';
  };
  const runId = arg('--run');
  const repo = arg('--repo');
  const dry = args.includes('--dry-run');
  if (!/^\d+$/u.test(runId) || !/^[\w.-]+\/[\w.-]+$/u.test(repo))
    throw new Error('rerun-unstarted: give --run <run id> --repo <owner/repo>');
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
  const jobs = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`])).jobs;
  const annotationsOf = {};
  for (const job of jobs)
    if (ranNothing(job))
      annotationsOf[job.id] = JSON.parse(
        gh(['api', `repos/${repo}/check-runs/${String(job.id)}/annotations?per_page=50`]),
      );
  const branch = encodeURIComponent(String(run.head_branch ?? ''));
  const newest = JSON.parse(
    gh([
      'api',
      `repos/${repo}/actions/workflows/${String(run.workflow_id)}/runs?branch=${branch}&event=push&per_page=1`,
    ]),
  ).workflow_runs?.[0]?.id;
  const plan = rerunPlan({ run, jobs, annotationsOf, newestRunId: newest, repository: repo });
  let said = plan.line;
  if (plan.rerun && !dry) {
    // One job: that job (and any job that needs it). More: the run's failed jobs, which are then exactly those.
    if (plan.jobs.length === 1)
      gh(['api', '-X', 'POST', `repos/${repo}/actions/jobs/${String(plan.jobs[0].id)}/rerun`]);
    else gh(['api', '-X', 'POST', `repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`]);
  } else if (plan.rerun) said += ' (a dry run: nothing re-run)';
  process.stdout.write(`${said}\n`);
  if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${said}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
