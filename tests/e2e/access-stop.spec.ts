import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  ACCESS_REMOVED_TEXT,
  LOCK_REASON_TEXT,
  NO_CONTACT_COME_BACK_TEXT,
  NO_CONTACT_STOP_TEXT,
  NO_CONTACT_STOP_TITLE,
  OFFLINE_SHORT_TEXT,
  STOPPED_REFUSAL,
} from '../../src/shared/access';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  answerAgain,
  answerHeardAgo,
  closedWatch,
  holdListClock,
  moveListClock,
  newStandIn,
  ownerCall,
  PLACEHOLDER_PERSON,
  revoke,
  standInOf,
  stopAnswering,
} from './access';
import type { AccessStandIn } from '../access-standin';
import { clearOfShowControls, expectFits, fitFaults } from './fit';
import {
  holdStill,
  launchApp,
  letTimePass,
  lockPage,
  operatorPage,
  operatorReady,
  outputPage,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { logText } from './log-lines';
import { freePort, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Live checks (Session 54, access by Gmail, E3): Drashti checks its access before it opens and while open; revoked
 * (in the Access List or typed into the Sheet), rejected or unknown, everything stops at once in the main process
 * (the controls behind one plain message with only Quit, every request refused whatever page asks, the screens fading
 * to black, the stream and recording ended). With no answer (no internet; the owner's decisions of 28 and 29 Oct 2026),
 * Drashti keeps working, the stream and recording included, a line in the status bar in Pro and Simple Mode saying how
 * long, for up to 15 days from the last answer, then it stops as a revoke stops it, saying to ask for access again;
 * started with no answer, it opens only within those 15 days of an answer that let it in; quit and started again at once
 * it opens at once; a data folder copied to another computer does not let that computer in. The stand-in list on
 * 127.0.0.1; checks every 6 s and "the 15 days" 20 s here (test switches a packaged Drashti never reads), so no test
 * waits; the list's own 15 days are moved on its clock.
 *
 * Session 55 (the owner's decisions of 29 Oct 2026): a start within the 15 days of an answer that let it in opens at
 * once, the list asked in the background (a revoke heard then stops it at that answer); the line, "Can’t reach the
 * access list: Drashti keeps working for 14 days 6 hours more.", shorter as it runs down, only once there has been no
 * answer for about 2 minutes (a few seconds here) and three checks in a row have had none, so that nothing in the window
 * moves when it comes or goes and it is never over a control; and when the computer's network comes back (a file stands
 * in for the network here, DRASHTI_TEST_NETWORK_FILE), the list is asked at once, a check waiting on the old network
 * given up.
 *
 * alpha.24 (the owner's QA24-ACCESS-STRIP A, 27 Nov 2026, in place of Session 55's strip kept for the line under the top
 * bar, 24 px in every look): the line is said in the status bar, in place of the version and in the version's own room
 * (cut short with "…" there if it must be, its words whole in its tooltip and to a screen reader), while the list does
 * not answer; still nothing in the window moves when it comes or goes, nothing in the status bar either, and it is
 * never over a control. So nothing comes between the top bar and the columns.
 */

const FAST = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '6000',
  DRASHTI_TEST_ACCESS_STOP_MS: '20000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '2000',
};
const SCREENS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

/** The placeholder presentation's first slide up, as in a show. */
const slideUp = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    if (!p) throw new Error('no placeholder presentation');
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 0 });
  });

/** Drashti let in, with a slide on a screen of its own (a pretend display, as the tests' screens are). */
async function showing(env: Record<string, string> = {}) {
  const run = await launchApp({ ...FAST, ...SCREENS, ...env });
  const win = await operatorPage(run.app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 1);
  const out = await outputPage(run.app);
  await slideUp(win);
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The line's words, the owner's own (Session 55): days and hours, hours and minutes, minutes, or less than a minute. */
const LINE =
  /^Can’t reach the access list: Drashti keeps working for (\d+ days?( \d+ hours?)?|\d+ hours?( \d+ minutes?)?|\d+ minutes?|less than a minute) more\.$/u;

/**
 * Checks every 2 s, each given 1 s, and the bar only after 12 s with no answer (and three checks missed): so two missed
 * checks in a row come and go long before it could show.
 */
const QUICK = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '2000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '1000',
  DRASHTI_TEST_ACCESS_BAR_MS: '12000',
};

/**
 * Where the window's parts and everything that runs the show are, each named by its test id (or what it is) and its
 * place in the page: nothing of it may move, come or go as the line comes or goes.
 */
