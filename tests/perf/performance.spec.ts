import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { constants, getPriority, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { letInBeforeStart } from '../e2e/access';
import { launchApp, operatorPage, operatorReady, QUIET, relaunchApp } from '../e2e/helpers';
import { freePort, testFfmpeg } from '../e2e/stream-helpers';
import { recoveryAgainstBudget } from '../e2e/recovery-figure';
import { caseLine, caseRow, framePeriod, measureRun, type MotionRun } from '../../src/shared/motion-measure';
import { OPENING_MS } from '../../src/shared/opening';

/*
 * The performance check, started by hand (pnpm test:perf, or the
 * "Performance" workflow): the app's own performance self-test, headless.
 * Not part of CI's runs, where virtual machines stall now and then. On the
 * mandir's machines run the installed app instead (README, "Performance check").
 * It opens a real output, so on a computer someone is using it waits for
 * their agreement (DRASHTI_E2E_LOUD=1); otherwise run the workflow.
 */

test.skip(QUIET, 'Opens a real output: run the Performance workflow (or with DRASHTI_E2E_LOUD=1)');

interface PerfResult {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  summary: string;
  /** Each slide change's raw times (src/main/perftest.ts, RawChange). */
  raw?: unknown[];
  /** The operator window's first drawing before anything is measured (Session 26h): never judged. */
  coldStart?: string;
}

/**
 * Modest hardware, on CI (DRASHTI_PERF_HANDICAP=1; Session 15): on Windows, Drashti and everything it
 * starts get two cores (this process limits itself first, and children take its cores); on a Mac,
 * which cannot do that, two busy processes take the processor from it while it runs. What it says.
 */
const HANDICAP = process.env['DRASHTI_PERF_HANDICAP'] === '1';
/** A heavy case or modest hardware takes longer (the stream encoded in software on two cores, say): it reports, not times out. */
const SLOW = HANDICAP || (process.env['DRASHTI_PERF_SCENARIO'] ?? '') !== '';
const STOP_AFTER_MS = SLOW ? 840_000 : 240_000;

function handicap(): { what: string; stop(): void } {
  if (!HANDICAP) return { what: '', stop: () => undefined };
  if (process.platform === 'win32') {
    const env = { ...process.env };
    delete env['PSModulePath'];
    const ps = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const r = spawnSync(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-Process -Id ${String(process.pid)}; $p.ProcessorAffinity = 3; $p.ProcessorAffinity`,
      ],
      { env, encoding: 'utf8' },
    );
    return { what: `handicap: two cores (affinity ${r.stdout.trim() || 'not set'})`, stop: () => undefined };
  }
  const busy: ChildProcess[] = [0, 1].map(() =>
    spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }),
  );
  return {
    what: 'handicap: two busy processes competing for the processor',
    stop: () => {
      for (const b of busy) b.kill('SIGKILL');
    },
  };
}

/**
 * Start a program at normal priority on Windows, as the mandir PC starts Drashti (Session 17). CI's
 * runner starts every program below normal, and Windows starts a program's children below normal only
 * when it is below normal itself: this process goes to normal just while it starts Drashti, so Drashti
 * and everything it starts begin at normal. FFmpeg standing in for YouTube stays as it was.
 */
function startAtNormal<T>(start: () => T): T {
  if (process.platform !== 'win32') return start();
  const before = getPriority();
  try {
    setPriority(constants.priority.PRIORITY_NORMAL);
  } catch {
    return start();
  }
  try {
    return start();
  } finally {
    try {
      setPriority(before);
    } catch {
      // As it is.
    }
  }
}

async function runPerformanceTest(
  extra: Record<string, string> = {},
): Promise<{ code: number | null; result: PerfResult | null; log: string }> {
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  // The check runs only on a computer let in (Session 54): here, a folder of the test's own let in through the
  // stand-in access list on 127.0.0.1, which Drashti reads in place of this computer's own data folder (a test
  // switch a packaged Drashti never reads).
  const accessHome = mkdtempSync(join(tmpdir(), 'drashti-perf-access-'));
  const access = (await letInBeforeStart(accessHome)).env;
  // Never the real list, here or on CI (Session 54's question 8, answered 29 Oct 2026: the stand-in on CI).
  if (!access['DRASHTI_TEST_ACCESS_URL']?.startsWith('http://127.0.0.1:'))
    throw new Error('The performance check must be let in through the stand-in list on 127.0.0.1.');
  Object.assign(
    env,
    {
      DRASHTI_SELFTEST: 'performance',
      DRASHTI_NO_QUIT_CONFIRM: '1',
      ...access,
      DRASHTI_TEST_ACCESS_HOME: accessHome,
    },
    extra,
  );
  const load = handicap();
  if (load.what) console.log(load.what);
  return new Promise((resolve) => {
    const child = startAtNormal(() => spawn(electron, ['.'], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
    let log = '';
    child.stdout.on('data', (d: Buffer) => (log += d.toString()));
    child.stderr.on('data', (d: Buffer) => (log += d.toString()));
    const timer = setTimeout(() => child.kill(), STOP_AFTER_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      load.stop();
      // The animations scenario's lines as it went (Session 57), a check stopped at its time limit's included.
      for (const l of log.split('\n')) if (l.startsWith('DRASHTI_PERF_ANIMATIONS ')) console.log(l);
      const line = log.split('\n').find((l) => l.startsWith('DRASHTI_PERFTEST_RESULT '));
      resolve({
        code,
        result: line ? (JSON.parse(line.slice('DRASHTI_PERFTEST_RESULT '.length)) as PerfResult) : null,
        log,
      });
    });
  });
}

test('slide changes keep reaching the screen within a frame during a big import', async () => {
  test.setTimeout(STOP_AFTER_MS + 60_000);
  const appearance = process.env['DRASHTI_TEST_APPEARANCE'] ?? '';
  console.log(`The operator window's appearance: ${appearance === '' ? 'the computer’s own' : appearance}`);
  const { code, result, log } = await runPerformanceTest();
  expect(result, log.slice(-3000)).not.toBeNull();
  // The cold start on its own line, for the record, then the measured part's figures.
  if (result?.coldStart) console.log(result.coldStart);
  console.log(result?.summary);
  keepRaw('plain', result);
  for (const c of result?.checks ?? []) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    expect.soft(c.ok, `${c.name} ${c.detail}`).toBe(true);
  }
  test.info().annotations.push({ type: 'performance', description: result?.summary ?? '' });
  expect(result?.passed).toBe(true);
  expect(code).toBe(0);
});

test('slide changes keep reaching the screen within a frame while streaming and recording, during a big import', async () => {
  test.setTimeout(STOP_AFTER_MS + 120_000);
  const ffmpeg = testFfmpeg();
  test.skip(!ffmpeg, 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-perf-stream-'));
  // FFmpeg on this computer stands in for YouTube; the app's stream key for this is made up.
  const listen = (at: number, file: string) =>
    spawn(
      ffmpeg ?? '',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-listen',
        '1',
        '-i',
        `rtmp://127.0.0.1:${at}/live2/test-made-up-key-perf-0000`,
        '-c',
        'copy',
        '-f',
        'flv',
        '-y',
        join(dir, file),
      ],
      { stdio: 'ignore' },
    );
  const listeners = [listen(port, 'received.flv')];
  // Two places at once (Session 28, the Performance workflow's "places"): a second listener here too.
  const second = process.env['DRASHTI_PERF_PLACES'] === '2' ? await freePort() : null;
  if (second) listeners.push(listen(second, 'received-2.flv'));
  try {
    const profile = process.env['DRASHTI_PERF_PROFILE'];
    const { code, result, log } = await runPerformanceTest({
      DRASHTI_PERF_STREAM: `rtmp://127.0.0.1:${port}/live2`,
      ...(second ? { DRASHTI_PERF_STREAM_ALSO: `rtmp://127.0.0.1:${second}/live2` } : {}),
      DRASHTI_TEST_FAKE_DEVICES: '1',
      // Its own profile, beside the first check's.
      ...(profile ? { DRASHTI_PERF_PROFILE: `${profile}-stream` } : {}),
    });
    expect(result, log.slice(-3000)).not.toBeNull();
    // The cold start on its own line, for the record, then the measured part's figures.
    if (result?.coldStart) console.log(result.coldStart);
    console.log(result?.summary);
    keepRaw('streaming', result);
    for (const c of result?.checks ?? []) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
      expect.soft(c.ok, `${c.name} ${c.detail}`).toBe(true);
    }
    test.info().annotations.push({ type: 'performance', description: result?.summary ?? '' });
    expect(result?.summary).toContain('streaming');
    expect(result?.passed).toBe(true);
    expect(code).toBe(0);
  } finally {
    for (const l of listeners) l.kill('SIGKILL');
  }
});

