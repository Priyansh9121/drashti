import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
  windowShowing,
} from './helpers';
import { audioPage, dispatch, snapshot } from './time-bar-helpers';
import { makeTestVideo } from './test-media';
import { holdClock } from './placeholder-slides';
import { decodePng } from './png-decode';

async function setup() {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-s5-'));
  const a = await makeTestVideo(win, join(dir, 'Placeholder red.webm'), { seconds: 8, hue: 0, tone: 440 });
  const b = await makeTestVideo(win, join(dir, 'Placeholder blue.webm'), { seconds: 8, hue: 240, tone: 880 });
  const ids = await importAndGetIds(win, [a, b]);
  await setUpScreen(win, 'Main Hall', 0);
  const hall = await outputPage(app);
  await outputReady(hall);
  await win.getByTestId('open-stream').click();
  const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(stream.getByTestId('program-root')).toBeVisible();
  return { app, win, hall, stream, audio: await audioPage(app), ids };
}

const video = (page: Page, id: string) => page.locator(`video[data-media-id="${id}"]`).first();

test('Cue holds the first trimmed frame privately, then Go uses its loaded frame at one shared engine moment', async () => {
  const { app, win, hall, stream, audio, ids } = await setup();
  try {
    const id = ids[1] ?? '';
    await win.evaluate(
      (id) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(id, { startMs: 1000, endMs: 7000, markers: [] }),
      id,
    );
    await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#205020' } });
    expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
    await expect
      .poll(async () => (await snapshot(win)).videoCue?.ready.length ?? -1, {
        message: 'Cue publishes matching first-frame acknowledgements',
      })
      .toBeGreaterThanOrEqual(4);
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
  const { app, win, hall, stream, audio, ids } = await setup();
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
    await expect
      .poll(async () => (await snapshot(win)).videoCue?.ready.length ?? -1)
      .toBeGreaterThanOrEqual(4);
    await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 5500 });
    await expect.poll(async () => (await snapshot(win)).videoCrossfade?.durationMs ?? 0).toBe(2000);
    const fade = (await snapshot(win)).videoCrossfade;
    if (!fade) throw new Error('No engine crossfade');
    for (const fraction of [0.1, 0.5, 0.9]) {
      await holdClock(app, fade.at + fade.durationMs * fraction);
      for (const page of [hall, win, stream]) {
        const root = page.locator('[data-video-crossfade]').first();
        await expect(root).toHaveAttribute('data-video-crossfade', fade.id);
        await expect
          .poll(() =>
            root
              .locator('[data-video-gain]')
              .evaluateAll((ns) => ns.map((n) => Number((n as HTMLElement).dataset['videoGain']))),
          )
          .toEqual([1 - fraction, fraction]);
      }
      await expect
        .poll(() =>
          audio
            .locator('audio[data-crossfade-gain]')
            .evaluateAll((ns) => ns.map((n) => Number((n as HTMLElement).dataset['crossfadeGain']))),
        )
        .toEqual([1 - fraction, fraction]);
      const image = decodePng(await hall.screenshot());
      const p = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
      expect(
        (image.rgba[p] ?? 0) + (image.rgba[p + 2] ?? 0),
        'actual picture never dips through black',
      ).toBeGreaterThan(80);
    }
    await holdClock(app, null);
    await expect.poll(async () => (await snapshot(win)).videoCrossfade ?? null).toBeNull();
    await expect(video(hall, ids[0] ?? '')).toHaveCount(0);
    await expect(video(hall, ids[1] ?? '')).toHaveJSProperty('paused', false);
  } finally {
    await holdClock(app, null);
    await app.close();
  }
});
