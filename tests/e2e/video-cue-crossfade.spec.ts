import { streamSoundPage } from './stream-helpers';
import { beginCueDiagnostics, retainCueDiagnostics } from './video-cue-diagnostics';
import { outputReady } from './helpers';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { setupVideoCue, cueReady } from './video-cue-helpers';
import { decodePng } from './png-decode';

const video = (page: Page, id: string) => page.locator(`video[data-media-id="${id}"]`).first();
/** The cued video's trim (its start point): the frame Cue holds and Go starts from. */
const TRIM_MS = 1000;

test('Cue holds the first trimmed frame privately, then Go uses its loaded frame at one shared engine moment', async () => {
  const { app, win, hall, stream, audio, ids } = await setupVideoCue();
  await beginCueDiagnostics([hall, win, stream, audio]);
  let pixelGoAt: number | null = null;
  try {
    const id = ids[1] ?? '';
    await win.evaluate(
      ({ id, startMs }) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(id, { startMs, endMs: 7000, markers: [] }),
      { id, startMs: TRIM_MS },
    );
    await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#205020' } });
    expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
    await cueReady(win);
    await hall.reload();
    await outputReady(hall);
    await cueReady(win);
    const cue = (await snapshot(win)).videoCue;
    if (!cue) throw new Error('No video cue');
    expect((await snapshot(win)).layers.background).toEqual({ kind: 'color', color: '#205020' });
    for (const page of [hall, win, stream]) {
      await expect(video(page, id)).toHaveJSProperty('paused', true);
      expect(await video(page, id).evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 2);
      await video(page, id).evaluate((v: HTMLVideoElement) => {
        v.dataset['prepared'] = 'yes';
        const initial = v.currentTime;
        const callbacks: {
          at: number;
          expected: number;
          mediaTime: number;
          presentedFrames: number;
          currentTime: number;
        }[] = [];
        const presented: VideoFrameRequestCallback = (_now, frame) => {
          callbacks.push({
            at: Date.now(),
            expected: Date.now() + frame.expectedDisplayTime - performance.now(),
            mediaTime: frame.mediaTime,
            presentedFrames: frame.presentedFrames,
            currentTime: v.currentTime,
          });
          v.dataset['cueCallbacks'] = JSON.stringify(callbacks);
          if (frame.mediaTime > initial + 0.001) {
            v.dataset['firstMotionAt'] = String(Date.now() + frame.expectedDisplayTime - performance.now());
            v.dataset['firstMotionMedia'] = String(frame.mediaTime);
            v.dataset['firstMotionCallbackAt'] = String(Date.now());
          } else v.requestVideoFrameCallback(presented);
        };
        v.requestVideoFrameCallback(presented);
        // Retain the old observer beside the native frame timestamp, to prove any polling delay.
        const polled = () => {
          (globalThis as { s5Diagnostics?: { sample: () => void } }).s5Diagnostics?.sample();
          if (v.currentTime > initial + 0.001) v.dataset['polledMotionAt'] = String(Date.now());
          else requestAnimationFrame(polled);
        };
        requestAnimationFrame(polled);
      });
    }
    const sound = audio.locator(`audio[data-media-id="${id}"]`);
    await expect(sound).toHaveJSProperty('paused', true);
    const box = await video(hall, id).evaluate((v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        innerWidth,
        innerHeight,
        sourceWidth: v.videoWidth,
      };
    });
    await app.evaluate(
      ({ BrowserWindow }, { url, box }) => {
        const w = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
        if (!w) throw new Error('No native hall for Cue pixel evidence');
        const rows: {
          at: number;
          center: number | null;
          rgb: number[];
          size: { width: number; height: number };
        }[] = [];
        const stop = () => {
          if (!w.isDestroyed()) w.webContents.endFrameSubscription();
        };
        (
          globalThis as { s5CuePixels?: { box: typeof box; rows: typeof rows; stop: () => void } }
        ).s5CuePixels = { box, rows, stop };
        w.webContents.beginFrameSubscription(false, (image) => {
          const size = image.getSize(),
            data = image.toBitmap();
          const sx = size.width / box.innerWidth,
            sy = size.height / box.innerHeight;
          const y = Math.max(0, Math.min(size.height - 1, Math.round((box.y + box.height / 2) * sy)));
          const begin = Math.max(0, Math.round(box.x * sx));
          const end = Math.min(size.width - 1, Math.round((box.x + box.width) * sx));
          let left: number | null = null,
            right: number | null = null;
          for (let x = begin; x <= end; x++) {
            const p = (y * size.width + x) * 4;
            if ((data[p] ?? 0) > 220 && (data[p + 1] ?? 0) > 220 && (data[p + 2] ?? 0) > 220) {
              left ??= x;
              right = x;
            }
          }
          const p = (y * size.width + Math.floor((begin + end) / 2)) * 4;
          rows.push({
            at: Date.now(),
            size,
            center:
              left === null || right === null
                ? null
                : (((left + right + 1) / 2 - box.x * sx) * box.sourceWidth) / (box.width * sx),
            rgb: [data[p + 2] ?? 0, data[p + 1] ?? 0, data[p] ?? 0],
          });
          if (rows.length >= 60) stop();
        });
      },
      { url: hall.url(), box },
    );
    await win.getByRole('button', { name: 'Go cued video', exact: true }).click();
    const bg = (await snapshot(win)).layers.background;
    if (bg?.kind !== 'media' || !bg.seek) throw new Error('No scheduled Go');
    pixelGoAt = bg.seek.at;
    const motion: {
      page: string;
      at: number;
      mediaTime: number;
      callbackAt: number;
      polledAt: number;
      callbacks: unknown;
    }[] = [];
    for (const [index, page] of [hall, win, stream].entries()) {
      await expect(video(page, id)).toHaveAttribute('data-first-motion-at', /[1-9]/);
      motion.push({
        page: ['hall', 'LIVE', 'stream'][index] ?? '',
        at: Number(await video(page, id).getAttribute('data-first-motion-at')),
        mediaTime: Number(await video(page, id).getAttribute('data-first-motion-media')),
        callbackAt: Number(await video(page, id).getAttribute('data-first-motion-callback-at')),
        polledAt: Number(await video(page, id).getAttribute('data-polled-motion-at')),
        callbacks: JSON.parse((await video(page, id).getAttribute('data-cue-callbacks')) ?? '[]'),
      });
      await expect(video(page, id)).toHaveAttribute('data-prepared', 'yes');
    }
    await test.info().attach('s5-motion-observers.json', {
      body: Buffer.from(JSON.stringify({ goAt: bg.seek.at, motion })),
      contentType: 'application/json',
    });
    for (const { at, mediaTime } of motion) {
      // Never moving before Go: no moved frame is on the screen before the engine's moment.
      expect(at - bg.seek.at).toBeGreaterThanOrEqual(0);
      // Starts within one 30 fps frame of Go (QA21-S5-1, the owner's "A, measure the start"): the start is the first
      // moving frame's display time less its media time past the trim. That frame is itself one frame after the trim,
      // so its own display time is a frame later than the start even when the start is exact.
      const start = at - (mediaTime - TRIM_MS / 1000) * 1000;
      expect(start - bg.seek.at, 'starts within one 30 fps frame of Go').toBeLessThanOrEqual(1000 / 30);
    }
    await expect(sound).toHaveJSProperty('paused', false);
  } finally {
    const pixels = await app
      .evaluate(() => {
        const g = globalThis as { s5CuePixels?: { box: unknown; rows: unknown; stop: () => void } };
        const value = g.s5CuePixels;
        if (!value) return null;
        value.stop();
        delete g.s5CuePixels;
        return { box: value.box, rows: value.rows };
      })
      .catch(() => null);
    if (pixels)
      await test.info().attach('s5-native-cue-pixels.json', {
        body: Buffer.from(JSON.stringify({ goAt: pixelGoAt, ...pixels })),
        contentType: 'application/json',
      });
    await retainCueDiagnostics([hall, win, stream, audio], test.info());
    await app.close();
  }
});

