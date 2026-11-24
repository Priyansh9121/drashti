import { join } from 'node:path';
import { beginCueDiagnostics, retainCueDiagnostics } from './video-cue-diagnostics';
import { letTimePass, outputReady } from './helpers';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { setupVideoCue, cueReady } from './video-cue-helpers';
import { decodePng } from './png-decode';

const video = (page: Page, id: string) => page.locator(`video[data-media-id="${id}"]`).first();
/** The cued video's trim (its start point): the frame Cue holds and Go starts from. */
const TRIM_MS = 1000;
/**
 * One frame of the stream's page: it draws 30 frames a second off screen (its capture: 1920x1080, 30 fps), in step with
 * this 30 fps video's frames, so it shows each of the video's frames on its own next frame: up to one of its frames
 * after the frame is due (a21-s5, a22-cue: its clock 9-47 ms after Go, read 19-54 ms on its frames).
 */
const STREAM_FRAME_MS = 1000 / 30;

/**
 * Cue a trimmed video, hold it `holdMs` (an operator may cue minutes ahead: Chromium lets an output that has been
 * silent for 30 s go to a stand-in sink, so a cue held past that is its own case), then Go: on hall, LIVE and the
 * stream it starts within one 30 fps frame of the engine's moment (the stream on its own frames, one of them more) and
 * never moves before it.
 */
