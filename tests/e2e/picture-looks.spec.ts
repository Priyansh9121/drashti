import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settled } from './a11y';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  testDisplays,
} from './helpers';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import { launchMain, launchNode, pairNode } from './nodes';
import { canvasPixels } from './pixels';

/*
 * Pictures zoomed and enhanced, on live too (Session 26e): the Picture
 * editor's zoom, move, brightness, contrast, colour, sharpness and Auto,
 * kept with the picture and drawn alike on two screens and the thumbnails;
 * the live zoom from LIVE, on two screens, and Keep this zoom; each
 * enhancement checked in the screens' pixels; and a node following.
 * Sharpness (Session 26f) is a sharpened copy made once per picture: the
 * screens and a node draw it with no filter in their pages, and its pixels
 * match the editor's preview. Pictures generated here only.
 */

/** A picture drawn in the page: a colour, or two side by side, or a band of each across. */
async function makePicture(page: Page, file: string, colours: string[], across = false) {
  const base64 = await page.evaluate(
    ({ colours, across }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      colours.forEach((c, i) => {
        ctx.fillStyle = c;
        if (across) ctx.fillRect(0, (i * 360) / colours.length, 640, 360 / colours.length);
        else ctx.fillRect((i * 640) / colours.length, 0, 640 / colours.length, 360);
      });
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    { colours, across },
  );
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/** Move a slider as a hand would (React hears the input). */
async function slide(range: Locator, value: number) {
  await range.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

const snapshot = (win: Page) =>
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

/** How a screen draws its background picture's look: its move and zoom, and its filters. */
const drawn = (page: Page) =>
  page.locator('[data-layer="background"] [data-look-picture]').evaluateAll((els) =>
    els.map((el) => ({
      transform: (el as HTMLElement).style.transform,
      filter: (el as HTMLElement).style.filter,
    })),
  );

/** What a page draws for its pictures' sharpening: the copies it draws, and its SVG filters (none, Session 26f). */
const sharpening = (page: Page) =>
  page.evaluate(() => ({
    // A node's later try at a copy that landed late has a URL of its own (?try=N): the same copy.
    copies: [...document.querySelectorAll('[data-look-picture][data-sharpened] img')].map((img) =>
      (img.getAttribute('src') ?? '').replace(/\?try=\d+$/u, ''),
    ),
    svg:
      document.querySelectorAll('filter, feConvolveMatrix').length +
      [...document.querySelectorAll<HTMLElement>('[style]')].filter((el) => el.style.filter.includes('url('))
        .length,
  }));

/** The look as the library gives it to the thumbnails (with its copy's step once that is ready). */
const libraryLook = (win: Page, id: string) =>
  win.evaluate(async (id) => (await (globalThis as PageGlobals).drashti.media.looks())[id] ?? null, id);

async function twoScreens(extra: Record<string, string> = {}) {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2', ...extra });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  // The main display and the test's first pretend one (CI's first two), however many this computer has: both
  // windows on one physical screen, so their pixels are read alike (Session 53).
  const [main, side] = await testDisplays(win);
  if (!main || !side) throw new Error('two displays expected');
  await setUpScreen(win, 'Main Hall', main.index);
  await setUpScreen(win, 'Side Hall', side.index);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [one, two] = outputPages(app);
  if (!one || !two) throw new Error('two screens expected');
  // Both ready to draw the show (Session 27's warm-up): one still black would differ from the other.
  for (const o of [one, two]) await outputReady(o);
  return { app, win, screens: [one, two] as const };
}

test('the Picture editor: zoom, move, enhance and Auto, kept with the picture, alike on two screens and the thumbnails', async () => {
  test.setTimeout(240_000);
  const { app, win, screens } = await twoScreens();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-picture-looks-'));
  const split = await makePicture(win, join(dir, 'Placeholder split.png'), ['#3a6ea5', '#a5603a']);
  const dull = await makePicture(
    win,
    join(dir, 'Placeholder dull.png'),
    ['#606060', '#707070', '#808080', '#909090'],
    true,
  );
  const [splitId = '', dullId = ''] = await importAndGetIds(win, [split, dull]);

  // From the picture's row in Media.
  await openLibrary(win);
  await win.getByRole('tab', { name: 'Media' }).click();
  await win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder split' })
    .getByTestId('media-picture')
    .click();
  const editor = win.getByTestId('picture-editor');
  await expect(editor).toBeVisible();
  await slide(editor.getByTestId('pe-zoom'), 200);
  await slide(editor.getByTestId('pe-brightness'), 20);
  await slide(editor.getByTestId('pe-contrast'), 10);
  await slide(editor.getByTestId('pe-colour'), 30);
  await slide(editor.getByTestId('pe-sharpness'), 50);
  // Moved by dragging, a quarter of the frame to the right (as far as the zoom allows).
  const frame = await editor.getByTestId('pe-frame').boundingBox();
  if (!frame) throw new Error('no frame');
  await win.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await win.mouse.down();
  await win.mouse.move(frame.x + frame.width * 0.75, frame.y + frame.height / 2, { steps: 5 });
  await win.mouse.up();
  await expect(editor.getByTestId('pe-picture')).toHaveCSS(
    'filter',
    /brightness\(1\.2\) contrast\(1\.1\) saturate\(1\.3\) url/u,
  );
  // The sharpening the preview names, built as elements (Sessions 31–36, SEC-14): a 3 × 3 kernel.
  const named =
    /url\("?#([^")]+)"?\)/u.exec(
      await editor.getByTestId('pe-picture').evaluate((el) => getComputedStyle(el).filter),
    )?.[1] ?? '';
  expect(named).toMatch(/^drashti-sharpen-\d+$/u);
  const matrix = win.locator(`filter[id="${named}"] feConvolveMatrix`);
  await expect(matrix).toHaveAttribute('order', '3');
  await expect(matrix).toHaveAttribute('edgeMode', 'duplicate');
  await expect(matrix).toHaveAttribute('kernelMatrix', /^(-?[\d.]+ ){8}-?[\d.]+$/u);
  await editor.getByTestId('pe-save').click();
  await expect(editor).toHaveCount(0);
  const look = await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.look(id), splitId);
  expect(look).toMatchObject({ zoom: 2, brightness: 0.2, contrast: 0.1, colour: 0.3, sharpness: 0.5 });
  expect(look?.x).toBeGreaterThan(0.2);

  // On the screens: both draw it the same, from the state.
  await background(win, splitId);
  expect((await snapshot(win)).pictures[splitId]).toMatchObject({ zoom: 2 });
  for (const s of screens) await expect.poll(() => drawn(s)).toHaveLength(1);
  const [a, b] = [await drawn(screens[0]), await drawn(screens[1])];
  expect(a).toEqual(b);
  expect(a[0]?.transform).toMatch(/scale\(2\)/u);
  // Its brightness, contrast and colour by CSS filters; its sharpness is its sharpened copy (Session 26f).
  expect(a[0]?.filter).toBe('brightness(1.2) contrast(1.1) saturate(1.3)');
  for (const s of screens)
    await expect
      .poll(() => sharpening(s), { timeout: 30_000 })
      .toEqual({ copies: [`drashti-media://sharp/${splitId}/50`], svg: 0 });
  // The thumbnails follow: its card in a playlist.
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder pictures', null, false);
    if (made.ok) await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId: id }]);
  }, splitId);
  await closeLibrary(win);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder pictures' }).click();
  await expect(
    win.getByTestId('open-playlist').getByTestId('playlist-item').locator('[data-look]'),
  ).toHaveCount(1);

  // Auto, on a dull picture: its contrast up from its own levels.
  await openLibrary(win);
  await win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder dull' })
    .getByTestId('media-picture')
    .click();
  await editor.getByTestId('pe-auto').click();
  await expect
    .poll(async () => Number(await editor.getByTestId('pe-contrast').inputValue()))
    .toBeGreaterThan(20);
  // Before shows it as it was taken while held.
  await editor.getByTestId('pe-before').dispatchEvent('pointerdown');
  await expect(editor.getByTestId('pe-picture')).toHaveCSS('filter', 'none');
  await editor.getByTestId('pe-before').dispatchEvent('pointerup');
  await editor.getByTestId('pe-save').click();
  expect(
    (await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.look(id), dullId))?.contrast,
  ).toBeGreaterThan(0.2);
  await app.close();
});