test('Crossfade in the playlist blends both pictures and sounds without black on hall, LIVE and stream', async () => {
  const { app, win, hall, stream, audio, ids } = await setupVideoCue();
  try {
    const streamSound = await streamSoundPage(app);
    const made = await win.evaluate(async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const created = await d.playlists.create('Placeholder crossfade', null, false);
      if (!created.ok) throw new Error(created.message);
      const id = created.ids[0] ?? '';
      const added = await d.playlists.addItems(
        id,
        null,
        ids.map((mediaId) => ({ kind: 'media', mediaId })),
      );
      if (!added.ok) throw new Error(added.message);
      await d.playlists.setWhenEnds(added.ids[0] ?? '', 'next');
      return { id, items: added.ids };
    }, ids);
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder crossfade' }).click();
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Crossfade…', exact: true }).click();
    await win.getByLabel('Crossfade seconds', { exact: true }).fill('2');
    await win.getByRole('button', { name: 'Save crossfade', exact: true }).click();
    await dispatch(win, { type: 'playItem', playlistId: made.id, itemId: made.items[0] });
    await cueReady(win);
    const pages = [hall, win, stream];
    // Observe real moving updates; holding a test clock cannot prove smooth playback or sound.
    for (const page of [...pages, audio, streamSound])
      await page.evaluate(() => {
        const trace: { t: number; gains: number[] }[] = [],
          polledTrace: typeof trace = [];
        const observed = globalThis as { s5Fade?: typeof trace; s5FadePolled?: typeof trace };
        observed.s5Fade = trace;
        observed.s5FadePolled = polledTrace;
        const until = performance.now() + 4000;
        const read = () => {
          const root = document.querySelector('[data-video-crossfade]');
          const elements = root
            ? root.querySelectorAll<HTMLElement>('[data-bg-fade]')
            : document.querySelectorAll<HTMLElement>('audio[data-crossfade-gain]');
          return [...elements].map((el) => Number(el.dataset['videoGain'] ?? el.dataset['crossfadeGain']));
        };
        const polled = () => {
          const gains = read();
          if (gains.length === 2 && gains.every(Number.isFinite)) polledTrace.push({ t: Date.now(), gains });
          if (performance.now() < until) requestAnimationFrame(polled);
        };
        requestAnimationFrame(polled);
        // Observe the writer's completed updates. A rAF reader registered before the fade
        // otherwise reads the previous frame before the fade's rAF callback has run.
        const observer = new MutationObserver(() => {
          if (performance.now() >= until) {
            observer.disconnect();
            return;
          }
          const gains = read();
          if (gains.length === 2 && gains.every(Number.isFinite)) trace.push({ t: Date.now(), gains });
        });
        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-video-gain', 'data-crossfade-gain'],
        });
      });
    await dispatch(win, { type: 'next' });
    const fade = (await snapshot(win)).videoCrossfade;
    if (!fade) throw new Error('No engine crossfade');
    expect(fade.durationMs).toBe(2000);
    // Capture actual blended pixels halfway through the engine interval, before its second half completes.
    await expect
      .poll(() => hall.locator('[data-bg-fade="in"]').getAttribute('data-video-gain'), { intervals: [16] })
      .toMatch(/^0\.[34]/);
    const before = Date.now();
    const image = decodePng(await hall.screenshot());
    const after = Date.now();
    const p = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
    const red = image.rgba[p] ?? 0,
      blue = image.rgba[p + 2] ?? 0;
    expect(red + blue, 'actual picture stays lit while red blends directly into blue').toBeGreaterThan(140);
    const expected = (now: number) => Math.max(0, Math.min(1, (now - fade.at) / fade.durationMs));
    // Generated backgrounds are approximately red=(143,36,36), blue=(36,36,143).
    expect(blue).toBeGreaterThanOrEqual(36 + 107 * expected(before) - 12);
    expect(blue).toBeLessThanOrEqual(36 + 107 * expected(after) + 12);
    await expect.poll(async () => (await snapshot(win)).videoCrossfade ?? null).toBeNull();
    const observers = await Promise.all(
      [...pages, audio, streamSound].map((page) =>
        page.evaluate(() => {
          const observed = globalThis as {
            s5Fade?: { t: number; gains: number[] }[];
            s5FadePolled?: { t: number; gains: number[] }[];
          };
          return { updated: observed.s5Fade ?? [], polled: observed.s5FadePolled ?? [] };
        }),
      ),
    );
    await test.info().attach('s5-gain-observers.json', {
      body: Buffer.from(JSON.stringify({ fade, observers })),
      contentType: 'application/json',
    });
    for (const page of [...pages, audio, streamSound]) {
      const trace = await page.evaluate(
        () => (globalThis as { s5Fade?: { t: number; gains: number[] }[] }).s5Fade ?? [],
      );
      expect(
        trace.length,
        'moving picture and sound gains were observed throughout the overlap',
      ).toBeGreaterThan(20);
      expect(trace.some((f) => (f.gains[1] ?? 0) > 0.75)).toBe(true);
      let previous = -1;
      for (const frame of trace) {
        const incoming = frame.gains[1] ?? -1;
        expect((frame.gains[0] ?? -1) + incoming).toBeCloseTo(1, 2);
        expect(incoming).toBeGreaterThanOrEqual(previous - 0.001);
        // Sound's diagnostics update every 50 ms; the audio thread executes the uninterrupted scheduled ramp.
        const tolerance = page === audio ? 0.04 : 0.02;
        expect(Math.abs(incoming - expected(frame.t))).toBeLessThanOrEqual(tolerance);
        previous = incoming;
      }
    }
    await expect(video(hall, ids[0] ?? '')).toHaveCount(0);
    await expect(video(hall, ids[1] ?? '')).toHaveJSProperty('paused', false);
  } finally {
    await app.close();
  }
});

