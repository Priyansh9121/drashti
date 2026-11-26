import { type ElectronApplication, type Locator, type Page, expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { logText } from './log-lines';
import { decodePng } from './png-decode';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  openSection,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';

/*
 * A probe, never merged (QA24-WALLBLACK-1, a24-wallblack): the owner's "after using picture in picture/video inputs,
 * the wallpaper goes black". A large placeholder picture (so the screens draw its display copy, as a photo's would)
 * and a small one are wallpapers; the chosen one is read on the hall, in LIVE and in its tile at each step: a video
 * input (Chromium's fake camera) added with its dialog, up and off; in the box and off; the picture itself in the box;
 * a window in the box; Delete and Undo; a restart. Each step's facts are printed (PROBE lines) and kept with the test.
 */

const ENV = {
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_FAKE_DEVICES: '1',
  DRASHTI_TEST_WINDOW_STANDIN: '1',
};

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let b = 0; b < 8; b++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(name: string, bytes: Buffer): Buffer {
  const type = Buffer.from(name);
  let crc = 0xffffffff;
  for (const b of Buffer.concat([type, bytes])) crc = (CRC[(crc ^ b) & 255] ?? 0) ^ (crc >>> 8);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const end = Buffer.alloc(4);
  end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, type, bytes, end]);
}
/** An opaque placeholder PNG of one bright colour. */
function picture(file: string, width: number, height: number, rgb: [number, number, number]): string {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 1 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  return file;
}

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** Mean light (0-255) of a screenshot, or null when it could not be taken. */
async function light(target: Page | Locator): Promise<number | null> {
  try {
    const png = decodePng(await target.screenshot({ timeout: 5000 }));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < png.rgba.length; i += 16) {
      sum += ((png.rgba[i] ?? 0) + (png.rgba[i + 1] ?? 0) + (png.rgba[i + 2] ?? 0)) / 3;
      n++;
    }
    return n > 0 ? Math.round(sum / n) : null;
  } catch {
    return null;
  }
}

/** What a page has of the wallpaper's picture elements: each img's src, complete, natural width. */
const imgs = (page: Page, selector: string) =>
  page
    .evaluate(async (sel) => {
      const all = [...document.querySelectorAll<HTMLImageElement>(sel)];
      const out = [];
      for (const img of all) {
        const src = img.getAttribute('src') ?? '';
        // The same address loaded again, and a new one (?probe): does the page get it, and what light it has.
        const again = await new Promise<string>((resolve) => {
          const i = new Image();
          i.onload = () => {
            resolve(`ok ${String(i.naturalWidth)}`);
          };
          i.onerror = () => {
            resolve('error');
          };
          i.src = src;
        });
        const fresh = await new Promise<string>((resolve) => {
          const i = new Image();
          i.crossOrigin = 'anonymous';
          i.onload = () => {
            const c = document.createElement('canvas');
            c.width = 8;
            c.height = 8;
            const ctx = c.getContext('2d');
            if (!ctx) {
              resolve('no canvas');
              return;
            }
            ctx.drawImage(i, 0, 0, 8, 8);
            const d = ctx.getImageData(4, 4, 1, 1).data;
            resolve(
              `ok ${String(i.naturalWidth)}x${String(i.naturalHeight)} rgb ${String(d[0])},${String(d[1])},${String(d[2])}`,
            );
          };
          i.onerror = () => {
            resolve('error');
          };
          i.src = `${src}${src.includes('?') ? '&' : '?'}probe=${String(Date.now())}`;
        });
        out.push({ src, complete: img.complete, naturalWidth: img.naturalWidth, again, fresh });
      }
      return out;
    }, selector)
    .catch((e: unknown) => String(e));