test('the live zoom: from LIVE, on two screens in step, for that showing only; Keep this zoom saves it', async () => {
  test.setTimeout(240_000);
  const { app, win, screens } = await twoScreens();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-live-zoom-'));
  const one = await makePicture(win, join(dir, 'Placeholder one.png'), ['#1d4e89', '#7c2d12']);
  const two = await makePicture(win, join(dir, 'Placeholder two.png'), ['#14532d']);
  const [oneId = '', twoId = ''] = await importAndGetIds(win, [one, two]);
  await background(win, oneId);
  await expect(win.getByTestId('live-zoom')).toBeVisible();
  await win.getByTestId('live-zoom-in').click();
  await win.getByTestId('live-zoom-in').click();
  await expect.poll(async () => (await snapshot(win)).liveZoom?.zoom).toBeCloseTo(1.5625);
  // Both screens glide there, and stand at the same place.
  for (const s of screens)
    await expect.poll(async () => (await drawn(s))[0]?.transform).toMatch(/scale\(1\.5625\)/u);
  expect(await drawn(screens[0])).toEqual(await drawn(screens[1]));
  // Scrolling over the preview zooms, dragging moves.
  const preview = await win.getByTestId('live-zoomable').boundingBox();
  if (!preview) throw new Error('no preview');
  await win.mouse.move(preview.x + preview.width / 2, preview.y + preview.height / 2);
  await win.mouse.wheel(0, -100);
  await expect.poll(async () => (await snapshot(win)).liveZoom?.zoom ?? 0).toBeGreaterThan(1.6);
  await win.mouse.down();
  await win.mouse.move(preview.x + preview.width * 0.6, preview.y + preview.height / 2, { steps: 5 });
  await win.mouse.up();
  await expect.poll(async () => (await snapshot(win)).liveZoom?.x ?? 0).toBeGreaterThan(0.05);
  // Keep this zoom: the picture's own now; the screens show the same, from its kept look.
  const live = (await snapshot(win)).liveZoom;
  await win.getByTestId('live-zoom-keep').click();
  await expect.poll(async () => (await snapshot(win)).liveZoom).toBeNull();
  const kept = await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.look(id), oneId);
  expect(kept?.zoom).toBeCloseTo(live?.zoom ?? 0);
  expect(kept?.x).toBeCloseTo(live?.x ?? 0);
  const scaleOf = (t: string | undefined) => Number(/scale\(([\d.]+)\)/u.exec(t ?? '')?.[1] ?? 0);
  for (const s of screens)
    await expect.poll(async () => scaleOf((await drawn(s))[0]?.transform)).toBeCloseTo(kept?.zoom ?? 0, 3);

  // A zoom lasts for that showing: the next picture comes up as kept (plain), the zoom gone.
  await win.getByTestId('live-zoom-in').click();
  await expect.poll(async () => (await snapshot(win)).liveZoom).not.toBeNull();
  await background(win, twoId);
  await expect.poll(async () => (await snapshot(win)).liveZoom).toBeNull();
  for (const s of screens) await expect.poll(() => drawn(s)).toEqual([]);
  // Simple Mode: no live zoom.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('live-zoom')).toHaveCount(0);
  expect(
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'zoomLive', zoom: 2, x: 0, y: 0 }),
    ),
  ).toMatchObject({ ok: false });
  await app.close();
});