const layout = (win: Page) =>
  win.evaluate(() => {
    const out: string[] = [];
    const parts = document.querySelectorAll(
      '[data-header], footer, main, aside, [data-testid^="column-"], [data-show-control], [data-testid="simple-mode"] > *',
    );
    parts.forEach((el, i) => {
      if (el.closest('[data-testid="access-offline-notices"]')) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const id = (el as HTMLElement).dataset['testid'] ?? el.tagName.toLowerCase();
      out.push(
        `${String(i)} ${id}: ${String(Math.round(r.x))},${String(Math.round(r.y))} ${String(Math.round(r.width))}×${String(Math.round(r.height))}`,
      );
    });
    return out;
  });

/**
 * The line is one line in the status bar, its words cut at most at their end (whole in its tooltip), and over no
 * control of any kind.
 */
async function oneLineOverNothing(win: Page, what: string): Promise<void> {
  const found = await win.evaluate(() => {
    const line = document.querySelector('[data-testid="access-offline-notice"]');
    const slot = document.querySelector('[data-testid="access-offline-notices"]');
    if (!line || !slot) return { problems: ['no line'] };
    const box = line.getBoundingClientRect();
    const problems: string[] = [];
    // In sight, its short words (alpha.24, in the version's room), whole and inside it; read out and in its tooltip, the
    // whole line.
    const words = line.querySelector('[data-testid="access-offline-short"]');
    const whole = line.querySelector('[data-testid="access-offline-words"]');
    if (!words || !whole) problems.push('its words are not in it');
    if (words && words.scrollWidth > words.clientWidth + 1) problems.push('its words in sight are cut');
    const inSight = words?.getBoundingClientRect();
    if (inSight && (inSight.left < box.left - 0.5 || inSight.right > box.right + 0.5))
      problems.push('its words in sight run out of it');
    // The time left after them (alpha.25 item 5), whole and inside it too.
    const left = line.querySelector('[data-testid="access-offline-left"]');
    if (!left) problems.push('its time left is not in it');
    if (left && left.scrollWidth > left.clientWidth + 1) problems.push('its time left in sight is cut');
    const leftBox = left?.getBoundingClientRect();
    if (leftBox && (leftBox.left < box.left - 0.5 || leftBox.right > box.right + 0.5))
      problems.push('its time left in sight runs out of it');
    if (whole && line.getAttribute('title') !== whole.textContent)
      problems.push(`its tooltip is “${String(line.getAttribute('title'))}”, not its whole line`);
    // Nor cut at the bottom.
    if (words && words.scrollHeight > words.clientHeight + 1)
      problems.push(
        `its words are cut at the bottom (${String(words.scrollHeight)} px in ${String(words.clientHeight)})`,
      );
    if (box.height > slot.getBoundingClientRect().height + 0.5)
      problems.push(`it is ${String(box.height)} px tall`);
    const bar = document.querySelector('footer[aria-label="Status"]')?.getBoundingClientRect();
    if (!bar || box.top < bar.top - 0.5 || box.bottom > bar.bottom + 0.5 || box.right > bar.right + 0.5)
      problems.push('it is not in the status bar');
    for (const el of document.querySelectorAll(
      'button, input, select, textarea, a[href], [role="button"], [role="tab"], [data-show-control]',
    )) {
      if (el.closest('[data-testid="access-offline-notices"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (box.left < r.right && r.left < box.right && box.top < r.bottom && r.top < box.bottom)
        problems.push(`it is over “${el.textContent.trim().slice(0, 30)}”`);
    }
    return { problems };
  });
  expect(found.problems, what).toEqual([]);
}

/** Where something is, as Playwright gives it. */
interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The status bar, the version and every control in the bar, each named by its test id (or its name, or what it is)
 * and exactly where it is, to the fraction of a pixel: none of it may move or change size as the line comes or goes
 * (alpha.24: the version only hides, keeping its room for the line).
 */
const statusBar = (win: Page) =>
  win.evaluate(() => {
    const bar = document.querySelector('footer[aria-label="Status"]');
    if (!bar) return ['no status bar'];
    const out: string[] = [];
    const parts = [
      bar,
      ...bar.querySelectorAll(
        'button, a[href], input, select, [role="button"], [role="switch"], [tabindex], [data-testid]',
      ),
    ];
    for (const el of parts) {
      if (el.closest('[data-testid="access-offline-notices"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
      out.push(`${id}: ${String(r.x)},${String(r.y)} ${String(r.width)}×${String(r.height)}`);
    }
    return out;
  });

/** The status bar once its parts have come (each as its store connects): the same at two looks a second apart. */
async function settledStatusBar(win: Page): Promise<string[]> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        const now = await statusBar(win);
        const same = JSON.stringify(now) === JSON.stringify(last);
        last = now;
        return same;
      },
      { message: 'the status bar settles', intervals: [1000] },
    )
    .toBe(true);
  return last;
}

/**
 * The line in the status bar, in place of the version and in its room (alpha.24): the version hidden while the line
 * shows, the line where the version was (`version`, its box before the line came) and no wider, its words the whole
 * line to a screen reader and in its tooltip, in its status region (read out as it comes).
 */
async function inTheVersionsPlace(win: Page, version: Place | null, what: string): Promise<void> {
  const slot = win.locator('footer[aria-label="Status"]').getByTestId('access-offline-notices');
  const line = slot.getByTestId('access-offline-notice');
  await expect(line, what).toBeVisible();
  await expect(slot, what).toHaveAttribute('role', 'status');
  // In sight the short words (lead 2's decision inside the owner's A); read out and in its tooltip the whole line.
  await expect(line.getByTestId('access-offline-short'), what).toHaveText(OFFLINE_SHORT_TEXT);
  // And the time left in sight after them (alpha.25 item 5, the delegate's words): "· 9 minutes" here, whole.
  await expect(line.getByTestId('access-offline-left'), what).toHaveText(/^ · \d+ (days?|hours?|minutes?)$/u);
  await expect(line.getByTestId('access-offline-left'), what).toHaveCSS(
    'font-variant-numeric',
    'tabular-nums',
  );
  await expect(slot.getByTestId('access-offline-words'), what).toHaveText(LINE);
  await expect(line, what).toHaveAttribute('title', LINE);
  await expect(win.getByTestId('app-info'), `${what}: the version hidden`).toBeHidden();
  expect(version, what).not.toBeNull();
  const box = await line.boundingBox();
  expect(box, what).not.toBeNull();
  const v = version ?? { x: 0, y: 0, width: 0, height: 0 };
  const b = box ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(b.x - v.x), `${what}: its left where the version’s was`).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(b.x + b.width - (v.x + v.width)),
    `${what}: its right where the version’s was`,
  ).toBeLessThanOrEqual(0.5);
}

