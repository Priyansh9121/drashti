import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlaybackClock } from '../../src/shared/media';
import { playbackBounds, playbackOffset, playbackPosition } from '../../src/shared/media';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';
import { makeTestVideo } from './test-media';

/*
 * A prop's video plays in step on every screen (Session 27, the skills review's MOT-6): the engine stamps
 * when the prop went up, and each screen plays its videos from then. Before, each window played them from
 * when it drew them, so a screen that opened later was behind by as much. Since Session 52 a prop's video, and
 * the logo's, play between their file's start and end points, as a background video does. A generated video only.
 */

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

/** Where a page's prop video is, in seconds (or NaN), once it plays. */
const where = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('[data-layer="props"] video');
    return v && v.readyState >= 2 && !v.paused ? v.currentTime : Number.NaN;
  });

test('a prop’s video plays in step on a screen that opens after it went up', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-prop-video-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder prop clip.webm'), {
    seconds: 8,
    hue: 200,
    tone: 0,
  });
  const [mediaId = ''] = await importAndGetIds(win, [video]);
  const firstId = await setUpScreen(win, 'Main Hall', 0);
  const first = await outputFor(app, firstId);
  await expect(first.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await win.evaluate(async (mediaId) => {
    const shown = await (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'showProp',
      prop: {
        id: 'placeholder-prop',
        name: 'Placeholder video prop',
        elements: [
          {
            id: 'placeholder-prop-video',
            kind: 'video',
            mediaId,
            frame: { x: 1200, y: 60, width: 640, height: 360 },
            fit: 'fit',
            loop: true,
          },
        ],
      },
    });
    if (!shown.ok) throw new Error('the prop was refused');
  }, mediaId);
  await expect.poll(() => where(first), { timeout: 20_000 }).toBeGreaterThan(0);
  // Two seconds on, a second screen opens: it plays the video where the first one is, not from its start.
  await letTimePass(win, 2000, 'the prop’s video plays on before the second screen opens');
  const secondId = await setUpScreen(win, 'Side Hall', 1);
  const second = await outputFor(app, secondId);
  await expect.poll(() => where(second), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const [a, b] = [await where(first), await where(second)];
        return Math.abs(a - b);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(0.15);
  await app.close();
});

/** Where a page's copy plays, sampled every 50 ms for a while (seconds). */
function positions(page: Page, selector: string, ms: number): Promise<number[]> {
  return page.evaluate(
    ({ selector, ms }) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const t = setInterval(() => {
          const v = document.querySelector<HTMLMediaElement>(selector);
          if (v && Number.isFinite(v.duration)) seen.push(v.currentTime);
        }, 50);
        setTimeout(() => {
          clearInterval(t);
          resolve(seen);
        }, ms);
      }),
    { selector, ms },
  );
}

/**
 * How far a page's copy is from where the engine's clock has it (seconds; shared/media.ts, as every screen works it
 * out), the median of five looks 60 ms apart; null while it does not play.
 */
