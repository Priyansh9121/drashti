import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
} from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow, WELCOME } from './placeholder-show';

/*
 * Accessibility by keyboard (Session 15, WCAG 2.2 AA): a whole sabha run by
 * the keyboard alone, in Pro Mode and in Simple Mode; the focus order going
 * through the window as it is laid out, region by region; the focus always
 * seen; and keys a control uses itself (the arrows between tabs, through a
 * menu) never also moving the slide on the screens.
 */

interface Focus {
  name: string;
  /** The landmark it is in: its label, or its kind (header, main...); 'none' outside any. */
  region: string;
  ring: boolean;
  inView: boolean;
  /**
   * Something else drawn over its middle that hides it (a banner: WCAG 2.4.11, Sessions 31–36's A9). A notice may lie
   * over it since 11 Nov 2026 (the owner: small and see-through in the bottom-right corner), but only see-through, so
   * the control and its ring stay in sight: an opaque one over it counts as covering it.
   */
  covered: boolean;
  testid: string;
  tag: string;
  role: string;
}

/** Where the keyboard is, and whether its focus ring can be seen. */
function focusOf(page: Page): Promise<Focus | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const style = getComputedStyle(el);
    const ring =
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2) ||
      (style.boxShadow !== 'none' && style.boxShadow !== '');
    const landmark = el.closest('header, nav, main, aside, footer, section[aria-label], [role="dialog"]');
    const region = landmark
      ? (landmark.getAttribute('aria-label') ?? landmark.tagName.toLowerCase())
      : 'none';
    const r = el.getBoundingClientRect();
    const inView =
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth;
    // What is drawn at its middle: itself (or something inside it), never a banner over it; and a notice over it only
    // see-through (it lets clicks through, so the hit test alone cannot see it).
    const mx = r.left + r.width / 2;
    const my = r.top + r.height / 2;
    const middle = inView ? document.elementFromPoint(mx, my) : null;
    const notice = document.querySelector('[data-testid="operator-notice"]');
    const n = notice?.getBoundingClientRect();
    const underNotice =
      notice !== null &&
      n !== undefined &&
      !notice.contains(el) &&
      mx >= n.left &&
      mx <= n.right &&
      my >= n.top &&
      my <= n.bottom;
    const back = notice ? getComputedStyle(notice).backgroundColor : '';
    const alpha = Number(
      /\/\s*([0-9.]+)\s*\)\s*$/u.exec(back)?.[1] ?? /^rgba\([^)]*,\s*([0-9.]+)\s*\)$/u.exec(back)?.[1] ?? 1,
    );
    // What shows through a see-through notice, its Dismiss button too, is not covered by it (CI's Mac, 11 Nov 2026:
    // More tools' ? lay under that button); an opaque notice over it is.
    const throughNotice = middle !== null && notice !== null && notice.contains(middle) && alpha < 1;
    const covered =
      (middle !== null && middle !== el && !el.contains(middle) && !throughNotice) ||
      (underNotice && alpha >= 1);
    // What a screen reader says: its label, or its words without the parts hidden from it (a playlist card's
    // picture holds its slide's words, Session 26a).
    const shown = el.cloneNode(true) as HTMLElement;
    for (const hidden of shown.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    const name = (el.getAttribute('aria-label') ?? shown.textContent)
      .trim()
      .replace(/\s+/gu, ' ')
      .slice(0, 60);
    return {
      name,
      region,
      ring,
      inView,
      covered,
      testid: el.dataset['testid'] ?? '',
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? '',
    };
  });
}

/** Press Tab until the keyboard is where `found` says (at most `max` presses); every stop on the way. */
async function tabTo(page: Page, found: (f: Focus) => boolean, max = 200): Promise<Focus[]> {
  const seen: Focus[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await focusOf(page);
    if (!f) continue;
    seen.push(f);
    if (found(f)) return seen;
  }
  throw new Error(
    `Not reached with Tab in ${String(max)} presses: ${seen.map((s) => `${s.region}: ${s.name}`).join(' | ')}`,
  );
}

