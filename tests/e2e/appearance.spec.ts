import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN, FOLLOW, WHITE, type Appearance } from '../../src/shared/appearance/appearances';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  relaunchApp,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { launchNode } from './nodes';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { holdClock } from './placeholder-slides';

/*
 * Appearance (Sessions 39–40): the look of Drashti's own windows, chosen in the app and kept per computer.
 * Choosing one changes the window at once (its colours, the window's own colour, the native parts) and lasts
 * over a restart, with the window opening on its colour; Follow the computer follows the computer turning
 * light or dark; Simple Mode shows the choice with no switch; every appearance passes axe in a show, a dialog,
 * Simple Mode and the Appearance window, and forced colours still work; and the audience screens draw exactly
 * the same in every one. Placeholder content only.
 */

/** "#rrggbb" as getComputedStyle writes it. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

/** What the operator window draws in now: its page's appearance, its body's colour and the window's own. */
async function drawn(app: ElectronApplication, win: Page) {
  const page = await win.evaluate(() => ({
    id: document.documentElement.dataset['appearance'] ?? null,
    base: document.documentElement.dataset['base'] ?? null,
    body: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  const native = await app.evaluate(({ BrowserWindow, nativeTheme }) => {
    const operator = BrowserWindow.getAllWindows().find((w) =>
      /index\.html|\/$/u.test(w.webContents.getURL()),
    );
    return {
      background: operator?.getBackgroundColor().toLowerCase() ?? null,
      source: nativeTheme.themeSource,
    };
  });
  return { ...page, ...native };
}

/** The window as an appearance draws it. */
const looksLike = (a: Appearance, source: string) => ({
  id: a.id,
  base: a.base,
  body: rgb(a.colours.ink),
  scheme: a.base,
  background: a.colours.ink,
  source,
});

/** Which radio item the View › Appearance menu has ticked. */
const ticked = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.getMenuItemById('appearance')?.submenu?.items ?? [])
      .filter((i) => i.type === 'radio' && i.checked)
      .map((i) => i.id),
  );

test('choosing each appearance changes the window at once, its own colour and the native parts too, and lasts over a restart', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  for (const a of BUILT_IN) {
    await chooseMenuItem(app, `appearance-${a.id}`);
    await expect.poll(() => drawn(app, win)).toEqual(looksLike(a, a.base));
    expect(await ticked(app)).toEqual([`appearance-${a.id}`]);
  }
  // From the Appearance window too: at once, and the choice shows there.
  await chooseMenuItem(app, 'appearance-window');
  const dialog = win.getByTestId('appearance-dialog');
  await expect(dialog).toBeVisible();
  const white = dialog.locator(`[data-testid="appearance-choice"][data-choice="${WHITE.id}"]`);
  await white.click();
  await expect(white).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => drawn(app, win)).toEqual(looksLike(WHITE, 'light'));
  expect(JSON.parse(readFileSync(join(userData, 'drashti-appearance.json'), 'utf8'))).toMatchObject({
    choice: 'white',
  });
  await app.close();

  // Started again: White from the first frame. The window is made on White's colour, and its page has it
  // before it has drawn anything (the preload sets it as the page's <html> is made).
  const again = await relaunchApp(userData);
  const next = await operatorPage(again.app);
  const made = await again.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.getBackgroundColor().toLowerCase()),
  );
  expect(made).toContain(WHITE.colours.ink);
  await expect(next.locator('html')).toHaveAttribute('data-appearance', 'white');
  await operatorReady(next);
  expect(await drawn(again.app, next)).toEqual(looksLike(WHITE, 'light'));
  expect(await ticked(again.app)).toEqual(['appearance-white']);
  await again.app.close();
});

