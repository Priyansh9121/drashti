import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, outputPage, relaunchApp, setUpScreen } from './helpers';
import { makeTestImage } from './test-media';

/*
 * File > Back Up Library… and Restore Library…: after a restore the library
 * is as it was at the backup, the one before it is kept under Backups/, and
 * Drashti starts again with nothing live, without asking the usual quit
 * question on the way.
 */

const outputs = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

test('a backup brings the library back as it was, keeping the one before', async () => {
  const first = await launchApp({
    ...outputs,
    // The quit question is on here (it is off in other tests): the restore must not ask it.
    DRASHTI_NO_QUIT_CONFIRM: '0',
    // Just quit after Restore Library…; the test starts Drashti again itself.
    DRASHTI_TEST_NO_RELAUNCH: '1',
  });
  const win = await operatorPage(first.app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-backup-e2e-'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { width: 160, height: 90 });
  const song = join(dir, 'Placeholder Kept Song.txt');
  writeFileSync(song, 'Placeholder kept line one\n\nPlaceholder kept line two\n');
  const [, songId = ''] = await importAndGetIds(win, [picture, song]);
  const names = () =>
    win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name).sort(),
    );
  const atBackup = await names();
  expect(atBackup).toContain('Placeholder Kept Song');

  // Something on a screen, so quitting would normally ask first.
  await setUpScreen(win);
  await outputPage(first.app);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    songId,
  );

  // Back up, with the media, into a folder the operator picks.
  const backups = mkdtempSync(join(tmpdir(), 'drashti-backups-e2e-'));
  await first.app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: true });
  }, backups);
  await first.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('backup-library')?.click();
  });
  await expect(win.getByRole('alert').filter({ hasText: 'Library backed up to' })).toBeVisible();
  const [backup = ''] = readdirSync(backups);
  expect(backup).toMatch(/^Drashti backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/u);
  expect(readdirSync(join(backups, backup)).sort()).toEqual(['Media', 'backup.json', 'drashti.sqlite']);
  expect(readdirSync(join(backups, backup, 'Media'), { recursive: true }).length).toBeGreaterThan(0);

  // Then the library changes: one presentation removed, another added.
  await win.evaluate(async (id) => {
    const lib = (globalThis as PageGlobals).drashti.library;
    const removed = await lib.removePresentations([id]);
    if (!removed.ok) throw new Error(removed.message);
    const added = await lib.newFromWords('Placeholder Added Later', 'Placeholder added line');
    if (!added.ok) throw new Error(added.message);
  }, songId);
  const changed = await names();
  expect(changed).toContain('Placeholder Added Later');
  expect(changed).not.toContain('Placeholder Kept Song');

  // Restore: the folder is checked, the operator is asked once (and told the screens go black),
  // and Drashti quits without the usual question. Either question going wrong keeps it open
  // (Cancel, Keep showing), and waiting for it to close then fails.
  await first.app.evaluate(
    ({ dialog }, from) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [from] });
      dialog.showMessageBox = (...args: unknown[]) => {
        const options = args.at(-1) as { detail?: string };
        const told = (options.detail ?? '').includes('the screens go black while it restarts');
        return Promise.resolve({ response: told ? 0 : 1, checkboxChecked: false });
      };
      dialog.showMessageBoxSync = () => 0;
    },
    join(backups, backup),
  );
  const closed = first.app.waitForEvent('close', { timeout: 30_000 });
  await first.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('restore-library')?.click();
  });
  await closed;

  // The next start: the library as it was at the backup, nothing live, and a word about it.
  const second = await relaunchApp(first.userData, outputs);
  const win2 = await operatorPage(second.app);
  await expect(
    win2.getByRole('alert').filter({ hasText: `Library restored from “${backup}”` }),
  ).toContainText('The library from before is kept in Drashti’s data folder, in Backups/Before restore');
  const restored = await win2.evaluate(async () => {
    const d2 = (globalThis as PageGlobals).drashti;
    const state = (await d2.engine.snapshot()).state;
    return {
      names: (await d2.library.listPresentations()).map((p) => p.name).sort(),
      media: (await d2.library.listMedia()).length,
      slide: state.layers.slide,
      recovery: await d2.app.recovery(),
    };
  });
  expect(restored).toEqual({ names: atBackup, media: 1, slide: null, recovery: null });
  await expect(win2.getByTestId('recovery-notice')).toHaveCount(0);
  const kept = readdirSync(join(first.userData, 'Backups'));
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatch(/^Before restore \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/u);
  expect(readdirSync(join(first.userData, 'Backups', kept[0] ?? '')).sort()).toEqual(
    expect.arrayContaining(['Media', 'backup.json', 'drashti.sqlite']),
  );
  await second.app.close();
});

test('a restored library that will not open is put back by itself, and the operator is told', async () => {
  const first = await launchApp({ DRASHTI_TEST_NO_RELAUNCH: '1' });
  const win = await operatorPage(first.app);
  const names = (page: typeof win) =>
    page.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name).sort(),
    );
  await win.evaluate(async () => {
    const added = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder Before Restore',
      'Placeholder line',
    );
    if (!added.ok) throw new Error(added.message);
  });
  const before = await names(win);

  // A backup of the library only.
  const backups = mkdtempSync(join(tmpdir(), 'drashti-backups-e2e-'));
  await first.app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false });
  }, backups);
  await first.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('backup-library')?.click();
  });
  await expect(win.getByRole('alert').filter({ hasText: 'Library backed up to' })).toBeVisible();
  const [backup = ''] = readdirSync(backups);

  // Broken in a way the check before a restore cannot see: its schema version reads fine,
  // but a table Drashti needs when it opens the library is gone.
  const broken = new Database(join(backups, backup, 'drashti.sqlite'));
  broken.exec('DROP TABLE app_meta');
  broken.close();

  await first.app.evaluate(
    ({ dialog }, from) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [from] });
      dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false });
    },
    join(backups, backup),
  );
  const closed = first.app.waitForEvent('close', { timeout: 30_000 });
  await first.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('restore-library')?.click();
  });
  await closed;

  // The next start: the restored library fails to open, the one from before is back, and a word about it.
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await expect(
    win2
      .getByRole('alert')
      .filter({ hasText: `The backup “${backup}” could not be opened after the restore` }),
  ).toContainText('Drashti put back the library from before it');
  expect(await names(win2)).toEqual(before);
  const kept = readdirSync(join(first.userData, 'Backups')).sort();
  expect(kept).toHaveLength(2);
  expect(kept[0]).toMatch(/^Before restore /u);
  expect(kept[1]).toMatch(/^Failed restore /u);
  await second.app.close();
});
