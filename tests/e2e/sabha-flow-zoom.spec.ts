import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { holdStill, launchApp, operatorPage, operatorReady } from './helpers';
import { SCAN, writeFlows } from './sabha-flow-fixtures';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';
import { expectFits } from './fit';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/** The operator page's globals, with the presses of 1 and 2 a test keeps (as function-keys.spec.ts keeps them). */
type Pressed = typeof globalThis & { digitPresses?: KeyboardEvent[] };

/**
 * The operator window at CI's size, the placeholder show's kirtan up, and the scan's PDF chosen in the Sabha flow
 * panel, its page drawn (with `playlist`, the placeholder playlist open in the middle first).
 */
async function chooseScan(
  app: ElectronApplication,
  scan: string,
  options: { playlist?: boolean } = {},
): Promise<{ win: Page; panel: Locator; input: Locator; region: Locator }> {
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { kirtanId } = await setUpPlaceholderShow(win, { video: false });
  if (options.playlist) {
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).first().click();
    await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  }
  await win.evaluate(async (id) => {
    await (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'goLive',
      presentationId: id,
      slideIndex: 0,
    });
  }, kirtanId);
  await win.getByRole('button', { name: 'Sabha flow', exact: true }).click();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, scan);
  const panel = win.getByTestId('sabha-flow');
  await panel.getByRole('button', { name: 'Choose PDF…' }).click();
  const image = panel.getByTestId('flow-page');
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const input = panel.getByRole('textbox', { name: 'Zoom', exact: true });
  const region = panel.getByTestId('flow-pages');
  return { win, panel, input, region };
}

/**
 * The middle of the part of the PDF region actually visible through every clipping ancestor (the scan's region sits
 * inside the panel body's own scroller at CI's size), and whether a press there lands on the region.
 */
function visiblePoint(
  region: Locator,
): Promise<{ x: number; y: number; width: number; height: number; hit: boolean }> {
  return region.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let left = Math.max(r.left, 0);
    let right = Math.min(r.right, innerWidth);
    let top = Math.max(r.top, 0);
    let bottom = Math.min(r.bottom, innerHeight);
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    return {
      x,
      y,
      width: right - left,
      height: bottom - top,
      hit: el.contains(document.elementFromPoint(x, y)),
    };
  });
}

/** The show as the engine keeps it: its revision and state. */
const show = (win: Page) =>
  win.evaluate(async () => {
    const { rev, state } = await (globalThis as PageGlobals).drashti.engine.snapshot();
    return { rev, state };
  });

