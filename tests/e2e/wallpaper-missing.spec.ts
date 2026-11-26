import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The chosen wallpaper's picture gone (QA24-WALLBLACK-1, the owner's "the wallpaper goes black"): deleted from Media,
 * and gone for good at the next start. The screens show black with nothing up, as they do with none chosen (render/
 * NothingUp.tsx, today's way), but never silently: the wallpaper's tile says its picture is missing instead of a black
 * square, the Wallpapers panel says so with Find…, and LIVE says why it is black. Find… (the folder answered here by
 * the test) brings the same picture back, chosen, on the screens. And a picture converted after it became a wallpaper
 * (a photo Drashti cannot draw as it is): the wallpaper moves to its copy, as a playlist's row does. Generated pictures,
 * placeholder names.
 */

const ENV = { DRASHTI_WINDOWED_OUTPUTS: '1' };
const FILE = 'Placeholder wallpaper.png';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** What the hall shows with nothing up: 'wallpaper' or 'black'. */
const nothingUp = (hall: Page) => hall.getByTestId('scene').first().getAttribute('data-nothing-up');

/** The hall's wallpaper picture up now, by its media id. */
const hallPicture = (hall: Page) =>
  hall
    .locator('[data-testid="wallpaper-picture"][data-wallpaper-role="current"]')
    .first()
    .getAttribute('data-media-id');

async function hallOf(app: ElectronApplication): Promise<Page> {
  const hall = await outputPage(app);
  await outputReady(hall);
  return hall;
}

test('a wallpaper whose picture is missing says so (its tile, the panel with Find…, LIVE) while the screens show black as with none chosen; after a restart too; Find… brings it back', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-wallpaper-missing-'));
  const first = await launchApp(ENV);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await sizeOperatorWindow(first.app, win, CI_WINDOW);
  await setUpScreen(win);
  const hall = await hallOf(first.app);
  const file = await makeTestImage(win, join(dir, FILE), { color: '#1e3a8a' });
  const [pictureId = ''] = await importAndGetIds(win, [file]);
  expect(pictureId).not.toBe('');
  const wallpaperId = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.wallpapers.add([id], null);
    if (!added.ok) throw new Error(added.message);
    const chosen = await d.wallpapers.choose(added.ids[0] ?? null);
    if (!chosen.ok) throw new Error(chosen.message);
    return added.ids[0] ?? '';
  }, pictureId);
  const panel = win.getByTestId('wallpapers');
  const tile = panel.locator(`[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"]`);
  const notice = panel.getByTestId('wallpaper-missing-notice');
  const live = win.getByTestId('live-wallpaper-missing');

  // As it should be: its picture on the hall and in its tile, nothing said.
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');
  await expect(tile.locator('img')).toHaveCount(1);
  await expect(tile.getByTestId('wallpaper-missing')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await expect(live).toHaveCount(0);

  // Its picture deleted from Media (Undo could bring it back): the screens show black, as with none chosen, and the
  // window says why everywhere the operator looks.
  const removed = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.media.remove([id]),
    pictureId,
  );
  expect(removed.ok).toBe(true);
  const says = async (hallPage: Page, page: Page) => {
    const t = page
      .getByTestId('wallpapers')
      .locator(`[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"]`);
    await expect(t.getByTestId('wallpaper-missing')).toHaveText('Picture missing');
    await expect(t.locator('img')).toHaveCount(0);
    await expect(t).toHaveAccessibleName(/^Placeholder wallpaper, its picture is missing$/u);
    await expect(t).toHaveAttribute('aria-pressed', 'true');
    const n = page.getByTestId('wallpapers').getByTestId('wallpaper-missing-notice');
    await expect(n).toContainText(
      `The wallpaper’s picture is missing: “${FILE}”. With nothing up, the screens show black.`,
    );
    await expect(n.getByRole('button', { name: 'Find…' })).toBeVisible();
    await expect(page.getByTestId('live-wallpaper-missing')).toHaveText(
      `Wallpaper’s picture missing: “${FILE}”. The screens show black when the wallpaper is up.`,
    );
    await expect(page.getByTestId('live-preview').getByTestId('scene').first()).toHaveAttribute(
      'data-nothing-up',
      'black',
    );
    await expect.poll(() => nothingUp(hallPage)).toBe('black');
  };
  await says(hall, win);
  // At CI's 1024 x 645, the smallest left column must show every line of the warning.
  const splitter = win.getByRole('separator', { name: 'Resize the playlists', exact: true });
  await splitter.focus();
  await splitter.press('Home');
  await expect
    .poll(() => win.getByTestId('column-left').evaluate((el) => el.getBoundingClientRect().width))
    .toBe(220);
  await expect
    .poll(() =>
      tile.getByTestId('wallpaper-missing').evaluate((el) => {
        const box = el.getBoundingClientRect();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const clipped: { text: string; box: number[]; ink: number[] }[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (
              rect.left < box.left - 0.5 ||
              rect.right > box.right + 0.5 ||
              rect.top < box.top - 0.5 ||
              rect.bottom > box.bottom + 0.5
            )
              clipped.push({
                text: node.textContent,
                box: [box.left, box.top, box.right, box.bottom],
                ink: [rect.left, rect.top, rect.right, rect.bottom],
              });
          }
        }
        return clipped;
      }),
    )
    .toEqual([]);
  await settled(win);
  await expect(tile.getByTestId('wallpaper-missing')).toHaveAttribute('title', 'Picture missing');
  await expectNoSeriousA11yIssues(win, 'a wallpaper whose picture is missing', '[data-testid="wallpapers"]');

  // Something is up underneath F12: the words explain the black wallpaper without saying nothing is up.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'setBackground',
      background: { kind: 'color', color: '#1e3a8a' },
    }),
  );
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ kind: 'color' });
  await win.keyboard.press('F12');
  await expect.poll(async () => (await state(win)).wallpaper).toBe(true);
  await expect(live).toHaveText(
    `Wallpaper’s picture missing: “${FILE}”. The screens show black when the wallpaper is up.`,
  );
  expect((await state(win)).layers.background).toMatchObject({ kind: 'color' });
  await win.keyboard.press('F12');
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));

  // Find immediately after Delete, before a restart: the same picture comes back on the first Find.
  await first.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, dir);
  await notice.getByRole('button', { name: 'Find…' }).click();
  await expect(tile.getByTestId('wallpaper-missing')).toHaveCount(0);
  await expect.poll(() => hallPicture(hall)).toBe(pictureId);
  expect((await state(win)).chosenWallpaper?.id).toBe(wallpaperId);
  expect(
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.remove([id]), pictureId),
  ).toMatchObject({ ok: true });
  await says(hall, win);

  // Gone for good at the next start (its file removed from Media): the same.
  await first.app.close();
  const second = await relaunchApp(first.userData, ENV);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  const hall2 = await hallOf(second.app);
  await says(hall2, win2);
  expect((await state(win2)).chosenWallpaper?.id).toBe(wallpaperId);

  // Find…: the folder it was imported from (the system's dialog, answered here by the test). The same picture comes
  // back, the wallpaper still chosen: on the screens again, and nothing more is said.
  await second.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, dir);
  await win2.getByTestId('wallpaper-missing-notice').getByRole('button', { name: 'Find…' }).click();
  const tile2 = win2
    .getByTestId('wallpapers')
    .locator(`[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"]`);
  await expect(tile2.locator('img')).toHaveCount(1, { timeout: 30_000 });
  await expect(tile2.getByTestId('wallpaper-missing')).toHaveCount(0);
  await expect(win2.getByTestId('wallpaper-missing-notice')).toHaveCount(0);
  await expect(win2.getByTestId('live-wallpaper-missing')).toHaveCount(0);
  await expect.poll(() => nothingUp(hall2)).toBe('wallpaper');
  expect(await hallPicture(hall2)).toBe(pictureId);
  expect(
    await win2.evaluate(async () => (await (globalThis as PageGlobals).drashti.wallpapers.view()).wallpapers),
  ).toMatchObject([{ id: wallpaperId, pictures: [{ mediaId: pictureId, missing: false }] }]);
  await second.app.close();
});