async function report(
  app: ElectronApplication,
  win: Page,
  hall: Page,
  wallpaperId: string,
  mediaId: string,
  userData: string,
  step: string,
  facts: Record<string, unknown>[],
): Promise<void> {
  const tile = win.locator(`[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"]`).first();
  const live = win.getByTestId('live-preview').getByTestId('scene').first();
  const library = await win.evaluate(
    async ({ id, wid }) => {
      const d = (globalThis as PageGlobals).drashti;
      const view = await d.wallpapers.view();
      const looks = await d.media.looks();
      const state = (await d.engine.snapshot()).state;
      return {
        chosen: view.chosenId === wid,
        pictures: view.wallpapers.find((w) => w.id === wid)?.pictures ?? null,
        libraryLook: looks[id] ?? null,
        stateLook: state.pictures[id] ?? null,
        chosenWallpaper: state.chosenWallpaper ?? null,
        background: state.layers.background?.kind ?? null,
        pip: state.layers.pip?.source.kind ?? null,
        wallpaperUp: state.wallpaper,
      };
    },
    { id: mediaId, wid: wallpaperId },
  );
  const displayDir = join(userData, 'Media', 'display');
  const display = (() => {
    try {
      return readdirSync(displayDir).map((f) => `${f} ${String(statSync(join(displayDir, f)).size)}`);
    } catch {
      return ['(none)'];
    }
  })();
  const fact = {
    step,
    library,
    display,
    tileImgs: await imgs(win, `[data-testid="wallpaper-tile"][data-wallpaper-id="${wallpaperId}"] img`),
    tileLight: (await tile.count()) > 0 ? await light(tile) : 'no tile',
    liveNothingUp: await live.getAttribute('data-nothing-up').catch(() => 'n/a'),
    liveImgs: await imgs(win, '[data-testid="live-preview"] [data-testid="wallpaper-picture"] img'),
    liveLight: await light(live),
    hallNothingUp: await hall
      .getByTestId('scene')
      .first()
      .getAttribute('data-nothing-up')
      .catch(() => 'n/a'),
    hallImgs: await imgs(hall, '[data-testid="wallpaper-picture"] img'),
    hallLight: await light(hall),
    windows: app.windows().length,
  };
  facts.push(fact);
  console.log(`PROBE ${JSON.stringify(fact)}`);
  const lines = logText(userData)
    .split('\n')
    .filter((l) => /display copy|Display copy|wallpaper|Wallpaper|media/u.test(l))
    .slice(-15);
  console.log(`PROBE-LOG ${step}\n${lines.join('\n')}`);
}