/** Tab once round the whole window (until the first stop comes again); every stop. */
async function tabRound(page: Page, max = 400): Promise<Focus[]> {
  const seen: Focus[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await focusOf(page);
    if (!f) continue;
    const first = seen[0];
    if (f.name === first?.name && f.testid === first.testid && f.region === first.region && seen.length > 3)
      return seen;
    seen.push(f);
  }
  return seen;
}

/** The regions in the order the keyboard first reaches them (the slides' region is named after what it shows). */
const regionOrder = (stops: readonly Focus[]) => [
  ...new Set(stops.map((s) => s.region.replace(/^Slides of .*/u, 'Slides'))),
];

const engine = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.engine.snapshot();
    return { rev: s.rev, state: s.state };
  });

/** The slide on the screens: its presentation and place ('' with none). */
async function slideOn(win: Page): Promise<string> {
  const slide = (await engine(win)).state.layers.slide;
  return slide ? `${slide.presentationId} #${String(slide.slideIndex)}` : '';
}

async function setUp(win: Page) {
  return setUpPlaceholderShow(win, { video: false });
}

test('Pro Mode: the keyboard goes through the window as it is laid out, its focus always seen', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  await win.reload();
  await operatorReady(win);
  const stops = await tabRound(win);
  expect(stops.length).toBeGreaterThan(30);
  // Every stop shows where the keyboard is, and can be seen (scrolled to if need be).
  expect(
    stops.filter((s) => !s.ring).map((s) => `${s.region}: ${s.name}`),
    'stops without a focus ring',
  ).toEqual([]);
  expect(
    stops.filter((s) => !s.inView).map((s) => `${s.region}: ${s.name}`),
    'stops out of sight',
  ).toEqual([]);
  // Every stop is in a landmark (but the dividers, which sit between them), and the regions come as
  // they are laid out: the header, the left column (Session 44: the Library button and the playlists; the
  // library opens over them), the slides, the live column, the controls along the bottom, and the status bar.
  expect(
    stops.filter((s) => s.region === 'none' && s.role !== 'separator').map((s) => s.name),
    'stops outside any landmark',
  ).toEqual([]);
  const order = regionOrder(stops);
  console.log(`Tab order by region: ${order.join(' > ')}`);
  const expected = ['header', 'Playlists', 'Slides', 'Live', 'Show controls', 'Status'];
  expect(order.filter((r) => expected.includes(r))).toEqual(expected);
  await app.close();
});

test('Pro Mode: with a notice up, no focused control is hidden by it: a see-through one may lie over it (WCAG 2.4.11; Sessions 31–36, A9; the owner, 11 Nov 2026)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  // A notice, as the main process sends one (after saving diagnostics, a restore, a command that failed).
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows())
      if (w.webContents.getURL().includes('index.html'))
        w.webContents.send('app:notice', {
          text: 'Placeholder notice that stays while the keyboard goes round',
        });
  });
  await expect(win.getByTestId('operator-notice')).toBeVisible();
  const stops = await tabRound(win);
  expect(stops.length).toBeGreaterThan(30);
  expect(
    stops.filter((s) => s.covered).map((s) => `${s.region}: ${s.name}`),
    'stops covered by something drawn over them',
  ).toEqual([]);
  await app.close();
});

test('a playlist row’s More, clicked, opens its menu without taking the focus into a part hidden from screen readers (Sessions 31–36, A14)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  const row = win
    .getByTestId('playlist-tree')
    .locator('li')
    .filter({ has: win.getByTestId('playlist-node') })
    .first();
  await row.hover();
  // A mouse's button only: hidden from screen readers (the keyboard opens the same menu on the row).
  await row.locator('button[aria-label^="More for "]').click();
  await expect(win.getByRole('menu')).toBeVisible();
  // Wherever the focus is, open or closed again, it is never inside anything aria-hidden.
  const hiddenFocus = () =>
    win.evaluate(
      () => document.activeElement?.closest('[aria-hidden="true"]')?.outerHTML.slice(0, 80) ?? null,
    );
  expect(await hiddenFocus()).toBeNull();
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu')).toHaveCount(0);
  expect(await hiddenFocus()).toBeNull();
  await app.close();
});

