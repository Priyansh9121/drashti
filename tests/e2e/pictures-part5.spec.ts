import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Pictures (Session 55, Part 5): every picture type, every way in (a JPEG named .jfif, an animated PNG's .apng, an
 * icon, a TIFF converted by itself), anything unreadable turned down with the reason; the Picture editor's Rotate,
 * Flip and Crop, kept with the picture and drawn so on a screen and the thumbnails, As it was taken putting it
 * back; a photo that does not fill its screen with its blurred, darker copy behind it, and the editor's switch for
 * it; and Save picture… from the one right-click menu, full size where chosen. Pictures generated here only.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

/** A picture drawn in the page, of colours side by side, saved as a PNG or a JPEG. */
async function makePicture(
  page: Page,
  file: string,
  colours: string[],
  size: { width: number; height: number } = { width: 64, height: 36 },
  type: 'image/png' | 'image/jpeg' = 'image/png',
): Promise<string> {
  const base64 = await page.evaluate(
    ({ colours, size, type }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      colours.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect((i * size.width) / colours.length, 0, size.width / colours.length, size.height);
      });
      return canvas.toDataURL(type).split(',')[1] ?? '';
    },
    { colours, size, type },
  );
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/** An icon holding one PNG (as Windows' icons do), from a PNG made in the page. */
function iconOf(png: Buffer): Buffer {
  const header = Buffer.from([0, 0, 1, 0, 1, 0]);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0);
  entry.writeUInt8(32, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

const background = (win: Page, mediaId: string) =>
  win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'image', fit: 'fit', loop: false },
      }),
    mediaId,
  );

/** Import files, and what the report says of each: its outcome, its message and its notes' codes and words. */
const imported = (win: Page, paths: string[]) =>
  win.evaluate(async (paths) => {
    const d = (globalThis as PageGlobals).drashti;
    const result = await d.library.importPaths(paths);
    if (!result.ok) throw new Error(result.message);
    const report = await d.library.getImportReport(result.run.id);
    return (report?.items ?? []).map((i) => ({
      name: i.name,
      outcome: i.outcome,
      message: i.message,
      id: i.target?.id ?? null,
      notes: i.issues.map((n) => `${n.code}: ${n.message}`),
    }));
  }, paths);

async function oneScreen(): Promise<{ app: ElectronApplication; win: Page; screen: Page }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [screen] = outputPages(app);
  if (!screen) throw new Error('a screen expected');
  await outputReady(screen);
  return { app, win, screen };
}

/** The Media tab's row of a picture, by its name. */
async function mediaRow(win: Page, name: string) {
  await openLibrary(win);
  await win.getByRole('tab', { name: 'Media' }).click();
  return win.getByTestId('media-row').filter({ hasText: name });
}

test('every picture type comes in and shows, a TIFF converted by itself; a broken picture and a JPEG XL are turned down with the reason', async () => {
  test.setTimeout(240_000);
  const { app, win, screen } = await oneScreen();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-picture-types-'));
  const jfif = await makePicture(
    win,
    join(dir, 'Placeholder download.jfif'),
    ['#2a6f97'],
    undefined,
    'image/jpeg',
  );
  const apng = await makePicture(win, join(dir, 'Placeholder moving.apng'), ['#6a4c93', '#1982c4']);
  const png = await makePicture(win, join(dir, 'icon source.png'), ['#8ac926'], { width: 32, height: 32 });
  const ico = join(dir, 'Placeholder icon.ico');
  writeFileSync(ico, iconOf(readFileSync(png)));
  const tif = join(dir, 'Placeholder scan.tif');
  const made = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x1982c4:s=64x36,format=rgb24',
    '-frames:v',
    '1',
    tif,
  ]);
  expect(made.status, String(made.stderr)).toBe(0);
  const broken = join(dir, 'Placeholder broken.png');
  writeFileSync(broken, 'placeholder text, not a picture');
  const jxl = join(dir, 'Placeholder new phone.jxl');
  writeFileSync(jxl, 'placeholder jpeg xl');

  const lines = await imported(win, [jfif, apng, ico, tif, broken, jxl]);
  const line = (name: string) => lines.find((l) => l.name === name);
  for (const name of ['Placeholder download.jfif', 'Placeholder moving.apng', 'Placeholder icon.ico'])
    expect(line(name), name).toMatchObject({ outcome: 'imported', notes: [] });
  expect(line('Placeholder scan.tif')).toMatchObject({
    outcome: 'imported',
    notes: [
      'converting-media: Drashti cannot show Placeholder scan.tif as it is: TIFF picture. It converts it by itself, and uses the copy wherever this file is; the original stays as it is.',
    ],
  });
  expect(line('Placeholder broken.png')).toMatchObject({
    outcome: 'failed',
    message:
      'Placeholder broken.png is not a picture Drashti can read: what is inside it is not a picture (it may be damaged, or another kind of file with a picture’s name).',
  });
  expect(line('Placeholder new phone.jxl')).toMatchObject({
    outcome: 'unsupported',
    message: 'Drashti does not read JPEG XL pictures (.jxl): save it as a JPEG or a PNG, then add that.',
  });

  // The TIFF converts while the show is idle. A JPEG stands for it wherever it is.
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).find(
          (m) => m.name === 'Placeholder scan.tif',
        )?.convertedTo ?? null,
      { timeout: 120_000 },
    )
    .toBe('Placeholder scan.jpg');
  // Each shows on the screen as it is.
  for (const name of ['Placeholder download.jfif', 'Placeholder moving.apng', 'Placeholder icon.ico']) {
    const id = line(name)?.id ?? '';
    expect((await background(win, id)).ok, name).toBe(true);
    await expect
      .poll(
        () =>
          screen
            .locator(`[data-layer="background"] img[data-media-id="${id}"]`)
            .evaluateAll((imgs) => imgs.some((i) => (i as HTMLImageElement).naturalWidth > 0)),
        { message: name, timeout: 20_000 },
      )
      .toBe(true);
  }
  await app.close();
});

