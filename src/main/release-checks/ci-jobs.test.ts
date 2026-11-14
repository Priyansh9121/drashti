import { describe, expect, it } from 'vitest';
import type { CiAnnotation, CiJob } from '../../../scripts/release-gate.mjs';
import { APP_JOBS, ciCheck, jobState, neverStarted, ranNothing } from '../../../scripts/release-gate.mjs';
import type { CiRun } from '../../../scripts/rerun-unstarted.mjs';
import { MAX_ATTEMPTS, rerunPlan } from '../../../scripts/rerun-unstarted.mjs';
import recordedJson from './ci-jobs-recorded.json';

/*
 * A CI job GitHub never started, told apart from a test failure, and re-run by itself (Session 58). On 12-13 Nov
 * 2026 GitHub, short of Mac runners, cancelled three Mac jobs it never gave one, which read as failures. On runs and
 * jobs recorded from GitHub's API (ci-jobs-recorded.json: each run's jobs and every non-passing job's check-run
 * annotations, kept to the fields the gate reads, steps by name): a job that never started, one that failed, a flaky
 * test (CI fails on one), one cancelled by a newer push and one cancelled by hand. The release gate names each
 * (scripts/release-gate.mjs); .github/workflows/rerun-unstarted.yml re-runs only the first kind
 * (scripts/rerun-unstarted.mjs).
 */

interface Recorded {
  about: string;
  run: CiRun & { head_sha: string };
  jobs: (CiJob & { id: number })[];
  annotations: Record<string, CiAnnotation[]>;
}
const recorded = recordedJson as unknown as Record<string, Recorded>;
const REPO = 'Priyansh9121/drashti';
const MAC = 'End-to-end and installers (macos-latest)';
const MAC_SECOND = 'End-to-end, second half (macos-latest)';
const WINDOWS = 'End-to-end and installers (windows-latest)';
const BLACK = 'End-to-end in Black (windows-latest)';
/** The app jobs as they were when these runs were recorded (before Session 58 split each system into three parts). */
const RECORDED_APP_JOBS = [MAC, WINDOWS, BLACK, MAC_SECOND];

function take(key: string): Recorded {
  const r = recorded[key];
  if (!r) throw new Error(`nothing recorded as ${key}`);
  return r;
}
function job(r: Recorded, name: string): CiJob & { id: number } {
  const j = r.jobs.find((x) => x.name === name);
  if (!j) throw new Error(`${name} is not among run ${String(r.run.id)}'s jobs`);
  return j;
}
const annotationsOf = (r: Recorded): Record<number, CiAnnotation[]> =>
  Object.fromEntries(Object.entries(r.annotations).map(([id, a]) => [Number(id), a]));
const stateOf = (r: Recorded, name: string) => {
  const j = job(r, name);
  return jobState(j, r.annotations[String(j.id)] ?? []);
};

/**
 * The alpha.17 gate's push run (13 Nov), its attempt 2 where every job passed, with its Mac job (first half, and the
 * second half if `both`) swapped for the recorded Mac job GitHub never started (12 Nov): the run the gate and the
 * re-run would have met had GitHub been short of Mac runners at that gate.
 */
function gateWithoutMac(both = false): Recorded {
  const passed = take('flakyGateRerun');
  const none = take('noRunnerBesideSuccess');
  const unstarted = job(none, MAC);
  const unstartedNotes = none.annotations[String(unstarted.id)] ?? [];
  const swapped = passed.jobs.map((j) =>
    j.name === MAC || (both && j.name === MAC_SECOND)
      ? { ...unstarted, id: j.id, name: j.name, run_id: passed.run.id, run_attempt: 1 }
      : j,
  );
  const annotations: Record<string, CiAnnotation[]> = {};
  for (const j of swapped) if (j.conclusion !== 'success') annotations[String(j.id)] = unstartedNotes;
  return {
    about: 'composed',
    run: { ...passed.run, run_attempt: 1, conclusion: 'failure' },
    jobs: swapped,
    annotations,
  };
}

