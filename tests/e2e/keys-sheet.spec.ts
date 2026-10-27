import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_GROUPS, KEYMAP } from '../../src/shared/keymap';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';

/*
 * The keys sheet (Session 25): Help > Keyboard Shortcuts…, or ? when no field has the focus, in Pro
 * Mode only. It lists every key in KEYMAP, grouped by what the operator is doing, as this computer
 * writes them, and says they follow what the operators already press (Session 50).
 */

const menuHas = (app: Awaited<ReturnType<typeof launchApp>>['app'], id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId) != null, id);

test('the keys sheet opens from the Help menu and with ?, lists every key, and is Pro Mode’s only', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const sheet = win.getByTestId('keys-sheet');

  // Help > Keyboard Shortcuts…
  await chooseMenuItem(app, 'keyboard-shortcuts');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('keys-group')).toHaveCount(KEY_GROUPS.length);
  for (const binding of KEYMAP) await expect(sheet).toContainText(binding.label);
  await expect(sheet.getByTestId('keys-follow')).toHaveText(
    'These keys follow what the operators already press.',
  );
  // As this computer writes them: Search is ⌘F on a Mac, Ctrl+F on Windows.
  await expect(sheet).toContainText(process.platform === 'darwin' ? '⌘F' : 'Ctrl+F');
  // The keys the operators already press (Session 50): F12 for the Logo, Cmd+1 and Cmd+2 (Ctrl+1 and
  // Ctrl+2 on Windows) for the Audience and Stage screens.
  const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl+';
  for (const key of ['F12', `${mod}1`, `${mod}2`]) await expect(sheet).toContainText(key);
  await expectNoSeriousA11yIssues(win, 'the keys sheet');
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // ? with no field chosen opens it, and ? closes it again.
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toBeVisible();
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toHaveCount(0);
  // In a field, ? is a character: no sheet.
  await openLibrary(win);
  const search = win.getByTestId('library-search');
  await search.focus();
  await win.keyboard.type('?');
  await expect(search).toHaveValue('?');
  await expect(sheet).toHaveCount(0);
  await search.fill('');

  // Simple Mode keeps its key line: no menu item, and ? does nothing.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  expect(await menuHas(app, 'keyboard-shortcuts')).toBe(false);
  await win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toHaveCount(0);
  await app.close();
});

/*
 * Single-letter keys (Session 37, WCAG 2.1.4): B and . (Black-out), L (the Logo) and ? (this list) act
 * anywhere in the window, so a word said to speech software, or a key brushed, could black out the hall.
 * They stay on unless they are turned off, with the switch in the keys sheet (anyone's in Pro Mode, with no PIN
 * since Session 54, E5): then they do nothing anywhere (the window, its menus, Simple Mode), and Black-out and
 * the Logo still work from their buttons.
 * The Logo keeps F12 (Session 50), a named key: the window shows it beside the Logo still.
 */

const show = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.engine.snapshot();
    return { rev: s.rev, blackout: s.state.blackout, logo: s.state.logo };
  });

const singleKeys = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.singleKeys());

/** Nothing has the keyboard: the show's keys act anywhere in the window then. */
const letGo = (win: Page) =>
  win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

/** A placeholder prop marked as the logo, so F12 and L have something to put up. */
async function markLogo(win: Page): Promise<void> {
  const problem = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const prop = await d.props.save(null, {
      name: 'Placeholder Logo',
      width: 1920,
      height: 1080,
      elements: [
        {
          id: 'placeholder-logo-text',
          kind: 'text',
          frame: { x: 360, y: 440, width: 1200, height: 200 },
          text: 'Placeholder Logo',
          lang: 'en',
          style: {
            fontFamily: null,
            fontSize: 96,
            fontWeight: 700,
            color: '#ffffff',
            align: 'center',
            verticalAlign: 'middle',
            lineHeight: 1.2,
            shadow: false,
          },
        },
      ],
    });
    if (!prop.ok) return prop.message;
    const marked = await d.props.setLogo(prop.id);
    return marked.ok ? '' : marked.message;
  });
  expect(problem).toBe('');
}