test('PDF typed zoom, safe keys, anchored zoom and captured mouse movement at CI window size', async () => {
  const { scan } = await writeFlows({ scan: SCAN });
  const { app } = await launchApp();
  try {
    const { win, panel, input, region } = await chooseScan(app, scan);
    const scroll = () => region.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
    await input.fill('130%');
    await input.press('Enter');
    await expect(input).toHaveValue('130%');
    await expect(region).toHaveAccessibleName(/130%/u);
    await input.fill('200');
    await input.press('Tab');
    await expect(input).toHaveValue('200%');
    for (const invalid of ['24', '401', 'abc', '']) {
      await input.fill(invalid);
      await input.press('Enter');
      await expect(panel.getByRole('alert')).toHaveText('Type a zoom from 25% to 400%');
      await expect(input).toHaveValue('200%');
      await expect(region).toHaveAccessibleName(/200%/u);
    }
    await input.fill('300');
    await input.press('Escape');
    await expect(input).toHaveValue('200%');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    const before = await show(win);
    expect(before.state.layers.slide).not.toBeNull();
    await input.focus();
    await input.press('ArrowRight');
    await input.press('Space');
    await input.press('b');
    await input.press('Escape');
    expect(await show(win)).toEqual(before);
    await input.fill('400');
    await input.press('Enter');
    await region.evaluate((el) => {
      el.scrollLeft = 160;
      el.scrollTop = 180;
    });
    await region.scrollIntoViewIfNeeded();
    const start = await scroll();
    const bounds = await region.boundingBox();
    if (!bounds) throw new Error('PDF region has no bounds');
    // The scan's PDF region sits inside the panel body's own scroller at this window size.
    // Hit the part actually visible through every clipping ancestor, not the full region's hidden centre.
    const point = await visiblePoint(region);
    expect(point.width).toBeGreaterThan(0);
    expect(point.height).toBeGreaterThan(0);
    expect(point.hit, 'The mouse must start on the visible PDF region').toBe(true);
    const { x, y } = point;
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x - 35, y - 30, { steps: 4 });
    await expect.poll(async () => (await scroll()).x).toBeGreaterThan(start.x + 25);
    await expect.poll(async () => (await scroll()).y).toBeGreaterThan(start.y + 20);
    await win.mouse.move(x + 20, y + 15, { steps: 4 });
    await expect.poll(async () => (await scroll()).x).toBeLessThan(start.x);
    await expect.poll(async () => (await scroll()).y).toBeLessThan(start.y);
    await win.mouse.move(bounds.x + bounds.width + 20, y);
    await win.mouse.up();
    const released = await scroll();
    await win.mouse.move(x, y);
    expect(await scroll()).toEqual(released);
    await region.evaluate((el) => {
      el.scrollLeft = 100;
      el.scrollTop = 200;
    });
    const anchor = await region.evaluate((el) => ({
      x: (el.scrollLeft + el.clientWidth / 2 - 8) / 4,
      y: (el.scrollTop + el.clientHeight / 2 - 8) / 4,
    }));
    await panel.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(input).toHaveValue('300%');
    const after = await region.evaluate((el) => ({
      x: (el.scrollLeft + el.clientWidth / 2 - 8) / 3,
      y: (el.scrollTop + el.clientHeight / 2 - 8) / 3,
    }));
    expect(Math.abs(after.x - anchor.x)).toBeLessThan(1);
    expect(Math.abs(after.y - anchor.y)).toBeLessThan(1);
    await region.evaluate((el) => {
      el.scrollLeft = 100;
      el.scrollTop = 200;
    });
    const pointerBefore = await scroll();
    await region.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: x, clientY: y });
    await expect(input).toHaveValue('400%');
    const pointerAfter = await scroll();
    expect(
      Math.abs((pointerAfter.x + x - bounds.x - 8) / 4 - (pointerBefore.x + x - bounds.x - 8) / 3),
    ).toBeLessThan(2);
    await region.evaluate((el) => {
      el.scrollTop = 600;
    });
    const beforeFit = await region.evaluate((el) => (el.scrollTop + el.clientHeight / 2 - 8) / 4);
    await panel.getByRole('button', { name: 'Fit to the panel' }).click();
    await expect(input).toHaveValue('100%');
    const fittedCentre = await region.evaluate((el) => el.scrollTop + el.clientHeight / 2 - 8);
    expect(Math.abs(fittedCentre - beforeFit)).toBeLessThan(1);
    // Crossing Fit adds/removes a horizontal scrollbar on Windows: use the new viewport centre.
    await input.fill('130');
    await input.press('Enter');
    await expect(input).toHaveValue('130%');
    const typedCentre = await region.evaluate((el) => (el.scrollTop + el.clientHeight / 2 - 8) / 1.3);
    expect(Math.abs(typedCentre - fittedCentre)).toBeLessThan(1);
    await panel.getByRole('button', { name: 'Fit to the panel' }).click();
    await expect(input).toHaveValue('100%');
    await expectFits(panel, 'PDF typed zoom at 1024 × 645');
  } finally {
    await app.close();
  }
});

test('⌘1 and ⌘2 (Ctrl+1 and Ctrl+2) typed in the Zoom box are the window’s, as in every field: taken, nothing typed, Audience and Stage stay on (S2-6)', async () => {
  const { scan } = await writeFlows({ scan: SCAN });
  const { app } = await launchApp();
  try {
    const { win, input } = await chooseScan(app, scan);
    // Each press of 1 or 2, kept to read whether the window took it (its default prevented) once it has gone by.
    await win.evaluate(() => {
      const g = globalThis as Pressed;
      g.digitPresses = [];
      document.addEventListener(
        'keydown',
        (e) => {
          if (e.key === '1' || e.key === '2') g.digitPresses?.push(e);
        },
        true,
      );
    });
    const taken = () =>
      win.evaluate(() => ((globalThis as Pressed).digitPresses ?? []).map((e) => e.defaultPrevented));
    const bothOn = async () => {
      const s = await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());
      return s.audience && s.stage;
    };
    expect(await bothOn()).toBe(true);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await input.focus();
    await win.keyboard.press(`${mod}+1`);
    await win.keyboard.press(`${mod}+2`);
    await expect(input).toHaveValue('100%');
    await expect(input).toBeFocused();
    await holdStill(bothOn, 1000, 'Mod+1 and Mod+2 in the Zoom box turn nothing off');
    expect(await taken()).toEqual([true, true]);
  } finally {
    await app.close();
  }
});