test('probe: the chosen wallpaper through video inputs, the box, Delete and Undo, and a restart', async () => {
  test.setTimeout(420_000);
  const { app, userData } = await launchApp(ENV);
  const facts: Record<string, unknown>[] = [];
  const failed: string[] = [];
  const watch = (page: Page, who: string) => {
    page.on('requestfailed', (r) => {
      if (r.url().startsWith('drashti-media:'))
        failed.push(`${who} failed ${r.url()} ${r.failure()?.errorText ?? ''}`);
    });
    page.on('response', (r) => {
      if (r.url().startsWith('drashti-media:') && r.status() >= 300)
        failed.push(`${who} ${String(r.status())} ${r.url()}`);
    });
  };
  try {
    const win = await operatorPage(app);
    watch(win, 'operator');
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-wallblack-'));
    const large = picture(join(dir, 'Placeholder wallpaper large.png'), 4000, 2250, [40, 160, 220]);
    const small = picture(join(dir, 'Placeholder wallpaper small.png'), 640, 360, [220, 160, 40]);
    const [largeId = '', smallId = ''] = await importAndGetIds(win, [large, small]);
    expect(largeId).not.toBe('');
    await setUpScreen(win);
    const hall = await outputPage(app);
    watch(hall, 'hall');
    await outputReady(hall);
    const made = await win.evaluate(
      async (ids) => {
        const d = (globalThis as PageGlobals).drashti;
        const added = await d.wallpapers.add(ids, null);
        if (!added.ok) throw new Error(added.message);
        const chosen = await d.wallpapers.choose(added.ids[0] ?? null);
        if (!chosen.ok) throw new Error(chosen.message);
        return added.ids;
      },
      [largeId, smallId],
    );
    const wallpaperId = made[0] ?? '';
    const at = (step: string) => report(app, win, hall, wallpaperId, largeId, userData, step, facts);
    const settle = (ms = 2500) => letTimePass(win, ms, 'a probe reads the screens a while after each step');
    await expect(win.getByTestId('live-preview').getByTestId('scene').first()).toHaveAttribute(
      'data-nothing-up',
      'wallpaper',
    );
    await settle(4000);
    await at('0 chosen');

    // Add a Video Input… with its dialog (its live pictures in the operator window), as the owner would.
    await openSection(win, 'video-inputs');
    await win.getByTestId('add-video-input').click();
    const dialog = win.getByTestId('video-input-dialog');
    await expect(dialog).toBeVisible();
    const choice = dialog.getByTestId('video-input-device').first();
    await expect(choice).toBeVisible({ timeout: 15_000 });
    await settle();
    await at('1 dialog open');
    await choice.click();
    await dialog.getByTestId('video-input-name').fill('Placeholder input');
    await dialog.getByTestId('video-input-save').click();
    await expect(dialog).toHaveCount(0);
    await settle();
    await at('2 input added');
    const inputId = await win.evaluate(async () => {
      const list = await (globalThis as PageGlobals).drashti.videoInputs.list();
      return list.inputs.find((i) => i.name === 'Placeholder input')?.id ?? '';
    });
    expect(inputId).not.toBe('');

    await dispatch(win, { type: 'showInput', inputId });
    await settle(4000);
    await at('3 input up');
    await dispatch(win, { type: 'clearLayer', layer: 'background' });
    await settle(500);
    await at('4a input off (0.5 s)');
    await settle(4000);
    await at('4b input off (4.5 s)');

    await dispatch(win, { type: 'showPip', source: { kind: 'input', inputId } });
    await settle(4000);
    await at('5 input in the box');
    await dispatch(win, { type: 'hidePip' });
    await settle(4000);
    await at('6 box off');

    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: largeId } });
    await settle(4000);
    await at('7 the wallpaper picture in the box');
    await dispatch(win, { type: 'swapPip' });
    await settle(3000);
    await dispatch(win, { type: 'hidePip' });
    await settle(4000);
    await at('8 box off again');

    const offered = await win.evaluate(async () => {
      const list = await (globalThis as PageGlobals).drashti.liveWindow.list();
      return list.ok ? list.windows.map((w) => w.id) : [];
    });
    if (offered[0]) {
      await dispatch(win, { type: 'showPip', source: { kind: 'window', id: offered[0] } });
      await settle(4000);
      await dispatch(win, { type: 'hidePip' });
      await settle(4000);
      await at('9 a window in the box, off');
    }

    await dispatch(win, { type: 'showInput', inputId });
    await settle(3000);
    await dispatch(win, { type: 'showPip', source: { kind: 'slides' } });
    await settle(2000);
    await dispatch(win, { type: 'clearAll' });
    await settle(4000);
    await at('10 input and the box, Clear all');

    await win.evaluate(async (wid) => {
      const d = (globalThis as PageGlobals).drashti;
      const gone = await d.wallpapers.remove(wid);
      if (!gone.ok) throw new Error(gone.message);
    }, wallpaperId);
    await settle(2000);
    await win.evaluate(async (wid) => {
      const d = (globalThis as PageGlobals).drashti;
      const back = await d.wallpapers.restore(wid);
      if (!back.ok) throw new Error(back.message);
    }, wallpaperId);
    await settle(4000);
    await at('11 Delete and Undo');

    await dispatch(win, { type: 'setWallpaper', on: true });
    await settle(2000);
    await dispatch(win, { type: 'setWallpaper', on: false });
    await settle(3000);
    await at('12 the Wallpaper on and off');
    console.log(`PROBE-FAILED ${JSON.stringify(failed)}`);
  } finally {
    await app.close().catch(() => undefined);
  }
  const again = await relaunchApp(userData, ENV);
  try {
    const win = await operatorPage(again.app);
    await operatorReady(win);
    const hall = await outputPage(again.app);
    await outputReady(hall);
    await letTimePass(win, 5000, 'a probe reads the screens a while after the restart');
    const wid = await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.wallpapers.view()).chosenId ?? '',
    );
    const mid = await win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.chosenWallpaper?.pictures[0] ??
        '',
    );
    await report(again.app, win, hall, wid, mid, userData, '13 after a restart', facts);
  } finally {
    await again.app.close().catch(() => undefined);
  }
  await test.info().attach('probe.json', { body: JSON.stringify({ facts, failed }, null, 1) });
  // Fails where any step's LIVE or hall was dark with the wallpaper chosen (the facts above say how).
  const dark = facts.filter(
    (f) =>
      (typeof f['liveLight'] === 'number' && f['liveLight'] < 30) ||
      (typeof f['hallLight'] === 'number' && f['hallLight'] < 30),
  );
  expect(dark.map((f) => f['step'])).toEqual([]);
});