/** Every accelerator in the application menu, as set. */
const menuAccelerators = (app: Awaited<ReturnType<typeof launchApp>>['app']) =>
  app.evaluate(({ Menu }) => {
    const found: string[] = [];
    const walk = (items: Electron.MenuItem[]) => {
      for (const item of items) {
        if (item.accelerator) found.push(item.accelerator);
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(Menu.getApplicationMenu()?.items ?? []);
    return found;
  });

test('single-letter keys (B, ., L and ?) are on to begin with, and can be turned off in the keys sheet: then they do nothing, in Pro and Simple Mode, and the buttons still work (Session 37, WCAG 2.1.4)', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await markLogo(win);
  const sheet = win.getByTestId('keys-sheet');
  const blackoutButton = win.getByTestId('blackout-button');
  const logoButton = win.getByTestId('logo-button');

  // On to begin with: they work as they always have, and the buttons show their first keys (the Logo's is
  // F12, as the operators press it: Session 50).
  await expect(blackoutButton.locator('kbd')).toHaveText('B');
  await expect(logoButton.locator('kbd')).toHaveText('F12');
  await letGo(win);
  await win.keyboard.press('b');
  await expect.poll(async () => (await show(win)).blackout).toBe(true);
  await win.keyboard.press('.');
  await expect.poll(async () => (await show(win)).blackout).toBe(false);
  await win.keyboard.press('l');
  await expect.poll(async () => (await show(win)).logo).not.toBeNull();
  await win.keyboard.press('l');
  await expect.poll(async () => (await show(win)).logo).toBeNull();
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toBeVisible();

  // The switch, in the keys sheet: off.
  const single = sheet.getByTestId('keys-single');
  await expect(single).toHaveAccessibleName('Single-letter keys (B, ., L and ?)');
  await expect(single).toBeChecked();
  expect(await singleKeys(win)).toBe(true);
  await single.click();
  await expect(single).not.toBeChecked();
  expect(await singleKeys(win)).toBe(false);
  // The sheet says they are off, beside each of them too.
  await expect(sheet.getByTestId('keys-single-off')).toContainText('B, ., L and ? do nothing');
  await expect(sheet.getByTestId('keys-single-off')).toContainText('and the Logo from F12');
  // Black-out and this list of keys: the Logo keeps F12 (Session 50).
  await expect(sheet.getByTestId('keys-off')).toHaveCount(2);
  await expectNoSeriousA11yIssues(win, 'the keys sheet with the single-letter keys off');
  // ? no longer closes it either; Esc does.
  await win.keyboard.press('Shift+Slash');
  await expect(sheet).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Off: B, ., L and ? leave the show (its revision) and the window as they are.
  await letGo(win);
  const before = await show(win);
  for (const key of ['b', 'Shift+B', '.', 'l', 'Shift+L', 'Shift+Slash']) await win.keyboard.press(key);
  await holdStill(
    async () => (await show(win)).rev === before.rev && (await sheet.count()) === 0,
    1500,
    'B, ., L and ? are off: nothing changes',
  );
  expect(await show(win)).toEqual(before);
  // No menu answers a single key either: each accelerator has Cmd, Ctrl or Alt, or is a named key.
  const single1 = (accelerator: string) => {
    const parts = accelerator.split('+');
    const key = parts.pop() ?? '';
    return key.length === 1 && parts.every((p) => p === 'Shift');
  };
  expect((await menuAccelerators(app)).filter(single1)).toEqual([]);
  // F12 still puts the Logo up and takes it down (Session 50): a named key, never acted on by a word said.
  await win.keyboard.press('F12');
  await expect.poll(async () => (await show(win)).logo).not.toBeNull();
  await win.keyboard.press('F12');
  await expect.poll(async () => (await show(win)).logo).toBeNull();
  // The buttons still work; Black-out's no longer shows a key, and the Logo's shows F12.
  await expect(blackoutButton.locator('kbd')).toHaveCount(0);
  await expect(logoButton.locator('kbd')).toHaveText('F12');
  await blackoutButton.click();
  await expect.poll(async () => (await show(win)).blackout).toBe(true);
  await blackoutButton.click();
  await expect.poll(async () => (await show(win)).blackout).toBe(false);
  await logoButton.click();
  await expect.poll(async () => (await show(win)).logo).not.toBeNull();
  await logoButton.click();
  await expect.poll(async () => (await show(win)).logo).toBeNull();

  // Kept with the library's settings: still off after a restart.
  await app.close();
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  expect(await singleKeys(win2)).toBe(false);
  await letGo(win2);
  const before2 = await show(win2);
  await win2.keyboard.press('b');
  await holdStill(async () => (await show(win2)).rev === before2.rev, 1000, 'B is still off after a restart');

  // Simple Mode: the keys do nothing there either, its key line does not name them, its buttons work, and it
  // cannot turn them back on.
  await win2.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win2.getByTestId('simple-mode')).toBeVisible();
  const keyLine = win2.getByTestId('simple-keys');
  await expect(keyLine).toContainText('Clear all');
  // The Logo keeps F12 there too (Session 50); only Black-out is left to its button.
  await expect(keyLine).toContainText('Logo F12');
  await expect(keyLine).toContainText('Black-out: its button');
  expect(await keyLine.locator('kbd').allTextContents()).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/^[B.L]$/u)]),
  );
  await letGo(win2);
  const before3 = await show(win2);
  for (const key of ['b', '.', 'l']) await win2.keyboard.press(key);
  await holdStill(
    async () => (await show(win2)).rev === before3.rev,
    1000,
    'B, . and L are off in Simple Mode',
  );
  await win2.getByTestId('simple-blackout').click();
  await expect.poll(async () => (await show(win2)).blackout).toBe(true);
  await win2.getByTestId('simple-blackout').click();
  await expect.poll(async () => (await show(win2)).blackout).toBe(false);
  const refused = await win2.evaluate(() => (globalThis as PageGlobals).drashti.app.setSingleKeys(true));
  expect(refused).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  expect(await singleKeys(win2)).toBe(false);
  await again.app.close();
});

