import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_ACCESS_LOCKED_REFUSAL } from '../../src/shared/mode';
import type { AccessStandIn } from '../access-standin';
import { logLines } from './log-lines';
import { makeTestImage } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Access by mode (Session 55, Part 19, the owner's decisions of 29 Oct 2026), against the stand-in list on 127.0.0.1:
 * a Gmail given Simple access may use Simple Mode only. Its Drashti opens in Simple Mode and has no way to Pro Mode: no
 * Switch to Pro Mode… in the window or the View menu, and the main process refuses Pro Mode and everything Simple Mode
 * refuses, whatever a page sends. The owner changing it to Pro, Pro Mode comes back by itself within a check (15 s);
 * changed back to Simple, Drashti drops to Simple Mode at that answer. Placeholder Gmails only.
 */

const SIMPLE_PERSON = 'simple.placeholder@example.com';

const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());

/** Whether the View menu offers a way to switch the mode now. */
const switchOffered = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Boolean(Menu.getApplicationMenu()?.getMenuItemById('switch-mode')));

/** What a page's requests get now, each by the main process: leaving Simple Mode, a change, and Simple Mode's lock. */
const tryAll = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const said = async (run: () => Promise<unknown>) => {
      try {
        return JSON.stringify(await run());
      } catch (error) {
        return String(error);
      }
    };
    return {
      // Pro Mode asked for, as its double-click asks (Session 55, Part 18: nothing typed).
      pro: await said(() => d.app.setMode('pro')),
      // A change Simple Mode refuses (a template made: Session 56 made a playlist Simple Mode's), and an engine command
      // it refuses (picture in picture swapped: switching the Look, refused here before, went with Looks in Part 12).
      playlist: await said(async () => {
        const [first] = (await d.playlists.tree()).filter((n) => !n.isFolder);
        return d.playlists.saveAsTemplate(first?.id ?? 'placeholder-none', {
          name: 'Placeholder',
          slots: [],
        });
      }),
      look: await said(() => d.engine.dispatch({ type: 'swapPip' })),
    };
  });

/** After the list's answer, the window shows the change within this (it is told at once: a few seconds is plenty). */
const FOLLOWS_MS = 5_000;

/** The checks the stand-in list has answered (a check answered 503, or that never reached it, is not one). */
const checksAnswered = (s: AccessStandIn) => s.calls.filter((op) => op === 'check').length;

/** Main's line for each check it has made, answered or not ("Access: check 3: let in (9 ms)", service.ts). */
const checkLines = (userData: string) => logLines(userData).filter((l) => /Access: check \d+: /u.test(l));

/**
 * The owner's change is in Drashti's hands once the list has answered a check after it: wait for that answer. Drashti
 * checks every 15 s, and a check with no answer is asked again at the next, 15 s on (service.ts, as designed); on CI's
 * Windows a check's connection can fail at once (alpha.20.1's final5: its job logged net::ERR_NO_BUFFER_SPACE, and
 * access-mode.spec.ts:119 missed its 25 s). Each wait keeps the test's 25 s: Main's next check comes within 25 s of the
 * change, and within 25 s of each check of Main's the list did not answer.
 */
async function listAnswersAfterTheChange(s: AccessStandIn, userData: string, change: string): Promise<void> {
  const answered = checksAnswered(s);
  while (checksAnswered(s) <= answered) {
    const made = checkLines(userData).length;
    await expect
      .poll(() => checkLines(userData).length, {
        timeout: 25_000,
        message: `after the owner's ${change}: Main's next check within 25 s (of the change, or of its check with no answer)`,
      })
      .toBeGreaterThan(made);
  }
}

/**
 * Each call the stand-in list hears and answers, with the test's own moments, by this computer's clock: read beside
 * Main's access lines (its log's own times) when a test fails.
 */
function watchStandIn(s: AccessStandIn): {
  mark: (what: string) => void;
  lines: (userData: string) => string[];
} {
  const marks: string[] = [];
  const mark = (what: string) => marks.push(`${new Date().toISOString()} test: ${what}`);
  const handle = s.list.handle.bind(s.list);
  s.list.handle = (text: string) => {
    let op: string;
    try {
      const raw = (JSON.parse(text) as { op?: unknown }).op;
      op = typeof raw === 'string' ? raw : 'a link page call';
    } catch {
      op = 'not JSON';
    }
    mark(`the stand-in list heard ${op}`);
    const answered = handle(text);
    mark(`the stand-in list answered ${op}`);
    return answered;
  };
  const lines = (userData: string) => {
    let main: string[];
    try {
      main = logLines(userData).filter((l) =>
        /Access:|Pro access again|Simple access|Switched|priority/u.test(l),
      );
    } catch (error) {
      main = [`(Main's log could not be read: ${String(error)})`];
    }
    return [...marks, ...main].sort();
  };
  return { mark, lines };
}

