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