test('each enhancement in the screens’ pixels, the same on two screens', async () => {
  test.setTimeout(240_000);
  const { app, win, screens } = await twoScreens();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-enhance-pixels-'));
  // Grey 96 and grey 160 side by side: brightness, contrast and sharpness read from them; a red for colour.
  const greys = await makePicture(win, join(dir, 'Placeholder greys.png'), ['#606060', '#a0a0a0']);
  const red = await makePicture(win, join(dir, 'Placeholder red.png'), ['#c03030']);
  const [greysId = '', redId = ''] = await importAndGetIds(win, [greys, red]);
  const set = (id: string, change: Record<string, number>) =>
    win.evaluate(
      ({ id, change }) =>
        (globalThis as PageGlobals).drashti.media.setLook(id, {
          zoom: 1,
          x: 0,
          y: 0,
          brightness: 0,
          contrast: 0,
          colour: 0,
          sharpness: 0,
          ...change,
        }),
      { id, change },
    );
  const points = [
    { x: 480, y: 540 },
    { x: 1440, y: 540 },
  ];
  const both = async (pts = points) => {
    const [a, b] = [await canvasPixels(screens[0], pts), await canvasPixels(screens[1], pts)];
    for (const [i, c] of a.entries())
      for (const k of [0, 1, 2]) expect(Math.abs((c[k] ?? 0) - (b[i]?.[k] ?? 0))).toBeLessThanOrEqual(6);
    return a;
  };
  await background(win, greysId);
  await expect.poll(async () => (await both())[0]?.[0] ?? 0).toBeGreaterThan(80);
  const plain = await both();
  // Brightness +50 %: each grey half as bright again.
  await set(greysId, { brightness: 0.5 });
  await expect.poll(async () => (await both())[0]?.[0] ?? 0).toBeGreaterThan((plain[0]?.[0] ?? 0) * 1.35);
  // Contrast +50 %: the dark one darker, the light one lighter.
  await set(greysId, { contrast: 0.5 });
  await expect.poll(async () => (await both())[0]?.[0] ?? 999).toBeLessThan((plain[0]?.[0] ?? 0) - 10);
  expect((await both())[1]?.[0] ?? 0).toBeGreaterThan((plain[1]?.[0] ?? 0) + 10);
  // Sharpness: right at the edge between them (a pixel either side, as the screen draws it), the light side
  // lighter and the dark side darker than either was: read along a line across the edge.
  await set(greysId, { sharpness: 1 });
  const across = Array.from({ length: 61 }, (_, i) => ({ x: 930 + i, y: 540 }));
  const extremes = async (screen: Page) => {
    const reds = (await canvasPixels(screen, across)).map((c) => c[0] ?? 0);
    return { most: Math.max(...reds), least: Math.min(...reds) };
  };
  for (const screen of screens)
    await expect
      .poll(async () => {
        const { most, least } = await extremes(screen);
        return most > (plain[1]?.[0] ?? 255) + 12 && least < (plain[0]?.[0] ?? 0) - 12;
      })
      .toBe(true);
  const [e1, e2] = [await extremes(screens[0]), await extremes(screens[1])];
  expect(Math.abs(e1.most - e2.most)).toBeLessThanOrEqual(8);
  expect(Math.abs(e1.least - e2.least)).toBeLessThanOrEqual(8);
  // Colour −100 %: a red becomes grey.
  await background(win, redId);
  await set(redId, { colour: -1 });
  await expect
    .poll(async () => {
      const [c] = await both([{ x: 960, y: 540 }]);
      return Math.max(Math.abs((c?.[0] ?? 0) - (c?.[1] ?? 0)), Math.abs((c?.[1] ?? 0) - (c?.[2] ?? 0)));
    })
    .toBeLessThanOrEqual(8);
  await app.close();
});

