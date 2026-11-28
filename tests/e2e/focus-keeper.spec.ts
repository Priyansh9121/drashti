import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { helpOn } from './help';
import { launchApp, openAllSections, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Where the keyboard goes when the control it pressed goes away (alpha.24, lead 2's focus piece; alpha.25 list items
 * 18 and 35, the joined-tree access hands-on's S2 BASE): a Pro Mode lit clear that can no longer be pressed, Close the
 * playlist, the status bar's Turn on Stage, the screens line's X and its Set up Stage screen… (Screens, then Esc), and
 * the Simple/Pro switch by Enter twice. Until alpha.24 the keyboard fell to the window's body every time, so a screen
 * reader said nothing and the next Tab began again from the top of the window. Now it stays in the part of the window it
 * was in (ui/focus-keeper.ts), never on a show control or a field (Enter there presses nothing; Space and the arrows
 * still run the show). And item 11: a control Tab reaches at the edge of LIVE's scroller has its whole focus ring in
 * sight (it was cut by 3-4 px at the scroller's foot).
 */

/** Stage off at the start, as an installed Drashti starts (stage-switch.spec.ts), and no display set to Stage. */
const STAGE_OFF = { DRASHTI_TEST_STAGE_AT_START: '' };

/** Where the keyboard is: the window's body, or the landmark or group it is in (its label, or its kind). */
const keyboardAt = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return 'BODY';
    const place = el.closest(
      '[role="group"][aria-label], header, footer, main, aside, nav, section[aria-label], [role="dialog"]',
    );
    if (!place) return 'outside any landmark';
    return place.getAttribute('aria-label') ?? place.tagName.toLowerCase();
  });

/** What the keyboard is on: its tag and test id, and whether it is a show control or a field. */
const keyboardOn = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return 'BODY';
    const kind = el.hasAttribute('data-show-control')
      ? ' (a show control)'
      : el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
        ? ' (a field)'
        : '';
    return `${el.tagName.toLowerCase()}${el.dataset['testid'] ? `#${el.dataset['testid']}` : ''}${kind}`;
  });

/** What the show has up (the engine's own word). */
const showState = (win: Page) =>
  win.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return {
      slide: s.layers.slide ? `${s.layers.slide.presentationId} #${String(s.layers.slide.slideIndex)}` : '',
      blackout: s.blackout,
      wallpaper: s.wallpaper,
    };
  });

/** The placeholder presentation's first slide up, as in a show. */
const slideUp = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    if (!p) throw new Error('no placeholder presentation');
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 0 });
  });

test('Pro Mode at 1024 × 645: Enter on a lit clear (it can then no longer be pressed) leaves the keyboard in the show controls, never on the window’s body, and on no show control: Enter again does nothing, and the next Tab goes on from there', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await slideUp(win);
    const clear = win.getByRole('button', { name: 'Clear slide (on screen)' });
    await clear.focus();
    await win.keyboard.press('Enter');
    await expect.poll(async () => (await showState(win)).slide).toBe('');
    await expect(win.getByRole('button', { name: 'Clear slide', exact: true })).toBeDisabled();
    await expect.poll(() => keyboardAt(win), { message: 'where the keyboard went' }).toBe('Clear one layer');
    expect(await keyboardOn(win), 'never on a show control or a field').not.toMatch(
      /BODY|show control|field/u,
    );
    // Enter there presses nothing (a show control beside it would have been pressed).
    const before = await showState(win);
    await win.keyboard.press('Enter');
    expect(await showState(win), 'Enter where the keyboard was kept').toEqual(before);
    // The next Tab goes on in the show controls (from the window's body it began again at the top bar).
    await win.keyboard.press('Tab');
    await expect.poll(() => keyboardAt(win), { message: 'the next Tab' }).toBe('Show controls');
  } finally {
    await app.close();
  }
});

test('Pro Mode: Close the playlist from the keyboard leaves the keyboard in the middle (Playlist and slides), never on the window’s body', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpPlaceholderShow(win, { video: false });
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
    await win.getByTestId('playlist-close').focus();
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('playlist-close')).toHaveCount(0);
    await expect
      .poll(() => keyboardAt(win), { message: 'where the keyboard went' })
      .toBe('Playlist and slides');
    expect(await keyboardOn(win)).not.toMatch(/BODY|show control|field/u);
  } finally {
    await app.close();
  }
});

test('Pro Mode, Stage on with no Stage screen: the status bar’s Turn on Stage, the screens line’s Set up Stage screen… (Screens, then Esc) and its X each leave the keyboard in the status bar, never on the window’s body', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp(STAGE_OFF);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await slideUp(win);
    const line = win.locator('[data-testid="screens-said"][data-kind="no-stage"]');
    const turnOn = win.getByTestId('switch-off-stage').getByRole('button', { name: 'Turn on Stage' });
    // Turn on Stage: it goes as Stage comes on.
    await turnOn.focus();
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('switch-off-stage')).toHaveCount(0);
    await expect(line).toHaveCount(1);
    await expect.poll(() => keyboardAt(win), { message: 'after Turn on Stage' }).toBe('Status');
    expect(await keyboardOn(win)).not.toMatch(/BODY|show control|field/u);
    // Set up Stage screen…: the line goes as Screens opens; Esc closes Screens, and the keyboard comes back to the
    // status bar, where what opened it was (item 18).
    await line.getByTestId('screens-said-set-up-stage').focus();
    await win.keyboard.press('Enter');
    const screens = win.getByRole('dialog', { name: 'Screens' });
    await expect(screens).toBeVisible();
    await expect(line).toHaveCount(0);
    await win.keyboard.press('Escape');
    await expect(screens).toHaveCount(0);
    await expect.poll(() => keyboardAt(win), { message: 'after Screens closed' }).toBe('Status');
    expect(await keyboardOn(win)).not.toMatch(/BODY|show control|field/u);
    // Stage off and on again: the line again; its X closes it.
    const off = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.screenSwitches.turn('stage', false),
    );
    expect(off.ok).toBe(true);
    await expect(win.getByTestId('switch-off-stage')).toHaveCount(1);
    await turnOn.click();
    await expect(line).toHaveCount(1);
    await line.getByRole('button', { name: 'Dismiss' }).focus();
    await win.keyboard.press('Enter');
    await expect(line).toHaveCount(0);
    await expect.poll(() => keyboardAt(win), { message: 'after the X' }).toBe('Status');
    expect(await keyboardOn(win)).not.toMatch(/BODY|show control|field/u);
  } finally {
    await app.close();
  }
});

