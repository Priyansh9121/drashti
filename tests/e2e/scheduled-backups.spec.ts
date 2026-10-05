import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEDULED_FOLDER } from '../../src/shared/backups';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { makeTestImage } from './test-media';

/*
 * Scheduled backups (Session 14), on the schedules' test clock: made at
 * their time into a folder of their own with one shared media folder, media
 * copied once, the newest kept and older ones (and media nobody needs)
 * pruned, a missing folder skipped with a warning, and one restored like a
 * backup made by hand. Placeholder words and a generated picture only.
 */

const CLOCK = { DRASHTI_TEST_ARTI_CLOCK: '1', DRASHTI_TEST_NO_RELAUNCH: '1' };

/** The next 03:00 on this computer's clock after `after`, plus a second. */
function nextThree(after: number): number {
  const d = new Date(after);
  d.setHours(3, 0, 1, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function moveClock(app: ElectronApplication, wallMs: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock?.(ms);
  }, wallMs);
}

const view = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.backups.view());

async function backupAt(app: ElectronApplication, win: Page, wallMs: number) {
  const before = (await view(win)).last?.endedAt ?? 0;
  await moveClock(app, wallMs);
  await expect.poll(async () => (await view(win)).last?.endedAt ?? 0, { timeout: 30_000 }).not.toBe(before);
  return (await view(win)).last;
}

test('made at their time, media copied once, the newest kept, a missing drive skipped, and one restored', async () => {
  test.setTimeout(180_000);
  const first = await launchApp(CLOCK);
  const win = await operatorPage(first.app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-scheduled-e2e-'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder backup picture.png'), {
    width: 160,
    height: 90,
  });
  const words = join(dir, 'Placeholder Backed Up.txt');
  writeFileSync(words, '[Verse]\nPlaceholder backed up line\n');
  await importAndGetIds(win, [picture, words]);
  const drive = mkdtempSync(join(tmpdir(), 'drashti-usb-'));

  // File > Scheduled Backups…: the folder, every day at 03:00, keep 2.
  await first.app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
  }, drive);
  await chooseMenuItem(first.app, 'scheduled-backups');
  const dialog = win.getByTestId('backups-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('backups-choose').click();
  await expect(dialog.getByTestId('backups-folder')).toHaveValue(drive);
  await dialog.getByTestId('backups-enabled').click();
  await dialog.getByTestId('backups-time').fill('03:00');
  await dialog.getByTestId('backups-keep').fill('2');
  await dialog.getByTestId('backups-save').click();
  await expect(dialog).toContainText('Saved.');
  await expect(dialog.getByTestId('backups-next')).toContainText('03:00');
  await expectNoSeriousA11yIssues(win, 'scheduled backups');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // At its time: a backup in a folder of its own, beside the shared media folder.
  const scheduled = join(drive, SCHEDULED_FOLDER);
  let at = nextThree(Date.now());
  const one = await backupAt(first.app, win, at);
  expect(one).toMatchObject({ outcome: 'done', copied: 1, files: 1 });
  const backups = () =>
    readdirSync(scheduled)
      .filter((n) => n.startsWith('Drashti backup'))
      .sort();
  const [firstBackup = ''] = backups();
  expect(readdirSync(join(scheduled, firstBackup)).sort()).toEqual([
    '.drashti-scheduled',
    'backup.json',
    'drashti.sqlite',
    'media.json',
  ]);
  // Media files are named by their hash, in folders by its first two letters.
  const hashed = (root: string) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((n) => /[0-9a-f]{64}\.\w+$/u.test(n));
  const [shared = ''] = hashed(join(scheduled, 'Media'));
  expect(shared).not.toBe('');
  const inode = statSync(join(scheduled, 'Media', shared)).ino;

  // The next day's copies no media again (named by its hash, it is there already).
  at = nextThree(at);
  const two = await backupAt(first.app, win, at);
  expect(two).toMatchObject({ outcome: 'done', copied: 0, files: 1 });
  expect(statSync(join(scheduled, 'Media', shared)).ino).toBe(inode);

  // Keep 2: the third removes the first, and a shared file no kept backup lists; the admin's own
  // file beside them stays.
  const orphan = join(scheduled, 'Media', '00', `${'0'.repeat(64)}.png`);
  mkdirSync(join(scheduled, 'Media', '00'), { recursive: true });
  writeFileSync(orphan, 'placeholder');
  writeFileSync(join(scheduled, 'Placeholder note.txt'), 'placeholder');
  mkdirSync(join(scheduled, 'Placeholder own folder'));
  at = nextThree(at);
  const three = await backupAt(first.app, win, at);
  expect(three).toMatchObject({ outcome: 'done' });
  expect(backups()).toHaveLength(2);
  expect(backups()).not.toContain(firstBackup);
  expect(existsSync(orphan)).toBe(false);
  expect(existsSync(join(scheduled, 'Media', shared))).toBe(true);
  expect(existsSync(join(scheduled, 'Placeholder note.txt'))).toBe(true);
  expect(existsSync(join(scheduled, 'Placeholder own folder'))).toBe(true);
  expect(await win.getByTestId('backup-warning').count()).toBe(0);

  // The drive taken out: that time is skipped, and the status bar says so until read.
  const saved = await win.evaluate(
    async (folder) => {
      const d = (globalThis as PageGlobals).drashti;
      const { schedule } = await d.backups.view();
      return d.backups.save({ ...schedule, folder });
    },
    join(drive, 'Placeholder unplugged drive'),
  );
  expect(saved.ok).toBe(true);
  at = nextThree(at);
  const skipped = await backupAt(first.app, win, at);
  expect(skipped?.outcome).toBe('skipped');
  const warning = win.getByTestId('backup-warning');
  await expect(warning).toContainText('skipped');
  await expect(warning).toContainText('is the drive connected');
  await warning.getByRole('button', { name: 'Dismiss the backup warning' }).click();
  await expect(warning).toHaveCount(0);

  // A presentation added after the backups, then the newest restored like a backup made by hand.
  const added = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder Added Later',
      'Placeholder later line',
    ),
  );
  expect(added.ok).toBe(true);
  const newest = join(scheduled, backups().at(-1) ?? '');
  await first.app.evaluate(({ dialog }, from) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [from] });
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false });
    dialog.showMessageBoxSync = () => 0;
  }, newest);
  const closed = first.app.waitForEvent('close', { timeout: 30_000 });
  await chooseMenuItem(first.app, 'restore-library');
  await closed;
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  const restored = await win2.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      names: (await d.library.listPresentations()).map((p) => p.name),
      media: (await d.library.listMedia()).length,
    };
  });
  expect(restored.names).toContain('Placeholder Backed Up');
  expect(restored.names).not.toContain('Placeholder Added Later');
  expect(restored.media).toBe(1);
  expect(hashed(join(first.userData, 'Media'))).toContain(shared);
  // The note says it was a scheduled one, with the shared media beside it.
  expect(JSON.parse(readFileSync(join(newest, 'backup.json'), 'utf8'))).toMatchObject({
    scheduled: true,
    mediaPool: '../Media',
  });
  await second.app.close();
});
