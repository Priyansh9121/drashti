import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ACCESS_REMOVED_TEXT, NO_ANSWER_STOP_TITLE, STOPPED_REFUSAL } from '../../src/shared/access';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  answerAgain,
  closedWatch,
  holdListClock,
  newStandIn,
  PLACEHOLDER_PERSON,
  revoke,
  standInOf,
  stopAnswering,
} from './access';
import { clearOfShowControls, expectFits } from './fit';
import {
  holdStill,
  launchApp,
  lockPage,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { freePort, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Live checks (Session 54, access by Gmail, E3): Drashti checks its access before it opens and while open; revoked
 * (in the Access List or typed into the Sheet), rejected or unknown, everything stops at once in the main process
 * (the controls behind one plain message with only Quit, every request refused whatever page asks, the screens fading
 * to black, the stream and recording ended); with no answer, the countdown over Pro and Simple Mode, then the same
 * stop; at start with no answer it does not open (Try Again), and quit and started again at once it opens at once; a
 * data folder copied to another computer does not let that computer in. The stand-in list on 127.0.0.1; checks every 6 s
 * and the stop 20 s after the last answer here (test switches a packaged Drashti never reads), so no test waits
 * minutes.
 */

const FAST = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '6000',
  DRASHTI_TEST_ACCESS_STOP_MS: '20000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '2000',
};
const SCREENS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

/** Drashti let in, with a slide on a screen of its own (a pretend display, as the tests' screens are). */
async function showing(env: Record<string, string> = {}) {
  const run = await launchApp({ ...FAST, ...SCREENS, ...env });
  const win = await operatorPage(run.app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 1);
  const out = await outputPage(run.app);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    if (!p) throw new Error('no placeholder presentation');
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 0 });
  });
  await expect(out.locator('[data-layer="slide"]')).toHaveCount(1);
  return { ...run, win, out };
}

/** What a page's request gets now: what it answered, or the words it was refused with. */
const tryIt = (win: Page, what: 'command' | 'library' | 'screens') =>
  win.evaluate(async (w) => {
    const d = (globalThis as PageGlobals).drashti;
    try {
      if (w === 'command') return JSON.stringify(await d.engine.dispatch({ type: 'toggleBlackout' }));
      if (w === 'library') return JSON.stringify((await d.library.listPresentations()).length);
      return JSON.stringify((await d.screens.get()).groups.length);
    } catch (error) {
      return String(error);
    }
  }, what);

/** The stop's screen, in place of the controls: one message, and Quit, the one button. */
async function expectStopped(win: Page, title: string, timeout = 20_000): Promise<void> {
  const stopped = win.getByTestId('access-stopped');
  await expect(stopped).toBeVisible({ timeout });
  await expect(stopped.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(win.getByRole('button')).toHaveCount(1);
  await expect(win.getByTestId('access-quit')).toBeFocused();
  for (const what of ['command', 'library', 'screens'] as const)
    expect(await tryIt(win, what), what).toContain(STOPPED_REFUSAL);
}

/** Quit, the one thing that works: Drashti quits at once, asking nothing. */
async function quitFromTheStop(watch: ReturnType<typeof closedWatch>, win: Page): Promise<void> {
  await win.getByTestId('access-quit').click();
  await watch.whenClosed;
}

test('a revoke while open stops everything at the next check, in the main process, and only Quit works', async () => {
  test.setTimeout(150_000);
  const { app, win, out, access: list } = await showing();
  const watch = closedWatch(app);
  try {
    // Before: the controls answer.
    expect(await tryIt(win, 'library')).not.toContain(STOPPED_REFUSAL);
    revoke(list, PLACEHOLDER_PERSON);
    // Within one check (6 s here), with the plain message.
    await expectStopped(win, ACCESS_REMOVED_TEXT);
    await expect(win.getByTestId('access-stopped')).toHaveAttribute('data-reason', 'revoked');
    // The screens fade to black from the engine's time, and nothing under the black is drawn any more.
    await expect(out.getByTestId('stopped-cover')).toHaveAttribute('data-stopped', 'black', {
      timeout: 5000,
    });
    await expect(out.locator('[data-layer="slide"]')).toHaveCount(0);
    // Nothing is asked of the list any more: the stop is for good.
    const asked = list.calls.length;
    await holdStill(() => list.calls.length === asked, 8000, 'nothing more is asked of the list');
    // The menu has Quit and the editing keys only: no show, no library, no window of tools.
    const menus = await app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label),
    );
    expect(menus.length).toBe(2);
    for (const gone of ['View', 'Library', 'Window', 'Diagnostics', 'Help'])
      expect(menus).not.toContain(gone);
    await quitFromTheStop(watch, win);
  } finally {
    if (!watch.closed()) await app.close();
  }
});

