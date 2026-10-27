import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DROP_REFUSED_VIEW } from '../../src/shared/drop-folder';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';

/*
 * The drop folder (Session 28, decision 21): a folder chosen in Pro Mode; pictures, videos and (Session 51)
 * sounds put in it come into Media by themselves, under "From the drop folder", once each has held still
 * for 5 s (the real settle time: no test switch shortens it). The folder is never written to; a file still
 * being written is taken only once whole; nothing comes in while the stream is on air (the on-air test hook
 * stands in for it); Simple Mode carries on quietly and cannot open it; in Pro Mode it opens with no PIN
 * (Session 54, E5: roles are gone).
 * Generated media only.
 */

/** The names in Media that came from the drop folder. */
const fromDrop = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listMedia())
      .filter((m) => m.fromDrop)
      .map((m) => m.name)
      .sort(),
  );

/** Every file in a folder: name, size, time and bytes. */
const snapshot = (dir: string) =>
  readdirSync(dir)
    .sort()
    .map((n) => {
      const s = statSync(join(dir, n));
      return [
        n,
        s.size,
        s.mtimeMs,
        createHash('sha256')
          .update(readFileSync(join(dir, n)))
          .digest('hex'),
      ];
    });

/** The system's folder dialog answers with this folder. */
const answerFolderDialog = (app: ElectronApplication, folder: string) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [f] });
  }, folder);