test('after a crash the screens come back: the recovery figure (Sessions 31–36, PERF-1)', async () => {
  test.setTimeout(360_000);
  // On Windows' two cores under the handicap, as the checks before it ran: a check that fails ends its worker, and
  // Playwright starts the next test in a new one, which never had their affinity (alpha.14's run of 30 Oct 2026
  // measured this figure on every core after the streaming check failed, alpha.13's on two). A Mac's handicap is the
  // checks' own busy processes, stopped as each check ends: none here, as before.
  if (HANDICAP && process.platform === 'win32') console.log(handicap().what);
  // Kill, start again, screens back, read from the start's phase lines: the same as the end-to-end test's,
  // against the same budget.
  await recoveryAgainstBudget((line) => {
    console.log(line);
    test.info().annotations.push({ type: 'recovery', description: line });
  });
});

/** The motion probe's record of the operator window (render/motion-probe.ts), as the page gives it. */
interface ProbeRead {
  frames: number[];
  changes: Record<string, number[]>;
  states: Record<string, string[]>;
}

/** The opening's runs (Session 57, item 6): each start's. */
const OPENING_RUNS = 3;

test('the opening as Drashti starts: from when it may move to its first frame, its two seconds, and how even its frames are (the animations scenario)', async () => {
  // The opening plays only as a person starts Drashti, in the operator window, never in a self-test (main/opening/
  // opening-start.ts): the animations scenario's checks above never see it, so it is measured here, with the motion
  // probe in the operator window (DRASHTI_TEST_MOTION_PROBE, the workflow's with this scenario). No screen is set up:
  // CI has one display, where a screen would cover the operator window; so the opening never waits for screens here
  // (OPENING_HOLD_MS at most on a mandir computer), and what is measured is its own start, length and frames.
  test.skip(
    process.env['DRASHTI_PERF_SCENARIO'] !== 'animations',
    'Measured with the animations scenario only',
  );
  test.setTimeout(300_000);
  // Under the handicap as the checks above were (Windows' two cores; a Mac's two busy processes, while it runs).
  const load = handicap();
  if (load.what) console.log(load.what);
  try {
    await measureOpening();
  } finally {
    load.stop();
  }
});