test('Saving a new edit cancels only its private cue, keeps LIVE, and Cue waits for that edited copy', async () => {
  const { app, win, hall, audio, ids } = await setupVideoCue();
  try {
    const id = ids[1] ?? '';
    const playing = ids[0] ?? '';
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: playing, media: 'video', fit: 'fit', loop: true },
    });
    await expect(video(hall, playing)).toHaveJSProperty('paused', false);
    const sounding = audio.locator(`audio[data-media-id="${playing}"]`);
    await expect(sounding).toHaveJSProperty('paused', false);
    const live = (await snapshot(win)).layers;
    expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
    await cueReady(win);
    const saved = await win.evaluate(async (id) => {
      const media = (globalThis as PageGlobals).drashti.media;
      const read = await media.videoEdit(id);
      if (!read.ok) throw new Error(read.message);
      return media.setVideoEdit({
        mediaId: id,
        revision: read.edit.revision,
        recipe: { ...read.edit.recipe, speed: 2 },
      });
    }, id);
    expect(saved.ok).toBe(true);
    await expect.poll(async () => (await snapshot(win)).videoCue ?? null).toBeNull();
    expect((await snapshot(win)).layers).toEqual(live);
    await expect(sounding).toHaveJSProperty('paused', false);
    expect(await dispatch(win, { type: 'cueVideo', mediaId: id })).toMatchObject({
      ok: false,
      error: 'preparing',
    });
    await expect(video(hall, id)).toHaveCount(0);
    expect((await snapshot(win)).layers).toEqual(live);
  } finally {
    await app.close();
  }
});