/**
 * How far the first column starts from the top bar's bottom: 0 with nothing between them (alpha.24: the access line's
 * strip gone).
 */
const underTheTopBar = (win: Page) =>
  win.evaluate(() => {
    const header = document.querySelector('[data-header]')?.getBoundingClientRect();
    const column = document.querySelector('[data-testid="column-left"]')?.getBoundingClientRect();
    return header && column ? Math.abs(column.top - header.bottom) : Number.POSITIVE_INFINITY;
  });

/**
 * Three checks have reached the stand-in since `from`, which says nothing: two in a row have had no answer, and the
 * third is on its way.
 */
const twoMissed = async (list: AccessStandIn, from: number) => {
  await expect.poll(() => list.tries - from, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
};

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

test('no strip under the top bar (alpha.24, the owner’s QA24-ACCESS-STRIP A): at 1024 × 645 in the default look, the first column starts where the top bar ends, in Pro and in Simple Mode', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(FAST);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    // A slide up, as in a show (Simple Mode's first tips come only with none up, in a place of their own).
    await slideUp(win);
    await expect(win.getByTestId('live-text')).toContainText('slide 1 of');
    await expect
      .poll(() => underTheTopBar(win), {
        message: 'Pro Mode: the first column’s top, from the top bar’s bottom',
      })
      .toBeLessThanOrEqual(1);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect
      .poll(() => underTheTopBar(win), {
        message: 'Simple Mode: the first column’s top, from the top bar’s bottom',
      })
      .toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});

