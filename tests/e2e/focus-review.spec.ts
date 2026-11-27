import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/* Review regressions for the focus keeper: retained lists still need a regional fallback when their own handlers
 * leave the keyboard nowhere. A row move that restores usable focus keeps precedence. Placeholder content only. */
const NAME = 'Placeholder focus playlist';

const makePlaylist = (win: Page, items = false) =>
  win.evaluate(async ({ name, items }) => {
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
  }, { name: NAME, items });

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
      await expect(region.getByTestId('playlist-node').filter({ hasText: finish === 'Enter' ? 'Placeholder renamed playlist' : NAME })).toHaveCount(1);
      expect(await list?.evaluate((el) => el.isConnected)).toBe(true);
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
    expect(await list?.evaluate((el) => el.isConnected)).toBe(true);
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('data-focus-kept', '');
    await win.keyboard.press('Enter');
    await expect(region.getByTestId('playlist-item')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
