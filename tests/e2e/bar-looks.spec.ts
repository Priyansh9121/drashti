import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BUILT_IN } from '../../src/shared/appearance/appearances';
import type { PageGlobals } from './helpers';
import { launchApp, OWN_APPEARANCE, operatorPage, operatorReady, setUpScreen } from './helpers';

/*
 * The bar of clears' own looks (alpha.24, the a25 list's items 28 and 33; operator/LayerBar.tsx). The Wallpaper and
 * Black-out off are an edge with no fill, pressable, so their edge is the only thing that marks them out from the bar:
 * at least 3:1 against what is round it (WCAG 1.4.11), in Depth (Follow the computer, light and dark, Pro and Simple
 * Mode) and in every appearance chosen by name; it was the appearance's divider, 1.17-1.49:1. And a show control's look
 * says what is up, so no button along the bar changes its look while it is pointed at, in any state: a lit Black-out
 * or Wallpaper brightened (brightness(1.1)), a lit clear, Clear all and Put it back took another fill or edge.
 * Placeholder slides only.
 */

/** The Wallpaper's and Black-out's test ids, Pro Mode's and Simple Mode's. */
const COVERS = ['wallpaper-button', 'blackout-button'] as const;
const SIMPLE_COVERS = ['simple-wallpaper', 'simple-blackout'] as const;