test('a status typed as revoked into the Sheet itself stops a running Drashti, as Revoke does', async () => {
  test.setTimeout(150_000);
  const { app, win, out, access: list } = await showing();
  const watch = closedWatch(app);
  try {
    // The owner types it into the Gmail's Status cell by hand: the list reads its Sheet at most 10 s after, and this
    // Drashti hears it at its next check after that (every 6 s here).
    list.list.sheet.type('Access List', 'Gmail', PLACEHOLDER_PERSON, 'Status', 'revoked');
    await expectStopped(win, ACCESS_REMOVED_TEXT, 40_000);
    await expect(win.getByTestId('access-stopped')).toHaveAttribute('data-reason', 'revoked');
    await expect(out.getByTestId('stopped-cover')).toHaveAttribute('data-stopped', 'black', {
      timeout: 5000,
    });
    await quitFromTheStop(watch, win);
  } finally {
    if (!watch.closed()) await app.close();
  }
});

test('the stop in Simple Mode, in CI’s window: one message and Quit, fitting, passing the accessibility checks', async () => {
  test.setTimeout(120_000);
  const { app, win, access: list } = await showing();
  const watch = closedWatch(app);
  try {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await sizeOperatorWindow(app, win, CI_WINDOW);
    revoke(list, PLACEHOLDER_PERSON);
    await expectStopped(win, ACCESS_REMOVED_TEXT);
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    await expectFits(win.getByTestId('access-stopped'), 'the stop at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'the stop at 1024 × 645');
    await quitFromTheStop(watch, win);
  } finally {
    if (!watch.closed()) await app.close();
  }
});

test('with no answer: the countdown over the controls, gone when the list answers, then the stop 2 minutes after the last answer', async () => {
  test.setTimeout(150_000);
  const { app, win, access: list } = await showing();
  const watch = closedWatch(app);
  try {
    await sizeOperatorWindow(app, win, CI_WINDOW);
    stopAnswering(list);
    // The countdown, from the next check: the show goes on under it.
    const countdown = win.getByTestId('access-countdown');
    await expect(countdown).toBeVisible({ timeout: 15_000 });
    await expect(win.getByTestId('access-countdown-line')).toHaveText(
      /^No internet: Drashti stops in 0:\d\d unless it can check your access$/u,
    );
    expect(await tryIt(win, 'library')).not.toContain(STOPPED_REFUSAL);
    await expectNoSeriousA11yIssues(win, 'the countdown at 1024 × 645', '[data-testid="access-countdown"]');
    // The list answers again: the countdown goes, and the show goes on.
    answerAgain(list);
    await expect(countdown).toHaveCount(0, { timeout: 15_000 });
    // No answer again, now for good: the countdown, then the stop.
    stopAnswering(list);
    await expect(countdown).toBeVisible({ timeout: 15_000 });
    await expectStopped(win, NO_ANSWER_STOP_TITLE);
    await expect(win.getByTestId('access-stopped')).toHaveAttribute('data-reason', 'no-answer');
    // The list answering again later opens nothing.
    answerAgain(list);
    await holdStill(
      () => win.getByTestId('access-stopped').isVisible(),
      8000,
      'the list answering again opens nothing',
    );
    await quitFromTheStop(watch, win);
  } finally {
    if (!watch.closed()) await app.close();
  }
});

test('the countdown over Simple Mode, in CI’s window: clear of its big buttons, fitting, passing the accessibility checks, the show going on under it', async () => {
  test.setTimeout(150_000);
  // The stop a minute after the last answer here, so the countdown stays up while it is looked at.
  const { app, win, access: list } = await showing({ DRASHTI_TEST_ACCESS_STOP_MS: '60000' });
  try {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    await sizeOperatorWindow(app, win, CI_WINDOW);
    stopAnswering(list);
    const countdown = win.getByTestId('access-countdown');
    await expect(countdown).toBeVisible({ timeout: 15_000 });
    await expect(win.getByTestId('access-countdown-line')).toHaveText(
      /^No internet: Drashti stops in 0:\d\d unless it can check your access$/u,
    );
    // Over Simple Mode, which stays: inside the window, never over Next, Back or the other big buttons.
    await expect(simple).toBeVisible();
    await expectFits(countdown, 'the countdown over Simple Mode at 1024 × 645');
    await clearOfShowControls(win, countdown);
    await expectNoSeriousA11yIssues(win, 'the countdown over Simple Mode at 1024 × 645');
    // The show goes on under it: Simple Mode's own Black-out button still works.
    const blackout = simple.getByTestId('simple-blackout');
    await blackout.click();
    await expect(blackout).toContainText('Black-out is on');
    await blackout.click();
    await expect(blackout).not.toContainText('Black-out is on');
    // The list answers again: the countdown goes, and Simple Mode is as it was.
    answerAgain(list);
    await expect(countdown).toHaveCount(0, { timeout: 15_000 });
    await expect(simple).toBeVisible();
  } finally {
    await app.close();
  }
});

test('at start with no answer Drashti does not open: Try Again opens it once the list answers', async () => {
  test.setTimeout(150_000);
  const first = await launchApp(FAST);
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const list = standInOf(first.userData);
  stopAnswering(list);
  const { app } = await relaunchApp(first.userData, FAST);
  try {
    const lock = await lockPage(app);
    await expect(lock.getByTestId('access-reason')).toHaveAttribute('data-reason', 'no-answer', {
      timeout: 20_000,
    });
    await expect(lock.getByTestId('access-reason')).toContainText('No internet');
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    await expectFits(lock.getByTestId('access-lock'), 'the lock screen with no answer');
    await expectNoSeriousA11yIssues(lock, 'the lock screen with no answer');
    // Try Again with still no answer: still not open.
    await lock.getByTestId('access-retry').click();
    await expect(lock.getByTestId('access-retry')).toHaveText('Try Again', { timeout: 20_000 });
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    answerAgain(list);
    await lock.getByTestId('access-retry').click();
    await operatorReady(await operatorPage(app));
  } finally {
    await app.close();
  }
});

test('quit and started again at once, Drashti opens at once: a check sooner than 5 s after the last is answered as any other', async () => {
  test.setTimeout(120_000);
  // The list's clock held still from before the first start: to the list, the second start's check comes 0 s after
  // the first's, closer together than the one check in 5 seconds it records.
  const list = await newStandIn();
  const release = holdListClock(list);
  // Each refusal the list gives, as it gives it: none, as a check sooner than 5 s after the last is answered.
  const refusals: string[] = [];
  list.tamper = (a) => {
    const p = JSON.parse(a.payload) as { op?: unknown; ok?: unknown; error?: unknown };
    if (p.ok !== true) refusals.push(`${String(p.op)}: ${String(p.error)}`);
    return a;
  };
  try {
    const first = await launchApp({}, undefined, { standIn: list });
    await operatorReady(await operatorPage(first.app));
    await first.app.close();
    const checks = list.calls.filter((c) => c === 'check').length;
    const { app } = await relaunchApp(first.userData);
    try {
      // Let in by its first check: the operator window, with no lock screen asking anything first.
      await operatorReady(await operatorPage(app));
      expect(list.calls.filter((c) => c === 'check').length).toBeGreaterThan(checks);
      expect(refusals).toEqual([]);
    } finally {
      await app.close();
    }
  } finally {
    list.tamper = null;
    release();
  }
});

test('a data folder copied to another computer does not let that computer in, and is never sent', async () => {
  test.setTimeout(120_000);
  const first = await launchApp();
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const list = standInOf(first.userData);
  const copy = mkdtempSync(join(tmpdir(), 'drashti-e2e-copy-'));
  cpSync(first.userData, copy, { recursive: true });
  const checks = list.calls.filter((c) => c === 'check').length;
  // The same list, but another computer.
  const { app } = await launchApp({}, copy, { standIn: list, hardwareId: 'placeholder-another-computer' });
  try {
    const lock = await lockPage(app);
    await expect(lock.getByTestId('access-reason')).toHaveAttribute('data-reason', 'copied');
    await expect(lock.getByTestId('access-reason')).toContainText('Each computer needs its own access');
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    expect(list.calls.filter((c) => c === 'check').length).toBe(checks);
  } finally {
    await app.close();
  }
  // The folder itself, on its own computer, still opens.
  const back = await relaunchApp(first.userData);
  await operatorReady(await operatorPage(back.app));
  await back.app.close();
});

test('a revoke ends the stream and the recording at once', async () => {
  test.setTimeout(180_000);
  const ffmpeg = testFfmpeg();
  // CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
  test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-access-stream-'));
  // FFmpeg on this computer stands in for YouTube; the stream's key is made up (stream-helpers.ts).
  const farEnd = rtmpListener(ffmpeg ?? '', port, join(dir, 'received.flv'));
  const { app, userData, access: list } = await launchApp({ ...FAST, DRASHTI_TEST_FAKE_DEVICES: '1' });
  const watch = closedWatch(app);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpStream(app, win, port, dir);
    await win.evaluate(async () => {
      const s = (globalThis as PageGlobals).drashti.stream;
      await s.startRecording();
      await s.goLive({ confirmed: true });
    });
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    await expect.poll(async () => (await status()).live.state, { timeout: 45_000 }).toBe('live');
    expect((await status()).recording.state).toBe('recording');
    revoke(list, PLACEHOLDER_PERSON);
    await expectStopped(win, ACCESS_REMOVED_TEXT);
    // Ended, as the main process keeps it (the window's own requests are refused now)…
    const kept = () =>
      JSON.parse(readFileSync(join(userData, 'stream-state.json'), 'utf8')) as {
        live: boolean;
        recording: boolean;
      };
    await expect.poll(kept, { timeout: 10_000 }).toMatchObject({ live: false, recording: false });
    // …and as the far end hears it: the stream is over.
    await expect
      .poll(() => farEnd.exitCode !== null || farEnd.signalCode !== null, { timeout: 30_000 })
      .toBe(true);
    await quitFromTheStop(watch, win);
  } finally {
    farEnd.kill('SIGKILL');
    if (!watch.closed()) await app.close();
  }
});