/*
 * The window shows nothing until it knows whether the single-letter keys act (Session 37), so that request is
 * always answered (Session 38, found by the assister reading Session 37): when the setting cannot be read (a
 * refused read of the library), the window shows with them on, as they are by default, and the log says why,
 * once. Before, the request failed and the operator window stayed blank.
 */
test('the operator window shows, the single-letter keys on, when their setting cannot be read, and the log says why once (Session 38)', async () => {
  test.setTimeout(90_000);
  const { app, userData } = await launchApp({ DRASHTI_TEST_SINGLE_KEYS_UNREADABLE: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await expect(win.getByTestId('blackout-button').locator('kbd')).toHaveText('B');
  expect(await singleKeys(win)).toBe(true);
  await letGo(win);
  await win.keyboard.press('b');
  await expect.poll(async () => (await show(win)).blackout).toBe(true);
  await win.keyboard.press('b');
  await expect.poll(async () => (await show(win)).blackout).toBe(false);
  // Asked again as the window opens again: on again, and still one line in the log.
  await win.reload();
  await operatorReady(win);
  expect(await singleKeys(win)).toBe(true);
  const said = () =>
    readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('Keys: the single-letter keys setting could not be read'));
  await expect.poll(said).toHaveLength(1);
  expect(said()[0]).toContain('so they are on, as they are by default');
  expect(said()[0]).toContain('A test made this read of the library fail');
  await app.close();
});
