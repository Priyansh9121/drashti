import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { launchApp } from './helpers';

/*
 * Playwright cannot stay attached to a renderer that crashes and reloads,
 * so the crash scenario runs as the app's own watchdog self-test with no
 * test driver attached. Reloading (no crash) is also checked through
 * Playwright below.
 */

interface SelfTestResult {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

function runSelfTest(): Promise<{ code: number | null; result: SelfTestResult | null; log: string }> {
  // Playwright runs these files as CommonJS; the electron package's main export is the binary's path.
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    DRASHTI_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'drashti-selftest-')),
    DRASHTI_SELFTEST: 'watchdog',
    DRASHTI_NO_QUIT_CONFIRM: '1',
  });
  return new Promise((resolve) => {
    const child = spawn(electron, ['.'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d: Buffer) => (log += d.toString()));
    child.stderr.on('data', (d: Buffer) => (log += d.toString()));
    const timer = setTimeout(() => child.kill(), 90_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = log.split('\n').find((l) => l.startsWith('DRASHTI_SELFTEST_RESULT '));
      resolve({
        code,
        result: line ? (JSON.parse(line.slice('DRASHTI_SELFTEST_RESULT '.length)) as SelfTestResult) : null,
        log,
      });
    });
  });
}

test('watchdog self-test: operator crash and reload never touch the output; crashed windows come back', async () => {
  const { code, result, log } = await runSelfTest();
  expect(result, log.slice(-3000)).not.toBeNull();
  for (const c of result?.checks ?? []) expect.soft(c.ok, `${c.name} ${c.detail}`).toBe(true);
  expect(result?.checks.map((c) => c.name)).toEqual([
    'an output window is open',
    'the first slide reaches the output',
    'the output shows something',
    'while the operator is crashed, the output keeps the same frame',
    'the watchdog reloads the operator window',
    'the reloaded operator window works',
    'the output was never reloaded or redrawn',
    'Next in the recovered operator window updates the output',
    'while the operator reloads, the output keeps the same frame',
    'the operator window comes back after a reload',
    'the watchdog reloads a crashed output',
    'the reloaded output shows the live slide again',
  ]);
  expect(result?.passed).toBe(true);
  expect(code).toBe(0);
  test.info().annotations.push({
    type: 'self-test',
    description: (result?.checks ?? []).map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('; '),
  });
});

test('reloading the operator window (Cmd/Ctrl+R) leaves the output page untouched', async () => {
  const { app } = await launchApp();
  const operator = await app.firstWindow();
  await expect(operator.getByTestId('presentation-list').getByRole('button')).toHaveCount(2);
  await operator.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const created = await d.screens.createGroup('Main Hall');
    if (!created.ok) throw new Error(created.message);
    await d.screens.assignDisplay(
      created.snapshot.groups[0]?.id ?? '',
      created.snapshot.displays[0]?.id ?? -1,
      { coverOperator: true },
    );
  });
  const output = await app.waitForEvent('window', { predicate: (w) => w.url().includes('output.html') });
  await operator.getByTestId('slide-thumb').first().click();
  await expect(output.locator('[data-lang="en"]')).toHaveText('Welcome to the test slide');
  const loadedAt = await output.evaluate(() => performance.timeOrigin);
  const pid = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('output.html'))
      ?.webContents.getOSProcessId(),
  );

  await operator.reload();
  await expect(operator.getByTestId('live-text')).toHaveText('Live: Language test slides · slide 1 of 3');
  await expect(output.locator('[data-lang="en"]')).toHaveText('Welcome to the test slide');
  expect(await output.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
  const pidAfter = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('output.html'))
      ?.webContents.getOSProcessId(),
  );
  expect(pidAfter).toBe(pid);
  await app.close();
});
