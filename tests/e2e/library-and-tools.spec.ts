import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  closeLibrary,
  launchApp,
  openLibrary,
  openMoreTools,
  operatorPage,
  operatorReady,
  windowShowing,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The library's button and the setup tools (Session 60, x36; the owner, 19 Nov 2026, using alpha.19): "remove the
 * library option above that, we dont need it" (his answer to A, "Yes, all": the Library button hidden only while the
 * library is open, where it repeats the sheet's own Library header; kept while it is closed, the way to open it besides
 * Cmd+F), and "we want to keep the QR code as well, but somewhere accesibble, … maybe somewhere we can access and
 * remember easily, below lower thirds?" (his answer: "A, More tools + menu"): Show a Window…, Add a Video Input…,
 * Picture in Picture… and QR code… in More tools under Lower Thirds and the MIDI controller, each with its line, and in
 * a Tools menu in the menu bar (Pro Mode); the library's rows keep Import… and New…. At CI's window size.
 */

const TOOLS: readonly { testId: string; name: string; dialog: string }[] = [
  { testId: 'show-a-window', name: 'Show a Window…', dialog: 'window-picker' },
  { testId: 'add-video-input', name: 'Add a Video Input…', dialog: 'video-input-dialog' },
  { testId: 'pip-open', name: 'Picture in Picture…', dialog: 'pip-dialog' },
  { testId: 'qr-code-open', name: 'QR code…', dialog: 'qr-dialog' },
];

/** The menu bar's top-level menus, and the Tools menu's items (not its separators), by their words. */
const menus = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const bar = Menu.getApplicationMenu()?.items ?? [];
    const tools = bar.find((i) => i.label === 'Tools');
    return {
      bar: bar.map((i) => i.label),
      tools:
        tools?.submenu?.items.filter((i) => i.type !== 'separator').map((i) => `${i.id}: ${i.label}`) ?? null,
    };
  });

/** A dialog of the operator window, open, then shut with Esc. */
async function opensAndShuts(win: Page, dialog: string): Promise<void> {
  const box = win.getByTestId(dialog);
  await expect(box).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
}

test('the Library button: there while the library is closed, gone while it is open (the sheet’s own Library header at the column’s top), back with the keyboard on it as the library closes', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const column = win.getByRole('region', { name: 'Playlists' });
  const button = win.getByTestId('library-button');
  const sheet = win.getByTestId('library-sheet');

  // Closed: the button opens it.
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(sheet).toBeVisible();
  await expect(win.locator('#library-search')).toBeFocused();
  // Open: one Library at the top of the column, the sheet's own header; no button above it.
  await expect(button).toHaveCount(0);
  await expect(column.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0);
  await expect(column.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  const tops = await win.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    return { column: top('section[aria-label="Playlists"]'), sheet: top('[data-testid="library-sheet"]') };
  });
  expect(Math.abs(tops.sheet - tops.column), 'the sheet starts at the column’s top').toBeLessThanOrEqual(1);
  await expectNoSeriousA11yIssues(win, 'the open library', 'section[aria-label="Playlists"]');

  // Esc shuts it: the button is back, with the keyboard.
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeVisible();
  await expect(button).toBeFocused();

  // Cmd+F (Ctrl+F) opens it at the search box, with no button over it; its own close button shuts it.
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await expect(sheet).toBeVisible();
  await expect(win.locator('#library-search')).toBeFocused();
  await expect(button).toHaveCount(0);
  await win.getByTestId('library-close').click();
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  await app.close();
});

