import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';
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
    const name = (el.getAttribute('aria-label') ?? el.textContent).trim().replace(/\s+/gu, ' ').slice(0, 60);
    return {
      name,
      region,
      ring,
      inView,
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

/** The regions in the order the keyboard first reaches them. */
const regionOrder = (stops: readonly Focus[]) => [...new Set(stops.map((s) => s.region))];

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
  const show = await setUpPlaceholderShow(win, { video: false });
  await win.evaluate(async (logoId) => {
    const marked = await (globalThis as PageGlobals).drashti.props.setLogo(logoId);
    if (!marked.ok) throw new Error(marked.message);
  }, show.logoPropId);
  return show;
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
  // they are laid out: the header, the left column (playlists, then the library), the slides, the
  // live column, the controls along the bottom, and the status bar.
  expect(
    stops.filter((s) => s.region === 'none' && s.role !== 'separator').map((s) => s.name),
    'stops outside any landmark',
  ).toEqual([]);
  const order = regionOrder(stops);
  console.log(`Tab order by region: ${order.join(' > ')}`);
  const expected = ['header', 'Playlists', 'Library', 'Slides', 'Live', 'Show controls', 'Status'];
  expect(order.filter((r) => expected.includes(r))).toEqual(expected);
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
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
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

  // Black-out and the logo, on and off.
  await win.keyboard.press('b');
  await expect(output.getByTestId('blackout')).toHaveCount(1);
  await win.keyboard.press('b');
  await expect(output.getByTestId('blackout')).toHaveCount(0);
  await win.keyboard.press('l');
  await expect.poll(async () => (await engine(win)).state.logo).not.toBeNull();
  await win.keyboard.press('l');
  await expect.poll(async () => (await engine(win)).state.logo).toBeNull();

  // A message, typed in its field and shown with Enter; Tab out of the field, and F5 takes it off.
  await tabTo(win, (f) => f.tag === 'input' && f.region === 'Live' && f.name === 'plate');
  await win.keyboard.type('KB 123');
  await win.keyboard.press('Enter');
  await expect(output.locator('[data-layer="messages"]')).toContainText('Car KB 123 please move');
  await win.keyboard.press('Tab');
  await win.keyboard.press('F5');
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
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setUp(win);
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Simple Mode, before Tab');
  const stops = await tabRound(win);
  expect(
    stops.filter((s) => !s.ring).map((s) => s.name),
    'stops without a focus ring',
  ).toEqual([]);
  expect(
    stops.filter((s) => !s.inView).map((s) => s.name),
    'stops out of sight',
  ).toEqual([]);
  // The playlist first (its choice, then its items), then the big buttons, as laid out.
  const at = (find: (f: Focus) => boolean) => stops.findIndex(find);
  const picker = at((s) => s.testid === 'simple-playlist');
  const item = at((s) => s.name.includes(WELCOME));
  const back = at((s) => /^Back\b/u.test(s.name));
  const next = at((s) => /^Next\b/u.test(s.name));
  const blackout = at((s) => s.testid === 'simple-blackout');
  const clear = at((s) => s.testid === 'simple-clear-all');
  expect([picker, item, back, next, blackout, clear].every((i) => i >= 0)).toBe(true);
  expect(picker).toBeLessThan(item);
  expect(item).toBeLessThan(back);
  expect(back).toBeLessThan(next);
  expect(next).toBeLessThan(blackout);
  expect(blackout).toBeLessThan(clear);

  // Next, by Tab and Enter: the welcome slide.
  await tabTo(win, (f) => /^Next\b/u.test(f.name));
  await win.keyboard.press('Enter');
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder welcome to the sabha');
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
  // The library's tabs: the arrows go to the next tab.
  await tabTo(win, (f) => f.testid.startsWith('library-tab-'));
  await win.keyboard.press('ArrowRight');
  await expect.poll(async () => (await focusOf(win))?.testid).not.toBe('library-tab-presentations');
  await win.keyboard.press('ArrowLeft');
  expect(await slideOn(win), "the arrows between the library's tabs moved the show").toBe(live);
  // A playlist's menu (Shift+F10, on every system): the arrows go through its choices.
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
