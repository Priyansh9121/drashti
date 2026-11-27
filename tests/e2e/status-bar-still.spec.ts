import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { answerAgain, stopAnswering } from './access';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The status bar's own controls hold still (alpha.24, lead 2's statusbar; alpha.25 list items 17, 34, 41, 11, 5, 48).
 * Its steady controls come first, in their order: the screens' summary (its words in a held slot), Sound, the
 * calendar and Help (with its ?'s room held); what comes and goes follows them (Audience off and Stage off with Turn
 * on, the warnings, what is muted, the captions' warning), then the passing news, the screens' line and the version's
 * place. So none of the steady ones moves, to the hundredth of a pixel, as anything comes or goes: Stage off going as
 * Stage goes on (until alpha.24 Sound and Help moved 162.66 px), Audience off coming (183.52 px), Stage's line, a kind
 * muted, Help on and off, "No access list" coming and going; in Pro and Simple Mode, at CI's 1024 × 645 and at
 * 1410 × 900. And every control in the bar is a 24 px target at least, its focus ring whole inside the window (the
 * bar's 24 px controls lost the ring's bottom 2.5 px to the window's edge). Placeholder words only.
 */

/** Stage off at the start, as an installed Drashti starts (stage-switch.spec.ts), and no display set to Stage. */
const STAGE_OFF = { DRASHTI_TEST_STAGE_AT_START: '' };

/** Checks every 2 s, each given 1 s, the access line after 12 s with no answer; its 10 minutes here. */
const QUICK = {
  DRASHTI_TEST_ACCESS_CHECK_MS: '2000',
  DRASHTI_TEST_ACCESS_TIMEOUT_MS: '1000',
  DRASHTI_TEST_ACCESS_BAR_MS: '12000',
  DRASHTI_TEST_ACCESS_STOP_MS: '600000',
};

const WIDE = { width: 1410, height: 900 } as const;

/** The bar's steady controls, by their test ids: none may move as anything else in the bar comes or goes. */
const STEADY = ['screens-summary', 'sound-status', 'sound-warning', 'today-calendar', 'help-toggle'];

const footer = (win: Page) => win.locator('footer[aria-label="Status"]');
const said = (win: Page) => win.getByTestId('screens-said');

/** Where each steady control is, to the hundredth of a pixel. */
const steadyParts = (win: Page) =>
  win.evaluate((ids) => {
    const bar = document.querySelector('footer[aria-label="Status"]');
    if (!bar) return ['no status bar'];
    const out: string[] = [];
    for (const id of ids) {
      const el = bar.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out.push(`${id}: ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`);
    }
    return out;
  }, STEADY);

/** Every control in the bar but the bar's own ?, to the hundredth of a pixel (Help on and off moves none of them). */
const barControls = (win: Page) =>
  win.evaluate(() => {
    const bar = document.querySelector('footer[aria-label="Status"]');
    if (!bar) return ['no status bar'];
    const out: string[] = [];
    for (const el of bar.querySelectorAll('button')) {
      if (el.hasAttribute('data-what-is-this')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent.trim();
      out.push(`${id}: ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`);
    }
    return out;
  });

/** The same at two looks a second apart: the bar once its parts have come (each as its store connects). */
async function settled(read: () => Promise<string[]>, what: string): Promise<string[]> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        const now = await read();
        const same = now.length > 0 && JSON.stringify(now) === JSON.stringify(last);
        last = now;
        return same;
      },
      { message: `${what}: the status bar settles`, intervals: [1000] },
    )
    .toBe(true);
  return last;
}

/** Audience or Stage turned, from Pro Mode in Simple Mode (Simple Mode only turns the screens on). */
async function turn(win: Page, mode: 'pro' | 'simple', which: 'audience' | 'stage', on: boolean): Promise<void> {
  const viaPro = mode === 'simple' && !on;
  if (viaPro) {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  }
  const turned = await win.evaluate(
    ([w, o]) => (globalThis as PageGlobals).drashti.screenSwitches.turn(w, o),
    [which, on] as const,
  );
  expect(turned.ok).toBe(true);
  if (viaPro) {
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
  }
  await expect(win.getByTestId(`switch-off-${which}`)).toHaveCount(on ? 0 : 1);
}