test('a sharpened picture: its copy on two screens and a node, with no filter in their pages', async () => {
  test.setTimeout(240_000);
  const main = await launchMain({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-sharpened-'));
    const picture = await makePicture(main.win, join(dir, 'Placeholder sharpened.png'), [
      '#606060',
      '#a0a0a0',
    ]);
    const [pictureId = ''] = await importAndGetIds(main.win, [picture]);
    await setUpScreen(main.win, 'Main Hall', 0);
    await setUpScreen(main.win, 'Side Hall', 1);
    await expect.poll(() => outputPages(main.app).length).toBe(2);
    // The node shows the main hall too, on its second display.
    const groupId = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.name === 'Main Hall')
          ?.id ?? '',
    );
    const displays = () =>
      main.win.evaluate(
        async (id) =>
          (
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
              ?.displays ?? []
          ).map((d) => d.id),
        nodeId,
      );
    await expect.poll(async () => (await displays()).length).toBeGreaterThanOrEqual(2);
    const displayId = (await displays())[1] ?? -1;
    expect(
      (
        await main.win.evaluate(
          ({ groupId, nodeId, displayId }) =>
            (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(groupId, nodeId, displayId),
          { groupId, nodeId, displayId },
        )
      ).ok,
    ).toBe(true);
    await background(main.win, pictureId);
    await expect.poll(() => outputPages(node.app).length).toBeGreaterThan(0);
    const pages = [...outputPages(main.app), ...outputPages(node.app)];
    for (const o of pages) await outputReady(o);
    // Unsharpened until its copy is ready: drawn, never blank.
    await main.win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setLook(id, {
          zoom: 1,
          x: 0,
          y: 0,
          brightness: 0.1,
          contrast: 0,
          colour: 0,
          sharpness: 0.5,
        }),
      pictureId,
    );
    // Made once, by Main; the node copies it as it copies media.
    await expect
      .poll(async () => (await libraryLook(main.win, pictureId))?.copy, { timeout: 60_000 })
      .toBe(50);
    for (const page of pages) {
      await expect
        .poll(() => sharpening(page), { timeout: 60_000 })
        .toEqual({ copies: [`drashti-media://sharp/${pictureId}/50`], svg: 0 });
      expect((await drawn(page))[0]?.filter).toBe('brightness(1.1)');
    }
    expect(readdirSync(join(main.userData, 'Media', 'sharpened'))).toHaveLength(1);
    // Sharpness back at 0: the picture itself again, and its copy goes.
    await main.win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setLook(id, {
          zoom: 1,
          x: 0,
          y: 0,
          brightness: 0.1,
          contrast: 0,
          colour: 0,
          sharpness: 0,
        }),
      pictureId,
    );
    for (const page of pages)
      await expect.poll(() => sharpening(page), { timeout: 30_000 }).toEqual({ copies: [], svg: 0 });
    await expect.poll(() => readdirSync(join(main.userData, 'Media', 'sharpened'))).toHaveLength(0);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

/** A picture of two greys side by side, W by H, saved to a temporary folder; its id once imported. */
async function edgePicture(win: Page, W: number, H: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-sharpened-pixels-'));
  const base64 = await win.evaluate(
    ({ W, H }) => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#606060';
      ctx.fillRect(0, 0, W / 2, H);
      ctx.fillStyle = '#a0a0a0';
      ctx.fillRect(W / 2, 0, W / 2, H);
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    { W, H },
  );
  const file = join(dir, 'Placeholder edge.png');
  writeFileSync(file, Buffer.from(base64, 'base64'));
  const [id = ''] = await importAndGetIds(win, [file]);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.setLook(id, {
        zoom: 1,
        x: 0,
        y: 0,
        brightness: 0,
        contrast: 0,
        colour: 0,
        sharpness: 0.5,
      }),
    id,
  );
  await expect.poll(async () => (await libraryLook(win, id))?.copy, { timeout: 60_000 }).toBe(50);
  return id;
}