test('the setup tools in More tools and a Tools menu: Show a Window…, Add a Video Input…, Picture in Picture… and QR code…, each with its line under Lower Thirds and the MIDI controller; the library keeps Import… and New…; none in Simple Mode', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1', DRASHTI_TEST_WINDOW_STANDIN: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);

  // The library's rows: Import… and New… in Presentations and in Media, nothing more.
  const sheet = await openLibrary(win);
  const rowOf = sheet.getByTestId('library-tools');
  await expect(rowOf.getByRole('button')).toHaveText(['Import…', 'New…']);
  await sheet.getByTestId('library-tab-media').click();
  await expect(rowOf.getByRole('button')).toHaveText(['Import…', 'New…']);
  for (const tool of TOOLS) await expect(win.getByTestId(tool.testId)).toHaveCount(0);
  await closeLibrary(win);

  // More tools: the four under Lower Thirds and the MIDI controller, each with its line, each opening its window.
  await openMoreTools(win);
  const more = win.getByTestId('more-tools');
  const setup = more.getByTestId('setup-tools');
  await setup.scrollIntoViewIfNeeded();
  await expect(setup.getByRole('button')).toHaveText(TOOLS.map((t) => t.name));
  const order = await win.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    return [
      top('[data-testid="lower-thirds-panel"]'),
      top('[data-testid="open-midi"]'),
      top('[data-testid="setup-tools"]'),
    ];
  });
  expect(order[0] ?? -1, 'Lower Thirds above the MIDI controller').toBeLessThan(order[1] ?? -1);
  expect(order[1] ?? -1, 'the setup tools under the MIDI controller').toBeLessThan(order[2] ?? -1);
  for (const tool of TOOLS) {
    const line = setup.getByTestId(`${tool.testId}-line`);
    await expect(line).toBeVisible();
    expect((await line.innerText()).trim().length, `${tool.name}: its line`).toBeGreaterThan(20);
    await setup.getByTestId(tool.testId).click();
    await opensAndShuts(win, tool.dialog);
  }
  await expectNoSeriousA11yIssues(win, 'More tools with the setup tools', '[data-testid="more-tools"]');

  // The Tools menu, after View and before Window (Mac and Windows): the four, then Lower Thirds, MIDI and OSC.
  const { bar, tools } = await menus(app);
  expect(bar.indexOf('Tools'), 'a Tools menu').toBeGreaterThan(-1);
  expect(bar.indexOf('Tools')).toBe(bar.indexOf('View') + 1);
  expect(bar.indexOf('Window')).toBe(bar.indexOf('Tools') + 1);
  expect(tools).toEqual([
    'tools-show-a-window: Show a Window…',
    'tools-add-video-input: Add a Video Input…',
    'tools-picture-in-picture: Picture in Picture…',
    'tools-qr-code: QR code…',
    'tools-lower-thirds-studio: Lower Thirds Studio…',
    'tools-midi: MIDI Controller…',
    'tools-osc: OSC Control…',
  ]);
  for (const [item, dialog] of [
    ['tools-show-a-window', 'window-picker'],
    ['tools-add-video-input', 'video-input-dialog'],
    ['tools-picture-in-picture', 'pip-dialog'],
    ['tools-qr-code', 'qr-dialog'],
    ['tools-midi', 'midi-dialog'],
    ['tools-osc', 'osc-dialog'],
  ] as const) {
    await chooseMenuItem(app, item);
    await opensAndShuts(win, dialog);
  }
  await chooseMenuItem(app, 'tools-lower-thirds-studio');
  const isStudio = (p: Page) => p.url().includes('lower-thirds.html');
  const studio = await windowShowing(app, isStudio, 'the Lower Thirds studio');
  await expect(studio.getByTestId('lt-studio')).toBeVisible({ timeout: 30_000 });
  // Shut as its window's close button does: nothing changed in it, nothing asked.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('lower-thirds.html'))
      ?.close();
  });
  await expect.poll(() => app.windows().some(isStudio)).toBe(false);

  // Simple Mode has none of them: no Tools menu, nothing in the window.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect.poll(async () => (await menus(app)).bar.includes('Tools')).toBe(false);
  for (const tool of TOOLS) await expect(win.getByTestId(tool.testId)).toHaveCount(0);
  await app.close();
});