async function offsetFrom(page: Page, selector: string, clock: PlaybackClock): Promise<number | null> {
  const looks = await page.evaluate(async (s) => {
    const out: { at: number; now: number; duration: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const v = document.querySelector<HTMLMediaElement>(s);
      if (!v || !Number.isFinite(v.duration) || v.paused) return null;
      out.push({ at: v.currentTime, now: Date.now(), duration: v.duration });
      // eslint-disable-next-line no-restricted-syntax -- in the page: looks 60 ms apart while it plays
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return out;
  }, selector);
  if (!looks) return null;
  const offsets = looks.map((l) => {
    const { start, end } = playbackBounds(clock.clip, l.duration);
    return playbackOffset(l.at, playbackPosition(clock, l.duration, l.now), end - start, clock.loop);
  });
  return offsets.sort((x, y) => x - y)[2] ?? null;
}

test('a prop’s video loops between its file’s start and end points, in step on two screens; the logo’s holds at its end point (Session 52)', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-prop-points-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder prop points clip.webm'), {
    seconds: 8,
    hue: 40,
  });
  const [mediaId = ''] = await importAndGetIds(win, [video]);
  // Its start and end points, as Media's Markers keeps them: it plays between 0:02 and 0:06.
  const set = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.setMarkers(id, { startMs: 2000, endMs: 6000, markers: [] }),
    mediaId,
  );
  expect(set.ok).toBe(true);
  const first = await outputFor(app, await setUpScreen(win, 'Main Hall', 0));
  const second = await outputFor(app, await setUpScreen(win, 'Side Hall', 1));
  for (const o of [first, second]) await outputReady(o);
  const element = (id: string, loop: boolean) =>
    ({
      id,
      kind: 'video',
      mediaId,
      frame: { x: 1200, y: 60, width: 640, height: 360 },
      fit: 'fit',
      loop,
    }) as const;
  const show = (type: 'showProp' | 'showLogo', id: string, el: ReturnType<typeof element>) =>
    win.evaluate(
      async ({ type, id, el }) => {
        const shown = await (globalThis as PageGlobals).drashti.engine.dispatch({
          type,
          prop: { id, name: `Placeholder ${id}`, elements: [el] },
        });
        if (!shown.ok) throw new Error(`${type} was refused`);
      },
      { type, id, el },
    );
  await show('showProp', 'points-prop', element('points-prop-video', true));
  const propVideo = `[data-layer="props"] video[data-media-id="${mediaId}"]`;
  const playing = (page: Page) =>
    page.evaluate((s) => !(document.querySelector<HTMLMediaElement>(s)?.paused ?? true), propVideo);
  for (const o of [first, second]) await expect.poll(() => playing(o), { timeout: 20_000 }).toBe(true);
  // Between its points only, going round: never before 0:02 or (much) after 0:06. Before, it played the whole file.
  const seen = await positions(first, propVideo, 6000);
  expect(seen.length).toBeGreaterThan(20);
  expect(Math.min(...seen)).toBeGreaterThan(1.8);
  expect(Math.max(...seen)).toBeLessThan(6.35);
  expect(seen.some((p, i) => i > 0 && p < (seen[i - 1] ?? 0) - 2)).toBe(true);
  // The points come from the engine (the prop's clips): each screen is where its clock has the video, in step.
  const prop = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.props[0],
  );
  expect(prop?.clips).toEqual({ [mediaId]: { startMs: 2000, endMs: 6000 } });
  const clock: PlaybackClock = { startedAt: prop?.shownAt ?? 0, loop: true, clip: prop?.clips?.[mediaId] };
  const until = Date.now() + 15_000;
  const looks: string[] = [];
  for (;;) {
    const a = await offsetFrom(first, propVideo, clock);
    const b = await offsetFrom(second, propVideo, clock);
    looks.push(`${a?.toFixed(3) ?? 'none'} ${b?.toFixed(3) ?? 'none'}`);
    if (a !== null && b !== null && Math.abs(a) < 0.25 && Math.abs(b) < 0.25 && Math.abs(a - b) < 0.15) break;
    if (Date.now() > until)
      throw new Error(`Not in step after 15 s. Offsets (first, second), each look: ${looks.join(' | ')}`);
  }

  // The logo's video, played once: it holds at its end point (0:06), not the file's end (0:08), on both screens.
  await show('showLogo', 'points-logo', element('points-logo-video', false));
  const logoVideo = `[data-layer="logo"] video[data-media-id="${mediaId}"]`;
  const heldAt = (page: Page) =>
    page.evaluate((s) => {
      const v = document.querySelector<HTMLVideoElement>(s);
      return v && v.readyState >= 2 && v.paused && v.currentTime > 2.5 ? v.currentTime : -1;
    }, logoVideo);
  for (const o of [first, second])
    await expect
      .poll(() => heldAt(o), { timeout: 30_000, message: 'the logo’s video holds at its end point' })
      .toBeCloseTo(6, 1);
  await app.close();
});