test('with no answer: no line at the first missed checks; after 2 minutes (12 s here) and three missed in a row, one line in the status bar in the owner’s words, in place of the version (alpha.24), nothing in the window or the status bar moving, over no control; gone when the list answers, the version back, nothing moving again', async () => {
  test.setTimeout(150_000);
  // "The hour" 10 minutes here, so the line says minutes.
  const { app, win, access: list } = await showing({ ...QUICK, DRASHTI_TEST_ACCESS_STOP_MS: '600000' });
  try {
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const line = win.getByTestId('access-offline-notice');
    // The line's place in the status bar, where the version is (a status region, so the line is read out as it
    // comes), is there before anything is missed, the version showing in it.
    const slot = win.locator('footer[aria-label="Status"]').getByTestId('access-offline-notices');
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('role', 'status');
    await expect(win.getByTestId('app-info')).toBeVisible();
    await expect(line).toHaveCount(0);
    // The viewport's column constraint must have committed before the unchanged Pro baseline.
    await expect(win.getByRole('separator', { name: 'Resize the playlists', exact: true })).toHaveAttribute(
      'aria-valuemax',
      '244',
    );
    const before = await layout(win);
    expect(before.length).toBeGreaterThan(5);
    const bar = await settledStatusBar(win);
    const version = await win.getByTestId('app-info').boundingBox();
    const tries = list.tries;
    stopAnswering(list);
    // Two checks missed (a third on its way): still nothing said, the show going on.
    await twoMissed(list, tries);
    await expect(line).toHaveCount(0);
    for (const what of ['library', 'screens'] as const)
      expect(await tryIt(win, what), what).not.toContain(STOPPED_REFUSAL);
    // 12 s with no answer: the line.
    await expect(line).toBeVisible({ timeout: 20_000 });
    const words = win.getByTestId('access-offline-words');
    await expect(words).toHaveText(LINE);
    await expect(words).toContainText(/for (9|10) minutes more/u);
    expect(await layout(win), 'nothing moved as the line came').toEqual(before);
    expect(await statusBar(win), 'nothing in the status bar moved as the line came').toEqual(bar);
    await inTheVersionsPlace(win, version, 'the line at 1024 × 645');
    await oneLineOverNothing(win, 'the line at 1024 × 645');
    await clearOfShowControls(win, line);
    await expectFits(slot, 'the line at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'the line at 1024 × 645');
    for (const what of ['library', 'screens'] as const)
      expect(await tryIt(win, what), what).not.toContain(STOPPED_REFUSAL);
    // A command still runs the show (Black-out on, then off again, as it was).
    for (let i = 0; i < 2; i++) expect(await tryIt(win, 'command')).not.toContain(STOPPED_REFUSAL);
    // The list answers again: the line goes, the version back, and still nothing has moved.
    answerAgain(list);
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    await expect(win.getByTestId('app-info')).toBeVisible();
    expect(await layout(win), 'nothing moved as the line went').toEqual(before);
    expect(await statusBar(win), 'nothing in the status bar moved as the line went').toEqual(bar);
  } finally {
    await app.close();
  }
});

test('the line’s words in sight in the status bar (alpha.24): whole, never cut short, at 1024 × 645 and 1410 × 900, in Pro and Simple Mode, the whole line in its tooltip', async () => {
  test.setTimeout(150_000);
  const { app, win, access: list } = await showing({ ...QUICK, DRASHTI_TEST_ACCESS_STOP_MS: '600000' });
  try {
    stopAnswering(list);
    const line = win.getByTestId('access-offline-notice');
    await expect(line).toBeVisible({ timeout: 30_000 });
    for (const mode of ['pro', 'simple'] as const) {
      if (mode === 'simple') {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
        await sizeOperatorWindow(app, win, size);
        await expect(line, where).toBeVisible();
        // Nothing in the status bar cut short, the line's words among them (fit.ts: Drashti's own words never end in
        // "…"), once the window has settled at this size.
        await expect
          .poll(async () => (await fitFaults(win, [])).filter((f) => f.startsWith('the status bar')), {
            message: `${where}: what does not fit in the status bar`,
          })
          .toEqual([]);
        // The words in sight whole, and saying what it is about.
        const shown = await line.evaluate((p) => {
          const words = p.querySelector('span:not(.sr-only)');
          const r = words?.getBoundingClientRect();
          const b = p.getBoundingClientRect();
          return words && r
            ? {
                text: words.textContent,
                cut:
                  words.scrollWidth > words.clientWidth + 1 ||
                  r.left < b.left - 0.5 ||
                  r.right > b.right + 0.5,
              }
            : null;
        });
        expect(shown, where).not.toBeNull();
        expect(shown?.cut, `${where}: the words in sight cut`).toBe(false);
        expect(shown?.text, where).toContain('access list');
        expect(shown?.text, where).toBe(`${OFFLINE_SHORT_TEXT} · 9 minutes`);
        // The whole line in its tooltip, wherever the mouse rests on it.
        await expect(line, where).toHaveAttribute('title', LINE);
      }
    }
  } finally {
    await app.close();
  }
});

test('with no answer for 15 days (30 s here), it stops as a revoke stops it, saying to ask for access again, the line said first; the list answering later opens nothing; started again, its lock screen says so with Request Access, and given access again it opens', async () => {
  test.setTimeout(180_000);
  const env = { ...QUICK, DRASHTI_TEST_ACCESS_BAR_MS: '6000', DRASHTI_TEST_ACCESS_STOP_MS: '30000' };
  const { app, win, userData, access: list } = await showing(env);
  const watch = closedWatch(app);
  try {
    stopAnswering(list);
    await expect(win.getByTestId('access-offline-words')).toHaveText(LINE, { timeout: 20_000 });
    await expectStopped(win, NO_CONTACT_STOP_TITLE, 40_000);
    const stopped = win.getByTestId('access-stopped');
    await expect(stopped).toHaveAttribute('data-reason', 'no-contact');
    await expect(stopped).toContainText(NO_CONTACT_STOP_TEXT);
    await expect(stopped).toContainText(NO_CONTACT_COME_BACK_TEXT);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await expectFits(stopped, 'the stop after 15 days at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'the stop after 15 days at 1024 × 645');
    // The list answering again later opens nothing.
    answerAgain(list);
    await holdStill(() => stopped.isVisible(), 8000, 'the list answering again opens nothing');
    await quitFromTheStop(watch, win);
  } finally {
    if (!watch.closed()) await app.close();
  }
  // The list's own 15 days pass with no check from this computer: its grant ends there too ("No contact for 15 days").
  moveListClock(list, 15 * DAY + HOUR, { quiet: [PLACEHOLDER_PERSON] });
  const again = await relaunchApp(userData, env);
  try {
    const lock = await lockPage(again.app);
    const reason = lock.getByTestId('access-reason');
    await expect(reason).toHaveAttribute('data-reason', 'no-contact', { timeout: 20_000 });
    await expect(reason).toContainText(LOCK_REASON_TEXT['no-contact']);
    // Request Access is there to ask again; Try Again would change nothing.
    await expect(lock.getByTestId('access-request')).toBeVisible();
    await expect(lock.getByTestId('access-retry')).toHaveCount(0);
    expect(list.list.sheet.find('Computers', 'Gmail', PLACEHOLDER_PERSON)).toMatchObject({
      'Why ended': 'no-contact',
    });
    await expectFits(lock.getByTestId('access-lock'), 'the lock screen after 15 days');
    await expectNoSeriousA11yIssues(lock, 'the lock screen after 15 days');
    // The owner gives access again: the new token lets this computer in.
    expect(ownerCall(list, 'regrant', { target: PLACEHOLDER_PERSON }).ok).toBe(true);
    const token = list.list.tokenFor(PLACEHOLDER_PERSON) ?? '';
    await lock.getByRole('tab', { name: 'I Have a Token' }).click();
    await lock.getByTestId('access-gmail').fill(PLACEHOLDER_PERSON);
    await lock.getByTestId('access-token').fill(token);
    await lock.getByTestId('access-redeem').click();
    await operatorReady(await operatorPage(again.app));
  } finally {
    await again.app.close();
  }
});

test('the line in days and hours: started with no internet 18 hours after an answer that let it in, Drashti opens at once and says it keeps working for 14 days 5 hours more', async () => {
  test.setTimeout(150_000);
  // The real 15 days (the other tests here make them shorter).
  const env = { ...QUICK, DRASHTI_TEST_ACCESS_BAR_MS: '6000', DRASHTI_TEST_ACCESS_STOP_MS: String(15 * DAY) };
  const first = await launchApp(env);
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const list = standInOf(first.userData);
  // Its last answer heard 18 hours ago (a check the list signed then), and no internet now.
  answerHeardAgo(first.userData, 18 * HOUR);
  stopAnswering(list);
  const { app } = await relaunchApp(first.userData, env);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(app.windows().filter((w) => w.url().includes('lock.html'))).toEqual([]);
    const line = win.getByTestId('access-offline-words');
    await expect(line).toHaveText(
      'Can’t reach the access list: Drashti keeps working for 14 days 5 hours more.',
      { timeout: 30_000 },
    );
    // In sight, the days left (alpha.25 item 5): rounded down.
    await expect(win.getByTestId('access-offline-left')).toHaveText(' · 14 days');
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await oneLineOverNothing(win, 'the line in days and hours at 1024 × 645');
  } finally {
    await app.close();
  }
});

test('the line in Simple Mode, in CI’s window: in its status bar in place of the version (alpha.24), nothing moving, over none of its big buttons, fitting, passing the accessibility checks, the show going on', async () => {
  test.setTimeout(150_000);
  const { app, win, access: list } = await showing({ ...QUICK, DRASHTI_TEST_ACCESS_STOP_MS: '600000' });
  // Numeric resize diagnostics only: never attach a DOM/storage dump or any access data.
  const attachLayoutNumbers = async (name: string) => {
    const facts = await win.evaluate(() => {
      const number = (raw: string | null): number | null => {
        if (raw === null || raw.trim() === '') return null;
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : null;
      };
      const box = (element: Element | null) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const column = (side: string) => {
        const element = document.querySelector<HTMLElement>(`[data-testid="column-${side}"]`);
        return { rect: box(element), inlineWidth: number(element?.style.width ?? null) };
      };
      const separator = (label: string) => {
        const element = document.querySelector(`[role="separator"][aria-label="${label}"]`);
        return {
          now: number(element?.getAttribute('aria-valuenow') ?? null),
          max: number(element?.getAttribute('aria-valuemax') ?? null),
        };
      };
      const preference = (side: 'left' | 'right'): number | 'absent' => {
        try {
          const raw = localStorage.getItem(`drashti.ui.layout.${side}`);
          if (raw === null) return 'absent';
          const value: unknown = JSON.parse(raw);
          return typeof value === 'number' && Number.isFinite(value) ? value : 'absent';
        } catch {
          return 'absent';
        }
      };
      return {
        timestampMs: Date.now(),
        monotonicMs: performance.now(),
        viewport: {
          innerWidth,
          innerHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
        },
        columns: { left: column('left'), middle: column('middle'), right: column('right') },
        separators: {
          left: separator('Resize the playlists'),
          right: separator('Resize the live column'),
        },
        persisted: { left: preference('left'), right: preference('right') },
        warningPresent: document.querySelector('[data-testid="access-offline-notice"]') !== null,
      };
    });
    await test.info().attach(name, { body: JSON.stringify(facts, null, 2), contentType: 'application/json' });
  };
  try {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const slot = win.locator('footer[aria-label="Status"]').getByTestId('access-offline-notices');
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('role', 'status');
    await expect(win.getByTestId('app-info')).toBeVisible();
    // The viewport is set: its column constraint must have committed before the unchanged baseline.
    await expect(
      simple.getByRole('separator', { name: 'Resize the playlists', exact: true }),
    ).toHaveAttribute('aria-valuemax', '244');
    const before = await layout(win);
    await attachLayoutNumbers('simple-layout-baseline-captured');
    expect(before.length).toBeGreaterThan(3);
    const bar = await settledStatusBar(win);
    const version = await win.getByTestId('app-info').boundingBox();
    const tries = list.tries;
    stopAnswering(list);
    const line = win.getByTestId('access-offline-notice');
    await twoMissed(list, tries);
    await expect(line).toHaveCount(0);
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('access-offline-words')).toHaveText(LINE);
    // In Simple Mode's status bar, in place of the version: nothing moved, over none of its big buttons.
    await expect(simple).toBeVisible();
    try {
      expect(await layout(win), 'nothing moved as the line came').toEqual(before);
    } catch (error) {
      try {
        await attachLayoutNumbers('simple-layout-warning-comparison-failed');
      } catch {
        // Preserve the original layout failure even if the diagnostic attachment cannot be collected.
      }
      throw error;
    }
    expect(await statusBar(win), 'nothing in the status bar moved as the line came').toEqual(bar);
    await inTheVersionsPlace(win, version, 'the line in Simple Mode at 1024 × 645');
    await oneLineOverNothing(win, 'the line in Simple Mode at 1024 × 645');
    await clearOfShowControls(win, line);
    await expectFits(slot, 'the line in Simple Mode at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'the line in Simple Mode at 1024 × 645');
    // The show goes on under it: Simple Mode's own Black-out button still works.
    const blackout = simple.getByTestId('simple-blackout');
    await blackout.click();
    await expect(blackout).toContainText('Black-out is on');
    await blackout.click();
    await expect(blackout).not.toContainText('Black-out is on');
    // The list answers again: the line goes, the version back, and Simple Mode is as it was.
    answerAgain(list);
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    await expect(win.getByTestId('app-info')).toBeVisible();
    expect(await layout(win), 'nothing moved as the line went').toEqual(before);
    expect(await statusBar(win), 'nothing in the status bar moved as the line went').toEqual(bar);
  } finally {
    await app.close();
  }
});

test('the network coming back: the list asked at once, a check waiting on the old network given up, so the line goes within seconds rather than at that check’s end (60 s here)', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-access-network-'));
  // The network as Drashti sees it: a file here (a test switch), as the computer's own would say it.
  const network = join(dir, 'network.txt');
  writeFileSync(network, 'online 192.0.2.10\n');
  const {
    app,
    userData,
    access: list,
  } = await launchApp({
    DRASHTI_TEST_ACCESS_CHECK_MS: '2000',
    // A check waits up to a minute for its answer, as one sent on a network with no internet behind it can.
    DRASHTI_TEST_ACCESS_TIMEOUT_MS: '60000',
    DRASHTI_TEST_ACCESS_BAR_MS: '6000',
    DRASHTI_TEST_ACCESS_STOP_MS: '600000',
    DRASHTI_TEST_NETWORK_FILE: network,
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const line = win.getByTestId('access-offline-notice');
    // The list unreachable (each check refused at once): the line.
    list.mode = 'error';
    await expect(line).toBeVisible({ timeout: 20_000 });
    // The computer's network goes; the next check is sent and waits, with nothing to answer it.
    writeFileSync(network, 'offline\n');
    await letTimePass(win, 2500, 'the network seen gone (it is looked at every 2 s)');
    list.mode = 'silent';
    const waiting = list.tries;
    await expect.poll(() => list.tries, { timeout: 10_000 }).toBeGreaterThan(waiting);
    // The computer joins a hotspot, and the list can answer: the line goes within seconds.
    answerAgain(list);
    const back = Date.now();
    writeFileSync(network, 'online 172.20.10.2\n');
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    expect(Date.now() - back).toBeLessThan(15_000);
    // Said in Drashti's own log: the network back, the waiting check given up, and the list asked again.
    const log = logText(userData);
    expect(log).toContain('Access: the network came back');
    expect(log).toMatch(/Access: check \d+: no answer \(network: Given up/u);
  } finally {
    await app.close();
  }
});

test('started again with no internet within the 15 days of an answer that let it in: Drashti opens at once, with no lock window and no wait, and says so in one line once three checks in a row had no answer', async () => {
  test.setTimeout(150_000);
  const env = { ...QUICK, DRASHTI_TEST_ACCESS_BAR_MS: '6000', DRASHTI_TEST_ACCESS_STOP_MS: '600000' };
  const first = await launchApp(env);
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const list = standInOf(first.userData);
  // Nothing answers at all, as with no internet: each check waits until its time is up.
  stopAnswering(list);
  const { app } = await relaunchApp(first.userData, env);
  const windows: string[] = [];
  app.on('window', (page) => windows.push(page.url()));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // Open at once: never the lock window ("Checking this computer’s access…").
    expect(app.windows().filter((w) => w.url().includes('lock.html'))).toEqual([]);
    expect(windows.filter((u) => u.includes('lock.html'))).toEqual([]);
    expect(await tryIt(win, 'library')).not.toContain(STOPPED_REFUSAL);
    const line = win.getByTestId('access-offline-notice');
    await expect(win.getByTestId('access-offline-words')).toHaveText(LINE, { timeout: 30_000 });
    // The list answers again: the line goes.
    answerAgain(list);
    await expect(line).toHaveCount(0, { timeout: 20_000 });
    expect(windows.filter((u) => u.includes('lock.html'))).toEqual([]);
  } finally {
    await app.close();
  }
});

test('started again within the 15 days after a revoke: Drashti opens at once, and stops at the list’s first answer', async () => {
  test.setTimeout(120_000);
  // Keep the cached allowance valid for the restart even if CI takes a while to close and relaunch Main.
  const grace = { ...FAST, DRASHTI_TEST_ACCESS_STOP_MS: String(10 * 60_000) };
  const first = await launchApp(grace);
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const list = standInOf(first.userData);
  revoke(list, PLACEHOLDER_PERSON);
  const { app } = await relaunchApp(first.userData, grace);
  const watch = closedWatch(app);
  try {
    // Open at once, then the list's answer (revoked) stops everything: only Quit works.
    const win = await operatorPage(app);
    await expectStopped(win, ACCESS_REMOVED_TEXT);
    await expect(win.getByTestId('access-stopped')).toHaveAttribute('data-reason', 'revoked');
    expect(app.windows().filter((w) => w.url().includes('lock.html'))).toEqual([]);
    await quitFromTheStop(watch, win);
  } finally {
    if (!watch.closed()) await app.close();
  }
});

test('started with no internet after the 15 days (20 s here), Drashti does not open: its lock screen says to ask for access again; still let in by the list, it opens by itself once the list answers', async () => {
  test.setTimeout(150_000);
  const first = await launchApp(FAST);
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const list = standInOf(first.userData);
  stopAnswering(list);
  // "The 15 days" (20 s here) pass, Drashti closed: nothing asks the list meanwhile.
  const asked = list.calls.length;
  await holdStill(() => list.calls.length === asked, 21_000, 'Drashti closed asks the list nothing');
  const { app } = await relaunchApp(first.userData, FAST);
  try {
    const lock = await lockPage(app);
    await expect(lock.getByTestId('access-reason')).toHaveAttribute('data-reason', 'no-contact', {
      timeout: 20_000,
    });
    await expect(lock.getByTestId('access-reason')).toContainText(LOCK_REASON_TEXT['no-contact']);
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    await expectFits(lock.getByTestId('access-lock'), 'the lock screen after 15 days with no answer');
    await expectNoSeriousA11yIssues(lock, 'the lock screen after 15 days with no answer');
    // Still no answer: still not open (it asks by itself every 6 s here).
    await letTimePass(lock, 7000, 'a try with no answer');
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    // The list answers, and its own 15 days are not up: it lets this computer in, and Drashti opens by itself.
    answerAgain(list);
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
      // Open at once (Session 55: let in moments ago), the operator window with no lock screen asking anything first,
      // and its check, in the background, answered as any other.
      await operatorReady(await operatorPage(app));
      expect(app.windows().filter((w) => w.url().includes('lock.html'))).toEqual([]);
      await expect.poll(() => list.calls.filter((c) => c === 'check').length).toBeGreaterThan(checks);
      expect(refusals).toEqual([]);
    } finally {
      await app.close();
    }
  } finally {
    list.tamper = null;
    release();
  }
});

