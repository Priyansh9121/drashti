import { expect, test } from '@playwright/test';
import { fKeyHint } from '../../src/shared/keymap';
import { chooseMenuItem, launchApp, openLibrary, operatorPage, operatorReady } from './helpers';

/*
 * The keys as each computer writes them (alpha.24, the owner's "shortcuts should be adaptable to mac, mac intel, and
 * windows"; keyplat): CI's Mac and Windows each check their own. The keys sheet writes a Mac's modifiers in Apple's
 * order (⇧⌘S, as its menus draw them) and says what this computer's F-keys need (a Mac's fn and Touch Bar, Windows'
 * Fn Lock); and with a Gujarati or Hindi keyboard layout, whose B key types "વ", B is Black-out on the window and a
 * letter in a field, never Black-out there.
 */

const platform = process.platform === 'darwin' ? 'darwin' : 'win32';

test('the keys sheet writes each key as this computer does, and says what its F-keys need', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await chooseMenuItem(app, 'keyboard-shortcuts');
  const sheet = win.getByTestId('keys-sheet');
  await expect(sheet).toBeVisible();
  // Screens and Uncover the controls: Shift before Command on a Mac, as Window › Uncover the Controls draws it.
  await expect(sheet).toContainText(platform === 'darwin' ? '⇧⌘S' : 'Ctrl+Shift+S');
  await expect(sheet).toContainText(platform === 'darwin' ? '⇧⌘U' : 'Ctrl+Shift+U');
  await expect(sheet).not.toContainText(platform === 'darwin' ? 'Ctrl' : '⌘');
  // Stop Repeat Slides' key as both keyboards print it.
  await expect(sheet).toContainText('Esc');
  await expect(sheet).not.toContainText('Escape');
  const fKeys = sheet.getByTestId('keys-fkeys');
  await expect(fKeys).toHaveText(fKeyHint(platform));
  await expect(fKeys).toContainText(platform === 'darwin' ? 'Touch Bar' : 'Fn Lock');
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await app.close();
});

test('with a Gujarati or Hindi layout, B is Black-out and Cmd or Ctrl with F is Search on the window, never in a field', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const blackout = win.getByTestId('blackout-button');
  const mod = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
  // A key press as a Gujarati or Devanagari layout makes it: its letter, and its place on the keyboard.
  const press = (
    where: 'window' | 'search',
    key: string,
    code: string,
    mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
  ) =>
    win.evaluate(
      ({ where: w, key: k, code: c, mods: m }) => {
        const target =
          w === 'search' ? document.querySelector('[data-testid="library-search"]') : document.body;
        target?.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true, ...m }),
        );
      },
      { where, key, code, mods },
    );
  await press('window', 'વ', 'KeyB');
  await expect(blackout).toHaveAccessibleName(/^Black-out is on/u);
  await press('window', 'ब', 'KeyB');
  await expect(blackout).not.toHaveAccessibleName(/^Black-out is on/u);
  // Cmd or Ctrl and the F key: the library, at its search box.
  await press('window', 'િ', 'KeyF', mod);
  await openLibrary(win);
  const search = win.getByTestId('library-search');
  await expect(search).toBeFocused();
  // In the search box the same keys are letters: no Black-out, and the box keeps the keyboard.
  await press('search', 'વ', 'KeyB');
  await press('search', 'ब', 'KeyB', { shiftKey: true });
  await press('search', '૧', 'Digit1', mod);
  await expect(search).toBeFocused();
  await expect(blackout).not.toHaveAccessibleName(/^Black-out is on/u);
  await app.close();
});