describe('a CI job GitHub never started (Session 58), on runs recorded from GitHub', () => {
  it('never started: it ran no step, had no runner, and its annotation says GitHub gave it none', () => {
    for (const key of ['noRunnerQuickCheck', 'noRunnerBesideSuccess', 'noRunnerBesideFailure']) {
      const r = take(key);
      const mac = job(r, MAC);
      expect(mac).toMatchObject({ conclusion: 'cancelled', runner_name: '', runner_id: 0, steps: [] });
      expect(ranNothing(mac)).toBe(true);
      expect(neverStarted(mac, r.annotations[String(mac.id)])).toBe(true);
      expect(stateOf(r, MAC)).toBe('never-started');
      // All three must hold: without the annotation it is only a job that was cancelled.
      expect(neverStarted(mac, [])).toBe(false);
      expect(jobState(mac, [])).toBe('cancelled');
    }
    // What was beside it: the Windows job passed, or failed (a test), and the rest of a quick check skipped.
    expect(stateOf(take('noRunnerBesideSuccess'), WINDOWS)).toBe('success');
    expect(stateOf(take('noRunnerBesideFailure'), WINDOWS)).toBe('failure');
    expect(stateOf(take('noRunnerQuickCheck'), BLACK)).toBe('skipped');
  });

  it('failed, flaky, cancelled by a newer push or by hand: none of them is a job that never started', () => {
    // A test failed: the job ran.
    const failed = take('noRunnerBesideFailure');
    expect(ranNothing(job(failed, WINDOWS))).toBe(false);
    expect(stateOf(take('newerPush'), WINDOWS)).toBe('failure');
    // A flaky test: CI fails on one (failOnFlakyTests), and the job ran: a failure.
    const flaky = take('flakyGate');
    expect(stateOf(flaky, MAC)).toBe('failure');
    expect(ranNothing(job(flaky, MAC))).toBe(false);
    // Cancelled by a newer push as they ran.
    const newer = take('newerPush');
    expect(stateOf(newer, MAC)).toBe('newer-push');
    expect(stateOf(newer, BLACK)).toBe('newer-push');
    // Cancelled by hand before its app jobs began: they ran nothing, yet GitHub was not short of a runner.
    const byHand = take('cancelledByHand');
    for (const j of byHand.jobs) {
      expect(jobState(j, byHand.annotations[String(j.id)] ?? [])).toBe('cancelled');
      expect(neverStarted(j, byHand.annotations[String(j.id)] ?? [])).toBe(false);
    }
    expect(byHand.jobs.filter((j) => ranNothing(j)).length).toBe(3);
  });

  it('the release gate names a job GitHub never started as such, never as a failure, and still does not pass', () => {
    const gate = gateWithoutMac();
    const sha = gate.run.head_sha;
    expect(
      ciCheck([gate.run], { [gate.run.id]: gate.jobs }, sha, annotationsOf(gate), RECORDED_APP_JOBS),
    ).toEqual({
      ok: false,
      line: 'No CI run from a push of 9befbc8 passed every app job (run 43361930288: macOS part 1 never started by GitHub (no runner), Windows part 1 success, Windows in Black success, macOS second half success). A job GitHub never started is not a test failure, and its re-run is not the one re-run a failure gets (nothing was tested): re-run it (CI re-runs such a job by itself as its run ends: .github/workflows/rerun-unstarted.yml) and wait for that attempt.',
    });
    // Not read (no annotations): only "cancelled", as before.
    expect(ciCheck([gate.run], { [gate.run.id]: gate.jobs }, sha, {}, RECORDED_APP_JOBS).line).toContain(
      'macOS part 1 cancelled,',
    );
    // Its re-run, attempt 2, passed every job: that counts, and says so.
    const rerun = take('flakyGateRerun');
    expect(ciCheck([rerun.run], { [rerun.run.id]: rerun.jobs }, sha, {}, RECORDED_APP_JOBS)).toEqual({
      ok: true,
      line: 'CI run 43361930288, from a push of 9befbc8, passed every app job (on attempt 2: a re-run counts).',
    });
  });

  it('the release gate keeps a failure, a flaky test and a newer push’s cancelling what they are', () => {
    const flaky = take('flakyGate');
    expect(
      ciCheck(
        [flaky.run],
        { [flaky.run.id]: flaky.jobs },
        flaky.run.head_sha,
        annotationsOf(flaky),
        RECORDED_APP_JOBS,
      ),
    ).toEqual({
      ok: false,
      line: 'No CI run from a push of 9befbc8 passed every app job (run 43361930288: macOS part 1 failure, Windows part 1 success, Windows in Black success, macOS second half success).',
    });
    const newer = take('newerPush');
    expect(
      ciCheck(
        [newer.run],
        { [newer.run.id]: newer.jobs },
        newer.run.head_sha,
        annotationsOf(newer),
        RECORDED_APP_JOBS,
      ),
    ).toEqual({
      ok: false,
      line: 'No CI run from a push of 27e8424 passed every app job (run 41497139815: macOS part 1 cancelled by a newer push, Windows part 1 failure, Windows in Black cancelled by a newer push, macOS second half missing).',
    });
    // Today's gate counts every part of every system (Session 58); the names above are the recorded runs' own.
    expect(APP_JOBS).toHaveLength(9);
    expect(APP_JOBS).toContain(MAC);
  });
});