const ffmpeg = testFfmpeg();

test('a photo converted after it became a wallpaper: the wallpaper moves to its copy, on the screens and in its tile', async () => {
  test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-wallpaper-convert-'));
  const heic = join(dir, 'Placeholder photo.heic');
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'media', 'placeholder.heic'), heic);
  // Converted by hand, after it is a wallpaper (an import's own conversion can end after its wallpaper is made).
  const { app } = await launchApp({ ...ENV, DRASHTI_TEST_NO_CONVERT_AT_IMPORT: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const hall = await hallOf(app);
  const [photo = ''] = await importAndGetIds(win, [heic]);
  expect(photo).not.toBe('');
  const wallpaperId = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.wallpapers.add([id], null);
    if (!added.ok) throw new Error(added.message);
    const chosen = await d.wallpapers.choose(added.ids[0] ?? null);
    if (!chosen.ok) throw new Error(chosen.message);
    return added.ids[0] ?? '';
  }, photo);
  const wallpaperTile = win
    .getByTestId('wallpapers')
    .locator(`[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"]`);
  await expect(wallpaperTile.getByTestId('wallpaper-missing')).toHaveText('Convert picture');
  await expect(wallpaperTile.locator('img')).toHaveCount(0);
  await expect(win.getByTestId('wallpaper-missing-notice')).toContainText(
    'The wallpaper’s picture needs conversion: “Placeholder photo.heic”. Convert it in Media.',
  );
  await expect(win.getByTestId('wallpaper-find-missing')).toHaveCount(0);
  await expect(win.getByTestId('live-wallpaper-missing')).toContainText('needs conversion');
  expect(
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.convert([id]), photo),
  ).toMatchObject({ ok: true });
  const job = () =>
    win.evaluate(async (id) => {
      const jobs = await (globalThis as PageGlobals).drashti.media.conversions();
      return jobs.find((j) => j.mediaId === id);
    }, photo);
  await expect
    .poll(job, { timeout: 120_000 })
    .toMatchObject({ state: 'done', convertedId: expect.any(String) });
  const copy = (await job())?.convertedId ?? '';
  // The wallpaper's picture is the copy now: the screens draw it, and its tile shows it.
  await expect.poll(async () => (await state(win)).chosenWallpaper?.pictures).toEqual([copy]);
  await expect.poll(() => hallPicture(hall)).toBe(copy);
  const tile = win
    .getByTestId('wallpapers')
    .locator(`[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"] img`);
  await expect
    .poll(() => tile.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(win.getByTestId('wallpaper-missing-notice')).toHaveCount(0);
  await expect(win.getByTestId('live-wallpaper-missing')).toHaveCount(0);
  const conversionId = (await job())?.conversionId ?? '';
  expect(conversionId).not.toBe('');
  expect(
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.undoConversion(id), conversionId),
  ).toMatchObject({ ok: true });
  await expect.poll(async () => (await state(win)).chosenWallpaper?.pictures).toEqual([photo]);
  await expect(wallpaperTile.getByTestId('wallpaper-missing')).toHaveText('Convert picture');
  await expect(win.getByTestId('wallpaper-find-missing')).toHaveCount(0);
  await app.close();
});