test('Pro Mode: a whole sabha by keyboard alone', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  await win.reload();
  await operatorReady(win);
  const live = win.getByTestId('live-text');
  const words = output.locator('[data-layer="slide"]');

  // Open the playlist, show its first item, and start it: Tab, Enter, Tab, Enter, Space.
  await tabTo(win, (f) => f.testid === 'playlist-node' && f.name.includes(PLAYLIST));
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('playlist-items')).toBeVisible();
  await tabTo(win, (f) => f.testid === 'playlist-item' && f.name.includes(WELCOME));
  await win.keyboard.press('Enter');
  await win.keyboard.press('Space');
  await expect(words).toContainText('Placeholder welcome to the sabha');

  // Next goes on into the kirtan; the next item and back with Shift and the arrows.
  await win.keyboard.press('ArrowRight');
  await expect(live).toContainText(`${KIRTAN} · slide 1 of 5`);
  await win.keyboard.press('ArrowRight');
  await expect(live).toContainText(`${KIRTAN} · slide 2 of 5`);
  await win.keyboard.press('ArrowLeft');
  await expect(live).toContainText(`${KIRTAN} · slide 1 of 5`);
  await win.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await engine(win)).state.layers.slide).toBeNull();
  await win.keyboard.press('Shift+ArrowLeft');
  await expect(live).toContainText(KIRTAN);

  // Black-out and the Wallpaper, on and off: the Wallpaper with F12, the Logo's key as the operators press it
  // (Session 55, Part 13).
  await win.keyboard.press('b');
  await expect(output.getByTestId('blackout')).toHaveCount(1);
  await win.keyboard.press('b');
  await expect(output.getByTestId('blackout')).toHaveCount(0);
  await win.keyboard.press('F12');
  await expect.poll(async () => (await engine(win)).state.wallpaper).toBe(true);
  await win.keyboard.press('F12');
  await expect.poll(async () => (await engine(win)).state.wallpaper).toBe(false);

  // A message, typed in its field and shown with Enter; Tab out of the field, and F6 takes it off.
  await tabTo(win, (f) => f.tag === 'input' && f.region === 'Live' && f.name === 'plate');
  await win.keyboard.type('KB 123');
  await win.keyboard.press('Enter');
  await expect(output.locator('[data-layer="messages"]')).toContainText('Car KB 123 please move');
  await win.keyboard.press('Tab');
  await win.keyboard.press('F6');
  await expect(output.locator('[data-layer="messages"]')).toHaveCount(0);

  // A timer started from its button.
  await tabTo(win, (f) => f.region === 'Live' && f.tag === 'button' && /^Start\b/u.test(f.name));
  await win.keyboard.press('Enter');
  await expect
    .poll(async () => (await engine(win)).state.timers.some((t) => t.startedAt !== null))
    .toBe(true);

  // Clear all, and Put it back from the keyboard.
  await win.keyboard.press('F1');
  await expect(output.locator('[data-layer]')).toHaveCount(0);
  await tabTo(win, (f) => f.testid === 'put-back');
  await win.keyboard.press('Enter');
  await expect(words).toBeVisible();
  await app.close();
});

