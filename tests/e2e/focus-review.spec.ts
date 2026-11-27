import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/* Review regressions for the focus keeper: retained lists still need a regional fallback when their own handlers
 * leave the keyboard nowhere. A row move that restores usable focus keeps precedence. Placeholder content only. */
const NAME = 'Placeholder focus playlist';

const makePlaylist = (win: Page, items = false) =>
  win.evaluate(
    async ({ name, items }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      const id = made.ids[0];
      if (!id) throw new Error('No placeholder playlist');
      if (items) {
        const added = await d.playlists.addItems(id, null, [
          { kind: 'header', label: 'Placeholder first' },
          { kind: 'header', label: 'Placeholder second' },
        ]);
        if (!added.ok) throw new Error(added.message);
      }
    },
    { name: NAME, items },
  );

for (const finish of ['Enter', 'Escape'])
  test(`finishing an existing playlist rename with ${finish} keeps focus in Playlists while the list remains`, async () => {
    const { app } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      await makePlaylist(win);
      const region = win.getByTestId('playlists');
      await region.getByTestId('playlist-node').filter({ hasText: NAME }).click();
      await region.getByRole('button', { name: `Rename playlist “${NAME}”` }).focus();
      await win.keyboard.press('Enter');
      const field = region.getByTestId('rename-field');
      await expect(field).toBeFocused();
      const list = await region.getByTestId('playlist-tree').elementHandle();
      await field.fill('Placeholder renamed playlist');
      await win.keyboard.press(finish);
      await expect(field).toHaveCount(0);
      await expect(
        region
          .getByTestId('playlist-node')
          .filter({ hasText: finish === 'Enter' ? 'Placeholder renamed playlist' : NAME }),
      ).toHaveCount(1);
      expect(await list.evaluate((el) => el.isConnected)).toBe(true);
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('data-focus-kept', '');
      await win.keyboard.press('Tab');
      expect(await region.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    } finally {
      await app.close();
    }
  });

test('a row move keeps its local focus; removing its non-live item then keeps focus in the playlist while its list remains', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await makePlaylist(win, true);
    await win.getByTestId('playlist-node').filter({ hasText: NAME }).click();
    const region = win.getByTestId('open-playlist');
    const first = region.getByTestId('playlist-item').filter({ hasText: 'Placeholder first' });
    await first.click();
    const down = region.getByRole('button', { name: 'Down', exact: true });
    await down.focus();
    await win.keyboard.press('Enter');
    await expect(region.getByTestId('playlist-item').last()).toContainText('Placeholder first');
    await expect(first).toBeFocused();
    await expect(region).not.toHaveAttribute('data-focus-kept', '');
    const list = await region.getByTestId('playlist-items').elementHandle();
    await region.getByRole('button', { name: 'Remove “Placeholder first” from the playlist' }).focus();
    await win.keyboard.press('Enter');
    await expect(first).toHaveCount(0);
    await expect(region.getByTestId('playlist-item')).toHaveCount(1);
    expect(await list.evaluate((el) => el.isConnected)).toBe(true);
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('data-focus-kept', '');
    await win.keyboard.press('Enter');
    await expect(region.getByTestId('playlist-item')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

/** The keyboard's location remains visibly marked, including after the action becomes usable again. */
async function expectKeptRing(dialog: Locator): Promise<void> {
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveAttribute('data-focus-kept', '');
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog).toHaveCSS('outline-style', 'solid');
  await expect(dialog).toHaveCSS('outline-width', '2px');
  await expect(dialog).toHaveCSS('outline-offset', '-2px');
  const drawn = await dialog.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      keyboard: el.matches(':focus-visible'),
      ring: style.outlineColor,
      surface: style.backgroundColor,
      opacity: style.opacity,
      forcedAdjust: style.forcedColorAdjust,
    };
  });
  expect(drawn.keyboard).toBe(true);
  expect(drawn.ring).not.toBe(drawn.surface);
  expect(drawn.ring).not.toMatch(/transparent|rgba\([^)]*, 0\)$/u);
  expect(drawn.opacity).toBe('1');
  expect(drawn.forcedAdjust).toBe('auto');
}

for (const media of [
  { name: 'ordinary motion', reducedMotion: 'no-preference', forcedColors: 'none' },
  { name: 'reduced motion', reducedMotion: 'reduce', forcedColors: 'none' },
  { name: 'forced colours with reduced motion', reducedMotion: 'reduce', forcedColors: 'active' },
] as const)
  test(`the kept Manual dialog has a full visible ring during printing and live-show restrictions: ${media.name}`, async () => {
    const { app } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      await sizeOperatorWindow(app, win, CI_WINDOW);
      await win.emulateMedia({ reducedMotion: media.reducedMotion, forcedColors: media.forcedColors });
      // Hold only the native print callback: no real printer, timed delay, or application behavior changed.
      await app.evaluate(({ app: electronApp }) => {
        const g = globalThis as { drashtiFinishFocusPrint?: () => void };
        electronApp.on('browser-window-created', (_event, window) => {
          window.webContents.print = (
            _options: unknown,
            callback?: (success: boolean, why: string) => void,
          ) => {
            g.drashtiFinishFocusPrint = () => {
              delete g.drashtiFinishFocusPrint;
              callback?.(true, '');
            };
          };
        });
      });
      await chooseMenuItem(app, 'manual');
      const manual = win.getByTestId('manual');
      const print = manual.getByRole('button', { name: 'Print…', exact: true });
      const save = manual.getByRole('button', { name: 'Save as PDF…', exact: true });
      await expect(print).toBeEnabled();
      await expect(manual.getByRole('searchbox', { name: 'Search the manual' })).toBeFocused();
      await win.keyboard.press('Tab');
      await expect(print).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(print).toBeDisabled();
      await expect(save).toBeDisabled();
      await expectKeptRing(manual);
      await expect
        .poll(() =>
          app.evaluate(
            () => typeof (globalThis as { drashtiFinishFocusPrint?: () => void }).drashtiFinishFocusPrint,
          ),
        )
        .toBe('function');
      await app.evaluate(() =>
        (globalThis as { drashtiFinishFocusPrint?: () => void }).drashtiFinishFocusPrint?.(),
      );
      await expect(print).toBeEnabled();
      await expectKeptRing(manual);

      // The other action can become disabled through the live-show restriction while it holds keyboard focus.
      await save.focus();
      await expect(manual).not.toHaveAttribute('data-focus-kept', '');
      await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const first = (await d.library.listPresentations())[0];
        if (!first) throw new Error('No placeholder presentation');
        await d.engine.dispatch({ type: 'goLive', presentationId: first.id, slideIndex: 0 });
      });
      await expect(save).toBeDisabled();
      await expect(manual.getByTestId('manual-waits')).toBeVisible();
      await expectKeptRing(manual);
      await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
      await expect(save).toBeEnabled();
      await expectKeptRing(manual);
      await win.keyboard.press('Escape');
      await expect(manual).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
