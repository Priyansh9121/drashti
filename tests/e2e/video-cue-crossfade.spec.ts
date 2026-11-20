import { outputReady } from './helpers';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { setupVideoCue, cueReady } from './video-cue-helpers';
import { decodePng } from './png-decode';

const video = (page: Page, id: string) => page.locator(`video[data-media-id="${id}"]`).first();

test('Cue holds the first trimmed frame privately, then Go uses its loaded frame at one shared engine moment', async () => {
  const { app, win, hall, stream, audio, ids } = await setupVideoCue();
  try {
    const id = ids[1] ?? '';
    await win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(id, { startMs: 1000, endMs: 7000, markers: [] }),
      id,
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
        const tick = () => {
          if (v.currentTime > initial + 0.001) v.dataset['firstMotionAt'] = String(Date.now());
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
    const sound = audio.locator(`audio[data-media-id="${id}"]`);
    await expect(sound).toHaveJSProperty('paused', true);
    await win.getByRole('button', { name: 'Go cued video', exact: true }).click();
    const bg = (await snapshot(win)).layers.background;
    if (bg?.kind !== 'media' || !bg.seek) throw new Error('No scheduled Go');
    for (const page of [hall, win, stream]) {
      await expect(video(page, id)).toHaveAttribute('data-first-motion-at', /[1-9]/);
      const at = Number(await video(page, id).getAttribute('data-first-motion-at'));
      expect(at - bg.seek.at).toBeGreaterThanOrEqual(0);
      expect(at - bg.seek.at, 'first motion within one 30 fps frame').toBeLessThanOrEqual(1000 / 30);
      await expect(video(page, id)).toHaveAttribute('data-prepared', 'yes');
    }
    await expect(sound).toHaveJSProperty('paused', false);
  } finally {
    await app.close();
  }
});

test('Crossfade in the playlist blends both pictures and sounds without black on hall, LIVE and stream', async () => {
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
    // Observe real moving frames; holding a test clock cannot prove smooth playback or sound.
    for (const page of [...pages, audio])
      await page.evaluate(() => {
        const trace: { t: number; gains: number[] }[] = [];
        (globalThis as { s5Fade?: typeof trace }).s5Fade = trace;
        const until = performance.now() + 4000;
        const tick = () => {
          const root = document.querySelector('[data-video-crossfade]');
          const elements = root
            ? root.querySelectorAll<HTMLElement>('[data-bg-fade]')
            : document.querySelectorAll<HTMLElement>('audio[data-crossfade-gain]');
          const gains = [...elements].map((el) =>
            Number(el.dataset['videoGain'] ?? el.dataset['crossfadeGain']),
          );
          if (gains.length === 2 && gains.every(Number.isFinite)) trace.push({ t: Date.now(), gains });
          if (performance.now() < until) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    await dispatch(win, { type: 'next' });
    const fade = (await snapshot(win)).videoCrossfade;
    if (!fade) throw new Error('No engine crossfade');
    expect(fade.durationMs).toBe(2000);
    // Capture actual blended pixels halfway through the engine interval, before its second half completes.
    await expect
      .poll(() => hall.locator('[data-bg-fade="in"]').getAttribute('data-video-gain'))
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