test('Simple Mode: every button by Tab, in order, its focus seen; Enter on them runs the sabha', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  // The playlist open in Pro Mode is Simple Mode's one playlist (Session 55, Part 18).
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('simple-mode').getByTestId('playlist-item')).toHaveCount(5);
  await expectNoSeriousA11yIssues(win, 'Simple Mode, before Tab');
  // Next's key starts the playlist: the welcome slide. Then Back is a stop too (with nothing up it waits, not
  // pressable, as Pro Mode's does).
  await win.keyboard.press('ArrowRight');
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder welcome to the sabha');
  // The round from the top of the window (its header's Pro Mode), wherever the keyboard was.
  await win.getByTestId('simple-leave').focus();
  const stops = await tabRound(win);
  expect(
    stops.filter((s) => !s.ring).map((s) => s.name),
    'stops without a focus ring',
  ).toEqual([]);
  expect(
    stops.filter((s) => !s.inView).map((s) => s.name),
    'stops out of sight',
  ).toEqual([]);
  // As laid out (Session 55, Part 18: Pro Mode's columns): the playlist (its Add files…, then its rows), then LIVE's
  // Back and Next, then the bar along the bottom (Clear all, then Black-out).
  const at = (find: (f: Focus) => boolean) => stops.findIndex(find);
  const addFiles = at((s) => s.testid === 'playlist-add-files');
  const item = at((s) => s.name.includes(WELCOME));
  const back = at((s) => /^Back\b/u.test(s.name));
  const next = at((s) => /^Next\b/u.test(s.name));
  const clear = at((s) => s.testid === 'simple-clear-all');
  const blackout = at((s) => s.testid === 'simple-blackout');
  expect([addFiles, item, back, next, clear, blackout].every((i) => i >= 0)).toBe(true);
  expect(addFiles).toBeLessThan(item);
  expect(item).toBeLessThan(back);
  expect(back).toBeLessThan(next);
  expect(next).toBeLessThan(clear);
  expect(clear).toBeLessThan(blackout);

  // Next, by Tab and Enter: on into the kirtan.
  await tabTo(win, (f) => /^Next\b/u.test(f.name));
  await win.keyboard.press('Enter');
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder chorus line');
  await tabTo(win, (f) => f.testid === 'simple-blackout');
  await win.keyboard.press('Enter');
  await expect(output.getByTestId('blackout')).toHaveCount(1);
  await win.keyboard.press('Enter');
  await expect(output.getByTestId('blackout')).toHaveCount(0);
  await tabTo(win, (f) => f.testid === 'simple-clear-all');
  await win.keyboard.press('Enter');
  await expect(output.locator('[data-layer]')).toHaveCount(0);
  // Put it back takes Clear all's place: the keyboard is still there.
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await tabTo(win, (f) => f.testid === 'simple-put-back');
  await win.keyboard.press('Enter');
  await expect(output.locator('[data-layer="slide"]')).toBeVisible();
  await app.close();
});

test('the arrows a control uses itself never also move the slide on the screens', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  await win.reload();
  await operatorReady(win);
  // Something live, so a Next would change it.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });
  const live = await slideOn(win);
  expect(live).not.toBe('');
  // The library's tabs (in its sheet, Session 44): the arrows go to the next tab.
  await openLibrary(win);
  await tabTo(win, (f) => f.testid.startsWith('library-tab-'));
  await win.keyboard.press('ArrowRight');
  await expect.poll(async () => (await focusOf(win))?.testid).not.toBe('library-tab-presentations');
  await win.keyboard.press('ArrowLeft');
  expect(await slideOn(win), "the arrows between the library's tabs moved the show").toBe(live);
  // A playlist's menu (Shift+F10, on every system): the arrows go through its choices.
  await closeLibrary(win);
  await tabTo(win, (f) => f.testid === 'playlist-node');
  await win.keyboard.press('Shift+F10');
  await expect(win.getByRole('menu')).toBeVisible();
  await expect.poll(async () => (await focusOf(win))?.role).toBe('menuitem');
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('ArrowDown');
  expect(await slideOn(win), "the arrows in a playlist's menu moved the show").toBe(live);
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu')).toHaveCount(0);
  expect(await slideOn(win), 'Esc on a menu moved the show').toBe(live);
  // A divider between the columns: the arrows move it.
  await tabTo(win, (f) => f.role === 'separator');
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowLeft');
  expect(await slideOn(win), 'the arrows on a divider moved the show').toBe(live);
  // And away from the controls the arrows still move the show.
  await win.locator('body').click({ position: { x: 640, y: 6 } });
  await win.keyboard.press('ArrowRight');
  await expect.poll(() => slideOn(win)).not.toBe(live);
  await app.close();
});
