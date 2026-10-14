import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Menus from the keyboard (Session 25): the choice with the focus shows the focus ring, closing
 * gives the focus back to what opened the menu (unless a choice put it somewhere else), and Esc
 * closes only the menu, even over the slide editor. Placeholder content only.
 */

/** The outline of whatever has the focus now. */
const focusRing = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return null;
    const style = getComputedStyle(el);
    return { role: el.getAttribute('role'), outline: style.outlineStyle, width: style.outlineWidth };
  });

test('a menu from the keyboard shows its focus ring, and closing gives the focus back', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.playlists.create(
      'Placeholder Menu Sabha',
      null,
      false,
    );
    if (!made.ok) throw new Error(made.message);
  });
  const panel = win.getByTestId('playlists');

  // The New menu, from its button: the first choice has the focus and its ring shows.
  const opener = panel.getByRole('button', { name: 'New playlist or folder' });
  await opener.focus();
  await win.keyboard.press('Enter');
  await expect(win.getByRole('menuitem', { name: 'New playlist' })).toBeFocused();
  expect(await focusRing(win)).toEqual({ role: 'menuitem', outline: 'solid', width: '2px' });
  await win.keyboard.press('ArrowDown');
  expect(await focusRing(win)).toEqual({ role: 'menuitem', outline: 'solid', width: '2px' });
  // Esc: the menu goes, and the keyboard is back on the button.
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu')).toHaveCount(0);
  await expect(opener).toBeFocused();

  // A playlist's own menu (Shift+F10 on it): Esc gives the focus back to the playlist.
  const node = panel.getByTestId('playlist-node').filter({ hasText: /^Placeholder Menu Sabha/u });
  await node.focus();
  await win.keyboard.press('Shift+F10');
  await expect(win.getByRole('menuitem', { name: 'Open' })).toBeFocused();
  expect((await focusRing(win))?.outline).toBe('solid');
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu')).toHaveCount(0);
  await expect(node).toBeFocused();

  // A choice that puts the focus somewhere else keeps it there: Rename… gives the name field.
  await win.keyboard.press('Shift+F10');
  await win.getByRole('menuitem', { name: 'Rename…' }).focus();
  await win.keyboard.press('Enter');
  await expect(panel.getByTestId('rename-field')).toBeFocused();
  await win.keyboard.press('Escape');
  await app.close();
});

test('Esc in a menu over the slide editor closes only the menu', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  await win.getByTestId('presentation-list').getByRole('button').first().click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  // Nothing changed or chosen in the editor: an Esc that reached it would close it.
  const shape = editor.getByTestId('add-shape');
  await shape.focus();
  await win.keyboard.press('Enter');
  await expect(win.getByRole('menu', { name: 'Add a shape' })).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu')).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(shape).toBeFocused();
  // The next Esc is the editor's own, and closes it (nothing changed).
  await win.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await app.close();
});

test('a library row’s menu holds the keyboard: the arrows and Space never move the show', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // No playlist open: a presentation's menu has "Add to playlist (open a playlist first)", off, and
  // Delete… (Session 26a; before, the menu had nothing to choose).
  const row = win.getByTestId('presentation-list').getByTestId('presentation-row').first();
  await row.click();
  await expect(win.getByTestId('slide-grid')).toBeVisible();
  await row.focus();
  await win.keyboard.press('Shift+F10');
  const menu = win.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Add to playlist/ })).toBeDisabled();
  const remove = menu.getByRole('menuitem', { name: 'Delete…' });
  // The one choice there is has the keyboard.
  await expect(remove).toBeFocused();
  const live = () =>
    win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.presentationId,
    );
  // Arrows in the menu: nothing goes up on the screens, and the keyboard stays in the menu.
  for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home']) await win.keyboard.press(key);
  await expect(remove).toBeFocused();
  expect(await live()).toBeNull();
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
  // Space presses the choice (Delete… asks first), never Next.
  await win.keyboard.press('Shift+F10');
  await expect(remove).toBeFocused();
  await win.keyboard.press('Space');
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toBeVisible();
  expect(await live()).toBeNull();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByTestId('presentation-list').getByTestId('presentation-row')).toHaveCount(2);
  expect(await live()).toBeNull();
  await app.close();
});