/**
 * The copy's pixels across the edge against the Picture editor's preview, its frame 320 by 180 and on
 * whole pixels (so the preview is drawn at `size`, in this window's own pixels): plain, it is the two
 * greys; sharpened by its filter, it matches the copy within step 12's tolerance.
 */
async function copyMatchesPreview(win: Page, id: string, size: { W: number; H: number }, ratio: number) {
  const { W, H } = size;
  const across = Array.from({ length: 12 }, (_, i) => W / 2 - 6 + i);
  const copy = await win.evaluate(
    async ({ id, across, H }) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `drashti-media://sharp/${id}/50`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { width: 0, height: 0, row: [] };
      ctx.drawImage(img, 0, 0);
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        row: across.map((x) => ctx.getImageData(x, H / 2, 1, 1).data[0] ?? -1),
      };
    },
    { id, across, H },
  );
  // Made at the size it is drawn at.
  expect({ width: copy.width, height: copy.height }).toEqual({ width: W, height: H });
  const copyRow = copy.row;
  // Sharpened: darker and lighter than either grey beside the edge.
  expect(Math.min(...copyRow)).toBeLessThan(0x60 - 12);
  expect(Math.max(...copyRow)).toBeGreaterThan(0xa0 + 12);

  await openLibrary(win);
  await win.getByRole('tab', { name: 'Media' }).click();
  await win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder edge' })
    .getByTestId('media-picture')
    .click();
  const editor = win.getByTestId('picture-editor');
  await expect(editor).toBeVisible();
  // The dialog in its place (it rises in: Session 26g), so the frame snaps to whole device pixels there.
  await settled(win);
  const frame = editor.getByTestId('pe-frame');
  await frame.evaluate((el, ratio) => {
    const f = el as HTMLElement;
    f.style.width = '320px';
    f.style.height = '180px';
    f.style.borderWidth = '0';
    const r = f.getBoundingClientRect();
    const snap = (v: number) => (Math.ceil(v * ratio) - v * ratio) / ratio;
    f.style.marginLeft = `${String(snap(r.left))}px`;
    f.style.marginTop = `${String(snap(r.top))}px`;
  }, ratio);
  const previewRow = async () => {
    const box = await frame.boundingBox();
    if (!box) throw new Error('no frame');
    const png = (await win.screenshot({ clip: box, scale: 'device' })).toString('base64');
    return win.evaluate(
      async ({ png, across, H }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];
        ctx.drawImage(bitmap, 0, 0);
        return across.map((x) => ctx.getImageData(x, H / 2, 1, 1).data[0] ?? -1);
      },
      { png, across, H },
    );
  };
  // Held at Before, the preview is the picture itself: the two greys.
  await editor.getByTestId('pe-before').dispatchEvent('pointerdown');
  await expect(editor.getByTestId('pe-picture')).toHaveCSS('filter', 'none');
  const plain = await previewRow();
  for (const [i, x] of across.entries())
    expect(Math.abs((plain[i] ?? -99) - (x < W / 2 ? 0x60 : 0xa0)), `pixel ${String(x)}`).toBeLessThanOrEqual(
      2,
    );
  await editor.getByTestId('pe-before').dispatchEvent('pointerup');
  await expect(editor.getByTestId('pe-picture')).toHaveCSS('filter', /url/u);
  // Sharpened by its filter, the preview matches the copy within step 12's tolerance: 6 at each point,
  // 8 at the darkest and lightest.
  const preview = await previewRow();
  for (const [i, v] of copyRow.entries())
    expect(Math.abs((preview[i] ?? -99) - v), `pixel ${String(across[i])}`).toBeLessThanOrEqual(6);
  expect(Math.abs(Math.min(...preview) - Math.min(...copyRow))).toBeLessThanOrEqual(8);
  expect(Math.abs(Math.max(...preview) - Math.max(...copyRow))).toBeLessThanOrEqual(8);
}