test('the Picture editor turns, flips and crops a picture, kept with it and drawn so on a screen and its thumbnail; As it was taken puts it back', async () => {
  test.setTimeout(240_000);
  const { app, win, screen } = await oneScreen();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-picture-edit-'));
  const split = await makePicture(win, join(dir, 'Placeholder split.png'), ['#1d4e89', '#7c2d12']);
  const id = (await imported(win, [split]))[0]?.id ?? '';

  const row = await mediaRow(win, 'Placeholder split');
  await row.getByTestId('media-picture').click();
  const editor = win.getByTestId('picture-editor');
  await expect(editor).toBeVisible();
  await expectFits(editor, 'the Picture editor at 1280 x 720');
  // CI's operator window: the editor with its Rotate, Flip and Crop still fits.
  await win.setViewportSize({ width: 1024, height: 645 });
  await expectFits(editor, 'the Picture editor at 1024 x 645');
  await expect(editor.getByTestId('pe-rotate')).toBeVisible();
  await editor.getByTestId('pe-rotate').click();
  await editor.getByTestId('pe-flip-across').click();
  await expect(editor.getByTestId('pe-flip-across')).toHaveAttribute('aria-pressed', 'true');
  await editor.getByTestId('pe-crop').click();
  await expect(editor.getByTestId('pe-crop-box')).toBeVisible();
  await editor.getByTestId('pe-crop-1:1').click();
  await expectFits(editor, 'the Picture editor while cropping at 1024 x 645');
  await expectNoSeriousA11yIssues(win, 'the Picture editor while cropping');
  await win.setViewportSize({ width: 1280, height: 720 });
  // The arrows move the crop: down a hundredth, twice.
  await editor.getByTestId('pe-crop-box').focus();
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('ArrowDown');
  await editor.getByTestId('pe-crop').click();
  await expect(editor.getByTestId('pe-crop-box')).toHaveCount(0);
  await editor.getByTestId('pe-save').click();
  await expect(editor).toHaveCount(0);
  const look = await win.evaluate((i) => (globalThis as PageGlobals).drashti.media.look(i), id);
  // Turned a quarter (a 36 × 64 picture now), flipped across, its 1:1 middle kept, moved down 2 %.
  expect(look).toMatchObject({ turn: 90, flipX: true, cropShape: '1:1', size: { width: 64, height: 36 } });
  expect(look?.crop?.w).toBeCloseTo(1, 5);
  expect(look?.crop?.h).toBeCloseTo(0.5625, 4);
  expect(look?.crop?.y).toBeCloseTo(0.21875 + 0.02, 4);

  // On the screen: the square part kept, fitted in the middle of the 16:9 screen, the picture turned and flipped.
  await background(win, id);
  const frame = screen.locator('[data-layer="background"] [data-look-frame]');
  await expect(frame).toHaveCount(1);
  const placed = await frame.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { left: s.left, width: s.width, height: s.height };
  });
  expect(placed).toEqual({ left: '21.875%', width: '56.25%', height: '100%' });
  await expect(frame.locator('img')).toHaveCSS('transform', /matrix\(/u);
  expect(await frame.locator('img').evaluate((el) => (el as HTMLElement).style.transform)).toBe(
    'scale(-1, 1) rotate(90deg)',
  );
  // Its thumbnail in a playlist too.
  await win.evaluate(async (i) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder pictures', null, false);
    if (made.ok) await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId: i }]);
  }, id);
  await closeLibrary(win);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder pictures' }).click();
  await expect(
    win.getByTestId('open-playlist').getByTestId('playlist-item').locator('[data-look-frame]'),
  ).toHaveCount(1);

  // As it was taken: all of it back, nothing kept.
  await (await mediaRow(win, 'Placeholder split')).getByTestId('media-picture').click();
  await editor.getByTestId('pe-reset-all').click();
  await editor.getByTestId('pe-save').click();
  await expect(editor).toHaveCount(0);
  expect(await win.evaluate((i) => (globalThis as PageGlobals).drashti.media.look(i), id)).toBeNull();
  await expect(screen.locator('[data-layer="background"] [data-look-frame]')).toHaveCount(0);
  await app.close();
});

