import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { SCAN, writeFlows } from './sabha-flow-fixtures';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';
import { expectFits } from './fit';

test('PDF typed zoom, safe keys, anchored zoom and captured mouse movement at CI window size', async () => {
  const { scan } = await writeFlows({ scan: SCAN });
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await win.getByRole('button', { name: 'Sabha flow', exact: true }).click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, scan);
    const panel = win.getByTestId('sabha-flow');
    await panel.getByRole('button', { name: 'Choose PDF…' }).click();
    const image = panel.getByTestId('flow-page');
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const input = panel.getByRole('textbox', { name: 'Zoom', exact: true });
    const region = panel.getByTestId('flow-pages');
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
    const before = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    await input.focus();
    await input.press('ArrowRight');
    await input.press('Space');
    await input.press('b');
    await input.press('Escape');
    expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).toEqual(before);
    await input.fill('400');
    await input.press('Enter');
    await region.evaluate((el) => { el.scrollLeft = 160; el.scrollTop = 180; });
    const start = await scroll();
    const bounds = await region.boundingBox();
    if (!bounds) throw new Error('PDF region has no bounds');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
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
    await region.evaluate((el) => { el.scrollLeft = 100; el.scrollTop = 200; });
    const anchor = await region.evaluate((el) => ({ x: (el.scrollLeft + el.clientWidth / 2 - 8) / 4, y: (el.scrollTop + el.clientHeight / 2 - 8) / 4 }));
    await panel.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(input).toHaveValue('300%');
    const after = await region.evaluate((el) => ({ x: (el.scrollLeft + el.clientWidth / 2 - 8) / 3, y: (el.scrollTop + el.clientHeight / 2 - 8) / 3 }));
    expect(Math.abs(after.x - anchor.x)).toBeLessThan(1);
    expect(Math.abs(after.y - anchor.y)).toBeLessThan(1);
    await panel.getByRole('button', { name: 'Fit to the panel' }).click();
    await expect(input).toHaveValue('100%');
    await expectFits(panel, 'PDF typed zoom at 1024 × 645');
  } finally {
    await app.close();
  }
});