/** A colour the page computed ("rgb(…)", "rgba(…)" or "color(srgb …)") as red, green and blue 0-255 and its alpha. */
function parse(colour: string): [number, number, number, number] {
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/u.exec(colour);
  if (srgb) {
    const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((x) => Number(x) * 255);
    return [r ?? 0, g ?? 0, b ?? 0, srgb[4] === undefined ? 1 : Number(srgb[4])];
  }
  const rgb = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/u.exec(colour);
  if (!rgb) throw new Error(`a colour this spec cannot read: ${colour}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
}

/** `top` drawn over the opaque `under`. */
function over(top: string, under: string): [number, number, number] {
  const [r, g, b, a] = parse(top);
  const [ur, ug, ub] = parse(under);
  return [r * a + ur * (1 - a), g * a + ug * (1 - a), b * a + ub * (1 - a)];
}

function luminance([r, g, b]: readonly number[]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
}

/** WCAG's contrast ratio of two colours. */
function ratio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** A button's edge and fill, and the first colour drawn under it (its bar's). */
const drawn = (button: Locator) =>
  button.evaluate((el) => {
    const own = getComputedStyle(el);
    let ground = '';
    for (let up = el.parentElement; up && ground === ''; up = up.parentElement) {
      const bg = getComputedStyle(up).backgroundColor;
      if (bg !== 'transparent' && !/^rgba\(.*, 0\)$/u.test(bg)) ground = bg;
    }
    return { edge: own.borderTopColor, fill: own.backgroundColor, ground };
  });

/**
 * How far a button stands out from what is round it: its edge's contrast with the bar under it, or its fill's if that
 * is more (a filled button is marked out by its fill).
 */
async function standsOut(button: Locator): Promise<{ edge: number; fill: number; colours: string }> {
  const d = await drawn(button);
  const ground = over(d.ground, 'rgb(0, 0, 0)');
  const g = `rgb(${ground.join(', ')})`;
  return {
    edge: ratio(over(d.edge, g), ground),
    fill: ratio(over(d.fill, g), ground),
    colours: `edge ${d.edge}, fill ${d.fill} on ${d.ground}`,
  };
}

/** The Wallpaper and Black-out off: each marked out at 3:1 at least, soft, so one run names every look that fails. */
async function coversStandOut(win: Page, ids: readonly string[], where: string): Promise<void> {
  for (const id of ids) {
    const cover = win.getByTestId(id);
    await expect(cover, `${where}: ${id} off`).toHaveAttribute('data-dimmed', 'true');
    const s = await standsOut(cover);
    expect
      .soft(Math.max(s.edge, s.fill), `${where}: ${id} off, its edge against the bar (${s.colours})`)
      .toBeGreaterThanOrEqual(3);
  }
}

const turnComputer = (app: ElectronApplication, source: 'light' | 'dark') =>
  app.evaluate(({ nativeTheme }, s) => {
    nativeTheme.themeSource = s;
  }, source);

test('the Wallpaper and Black-out, off: an edge at 3:1 against the bar, in Depth light and dark (Pro and Simple Mode) and in every appearance chosen by name', async () => {
  test.setTimeout(150_000);
  // Follow the computer (CI's Black job would start every other Drashti in Black, chosen by name).
  const { app } = await launchApp(OWN_APPEARANCE);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1024, height: 645 });
  await operatorReady(win);
  const html = win.locator('html');
  for (const [source, id] of [
    ['light', 'white'],
    ['dark', 'black'],
  ] as const) {
    await turnComputer(app, source);
    await expect(html).toHaveAttribute('data-appearance', id);
    await expect(html).toHaveAttribute('data-window-look', 'depth');
    await coversStandOut(win, COVERS, `Depth ${source}, Pro Mode`);
  }
  // Every appearance by name (flat: the bar in its zone's own surface).
  for (const a of BUILT_IN) {
    const chosen = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.appearance.choose(id),
      a.id,
    );
    expect(chosen, a.name).toMatchObject({ ok: true });
    await expect(html, a.name).toHaveAttribute('data-appearance', a.id);
    await expect(html, a.name).not.toHaveAttribute('data-window-look', 'depth');
    await coversStandOut(win, COVERS, a.name);
  }
  // Simple Mode, following the computer again: Depth, light and dark.
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.choose('follow')),
  ).toMatchObject({ ok: true });
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'))).toMatchObject({
    ok: true,
  });
  await expect(win.getByTestId('simple-buttons')).toBeVisible();
  for (const [source, id] of [
    ['light', 'white'],
    ['dark', 'black'],
  ] as const) {
    await turnComputer(app, source);
    await expect(html).toHaveAttribute('data-appearance', id);
    await expect(html).toHaveAttribute('data-window-look', 'depth');
    await coversStandOut(win, SIMPLE_COVERS, `Depth ${source}, Simple Mode`);
  }
  await app.close();
});

/** A button's look as drawn: what a pointer resting on it must not change. */
const lookOf = (button: Locator) =>
  button.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fill: s.backgroundColor,
      edge: s.borderTopColor,
      words: s.color,
      filter: s.filter,
      shadow: s.boxShadow,
      opacity: s.opacity,
      transform: s.transform,
    };
  });

const pointedAt = (button: Locator) => button.evaluate((el) => el.matches(':hover'));

/** The button's look with the pointer away from it and resting on it: the same (soft). */
async function samePointedAt(win: Page, button: Locator, what: string): Promise<void> {
  await win.mouse.move(0, 0);
  await expect.poll(() => pointedAt(button), `${what}: the pointer away`).toBe(false);
  const away = await lookOf(button);
  await button.hover();
  await expect.poll(() => pointedAt(button), `${what}: the pointer on it`).toBe(true);
  expect.soft(await lookOf(button), `${what}: its look, pointed at`).toEqual(away);
}

test('no button along the bar changes its look while pointed at, in any state: the Wallpaper and Black-out off and on, Clear all, a lit clear, Put it back (Pro and Simple Mode)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1024, height: 645 });
  await operatorReady(win);
  await setUpScreen(win);
  const [first] = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations());
  const goLive = { type: 'goLive', presentationId: first?.id ?? '', slideIndex: 0 } as const;
  const slideUp = () => win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), goLive);

  for (const simple of [false, true]) {
    const mode = simple ? 'Simple Mode' : 'Pro Mode';
    if (simple) {
      expect(
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple')),
      ).toMatchObject({ ok: true });
      await expect(win.getByTestId('simple-buttons')).toBeVisible();
    }
    const bar = win.getByTestId(simple ? 'simple-buttons' : 'layer-bar');
    const [wallpaper, blackout] = (simple ? SIMPLE_COVERS : COVERS).map((id) => win.getByTestId(id));
    if (!wallpaper || !blackout) throw new Error('no covers');
    // Off (nothing up but a slide): the Wallpaper and Black-out dimmed, Clear all and the slide's clear lit.
    await slideUp();
    const clearSlide = simple
      ? win.getByTestId('simple-clear-slide')
      : bar.getByRole('button', { name: /^Clear slide/u });
    await expect(clearSlide).toHaveAttribute('data-lit', 'true');
    const clearAll = simple
      ? win.getByTestId('simple-clear-all')
      : bar.getByRole('button', { name: /^Clear all/u });
    await expect(clearAll).toBeEnabled();
    for (const [button, what] of [
      [wallpaper, 'the Wallpaper off'],
      [blackout, 'Black-out off'],
      [clearAll, 'Clear all, something up'],
      [clearSlide, 'the slide’s clear, lit'],
    ] as const)
      await samePointedAt(win, button, `${mode}, ${what}`);
    // On: in LIVE's red, saying so; pointed at, the same red (it brightened).
    for (const [button, what] of [
      [wallpaper, 'the Wallpaper on'],
      [blackout, 'Black-out on'],
    ] as const) {
      await button.click();
      await expect(button, `${mode}, ${what}`).toHaveAttribute('data-lit', 'true');
      await samePointedAt(win, button, `${mode}, ${what}`);
      await button.click();
      await expect(button, `${mode}, ${what}, off again`).toHaveAttribute('data-dimmed', 'true');
    }
    // Clear all: Put it back in its place; pointed at, the same.
    await win.keyboard.press('F1');
    const putBack = win.getByTestId(simple ? 'simple-put-back' : 'put-back');
    await expect(putBack).toBeVisible();
    await samePointedAt(win, putBack, `${mode}, Put it back`);
    await putBack.click();
    await expect(putBack).toHaveCount(0);
  }
  await app.close();
});