test('a photo that does not fill the screen has its blurred, darker copy behind it; the Picture editor’s switch takes it away', async () => {
  test.setTimeout(240_000);
  const { app, win, screen } = await oneScreen();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-blurred-fill-'));
  // A phone's portrait photo: far narrower than the screen.
  const portrait = await makePicture(
    win,
    join(dir, 'Placeholder portrait.jpg'),
    ['#e76f51', '#2a9d8f'],
    {
      width: 36,
      height: 64,
    },
    'image/jpeg',
  );
  const id = (await imported(win, [portrait]))[0]?.id ?? '';
  await background(win, id);
  // Made once (at import, or as it came up), small, and drawn stretched behind the picture: no filter on the screen.
  const fill = screen.locator(`[data-layer="background"] [data-blurred-fill="${id}_b"] img`);
  await expect
    .poll(() => fill.evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth)), {
      timeout: 30_000,
    })
    .toEqual([72]);
  expect(await fill.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  expect((await state(win)).pictures[id]).toMatchObject({ blurred: true });

  // The switch in the Picture editor: off, kept with the picture; the screen draws black beside it again.
  const row = await mediaRow(win, 'Placeholder portrait');
  await row.getByTestId('media-picture').click();
  const editor = win.getByTestId('picture-editor');
  const toggle = editor.getByTestId('pe-blurred-fill');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await editor.getByTestId('pe-save').click();
  await expect(editor).toHaveCount(0);
  expect(await win.evaluate((i) => (globalThis as PageGlobals).drashti.media.look(i), id)).toMatchObject({
    fill: false,
  });
  await expect(screen.locator('[data-blurred-fill]')).toHaveCount(0);
  await app.close();
});

test('Save picture… in the one right-click menu saves a picture full size where chosen, as it shows', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-picture-'));
  const photo = await makePicture(
    win,
    join(dir, 'Placeholder darshan.jpg'),
    ['#264653'],
    undefined,
    'image/jpeg',
  );
  const sticker = await makePicture(win, join(dir, 'Placeholder banner.png'), ['#f4a261', '#e9c46a']);
  const lines = await imported(win, [photo, sticker]);
  const bannerId = lines.find((l) => l.name === 'Placeholder banner.png')?.id ?? '';
  // The banner turned a quarter: saved as it shows, 36 wide and 64 tall.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.setLook(id, {
        zoom: 1,
        x: 0,
        y: 0,
        brightness: 0,
        contrast: 0,
        colour: 0,
        sharpness: 0,
        turn: 90,
        size: { width: 64, height: 36 },
      }),
    bannerId,
  );
  // Where it is saved: the dialog answered here, as the operator would, by the name it offers.
  const saveTo = mkdtempSync(join(tmpdir(), 'drashti-saved-'));
  await app.evaluate(({ dialog }, folder) => {
    dialog.showSaveDialog = ((_w: unknown, options: { defaultPath?: string }) =>
      Promise.resolve({
        canceled: false,
        filePath: `${folder}/${(options.defaultPath ?? 'none').split(/[\\/]/u).at(-1) ?? 'none'}`,
      })) as unknown as typeof dialog.showSaveDialog;
  }, saveTo);

  const save = async (name: string) => {
    const row = await mediaRow(win, name);
    await row.getByTestId('media-item').click({ button: 'right' });
    await expect(win.getByRole('menuitem', { name: 'Save picture…' })).toBeVisible();
    await win.getByRole('menuitem', { name: 'Save picture…' }).click();
  };
  // A photo: its own bytes, as a JPEG.
  await save('Placeholder darshan');
  await expect
    .poll(() => readFileSync(join(saveTo, 'Placeholder darshan.jpg')).length, { timeout: 15_000 })
    .toBe(readFileSync(photo).length);
  expect(readFileSync(join(saveTo, 'Placeholder darshan.jpg')).equals(readFileSync(photo))).toBe(true);
  // A picture turned: made a PNG of its own pixels as it shows.
  await save('Placeholder banner');
  await expect
    .poll(
      () =>
        app.evaluate(
          ({ nativeImage }, path) => nativeImage.createFromPath(path).getSize(),
          join(saveTo, 'Placeholder banner.png'),
        ),
      { timeout: 30_000 },
    )
    .toEqual({ width: 36, height: 64 });
  await expect(win.getByText('Saved the picture as “Placeholder banner.png”.')).toBeVisible();
  await app.close();
});