async function cueThenGo(holdMs: number): Promise<void> {
  const { app, win, hall, stream, audio, ids, dir } = await setupVideoCue();
  await beginCueDiagnostics([hall, win, stream, audio], { lag: true });
  // Diagnostics only (a22-cue): a held cue's media and audio trace, from before its wait to after Go.
  const mediaTrace = holdMs > 0 ? join(dir, 's5-held-media-trace.json') : null;
  let tracing = false;
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
    // Diagnostics only: the reloaded hall is observed afresh (its first page's record went with it).
    await beginCueDiagnostics([hall], { lag: true });
    const cue = (await snapshot(win)).videoCue;
    if (!cue) throw new Error('No video cue');
    expect((await snapshot(win)).layers.background).toEqual({ kind: 'color', color: '#205020' });
    if (mediaTrace) {
      await app.evaluate(async ({ contentTracing }) => {
        await contentTracing.startRecording({ included_categories: ['media', 'audio'] });
      });
      tracing = true;
    }
    if (holdMs > 0)
      await letTimePass(
        win,
        holdMs,
        "the operator's wait between Cue and Go, past Chromium's 30 s silent-output switch",
      );
    expect((await snapshot(win)).videoCue?.id).toBe(cue.id);
    for (const page of [hall, win, stream]) {
      await expect(video(page, id)).toHaveJSProperty('paused', true);
      expect(await video(page, id).evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 2);
      await video(page, id).evaluate((v: HTMLVideoElement) => {
        v.dataset['prepared'] = 'yes';
        const initial = v.currentTime;
        // Diagnostics only: when this player's rate is actually set (its event comes a task later).
        const rate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
        if (rate?.set) {
          const sets: { at: number; rate: number }[] = [];
          Object.defineProperty(v, 'playbackRate', {
            configurable: true,
            get(this: HTMLMediaElement) {
              return rate.get?.call(this) as number;
            },
            set(this: HTMLMediaElement, value: number) {
              sets.push({ at: Date.now(), rate: value });
              v.dataset['rateSets'] = JSON.stringify(sets.slice(-12));
              rate.set?.call(this, value);
            },
          });
        }
        let after = 0;
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
            if (after === 0) {
              v.dataset['firstMotionAt'] = String(Date.now() + frame.expectedDisplayTime - performance.now());
              v.dataset['firstMotionMedia'] = String(frame.mediaTime);
              v.dataset['firstMotionCallbackAt'] = String(Date.now());
            }
            // Diagnostics only: the next frames too, to show how this page's frames follow the media's.
            if (++after < 9) v.requestVideoFrameCallback(presented);
          } else v.requestVideoFrameCallback(presented);
        };
        v.requestVideoFrameCallback(presented);
        // Retain the old observer beside the native frame timestamp, to prove any polling delay. Its animation frames'
        // times show the page's own frame grid (the stream's page draws 30 a second, off screen), diagnostics only.
        const ticks: number[][] = [];
        let moving = 0;
        const polled = () => {
          (globalThis as { s5Diagnostics?: { sample: () => void } }).s5Diagnostics?.sample();
          ticks.push([Date.now(), v.currentTime]);
          if (ticks.length > 48) ticks.shift();
          v.dataset['frameTicks'] = JSON.stringify(ticks);
          if (v.currentTime > initial + 0.001) {
            v.dataset['polledMotionAt'] ??= String(Date.now());
            if (++moving < 9) requestAnimationFrame(polled);
          } else requestAnimationFrame(polled);
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
    // Diagnostics only (a22-cue: the Mac's held cue got its Go late): how late the main process's event loop runs
    // around Go, and when the click went.
    await app.evaluate(() => {
      const lags: { t: number; ms: number }[] = [];
      let tickAt = Date.now();
      const timer = setInterval(() => {
        const now = Date.now();
        if (now - tickAt > 35 && lags.length < 2000) lags.push({ t: now, ms: now - tickAt });
        tickAt = now;
      }, 20);
      (globalThis as { s5MainLag?: { lags: typeof lags; stop: () => void } }).s5MainLag = {
        lags,
        stop: () => clearInterval(timer),
      };
    });
    const clickAt = Date.now();
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
      clock: string | null;
      ticks: unknown;
      rates: unknown;
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
        clock: await video(page, id).getAttribute('data-cue-clock'),
        ticks: JSON.parse((await video(page, id).getAttribute('data-frame-ticks')) ?? '[]'),
        rates: JSON.parse((await video(page, id).getAttribute('data-rate-sets')) ?? '[]'),
      });
      await expect(video(page, id)).toHaveAttribute('data-prepared', 'yes');
    }
    await test.info().attach('s5-motion-observers.json', {
      body: Buffer.from(JSON.stringify({ goAt: bg.seek.at, holdMs, clickAt, motion })),
      contentType: 'application/json',
    });
    for (const { page, at, mediaTime } of motion) {
      // Never moving before Go: no moved frame is on the screen before the engine's moment.
      expect(at - bg.seek.at).toBeGreaterThanOrEqual(0);
      // Starts within one 30 fps frame of Go (QA21-S5-1, the owner's "A, measure the start"): the start is the first
      // moving frame's display time less its media time past the trim. That frame is itself one frame after the trim,
      // so its own display time is a frame later than the start even when the start is exact.
      // The stream's page is judged on its own frames (QA23-CUE-5, the owner's words: "Stream: one frame more (Rec.)"):
      // one of its frames more. The hall's screens and LIVE keep one 30 fps frame.
      const start = at - (mediaTime - TRIM_MS / 1000) * 1000;
      const what =
        page === 'stream'
          ? 'the stream starts within one 30 fps frame of Go and one of its own frames'
          : 'starts within one 30 fps frame of Go';
      const bound = page === 'stream' ? 1000 / 30 + STREAM_FRAME_MS : 1000 / 30;
      expect(start - bg.seek.at, what).toBeLessThanOrEqual(bound);
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
    if (tracing && mediaTrace) {
      const kept = await app
        .evaluate(async ({ contentTracing }, path) => contentTracing.stopRecording(path), mediaTrace)
        .catch(() => null);
      if (kept)
        await test.info().attach('s5-held-media-trace.json', { path: kept, contentType: 'application/json' });
    }
    const mainLag = await app
      .evaluate(() => {
        const g = globalThis as { s5MainLag?: { lags: unknown; stop: () => void } };
        g.s5MainLag?.stop();
        const lags = g.s5MainLag?.lags ?? null;
        delete g.s5MainLag;
        return lags;
      })
      .catch(() => null);
    if (mainLag)
      await test.info().attach('s5-main-lag.json', {
        body: Buffer.from(JSON.stringify({ goAt: pixelGoAt, lags: mainLag })),
        contentType: 'application/json',
      });
    await retainCueDiagnostics([hall, win, stream, audio], test.info());
    await app.close();
  }
}

test('Cue holds the first trimmed frame privately, then Go uses its loaded frame at one shared engine moment', () =>
  cueThenGo(0));

test('A cue held over half a minute still starts within one frame of Go', async () => {
  test.setTimeout(150_000);
  await cueThenGo(35_000);
});

test('Crossfade in the playlist blends both pictures and sounds without black on hall, LIVE and stream', async () => {
  test.fixme(
    true,
    'Parked with the hidden feature: Crossfade… is not offered in alpha.22 (QA21-S5-2); it comes back with it',
  );
  const { app, win, hall, stream, audio, ids } = await setupVideoCue();
  try {
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
    for (const page of [...pages, audio])
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
      [...pages, audio].map((page) =>
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
    for (const page of [...pages, audio]) {
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