describe('re-running the jobs GitHub never started (Session 58, rerun-unstarted.yml)', () => {
  // `newest`: the id of the run's branch's newest push run (null: not known).
  const plan = (r: Recorded, more: Partial<CiRun> = {}, newest: number | null = r.run.id) =>
    rerunPlan({
      run: { ...r.run, ...more },
      jobs: r.jobs,
      annotationsOf: annotationsOf(r),
      newestRunId: newest ?? undefined,
      repository: REPO,
    });

  it('re-runs a push run’s jobs GitHub never started when they are all that did not pass', () => {
    const gate = gateWithoutMac();
    const p = plan(gate);
    expect(p).toMatchObject({ rerun: true });
    expect(p.rerun && p.jobs.map((j) => j.name)).toEqual([MAC]);
    expect(p.line).toBe(
      'Run 43361930288, attempt 1: End-to-end and installers (macos-latest) never started (GitHub gave it no runner): re-run, with any job skipped for want of it.',
    );
    // Both Mac halves without a runner: both.
    const both = plan(gateWithoutMac(true));
    expect(both.rerun && both.jobs.map((j) => j.name).sort()).toEqual([MAC, MAC_SECOND].sort());
    // The Ubuntu checks job without a runner, the app jobs skipped for want of it (they need it, ci.yml): that job
    // is re-run, and GitHub's job re-run brings back the jobs that need it.
    const skipped = job(take('noRunnerQuickCheck'), BLACK);
    const ubuntu = job(gate, 'Typecheck, lint, unit tests (Ubuntu)');
    const checksLost: Recorded = {
      ...gate,
      jobs: gate.jobs.map((j) =>
        j.id === ubuntu.id
          ? { ...job(take('noRunnerBesideSuccess'), MAC), id: j.id, name: j.name }
          : RECORDED_APP_JOBS.includes(j.name)
            ? { ...skipped, id: j.id, name: j.name }
            : j,
      ),
      annotations: { [String(ubuntu.id)]: gate.annotations[String(job(gate, MAC).id)] ?? [] },
    };
    const lost = plan(checksLost);
    expect(lost.rerun && lost.jobs.map((j) => j.name)).toEqual(['Typecheck, lint, unit tests (Ubuntu)']);
    expect(lost.line).toContain('re-run, with any job skipped for want of it.');
    // Its second attempt too, not its third.
    expect(plan(gate, { run_attempt: 2 }).rerun).toBe(true);
    expect(plan(gate, { run_attempt: MAX_ATTEMPTS })).toEqual({
      rerun: false,
      line: 'Run 43361930288 is on attempt 3: it is re-run by itself to attempt 3 at most; re-run it by hand.',
    });
  });

  it('never re-runs a job that ran and failed, a flaky test, a newer push’s cancelling or one cancelled by hand', () => {
    // A flaky test failed the Mac's first half: it ran; left for a person.
    expect(plan(take('flakyGate'))).toEqual({
      rerun: false,
      line: 'Run 43361930288: none of its jobs that did not pass went without a runner.',
    });
    // A job that never started beside one that failed: nothing is re-run, the failure is a person's to read.
    const mixed = gateWithoutMac();
    const failing = mixed.jobs.map((j) =>
      j.name === WINDOWS ? job(take('noRunnerBesideFailure'), WINDOWS) : j,
    );
    expect(plan({ ...mixed, jobs: failing })).toEqual({
      rerun: false,
      line: 'Run 43361930288: End-to-end and installers (windows-latest) failure: left for a person (only a run whose sole trouble is jobs GitHub never started is re-run by itself).',
    });
    // Cancelled by a newer push: that push's run is the newest; this one is not re-run.
    const newer = take('newerPush');
    expect(plan(newer, {}, newer.run.id + 1)).toEqual({
      rerun: false,
      line: `Run 41497139815 is not phase1’s newest (${String(newer.run.id + 1)} is): a re-run would cancel the newer one.`,
    });
    expect(plan(newer).rerun).toBe(false);
    // Cancelled by hand (main's own run at a release).
    expect(plan(take('cancelledByHand'))).toEqual({
      rerun: false,
      line: 'Run 43392703298: none of its jobs that did not pass went without a runner.',
    });
  });

  it('only a push run of main or phase1 that has ended without passing, from this repository, its branch’s newest', () => {
    const gate = gateWithoutMac();
    // A quick check (started by hand): left as it is.
    expect(plan(take('noRunnerQuickCheck'))).toEqual({
      rerun: false,
      line: 'Run 43248994559 is not of a push to main or phase1: left as it is.',
    });
    expect(plan(gate, { head_branch: 's58-c5-gate' }).rerun).toBe(false);
    expect(plan(gate, { status: 'in_progress' })).toEqual({
      rerun: false,
      line: 'Run 43361930288 has not ended (in_progress).',
    });
    expect(plan(gate, { conclusion: 'success' })).toEqual({ rerun: false, line: 'Run 43361930288 passed.' });
    expect(plan(gate, { head_repository: { full_name: 'someone/drashti' } })).toEqual({
      rerun: false,
      line: 'Run 43361930288 is of another repository’s code: left as it is.',
    });
    // Its branch's newest unknown, or another: never.
    expect(plan(gate, {}, null)).toEqual({
      rerun: false,
      line: 'Run 43361930288: phase1’s newest run is not known: left as it is.',
    });
    expect(plan(gate, {}, gate.run.id + 5).rerun).toBe(false);
  });
});
