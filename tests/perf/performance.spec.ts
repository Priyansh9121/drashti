import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/*
 * The performance check, started by hand (pnpm test:perf, or the
 * "Performance" workflow): the app's own performance self-test, headless.
 * Not part of CI's runs, where virtual machines stall now and then. On the
 * mandir's machines run the installed app instead (README, "Performance check").
 */

interface PerfResult {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  summary: string;
}

function runPerformanceTest(): Promise<{ code: number | null; result: PerfResult | null; log: string }> {
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { DRASHTI_SELFTEST: 'performance', DRASHTI_NO_QUIT_CONFIRM: '1' });
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