test('Follow the computer follows it turning light or dark, at once, and is the default', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(await ticked(app)).toEqual([`appearance-${FOLLOW}`]);
  expect((await drawn(app, win)).source).toBe('system');
  // The computer turning dark, then light (Electron's own setting stands in for the computer's).
  const computer = (source: 'dark' | 'light') =>
    app.evaluate(({ nativeTheme }, s) => {
      nativeTheme.themeSource = s;
    }, source);
  const black = BUILT_IN.find((a) => a.id === 'black') ?? WHITE;
  await computer('dark');
  await expect.poll(() => drawn(app, win)).toEqual(looksLike(black, 'dark'));
  await computer('light');
  await expect.poll(() => drawn(app, win)).toEqual(looksLike(WHITE, 'light'));
  // The Appearance window says which it is now.
  await chooseMenuItem(app, 'appearance-window');
  const follow = win.locator(`[data-testid="appearance-choice"][data-choice="${FOLLOW}"]`);
  await expect(follow).toHaveAttribute('aria-checked', 'true');
  await expect(follow).toContainText('(now White)');
  await computer('dark');
  await expect(follow).toContainText('(now Black)');
  await app.close();
});

test('Simple Mode shows the chosen appearance, with no switch, and refuses a change', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await chooseMenuItem(app, 'appearance-white');
  await expect(win.locator('html')).toHaveAttribute('data-appearance', 'white');
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect.poll(() => drawn(app, win)).toEqual(looksLike(WHITE, 'light'));
  const items = await app.evaluate(({ Menu }) =>
    ['appearance', 'appearance-white', 'appearance-black', 'appearance-window'].map(
      (id) => Menu.getApplicationMenu()?.getMenuItemById(id) ?? null,
    ),
  );
  expect(items).toEqual([null, null, null, null]);
  const refused = await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.choose('black'));
  expect(refused).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  expect((await drawn(app, win)).id).toBe('white');
  await app.close();
});