test('a test Drashti whose first check gets no answer says so in the test’s output, from its own log (question 36)', async () => {
  test.setTimeout(120_000);
  // The list there, but answering each call with an error page: the first check gets no answer.
  const list = await newStandIn();
  list.mode = 'error';
  const said: string[] = [];
  const log = console.log;
  console.log = (...words: unknown[]) => {
    said.push(words.map(String).join(' '));
    log(...words);
  };
  try {
    const { app, userData } = await launchApp(FAST, undefined, { standIn: list });
    try {
      // Not let in yet: the lock window, saying there was no answer.
      const lock = await lockPage(app);
      await expect(lock.getByTestId('access-reason')).toHaveAttribute('data-reason', 'no-answer', {
        timeout: 20_000,
      });
      await expect
        .poll(() => said.filter((l) => l.startsWith('Access at start: ')), { timeout: 10_000 })
        .toEqual([
          expect.stringMatching(
            /^Access at start: this Drashti’s first check got no answer \(http: The list answered HTTP 503\.; \d+ ms\)$/u,
          ) as unknown as string,
        ]);
      // Its own log says each check, what came of it and how long it took, and nothing it sent.
      expect(logText(userData)).toMatch(
        /Access: check 1: no answer \(http: The list answered HTTP 503\.; \d+ ms\)/u,
      );
      // The list answers: Try Again lets it in, and the log says so too.
      answerAgain(list);
      await lock.getByTestId('access-retry').click();
      await operatorReady(await operatorPage(app));
      expect(logText(userData)).toMatch(/Access: check \d+: let in \(\d+ ms\)/u);
      // Said once, for the first check only.
      expect(said.filter((l) => l.startsWith('Access at start: '))).toHaveLength(1);
    } finally {
      await app.close();
    }
  } finally {
    console.log = log;
    await list.close();
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

test('with no internet the stream and the recording go on, until the 15 days (45 s here) are up', async () => {
  test.setTimeout(180_000);
  const ffmpeg = testFfmpeg();
  // CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
  test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-access-offline-stream-'));
  // FFmpeg on this computer stands in for YouTube; the stream's key is made up (stream-helpers.ts).
  const received = join(dir, 'received.flv');
  const farEnd = rtmpListener(ffmpeg ?? '', port, received);
  const {
    app,
    userData,
    access: list,
  } = await launchApp({
    ...FAST,
    DRASHTI_TEST_ACCESS_STOP_MS: '45000',
    // The line once three checks in a row have had no answer (about 20 s here), whatever the time since the last answer.
    DRASHTI_TEST_ACCESS_BAR_MS: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
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
    const recorded = () =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.mkv'))
        .reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    stopAnswering(list);
    await expect(win.getByTestId('access-offline-notice')).toBeVisible({ timeout: 30_000 });
    // Two checks more with no answer: still on air and recording, both still growing.
    const before = { sent: statSync(received).size, kept: recorded() };
    await letTimePass(win, 13_000, 'two checks with no answer (every 6 s here)');
    const s = await status();
    expect(s.live.state).toBe('live');
    expect(s.recording.state).toBe('recording');
    expect(statSync(received).size).toBeGreaterThan(before.sent);
    expect(recorded()).toBeGreaterThan(before.kept);
    // The 15 days up: the stop, the stream and the recording ended.
    await expectStopped(win, NO_CONTACT_STOP_TITLE, 60_000);
    const kept = () =>
      JSON.parse(readFileSync(join(userData, 'stream-state.json'), 'utf8')) as {
        live: boolean;
        recording: boolean;
      };
    await expect.poll(kept, { timeout: 10_000 }).toMatchObject({ live: false, recording: false });
    await quitFromTheStop(watch, win);
  } finally {
    farEnd.kill('SIGKILL');
    if (!watch.closed()) await app.close();
  }
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