/** The opening's runs, each a start of Drashti with it asked for, measured in the operator window. */
async function measureOpening(): Promise<void> {
  // A library started once and quit on purpose, so each start after it is a person's start of the same version.
  const first = await launchApp();
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const runs: (MotionRun & { launchedAt: number; appearedAt: number | null; movableAt: number | null })[] =
    [];
  let period = 1000 / 60;
  for (let i = 0; i < OPENING_RUNS; i++) {
    const launchedAt = Date.now();
    const { app } = await relaunchApp(first.userData, {
      DRASHTI_TEST_OPENING: '1',
      DRASHTI_TEST_MOTION_PROBE: '1',
    });
    const win = await operatorPage(app);
    const read = () =>
      win.evaluate(() => {
        const probe = (globalThis as { drashtiMotionProbe?: { read(a: number, b: number): unknown } })
          .drashtiMotionProbe;
        return (probe?.read(0, Number.MAX_SAFE_INTEGER) ?? null) as {
          frames: number[];
          changes: Record<string, number[]>;
          states: Record<string, string[]>;
        } | null;
      });
    // Until it has come and gone (it ends by itself after its two seconds).
    await expect
      .poll(
        async () => {
          const r = await read();
          return (
            r !== null &&
            (r.states['opening-shown'] ?? []).at(-1) === '' &&
            (r.changes['opening'] ?? []).length > 0
          );
        },
        { timeout: 30_000, intervals: [250] },
      )
      .toBe(true);
    const r = (await read()) as ProbeRead;
    period = framePeriod(r.frames);
    const shown = r.changes['opening-shown'] ?? [];
    const said = r.states['opening-shown'] ?? [];
    const at = (i: number | undefined) => (i === undefined ? null : (r.frames[i] ?? null));
    // When it came (black over the window), and when it might move: at once, or once the screens had drawn.
    const appearedAt = at(shown[0]);
    const movableAt = at(shown[said.findIndex((s) => s === 'false')]);
    const pressAt = movableAt ?? appearedAt ?? launchedAt;
    const run = measureRun(
      { frames: r.frames, changes: r.changes['opening'] ?? [] },
      { pressAt, until: pressAt + 10_000 },
      period,
    );
    runs.push({ ...run, launchedAt, appearedAt, movableAt });
    const ms = (v: number | null) => (v === null ? '?' : `${String(Math.round(v))} ms`);
    console.log(
      `opening run ${String(i + 1)}: came ${ms(appearedAt === null ? null : appearedAt - launchedAt)} after the launch, might move ${ms(movableAt === null || appearedAt === null ? null : movableAt - appearedAt)} after it came, first moved ${ms(run.delay)} after that, for ${ms(run.length)}`,
    );
    await app.close();
  }
  const row = caseRow('opening', OPENING_MS, runs, period);
  const line = `scenario animations, the opening (the operator window's own frames): frame period ${period.toFixed(2)} ms; ${caseLine(row)}`;
  console.log(line);
  test.info().annotations.push({ type: 'performance', description: line });
  const dir = process.env['DRASHTI_PERF_RAW'];
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `opening-${process.platform}.json`),
      JSON.stringify({ platform: process.platform, handicap: HANDICAP, period, row, runs }),
    );
  }
  expect(row.seen, line).toBe(OPENING_RUNS);
}

/**
 * Each slide change's raw times, as JSON, where DRASHTI_PERF_RAW says (the Performance workflow keeps them
 * 90 days; Sessions 31–36, PERF-2): one file per test and system, with the commit, for scripts/perf-compare.mjs.
 */
function keepRaw(which: string, result: PerfResult | null): void {
  const dir = process.env['DRASHTI_PERF_RAW'];
  if (!dir || !result?.raw) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${which}-${process.platform}.json`),
    JSON.stringify({
      commit: process.env['GITHUB_SHA'] ?? null,
      run: process.env['GITHUB_RUN_ID'] ?? null,
      platform: process.platform,
      test: which,
      changes: result.raw,
    }),
  );
}
