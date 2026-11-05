import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Where a start's time goes (question 36 of Session 54: from its 650th test on, every start on CI's Mac took about
 * 15 s more, inside the operator window, before its status bar said the version, and nothing said where). The log
 * now says when the operator window's page had loaded, when the window knew each thing it waits for before it draws
 * its controls (its access, its mode, the single-letter keys and the version), and when it drew them, as the start's
 * other phase lines do; a slow start in a test prints them (helpers.ts, operatorReady).
 */

/** Ms since the main process began, from a phase line's "at N ms". */
const at = (line: string, what: string): number => {
  const m = new RegExp(`${what} at (\\d+) ms`, 'u').exec(line);
  return m ? Number(m[1]) : Number.NaN;
};

test('a start says in the log when the operator window loaded, knew what it waits for, and drew its controls', async () => {
  const { app, userData } = await launchApp();
  const operator = await operatorPage(app);
  await operatorReady(operator);
  const file = join(userData, 'logs', 'drashti.log');
  // The window says so once it has drawn its controls and knows the version: a moment after operatorReady.
  await expect
    .poll(() => readFileSync(file, 'utf8').includes('Start: operator window drawn at'), { timeout: 10_000 })
    .toBe(true);
  const lines = readFileSync(file, 'utf8').split('\n');
  const loaded = lines.find((l) => l.includes('Start: operator window loaded at')) ?? '';
  const drawn = lines.find((l) => l.includes('Start: operator window drawn at')) ?? '';
  expect(loaded).toMatch(/Start: operator window loaded at \d+ ms/u);
  expect(drawn).toMatch(
    /Start: operator window drawn at \d+ ms \(its access known at \d+ ms, its mode at \d+ ms, its single-letter keys at \d+ ms, its version at \d+ ms\)/u,
  );
  // In order: the page loaded before the window knew anything, and it drew its controls once it knew its access, its
  // mode and its keys (the version can come a moment later).
  const drewAt = at(drawn, 'drawn');
  expect(at(loaded, 'loaded')).toBeLessThanOrEqual(at(drawn, 'access known'));
  for (const what of ['access known', 'its mode', 'its single-letter keys'])
    expect(at(drawn, what)).toBeLessThanOrEqual(drewAt);
  await app.close();
});

/** The HEVC question's answer, as the log says it (asked of a page, not given by a test). */
const HEVC_ANSWERED = /This computer (plays|cannot play) HEVC video/u;

test('the operator window starts without waiting for the HEVC question: its answer 15 s late, as on CI’s Mac late in a run, comes after the window has drawn its controls (question 36)', async () => {
  test.setTimeout(120_000);
  // Chromium answers whether this computer plays HEVC only once the GPU process has said which video decoders it
  // has, holding the page that asks until then: here 15 s.
  const { app, userData } = await launchApp({ DRASHTI_TEST_HEVC_ANSWER_MS: '15000' });
  try {
    const log = () => readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
    const operator = await operatorPage(app);
    await operatorReady(operator);
    // The window's whole start (its access, mode, keys and version known, its controls drawn) is in the log...
    await expect
      .poll(() => log().includes('Start: operator window drawn at'), { timeout: 10_000 })
      .toBe(true);
    // ...while the answer is still on its way.
    expect(log()).not.toMatch(HEVC_ANSWERED);
    // It still comes, late: Chromium's own answer, once the question lets go of its page.
    await expect.poll(log, { timeout: 60_000 }).toMatch(HEVC_ANSWERED);
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
  }
});