test('a sharpened copy’s pixels match the Picture editor’s preview', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  // No screen set up: the copy is the picture's own size, drawn one pixel to one screen pixel in the
  // preview, as wide as its frame is made, in this window's own pixels.
  const ratio = await win.evaluate(() => window.devicePixelRatio);
  const size = { W: 320 * ratio, H: 180 * ratio };
  const id = await edgePicture(win, size.W, size.H);
  await copyMatchesPreview(win, id, size, ratio);
  await app.close();
});

test('a sharpened copy is made at the size the hall’s screen draws it, as the editor shows it (Session 26g)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const ratio = await win.evaluate(() => window.devicePixelRatio);
  // The hall's screen draws its 16:9 canvas 320 by 180 of this window's pixels (its own window sized for
  // that at its own pixel ratio).
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [output] = outputPages(app);
  const outputRatio = (await output?.evaluate(() => devicePixelRatio)) ?? 1;
  const css = { width: (320 * ratio) / outputRatio, height: (180 * ratio) / outputRatio };
  await app.evaluate(({ BrowserWindow }, css) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const url = w.webContents.getURL();
      if (url.includes('output.html') && !url.includes('identify=')) w.setContentSize(css.width, css.height);
    }
  }, css);
  await expect
    .poll(() => output?.evaluate(() => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio]))
    .toEqual([320 * ratio, 180 * ratio]);
  // A picture twice that size: its copy is made at the screen's size, sharpened there, as the editor's
  // preview (its frame the same size) sharpens it.
  const id = await edgePicture(win, 640 * ratio, 360 * ratio);
  await copyMatchesPreview(win, id, { W: 320 * ratio, H: 180 * ratio }, ratio);
  await app.close();
});