/** What comes and goes in the bar, each with how to see it has: in the order the operator meets them. */
const ACTS: { what: string; act: (win: Page, mode: 'pro' | 'simple') => Promise<void> }[] = [
  {
    what: 'Stage on with no Stage screen (Stage off goes, Stage’s line comes)',
    act: async (win, mode) => {
      await turn(win, mode, 'stage', true);
      await expect(said(win)).toHaveAttribute('data-kind', 'no-stage');
    },
  },
  {
    what: 'Stage’s line dismissed',
    act: async (win) => {
      await said(win).getByRole('button', { name: 'Dismiss' }).click();
      await expect(said(win)).toHaveCount(0);
    },
  },
  { what: 'Audience off', act: (win, mode) => turn(win, mode, 'audience', false) },
  { what: 'Audience on', act: (win, mode) => turn(win, mode, 'audience', true) },
  {
    what: 'Audio muted',
    act: async (win) => {
      await win.evaluate(() => (globalThis as PageGlobals).drashti.sound.setMuted('audio', true));
      await expect(win.getByTestId('sound-muted-status')).toHaveText('Audio muted');
    },
  },
  {
    what: 'Audio on again',
    act: async (win) => {
      await win.evaluate(() => (globalThis as PageGlobals).drashti.sound.setMuted('audio', false));
      await expect(win.getByTestId('sound-muted-status')).toHaveText('');
    },
  },
  {
    what: 'Stage off again',
    act: async (win, mode) => {
      await turn(win, mode, 'stage', false);
      await expect(said(win)).toHaveCount(0);
    },
  },
];

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645 and 1410 × 900: the status bar’s screens summary, Sound, calendar and Help hold still to the hundredth of a pixel as Stage off, Audience off, Stage’s line, a kind muted, Help and “No access list” come and go`, async () => {
    test.setTimeout(240_000);
    const { app, access: list } = await launchApp({ ...STAGE_OFF, ...QUICK });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      if (mode === 'simple') {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      await expect(win.getByTestId('switch-off-stage')).toHaveCount(1);
      for (const size of [CI_WINDOW, WIDE]) {
        await sizeOperatorWindow(app, win, size);
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
        const first = await settled(() => steadyParts(win), where);
        expect(first.map((p) => p.split(':')[0]), where).toEqual(
          expect.arrayContaining(['screens-summary', 'sound-status', 'help-toggle']),
        );
        for (const { what, act } of ACTS) {
          await act(win, mode);
          expect(await settled(() => steadyParts(win), `${where}, ${what}`), `${where}, ${what}`).toEqual(first);
        }
        // Help on and off: no control in the bar moves (the bar's ?, Pro Mode's from 1280 px wide, comes in its room).
        const controls = await settled(() => barControls(win), `${where}, Help off`);
        const help = win.getByTestId('help-toggle');
        for (const pressed of ['true', 'false']) {
          await help.dispatchEvent('click');
          await expect(help).toHaveAttribute('aria-pressed', pressed);
          const what = `${where}, Help ${pressed === 'true' ? 'on' : 'off'}`;
          expect(await settled(() => barControls(win), what), what).toEqual(controls);
          expect(await steadyParts(win), what).toEqual(first);
        }
      }
      // "No access list" coming and going (in the version's room): at 1410 × 900, then at 1024 × 645.
      for (const size of [WIDE, CI_WINDOW]) {
        await sizeOperatorWindow(app, win, size);
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
        const first = await settled(() => barControls(win), where);
        const steady = await steadyParts(win);
        stopAnswering(list);
        await expect(win.getByTestId('access-offline-notice'), where).toBeVisible({ timeout: 30_000 });
        expect(await settled(() => barControls(win), `${where}, No access list`), where).toEqual(first);
        expect(await steadyParts(win), where).toEqual(steady);
        answerAgain(list);
        await expect(win.getByTestId('access-offline-notice'), where).toHaveCount(0, { timeout: 30_000 });
        expect(await settled(() => barControls(win), `${where}, the list answers`), where).toEqual(first);
      }
    } finally {
      await app.close();
    }
  });

/**
 * Each control in the bar: whether it is a 24 px target at least (WCAG 2.5.8), and whether its focus ring, where the
 * keyboard is on it, is whole inside the window and inside every part that clips it.
 */
const ringAndTarget = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.closest('footer[aria-label="Status"]')) return null;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const out = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
    const ring = { left: r.left - out, top: r.top - out, right: r.right + out, bottom: r.bottom + out };
    const problems: string[] = [];
    if (r.width < 24 - 0.01 || r.height < 24 - 0.01)
      problems.push(`${r.width.toFixed(1)} × ${r.height.toFixed(1)}, under 24 px`);
    if (!el.matches(':focus-visible') || style.outlineStyle === 'none') problems.push('no ring');
    const cut = (what: string, box: { left: number; top: number; right: number; bottom: number }) => {
      const sides = [
        ['top', box.top - ring.top],
        ['bottom', ring.bottom - box.bottom],
        ['left', box.left - ring.left],
        ['right', ring.right - box.right],
      ] as const;
      for (const [side, by] of sides)
        if (by > 0.01) problems.push(`its ring cut ${by.toFixed(1)} px at the ${side} by ${what}`);
    };
    cut('the window', { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      cut(p.getAttribute('data-testid') ?? p.tagName.toLowerCase(), p.getBoundingClientRect());
    }
    const name = (el.getAttribute('aria-label') ?? el.textContent).trim().replace(/\s+/gu, ' ').slice(0, 40);
    return { name: el.dataset['testid'] ?? name, problems };
  });

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645 and 1410 × 900, Help on, Stage off and Stage’s line: every control in the status bar a 24 px target, its focus ring whole inside the window`, async () => {
    test.setTimeout(150_000);
    const { app } = await launchApp(STAGE_OFF);
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      if (mode === 'simple') {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      const help = win.getByTestId('help-toggle');
      await help.dispatchEvent('click');
      await expect(help).toHaveAttribute('aria-pressed', 'true');
      // Stage's line, then Stage off beside it (Audience off): Turn on, Set up Stage screen… and the X all in the bar.
      await turn(win, mode, 'stage', true);
      await expect(said(win)).toHaveAttribute('data-kind', 'no-stage');
      await turn(win, mode, 'audience', false);
      for (const size of [CI_WINDOW, WIDE]) {
        await sizeOperatorWindow(app, win, size);
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${String(size.width)} × ${String(size.height)}`;
        await expect(footer(win).getByTestId('screens-summary'), where).toBeVisible();
        // From the bar's first control by the keyboard, every stop in the bar.
        await win.getByTestId('screens-summary').focus();
        await win.keyboard.press('Shift+Tab');
        await win.keyboard.press('Tab');
        const seen: string[] = [];
        const problems: string[] = [];
        for (let i = 0; i < 20; i++) {
          const at = await ringAndTarget(win);
          if (at === null) break;
          seen.push(at.name);
          for (const p of at.problems) problems.push(`${at.name}: ${p}`);
          await win.keyboard.press('Tab');
        }
        expect(seen, where).toEqual(expect.arrayContaining(['screens-summary', 'help-toggle', 'Dismiss']));
        if (mode === 'pro') expect(seen, where).toContain('Turn on Audience');
        if (mode === 'pro' && size === WIDE) expect(seen, where).toContain('what-is-this-statusbar');
        expect(problems, `${where}: the bar's controls' targets and focus rings`).toEqual([]);
      }
    } finally {
      await app.close();
    }
  });

/**
 * The screens' line's action buttons describe what they do to a screen reader (alpha.25 item 48): their tooltips'
 * words had reached the eye only.
 */
test('Pro Mode: Set up Stage screen… says what it does as its description, its name unchanged', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp(STAGE_OFF);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await turn(win, 'pro', 'stage', true);
    const button = said(win).getByTestId('screens-said-set-up-stage');
    await expect(button).toHaveAccessibleName('Set up Stage screen…');
    await expect(button).toHaveAttribute('aria-description', 'Opens Screens, to give a display the Stage job.');
  } finally {
    await app.close();
  }
});