/** Main's Chromium network log from now, in the test's own folder: kept only when the test fails. */
async function keepNetworkLog(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ netLog }, file) => {
    await netLog.startLogging(file, { captureMode: 'default' });
  }, test.info().outputPath('network-log.json'));
}

test('Simple access: Simple Mode only, with no way to Pro Mode in the window, the View menu or the main process; the owner giving Pro, Pro Mode comes back by itself, and Simple again drops it to Simple Mode', async () => {
  test.setTimeout(150_000);
  const {
    app,
    access: s,
    userData,
  } = await launchApp({}, undefined, {
    as: { gmail: SIMPLE_PERSON },
    mode: 'simple',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const simple = win.getByTestId('simple-mode');
    // Opened in Simple Mode, whatever it was in before (a clean start is Pro Mode's).
    await expect(simple).toBeVisible();
    expect(await modeOf(win)).toBe('simple');
    // No way to Pro Mode: not on Simple Mode's screen, not in the View menu.
    await expect(win.getByTestId('simple-leave')).toHaveCount(0);
    expect(await switchOffered(app)).toBe(false);
    await chooseMenuItem(app, 'switch-mode');
    await expect(win.getByTestId('leave-simple')).toHaveCount(0);
    // Said plainly, where the way out was.
    await expect(win.getByTestId('simple-access')).toContainText('Simple Mode only');
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await expectFits(win.getByTestId('simple-mode'), 'Simple Mode with Simple access at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'Simple Mode with Simple access at 1024 × 645');
    // The main process refuses Pro Mode, and all Simple Mode refuses, whatever a page sends.
    const tried = await tryAll(win);
    expect(tried.pro).toContain('"ok":false');
    expect(tried.pro).toContain('Simple Mode only');
    expect(tried.playlist).toContain('Simple Mode is on');
    expect(tried.look).toContain('Simple Mode is on');
    expect(await modeOf(win)).toBe('simple');
    await holdStill(
      async () => (await modeOf(win)) === 'simple',
      3000,
      'nothing a page sent took it out of Simple Mode',
    );

    // The owner gives this Gmail Pro: at its next check (every 15 s), Pro Mode comes back by itself.
    s.setMode(SIMPLE_PERSON, 'pro');
    await listAnswersAfterTheChange(s, userData, 'Pro');
    await expect(simple).toHaveCount(0, { timeout: FOLLOWS_MS });
    expect(await modeOf(win)).toBe('pro');
    await expect(win.getByTestId('app-header')).toBeVisible();
    expect(await switchOffered(app)).toBe(true);

    // And Simple again: dropped to Simple Mode at that answer, with no way back.
    s.setMode(SIMPLE_PERSON, 'simple');
    await listAnswersAfterTheChange(s, userData, 'Simple');
    await expect(simple).toBeVisible({ timeout: FOLLOWS_MS });
    expect(await modeOf(win)).toBe('simple');
    await expect(win.getByTestId('simple-leave')).toHaveCount(0);
    expect(
      JSON.stringify(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'))),
    ).toContain('"ok":false');
  } finally {
    await app.close();
  }
});

test('Pro access: Simple Mode the operator chose stays when the owner gives Simple and then Pro again; and its Pro Mode is back with Pro access', async () => {
  test.setTimeout(150_000);
  const { app, access: s, userData } = await launchApp({}, undefined, { as: { gmail: SIMPLE_PERSON } });
  // A failure says when each call reached the stand-in list, beside the test's own moments and Main's access lines, and
  // keeps Main's Chromium network log (alpha.20.1's final5, CI's Windows: Pro again not heard in 25 s, its cause unseen).
  const said = watchStandIn(s);
  await keepNetworkLog(app);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(await modeOf(win)).toBe('pro');
    // The operator's own choice: Simple Mode.
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    await expect(win.getByTestId('simple-leave')).toBeVisible();
    // Simple access: the way out goes at the next check.
    said.mark('the owner gives Simple');
    s.setMode(SIMPLE_PERSON, 'simple');
    await listAnswersAfterTheChange(s, userData, 'Simple');
    await expect(win.getByTestId('simple-leave')).toHaveCount(0, { timeout: FOLLOWS_MS });
    // Pro again: the way out is back, and Simple Mode stays, the operator's own choice.
    said.mark('the owner gives Pro');
    s.setMode(SIMPLE_PERSON, 'pro');
    await listAnswersAfterTheChange(s, userData, 'Pro');
    await expect(win.getByTestId('simple-leave')).toBeVisible({ timeout: FOLLOWS_MS });
    await holdStill(
      async () => (await modeOf(win)) === 'simple',
      3000,
      'Simple Mode chosen by the operator stays',
    );
  } catch (error) {
    said.mark('failed');
    console.log(
      `The access, as the test, the stand-in list and Main saw it:\n${said.lines(userData).join('\n')}`,
    );
    throw error;
  } finally {
    await app
      .evaluate(async ({ netLog }) => {
        await netLog.stopLogging();
      })
      .catch(() => undefined);
    await app.close();
  }
});

/**
 * The next check that reaches the stand-in list is answered 503, as a check's connection on CI's Windows can fail at once
 * (alpha.20.1's final5: net::ERR_NO_BUFFER_SPACE, its job's own log): Drashti hears no answer, and asks again at its next
 * check, 15 s on (service.ts, as designed). The checks after it are answered.
 */
async function failTheNextCheck(s: AccessStandIn): Promise<void> {
  const tries = s.tries;
  s.mode = 'error';
  await expect.poll(() => s.tries, { timeout: 25_000 }).toBeGreaterThan(tries);
  s.mode = 'answer';
}

test('Pro access, the check after the owner gives Pro again with no answer (a connection that fails at once, as on CI’s Windows): the way out is back at the list’s next answer, and Simple Mode stays', async () => {
  test.setTimeout(150_000);
  const { app, access: s, userData } = await launchApp({}, undefined, { as: { gmail: SIMPLE_PERSON } });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(win.getByTestId('simple-leave')).toBeVisible();
    s.setMode(SIMPLE_PERSON, 'simple');
    await listAnswersAfterTheChange(s, userData, 'Simple');
    await expect(win.getByTestId('simple-leave')).toHaveCount(0, { timeout: FOLLOWS_MS });
    s.setMode(SIMPLE_PERSON, 'pro');
    await failTheNextCheck(s);
    // Still Simple access: no answer came after the owner's change.
    await expect(win.getByTestId('simple-leave')).toHaveCount(0);
    await listAnswersAfterTheChange(s, userData, 'Pro');
    await expect(win.getByTestId('simple-leave')).toBeVisible({ timeout: FOLLOWS_MS });
    await holdStill(
      async () => (await modeOf(win)) === 'simple',
      3000,
      'Simple Mode chosen by the operator stays',
    );
  } finally {
    await app.close();
  }
});

test('Simple access refuses exactly what Simple Mode refuses (Session 55, Parts 18 and 19, one list): its playlist takes files, and nothing of a playlist that is Pro Mode’s, in words with no way to Pro Mode', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({}, undefined, { as: { gmail: SIMPLE_PERSON }, mode: 'simple' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    // Started in Simple Mode by the access: a playlist of its own (none was kept), as Simple Mode makes one.
    const one = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist());
    expect(one).not.toBeNull();
    await expect(simple.getByTestId('playlist-title')).toHaveText(/^Sabha, /u);
    // Add files…: a picture into it, as with Pro access.
    const picture = await makeTestImage(
      win,
      join(mkdtempSync(join(tmpdir(), 'drashti-simple-access-')), 'Placeholder access picture.png'),
      { color: '#4c1d95' },
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, picture);
    await simple.getByTestId('playlist-add-files').click();
    await expect(simple.getByTestId('playlist-item')).toHaveCount(1);
    // Beyond what Simple Mode does with the playlists (Session 56: as Pro Mode's left column), refused in Simple
    // access's words, which offer no way to Pro Mode: rows of what is no playlist, a copy, a template.
    const refused = await win.evaluate(async (playlistId) => {
      const d = (globalThis as PageGlobals).drashti;
      return {
        other: await d.playlists.addItems('placeholder-other-playlist', null, [
          { kind: 'header', label: 'Placeholder' },
        ]),
        copy: await d.playlists.duplicate(playlistId ?? ''),
        template: await d.playlists.saveAsTemplate(playlistId ?? '', { name: 'Placeholder', slots: [] }),
      };
    }, one);
    expect(refused).toEqual({
      other: { ok: false, message: SIMPLE_ACCESS_LOCKED_REFUSAL },
      copy: { ok: false, message: SIMPLE_ACCESS_LOCKED_REFUSAL },
      template: { ok: false, message: SIMPLE_ACCESS_LOCKED_REFUSAL },
    });
  } finally {
    await app.close();
  }
});