for (const id of BUILT_IN.map((a) => a.id)) {
  test(`${id}: axe passes in a show, a dialog, the Appearance window and Simple Mode; forced colours still work`, async () => {
    test.setTimeout(120_000);
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1280, height: 720 });
    await operatorReady(win);
    await chooseMenuItem(app, `appearance-${id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
    await setUpPlaceholderShow(win);
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await win.getByTestId('playlist-item').filter({ hasText: KIRTAN }).click();
    await win.getByTestId('slide-thumb').nth(1).click();
    await expect(win.getByTestId('slide-thumb').nth(1)).toHaveAttribute('aria-current', 'true');
    await expectNoSeriousA11yIssues(win, `${id}: Pro Mode in a show`);
    await chooseMenuItem(app, 'keyboard-shortcuts');
    await expect(win.getByTestId('keys-sheet')).toBeVisible();
    await expectNoSeriousA11yIssues(win, `${id}: a dialog (the keys sheet)`);
    await win.keyboard.press('Escape');
    await expect(win.getByTestId('keys-sheet')).toHaveCount(0);
    await chooseMenuItem(app, 'appearance-window');
    await expect(win.getByTestId('appearance-dialog')).toBeVisible();
    await expectNoSeriousA11yIssues(win, `${id}: the Appearance window`);
    // Forced colours (a Windows contrast theme): the choice is still told by more than colour, and axe passes.
    await win.emulateMedia({ forcedColors: 'active' });
    // Drawn again in the system's colours before anything is measured.
    await win.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    await expect
      .poll(() => win.evaluate(() => getComputedStyle(document.body).color))
      .not.toBe(getComputedStyleFg(id));
    await expect(win.locator('[data-testid="appearance-choice"][aria-checked="true"]')).toHaveCount(1);
    await expect(win.locator('[data-testid="appearance-choice"][aria-checked="true"]')).toContainText(
      'Chosen',
    );
    // The system's theme sets the colours here: contrast is its own (a11y.ts says why axe's is left out).
    await expectNoSeriousA11yIssues(win, `${id}: the Appearance window in forced colours`, undefined, [
      'color-contrast',
    ]);
    // The keyboard's place: an outline, which forced colours keep.
    await win.locator('[data-testid="appearance-choice"][aria-checked="true"]').focus();
    await win.keyboard.press('Shift+Tab');
    await win.keyboard.press('Tab');
    await expect(win.locator('[data-testid="appearance-choice"][aria-checked="true"]')).toBeFocused();
    expect(
      await win.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineStyle),
    ).not.toBe('none');
    await win.emulateMedia({ forcedColors: 'none' });
    await win.keyboard.press('Escape');
    await win.getByRole('button', { name: 'Simple Mode' }).click();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expectNoSeriousA11yIssues(win, `${id}: Simple Mode`);
    await app.close();
  });
}

/** The appearance's own words' colour, as getComputedStyle writes it (forced colours replace it). */
const getComputedStyleFg = (id: string) => rgb((BUILT_IN.find((a) => a.id === id) ?? WHITE).colours.fg);

test('a node’s own window takes its computer’s appearance from its first frame, and keeps it over a restart', async () => {
  const { app, page, userData } = await launchNode();
  // Its computer's own setting (Follow the computer): Black or White, the window made on its colour.
  await expect(page.locator('html')).toHaveAttribute('data-appearance', /^(black|white)$/u);
  const shownId = await page.evaluate(() => document.documentElement.dataset['appearance'] ?? '');
  const shown = BUILT_IN.find((a) => a.id === shownId) ?? WHITE;
  const nodeBackground = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().includes('node.html'))
        .map((w) => w.getBackgroundColor().toLowerCase()),
    );
  expect(await nodeBackground()).toEqual([shown.colours.ink]);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    rgb(shown.colours.ink),
  );
  await app.close();
  // Kept per computer: a node started in another appearance (as a person would have chosen on it) keeps it.
  writeFileSync(
    join(userData, 'drashti-appearance.json'),
    JSON.stringify({ version: 1, choice: 'tulsi', motion: 'calm', own: [] }),
  );
  const again = await launchNode({}, userData);
  await expect(again.page.locator('html')).toHaveAttribute('data-appearance', 'tulsi');
  await again.app.close();
});

/** Decode a page's picture to RGBA in Electron's main process (no PNG package in the tests). */
async function bitmap(app: ElectronApplication, page: Page): Promise<string> {
  const png = await page.screenshot();
  return app.evaluate(
    ({ nativeImage }, b64) =>
      nativeImage.createFromBuffer(Buffer.from(b64, 'base64')).toBitmap().toString('base64'),
    png.toString('base64'),
  );
}

test('the audience screens draw exactly the same in every appearance: the hall’s screen and the stage screen', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Main Hall', 0);
  const stageScreen = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stageScreen);
  await expect.poll(() => outputPages(app).length).toBe(2);
  for (const out of outputPages(app)) await outputReady(out);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    await d.engine.dispatch({ type: 'goLive', presentationId: p?.id ?? '', slideIndex: 0 });
  });
  const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
  /** Each screen's picture, by its role, once two in a row are the same (it has settled). */
  const pictures = async () => {
    const out: Record<string, string> = {};
    for (const page of outputPages(app)) {
      const role = (await roleOf(page)) ?? '';
      let last = await bitmap(app, page);
      for (let i = 0; i < 10; i++) {
        const now = await bitmap(app, page);
        if (now === last) break;
        last = now;
      }
      out[role] = last;
    }
    return out;
  };
  // The stage screen shows the time: once the slide has come in, every screen's clock is held at that moment
  // (Main's own, the engine's), so a minute turning while the appearances are compared changes nothing (it
  // did once on CI's Mac, Tulsi's stage screen, with the clock running).
  await pictures();
  const settled = await app.evaluate(() => Date.now());
  expect(await holdClock(app, settled), 'both screens hold their clock').toBe(2);
  await chooseMenuItem(app, 'appearance-black');
  await expect(win.locator('html')).toHaveAttribute('data-appearance', 'black');
  const first = await pictures();
  expect(Object.keys(first).sort()).toEqual(['audience', 'stage']);
  // Real pictures: the slide's words are on them, not a blank or black frame.
  for (const role of ['audience', 'stage']) {
    const bytes = Buffer.from(first[role] ?? '', 'base64');
    expect(bytes.length, role).toBeGreaterThan(0);
    expect(
      bytes.some((b, i) => i % 4 !== 3 && b > 128),
      `${role}: something light drawn on it`,
    ).toBe(true);
  }
  for (const a of BUILT_IN.filter((x) => x.id !== 'black')) {
    await chooseMenuItem(app, `appearance-${a.id}`);
    await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
    // The screens were never told: their pages have no appearance at all.
    for (const out of outputPages(app))
      expect(await out.evaluate(() => document.documentElement.dataset['appearance'] ?? null)).toBeNull();
    const now = await pictures();
    for (const role of ['audience', 'stage'])
      expect(now[role] === first[role], `${a.name}: the ${role} screen`).toBe(true);
  }
  await app.close();
});
