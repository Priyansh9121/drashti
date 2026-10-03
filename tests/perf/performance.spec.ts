import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUIET } from '../e2e/helpers';
import { freePort, testFfmpeg } from '../e2e/stream-helpers';

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
}

function runPerformanceTest(
  extra: Record<string, string> = {},
): Promise<{ code: number | null; result: PerfResult | null; log: string }> {
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { DRASHTI_SELFTEST: 'performance', DRASHTI_NO_QUIT_CONFIRM: '1' }, extra);
  return new Promise((resolve) => {
    const child = spawn(electron, ['.'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d: Buffer) => (log += d.toString()));
    child.stderr.on('data', (d: Buffer) => (log += d.toString()));
    const timer = setTimeout(() => child.kill(), 240_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
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
  test.setTimeout(300_000);
  const { code, result, log } = await runPerformanceTest();
  expect(result, log.slice(-3000)).not.toBeNull();
  console.log(result?.summary);
  for (const c of result?.checks ?? []) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    expect.soft(c.ok, `${c.name} ${c.detail}`).toBe(true);
  }
  test.info().annotations.push({ type: 'performance', description: result?.summary ?? '' });
  expect(result?.passed).toBe(true);
  expect(code).toBe(0);
});

test('slide changes keep reaching the screen within a frame while streaming and recording, during a big import', async () => {
  test.setTimeout(360_000);
  const ffmpeg = testFfmpeg();
  test.skip(!ffmpeg, 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-perf-stream-'));
  // FFmpeg on this computer stands in for YouTube; the app's stream key for this is made up.
  const listener = spawn(
    ffmpeg ?? '',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-listen',
      '1',
      '-i',
      `rtmp://127.0.0.1:${port}/live2/test-made-up-key-perf-0000`,
      '-c',
      'copy',
      '-f',
      'flv',
      '-y',
      join(dir, 'received.flv'),
    ],
    { stdio: 'ignore' },
  );
  try {
    const { code, result, log } = await runPerformanceTest({
      DRASHTI_PERF_STREAM: `rtmp://127.0.0.1:${port}/live2`,
      DRASHTI_TEST_FAKE_DEVICES: '1',
    });
    expect(result, log.slice(-3000)).not.toBeNull();
    console.log(result?.summary);
    for (const c of result?.checks ?? []) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
      expect.soft(c.ok, `${c.name} ${c.detail}`).toBe(true);
    }
    test.info().annotations.push({ type: 'performance', description: result?.summary ?? '' });
    expect(result?.summary).toContain('streaming');
    expect(result?.passed).toBe(true);
    expect(code).toBe(0);
  } finally {
    listener.kill('SIGKILL');
  }
});