test('a phone draws a sharpened picture from its copy at the width it draws it, with no filter', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-sharpened-'));
  const picture = await makePicture(win, join(dir, 'Placeholder phone picture.png'), ['#606060', '#a0a0a0']);
  const [pictureId = ''] = await importAndGetIds(win, [picture]);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.setLook(id, {
        zoom: 1,
        x: 0,
        y: 0,
        brightness: 0.1,
        contrast: 0,
        colour: 0,
        sharpness: 0.5,
      }),
    pictureId,
  );
  await expect.poll(async () => (await libraryLook(win, pictureId))?.copy, { timeout: 60_000 }).toBe(50);
  await background(win, pictureId);
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  const loads: string[] = [];
  p.on('request', (r) => loads.push(new URL(r.url()).pathname));
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // The live picture: the copy at the width the phone draws it (Session 54, D1; its small preview before), with
    // the rest of its look, and no SVG filter.
    const copyId = `${pictureId}_s50`;
    const looked = p.getByTestId('remote-live').locator(`[data-look-picture][data-sharpened="${copyId}"]`);
    await expect(looked.locator(`img[data-preview="shown"][data-media-id="${copyId}"]`)).toHaveCount(1, {
      timeout: 30_000,
    });
    expect(await looked.evaluate((el) => (el as HTMLElement).style.filter)).toBe('brightness(1.1)');
    expect((await sharpening(p)).svg).toBe(0);
    expect(loads).toContain(`/api/v1/media/${copyId}/picture`);
    // Only pictures, never a file in pieces (a video's, played on the phone), the copy's or the picture's.
    expect(loads.filter((path) => path.includes('/media/') && !path.endsWith('/picture'))).toEqual([]);
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a node’s screen draws a picture’s look and the live zoom as Main’s does', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-node-look-'));
    const picture = await makePicture(main.win, join(dir, 'Placeholder node picture.png'), [
      '#1d4e89',
      '#7c2d12',
    ]);
    const [pictureId = ''] = await importAndGetIds(main.win, [picture]);
    await main.win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setLook(id, {
          zoom: 1.5,
          x: 0.1,
          y: 0,
          brightness: 0.1,
          contrast: 0,
          colour: 0.2,
          sharpness: 0,
        }),
      pictureId,
    );
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const groupId = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find(
          (g) => g.name === 'Placeholder Hall',
        )?.id ?? '',
    );
    const displays = () =>
      main.win.evaluate(
        async (id) =>
          (
            (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
              ?.displays ?? []
          ).map((d) => d.id),
        nodeId,
      );
    await expect.poll(async () => (await displays()).length).toBeGreaterThanOrEqual(2);
    const displayId = (await displays())[1] ?? -1;
    expect(
      (
        await main.win.evaluate(
          ({ groupId, nodeId, displayId }) =>
            (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(groupId, nodeId, displayId),
          { groupId, nodeId, displayId },
        )
      ).ok,
    ).toBe(true);
    await background(main.win, pictureId);
    const nodeOut = await (async () => {
      await expect.poll(() => outputPages(node.app).length).toBeGreaterThan(0);
      const [page] = outputPages(node.app);
      if (!page) throw new Error('no node screen');
      return page;
    })();
    await outputReady(nodeOut);
    await expect
      .poll(async () => (await drawn(nodeOut))[0]?.transform ?? '', { timeout: 60_000 })
      .toMatch(/scale\(1\.5\)/u);
    expect((await drawn(nodeOut))[0]?.filter).toBe('brightness(1.1) saturate(1.2)');
    // The live zoom from Main's LIVE: the node's screen follows.
    await main.win.getByTestId('live-zoom-in').click();
    await expect
      .poll(async () => (await drawn(nodeOut))[0]?.transform ?? '', { timeout: 30_000 })
      .toMatch(/scale\(1\.875\)/u);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