test('pictures, videos and sounds put in the drop folder come into Media within 15 s, the folder untouched; a file written over 6 s is taken once, whole; nothing comes in on air', async () => {
  test.setTimeout(180_000);
  const drop = mkdtempSync(join(tmpdir(), 'drashti-drop-'));
  const scratch = mkdtempSync(join(tmpdir(), 'drashti-drop-made-'));
  const { app, userData } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  try {
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1280, height: 860 });
    await operatorReady(win);

    // File › Drop Folder…: Choose…
    await answerFolderDialog(app, drop);
    await chooseMenuItem(app, 'drop-folder');
    const dialog = win.getByTestId('drop-dialog');
    await dialog.getByTestId('drop-choose').click();
    await expect(dialog.getByTestId('drop-folder-path')).toHaveText(drop);
    await expect(dialog.getByTestId('drop-state')).toHaveAttribute('data-state', 'watching');
    await expect(dialog.getByTestId('drop-on')).toBeChecked();
    await expectNoSeriousA11yIssues(win, 'Drop folder');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    // A placeholder picture and video, made elsewhere and moved in whole.
    await makeTestImage(win, join(scratch, 'Placeholder darshan.png'));
    await makeTestVideo(win, join(scratch, 'Placeholder clip.webm'), { seconds: 1 });
    const t0 = Date.now();
    renameSync(join(scratch, 'Placeholder darshan.png'), join(drop, 'Placeholder darshan.png'));
    renameSync(join(scratch, 'Placeholder clip.webm'), join(drop, 'Placeholder clip.webm'));
    const before = snapshot(drop);
    await expect
      .poll(() => fromDrop(win), { timeout: 15_000 })
      .toEqual(['Placeholder clip.webm', 'Placeholder darshan.png']);
    expect(Date.now() - t0).toBeLessThan(15_000);
    // Under the filter in Media, with one notice for the batch.
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    await win.getByTestId('media-filter-drop').click();
    await expect(win.getByTestId('media-filter-drop')).toHaveAttribute('aria-pressed', 'true');
    await expect(win.getByTestId('media-list')).toHaveAttribute('data-count', '2');
    await expect(win.getByText('2 pictures and videos from the drop folder are in Media.')).toBeVisible();
    // Never written to.
    expect(snapshot(drop)).toEqual(before);

    // A picture written over 6 s, a piece a second: taken once, whole.
    await makeTestImage(win, join(scratch, 'slow.png'), { width: 640, height: 360, color: '#a53a6e' });
    const whole = readFileSync(join(scratch, 'slow.png'));
    const slow = join(drop, 'Placeholder slow.png');
    const pieces = 7;
    const size = Math.ceil(whole.length / pieces);
    for (let i = 0; i < pieces; i++) {
      appendFileSync(slow, whole.subarray(i * size, (i + 1) * size));
      if (i < pieces - 1) await letTimePass(win, 1000, 'the picture is written a piece a second');
    }
    await expect
      .poll(() => fromDrop(win), { timeout: 20_000 })
      .toEqual(['Placeholder clip.webm', 'Placeholder darshan.png', 'Placeholder slow.png']);
    const sha = createHash('sha256').update(whole).digest('hex');
    expect(existsSync(join(userData, 'Media', sha.slice(0, 2), `${sha}.png`))).toBe(true);
    // Only the whole file came in: Media has no other copy of it.
    const named = await win.evaluate(async () =>
      (await (globalThis as PageGlobals).drashti.library.listMedia()).filter(
        (m) => m.name === 'Placeholder slow.png',
      ),
    );
    expect(named).toHaveLength(1);

    // A sound (Session 51): taken as pictures and videos are, under the filter, with its own notice.
    makeTestTone(join(scratch, 'Placeholder bell.wav'), { seconds: 1 });
    renameSync(join(scratch, 'Placeholder bell.wav'), join(drop, 'Placeholder bell.wav'));
    await expect
      .poll(() => fromDrop(win), { timeout: 20_000 })
      .toEqual([
        'Placeholder bell.wav',
        'Placeholder clip.webm',
        'Placeholder darshan.png',
        'Placeholder slow.png',
      ]);
    await expect(win.getByText('1 sound from the drop folder is in Media.')).toBeVisible();

    // On air: nothing comes in until it is off air.
    await app.evaluate(() => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
    });
    await makeTestImage(win, join(scratch, 'Placeholder on air.png'), { color: '#6ea53a' });
    renameSync(join(scratch, 'Placeholder on air.png'), join(drop, 'Placeholder on air.png'));
    await holdStill(
      async () => !(await fromDrop(win)).includes('Placeholder on air.png'),
      9000,
      'on air, nothing comes in from the drop folder',
    );
    await chooseMenuItem(app, 'drop-folder');
    await expect(dialog.getByTestId('drop-state')).toHaveAttribute('data-state', 'waiting');
    await app.evaluate(() => {
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
    });
    await expect.poll(() => fromDrop(win), { timeout: 15_000 }).toContain('Placeholder on air.png');
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(drop, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('File › Drop Folder… opens in Pro Mode with no PIN asked; in Simple Mode it cannot be opened, and carries on with no notice', async () => {
  test.setTimeout(120_000);
  const drop = mkdtempSync(join(tmpdir(), 'drashti-drop-'));
  const scratch = mkdtempSync(join(tmpdir(), 'drashti-drop-made-'));
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await answerFolderDialog(app, drop);
    const chosen = await win.evaluate(() => (globalThis as PageGlobals).drashti.drop.pickFolder());
    expect(chosen).toMatchObject({ ok: true, view: { folder: drop, on: true } });

    // Pro Mode: the menu opens it at once, as it stands, and nothing asks for a PIN (Session 54, E5).
    await chooseMenuItem(app, 'drop-folder');
    const dialog = win.getByTestId('drop-dialog');
    await expect(dialog.getByTestId('drop-folder-path')).toHaveText(drop);
    await expect(win.getByRole('dialog')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Simple Mode: no File menu, the main process refuses to show or change it, and the folder carries on,
    // saying nothing.
    await win.getByRole('button', { name: 'Simple Mode' }).click();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    expect(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('drop-folder') ?? null),
    ).toBeNull();
    const refused = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return { view: await d.drop.view(), off: await d.drop.setOn(false) };
    });
    expect(refused.view).toEqual(DROP_REFUSED_VIEW);
    expect(refused.off).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    await makeTestImage(win, join(scratch, 'Placeholder quiet.png'));
    renameSync(join(scratch, 'Placeholder quiet.png'), join(drop, 'Placeholder quiet.png'));
    await expect.poll(() => fromDrop(win), { timeout: 15_000 }).toEqual(['Placeholder quiet.png']);
    await holdStill(
      async () => (await win.getByText(/from the drop folder/u).count()) === 0,
      500,
      'in Simple Mode no notice shows',
    );
  } finally {
    await app.close().catch(() => undefined);
    rmSync(drop, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
