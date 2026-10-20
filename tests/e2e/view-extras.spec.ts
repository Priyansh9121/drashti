import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  closeLibrary,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';

/*
 * Hidden, not deleted (Session 26a): the Shastra tab, the Templates beside the
 * playlists and the kirtan filters leave the operator window, and an admin's
 * View › Show Shastra, Templates and Kirtan Details (off to begin with, kept
 * with the library's settings) brings them back. Import… stands where the
 * filters were: Files…, A Folder… and From a Link….
 */

const menuChecked = (app: Awaited<ReturnType<typeof launchApp>>['app']) =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('show-extras')?.checked ?? null);

test('Shastra, Templates and the kirtan filters are hidden to begin with; the View switch brings them back, and keeps', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const shastraTab = win.getByTestId('library-tab-shastra');
  const templatesTab = win.getByTestId('playlist-view-tab-templates');
  const filters = win.getByTestId('filter-button');
  // Hidden: the library has Presentations and Media, the playlists a heading, and Import… where the filters were.
  await openLibrary(win);
  await expect(win.getByTestId('library-tab-presentations')).toBeVisible();
  await expect(win.getByTestId('library-tab-media')).toBeVisible();
  await expect(shastraTab).toHaveCount(0);
  await expect(templatesTab).toHaveCount(0);
  await expect(filters).toHaveCount(0);
  await expect(win.getByTestId('playlists').getByRole('heading', { name: 'Playlists' })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Import…' })).toBeVisible();
  expect(await menuChecked(app)).toBe(false);
  // A playlist's menu has no slots or templates either.
  await closeLibrary(win);
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.playlists.create('Placeholder Sunday', null, false),
  );
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sunday' }).click();
  await win.getByRole('button', { name: 'Playlist actions' }).click();
  await expect(win.getByRole('menuitem', { name: 'Add a header' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Add a slot…' })).toHaveCount(0);
  await expect(win.getByRole('menuitem', { name: 'Save as template…' })).toHaveCount(0);
  await win.keyboard.press('Escape');
  await win.getByTestId('playlist-close').click();
  await expectNoSeriousA11yIssues(win, 'the operator window with Shastra, Templates and the filters hidden');

  // View › Show Shastra, Templates and Kirtan Details: all three come back.
  await chooseMenuItem(app, 'show-extras');
  await openLibrary(win);
  await expect(shastraTab).toBeVisible();
  await expect(templatesTab).toBeVisible();
  await expect(filters).toBeVisible();
  await expect.poll(() => menuChecked(app)).toBe(true);
  await shastraTab.click();
  await expect(win.getByTestId('library-tab-shastra')).toHaveAttribute('aria-selected', 'true');
  // Kept with the library's settings: still shown after a restart.
  await app.close();
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await openLibrary(win2);
  await operatorReady(win2);
  await expect(win2.getByTestId('library-tab-shastra')).toBeVisible();
  expect(await menuChecked(again.app)).toBe(true);
  // Off again: the window leaves the Shastra tab it was on for Presentations.
  await win2.getByTestId('library-tab-shastra').click();
  await chooseMenuItem(again.app, 'show-extras');
  await expect(win2.getByTestId('library-tab-shastra')).toHaveCount(0);
  await expect(win2.getByTestId('library-tab-presentations')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => menuChecked(again.app)).toBe(false);
  await again.app.close();
});

test('Import… offers Files… (everything Drashti imports), A Folder… and From a Link…', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  // Every system file dialog answers "cancelled", and says what it was asked.
  await app.evaluate(({ dialog }) => {
    const asked: unknown[] = [];
    (globalThis as { asked?: unknown[] }).asked = asked;
    dialog.showOpenDialog = (...args: unknown[]) => {
      asked.push(args.at(-1));
      return Promise.resolve({ canceled: true, filePaths: [] });
    };
  });
  await openLibrary(win);
  const asked = () =>
    app.evaluate(
      () =>
        (globalThis as { asked?: { properties?: string[]; filters?: { extensions: string[] }[] }[] }).asked ??
        [],
    );
  const importButton = win.getByRole('button', { name: 'Import…' });
  await importButton.click();
  const menu = win.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Files…', 'A Folder…', 'From a Link…']);
  await expectNoSeriousA11yIssues(win, 'the Import… menu');
  await menu.getByRole('menuitem', { name: 'Files…' }).click();
  await expect.poll(async () => (await asked()).length).toBe(1);
  const files = (await asked())[0];
  expect(files?.properties).toEqual(expect.arrayContaining(['openFile', 'multiSelections']));
  const extensions = files?.filters?.[0]?.extensions ?? [];
  for (const ext of [
    'pptx',
    'key',
    'pdf',
    'png',
    'jpg',
    'heic',
    'mp4',
    'mov',
    'mp3',
    'wav',
    'pro6',
    'pro6x',
    'pro',
    'probundle',
    'txt',
  ])
    expect(extensions, ext).toContain(ext);
  await importButton.click();
  await menu.getByRole('menuitem', { name: 'A Folder…' }).click();
  await expect.poll(async () => (await asked()).length).toBe(2);
  expect((await asked())[1]?.properties).toEqual(['openDirectory']);
  await importButton.click();
  await menu.getByRole('menuitem', { name: 'From a Link…' }).click();
  await expect(win.getByTestId('link-dialog')).toBeVisible();
  await app.close();
});