test('Simple Mode by Enter twice on its switch, and Pro Mode again by Enter twice on Simple Mode’s: the keyboard stays in the window’s header, never on its body', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.locator('header[data-header]').getByRole('button', { name: 'Simple Mode' }).focus();
    await win.keyboard.press('Enter');
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect.poll(() => keyboardAt(win), { message: 'in Simple Mode' }).toBe('header');
    expect(
      await win.evaluate(() => document.activeElement?.closest('[data-testid="simple-mode"]') !== null),
    ).toBe(true);
    await win.getByTestId('simple-leave').focus();
    await win.keyboard.press('Enter');
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('simple-mode')).toHaveCount(0);
    await expect.poll(() => keyboardAt(win), { message: 'in Pro Mode again' }).toBe('header');
  } finally {
    await app.close();
  }
});

/**
 * Where the focused control's ring is cut (item 11): by each part around it that clips what it holds (its overflow not
 * visible) or by the window, by more than half a pixel; with its name, and whether it is in LIVE's column.
 */
const ringCut = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const style = getComputedStyle(el);
    const width = style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth);
    const out = width + (Number.parseFloat(style.outlineOffset) || 0);
    const r = el.getBoundingClientRect();
    const ring = { top: r.top - out, bottom: r.bottom + out, left: r.left - out, right: r.right + out };
    const cuts: string[] = [];
    const cutBy = (box: { top: number; bottom: number; left: number; right: number }) =>
      Math.max(box.top - ring.top, ring.bottom - box.bottom, box.left - ring.left, ring.right - box.right);
    for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const b = at.getBoundingClientRect();
      const top = b.top + at.clientTop;
      const left = b.left + at.clientLeft;
      const by = cutBy({ top, left, bottom: top + at.clientHeight, right: left + at.clientWidth });
      if (by > 0.5) cuts.push(`${at.dataset['testid'] ?? at.tagName.toLowerCase()} ${by.toFixed(1)} px`);
    }
    const window = cutBy({ top: 0, left: 0, bottom: innerHeight, right: innerWidth });
    if (window > 0.5) cuts.push(`the window ${window.toFixed(1)} px`);
    const shown = el.cloneNode(true) as HTMLElement;
    for (const hidden of shown.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    const name = (el.getAttribute('aria-label') ?? shown.textContent)
      .trim()
      .replace(/\s+/gu, ' ')
      .slice(0, 50);
    return { name, live: el.closest('aside[aria-label="Live"]') !== null, ring: width >= 2, cuts };
  });

for (const help of [false, true])
  test(`Pro Mode${help ? ' with Help on' : ''}, every LIVE section open, at 1024 × 645 and 1410 × 900: no control Tab reaches in LIVE’s column has its focus ring cut (item 11: by its scroller’s edge)`, async () => {
    test.setTimeout(150_000);
    const { app } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await setUpPlaceholderShow(win, { video: false });
      await openAllSections(win);
      if (help) await helpOn(win);
      for (const size of [CI_WINDOW, { width: 1410, height: 900 }]) {
        await sizeOperatorWindow(app, win, size);
        const where = `${String(size.width)} × ${String(size.height)}`;
        // From the top of LIVE's column, scrolled back up, Tab by Tab until the keyboard leaves it.
        await win.evaluate(() => {
          const live = document.querySelector('aside[aria-label="Live"]');
          for (const part of [
            live,
            ...(live?.querySelectorAll('[data-testid="live-scroll"], [data-testid="live-rest"]') ?? []),
          ])
            if (part instanceof HTMLElement) part.scrollTop = 0;
          const last = [...document.querySelectorAll<HTMLElement>('main button:not([disabled])')].at(-1);
          last?.focus();
        });
        const cut: string[] = [];
        let inLive = 0;
        for (let i = 0; i < 250; i++) {
          await win.keyboard.press('Tab');
          const at = await ringCut(win);
          if (!at) continue;
          if (!at.live) {
            if (inLive > 0) break;
            continue;
          }
          inLive += 1;
          expect(at.ring, `${where}: ${at.name} shows its focus ring`).toBe(true);
          if (at.cuts.length > 0) cut.push(`${at.name}: ${at.cuts.join(', ')}`);
        }
        expect(inLive, `${where}: stops in LIVE's column`).toBeGreaterThan(10);
        expect(cut, `${where}: controls in LIVE's column whose focus ring is cut`).toEqual([]);
      }
    } finally {
      await app.close();
    }
  });
