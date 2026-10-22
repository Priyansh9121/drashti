import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PlaybackClock } from '../../src/shared/media';
import { playbackBounds, playbackOffset, playbackPosition } from '../../src/shared/media';
import type { PageGlobals } from './helpers';
import {
  holdStill,
  importAndGetIds,
  killApp,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  relaunchApp,
  savedLive,
  setUpScreen,
} from './helpers';
import { crashAndRecover } from './recovery-figure';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';

/*
 * Restart recovery: after an unexpected stop, the next start puts the same
 * slide, background and black-out back on the screens by itself and tells
 * the operator; after a clean quit it starts with nothing live.
 */

const line = (text: string) => ({ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) });

test('after a crash the same slide, background and black-out come back; after a clean quit nothing is live, even after a start that changed nothing', async () => {
  test.setTimeout(150_000);
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-'));
  const still = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { width: 160, height: 90 });
  const show = join(dir, 'Placeholder Recovery.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-RECOVERY',
      groups: [
        {
          name: 'Verse',
          slides: [
            { background: { path: still, kind: 'image' }, text: [line('Placeholder recovery one')] },
            { text: [line('Placeholder recovery two')] },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  await setUpScreen(win);
  await outputPage(first.app);
  const dispatch = (command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) =>
    win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
  await dispatch({ type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch({ type: 'goLive', presentationId, slideIndex: 1 });
  await dispatch({ type: 'setBlackout', on: true });

  // Saved as it changes (in the background): wait until the file has it, then stop Drashti dead.
  const stateFile = join(first.userData, 'live-state.json');
  await expect
    .poll(() => {
      if (!existsSync(stateFile)) return null;
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        slide: { slideIndex: number } | null;
        blackout: boolean;
      };
      return [saved.slide?.slideIndex, saved.blackout];
    })
    .toEqual([1, true]);
  await killApp(first.app);

  // The next start puts it all back by itself, and says so.
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  const output = await outputPage(second.app);
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder recovery two');
  await expect(output.locator('[data-layer="background"] img')).toHaveAttribute('data-state', 'ready');
  await expect(output.getByTestId('blackout')).toBeVisible();
  const notice = win2.getByTestId('recovery-notice');
  await expect(notice).toContainText(
    'Drashti stopped unexpectedly and has put back what was live: "Placeholder Recovery", slide 2, the background and black-out.',
  );
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toHaveCount(0);

  // A clean quit: the next start has nothing live, and nothing to say.
  await second.app.close();
  const third = await relaunchApp(first.userData);
  const win3 = await operatorPage(third.app);
  await openLibrary(win3);
  await expect(win3.getByTestId('presentation-list').getByRole('button').first()).toBeVisible();
  const layers = await win3.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return { slide: s.layers.slide, background: s.layers.background, blackout: s.blackout };
  });
  expect(layers).toEqual({ slide: null, background: null, blackout: false });
  expect(await win3.evaluate(() => (globalThis as PageGlobals).drashti.app.recovery())).toBeNull();
  await expect(win3.getByTestId('recovery-notice')).toHaveCount(0);

  // That start changed nothing and quits cleanly: the start after it still has nothing to put back.
  // Before Session 20 it put the show from the second run back, as after a crash (seen on 9 Oct 2026).
  await third.app.close();
  const fourth = await relaunchApp(first.userData);
  const win4 = await operatorPage(fourth.app);
  await openLibrary(win4);
  await expect(win4.getByTestId('presentation-list').getByRole('button').first()).toBeVisible();
  expect(await win4.evaluate(() => (globalThis as PageGlobals).drashti.app.recovery())).toBeNull();
  const layers4 = await win4.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return { slide: s.layers.slide, background: s.layers.background, blackout: s.blackout };
  });
  expect(layers4).toEqual({ slide: null, background: null, blackout: false });
  await fourth.app.close();
});

test('after a crash a running timer, a message and the sound come back, carrying on where they were', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-show-'));
  const tune = await makeTestVideo(win, join(dir, 'Placeholder tune.webm'), {
    seconds: 3,
    tone: 300,
    width: 64,
    height: 36,
  });
  const [tuneId = ''] = await importAndGetIds(win, [tune]);
  await setUpScreen(win);
  await outputPage(first.app);
  // A countdown, running; a message with it in; the tune on the audio layer.
  const started = await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.timers.create({
      name: 'Placeholder start',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
    await d.engine.dispatch({ type: 'startTimer', timerId: made.id });
    await d.engine.dispatch({
      type: 'showMessage',
      message: {
        id: 'placeholder-message',
        text: 'Placeholder sabha starts in [timer]',
        parts: [
          { kind: 'text', text: 'Placeholder sabha starts in ' },
          { kind: 'timer', timerId: made.id },
        ],
      },
    });
    await d.engine.dispatch({
      type: 'playAudio',
      audio: { id: 'placeholder-tune', title: 'Placeholder tune', mediaId, volume: 1, loop: true },
    });
    const s = (await d.engine.snapshot()).state;
    return { timer: s.timers[0]?.startedAt ?? 0, audio: s.layers.audio?.startedAt ?? 0 };
  }, tuneId);
  // Saved, the sound too, then stopped dead. The show is saved within a quarter of a second of a
  // change, counted from the first of several in a row: on a slow computer the timer and the message
  // can be saved before the sound starts, so waiting for those two alone could stop it a moment too soon.
  const stateFile = join(first.userData, 'live-state.json');
  await expect
    .poll(() => {
      if (!existsSync(stateFile)) return null;
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        messages?: unknown[];
        timers?: unknown[];
        audio?: unknown;
      };
      return [
        saved.messages?.length,
        saved.timers?.length,
        saved.audio !== undefined && saved.audio !== null,
      ];
    })
    .toEqual([1, 1, true]);
  await killApp(first.app);

  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  const output = await outputPage(second.app);
  // The message is back, with the timer counting on from where it started (below 5:00 now).
  const banner = output.locator('[data-layer="messages"]');
  await expect(banner).toContainText('Placeholder sabha starts in 4:');
  const back = await win2.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return { timer: s.timers[0]?.startedAt ?? -1, audio: s.layers.audio?.startedAt ?? -1 };
  });
  expect(back).toEqual(started);
  // The sound plays again in the audio player, from where it would be now.
  await expect.poll(() => second.app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const audio = second.app.windows().find((w) => w.url().includes('audio.html'));
  await expect
    .poll(() =>
      audio?.locator('audio[data-key]').evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0),
    )
    .toBe(true);
  await expect(win2.getByTestId('recovery-notice')).toContainText('the sound, a message and a timer');
  await second.app.close();
});

/** The background video and the sound playing, as the engine has them. */
const playing = (win: Page) =>
  win.evaluate(async () => {
    const layers = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers;
    return {
      background: layers.background?.kind === 'media' ? layers.background : null,
      audio: layers.audio,
    };
  });

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/**
 * Wait until a window's copy of a file plays within half a second of where the engine's clock has it: from its
 * last jump, between its start and end points, round its loop (shared/media.ts playbackPosition, as every screen
 * and the audio player work it out), the median of a few looks. A jump or points lost put it seconds away; how
 * finely copies keep in step is skips.spec.ts's and markers.spec.ts's to say.
 */
async function nearTheClock(page: Page, selector: string, clock: PlaybackClock, what: string): Promise<void> {
  const until = Date.now() + 15_000;
  const seen: string[] = [];
  for (;;) {
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
    const offsets = (looks ?? []).map((l) => {
      const { start, end } = playbackBounds(clock.clip, l.duration);
      return playbackOffset(l.at, playbackPosition(clock, l.duration, l.now), end - start, clock.loop);
    });
    const median = offsets.sort((a, b) => a - b)[2];
    seen.push(median === undefined ? 'none' : median.toFixed(3));
    if (median !== undefined && Math.abs(median) < 0.5) return;
    if (Date.now() > until)
      throw new Error(
        `${what}: not where the clock has it after 15 s. Offsets, each look: ${seen.join(' ')}`,
      );
  }
}

test('after a crash a video and a sound come back from their last jump, between their start and end points (Session 51)', async () => {
  test.setTimeout(150_000);
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-jumps-'));
  const loop = await makeTestVideo(win, join(dir, 'Placeholder recovery loop.webm'), {
    seconds: 6,
    hue: 200,
    width: 64,
    height: 36,
  });
  const tone = makeTestTone(join(dir, 'Placeholder recovery tone.wav'), { seconds: 120, hz: 330 });
  const [videoId = '', toneId = ''] = await importAndGetIds(win, [loop, tone]);
  // The video loops between 0:01 and 0:05, with a marker at 0:03; the sound plays once between 0:05 and 1:50.
  const set = await win.evaluate(
    ({ videoId, toneId }) => {
      const d = (globalThis as PageGlobals).drashti;
      return Promise.all([
        d.media.setMarkers(videoId, {
          startMs: 1000,
          endMs: 5000,
          markers: [{ id: 'placeholder-verse', name: 'Placeholder verse', atMs: 3000 }],
        }),
        d.media.setMarkers(toneId, { startMs: 5000, endMs: 110_000, markers: [] }),
      ]);
    },
    { videoId, toneId },
  );
  expect(set.map((s) => s.ok)).toEqual([true, true]);
  await setUpScreen(win);
  await outputPage(first.app);
  await win.evaluate(
    async ({ videoId, toneId }) => {
      const engine = (globalThis as PageGlobals).drashti.engine;
      await engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: videoId, media: 'video', fit: 'fill', loop: true },
      });
      await engine.dispatch({
        type: 'playAudio',
        audio: { id: 'placeholder-tone', title: 'Placeholder tone', mediaId: toneId, volume: 1, loop: false },
      });
    },
    { videoId, toneId },
  );
  // Once their lengths are known (a moment after they start): the video jumps to its marker, the sound on 15 s.
  await expect
    .poll(async () => {
      const { background, audio } = await playing(win);
      return background?.durationMs !== undefined && audio?.durationMs !== undefined;
    })
    .toBe(true);
  await win.evaluate(async () => {
    const engine = (globalThis as PageGlobals).drashti.engine;
    await engine.dispatch({ type: 'jumpToMarker', layer: 'background', markerId: 'placeholder-verse' });
    await engine.dispatch({ type: 'skip', layer: 'audio', jump: 'forward' });
  });
  const before = await playing(win);
  expect(before.background?.seek?.toMs).toBe(3000);
  expect(before.audio?.seek?.toMs).toBeGreaterThanOrEqual(20_000);
  // Saved with both jumps, then stopped dead.
  await savedLive(
    first.userData,
    (saved) => 'seek' in (saved.background ?? {}) && 'seek' in (saved.audio ?? {}),
  );
  await killApp(first.app);

  // Since Session 14 both came back as if never jumped, over the whole file (and the video without its marker).
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  const { background, audio } = await playing(win2);
  expect(background).toMatchObject({
    mediaId: videoId,
    startedAt: before.background?.startedAt,
    seek: before.background?.seek,
    clip: { startMs: 1000, endMs: 5000 },
    marks: [{ id: 'placeholder-verse', name: 'Placeholder verse', atMs: 3000 }],
  });
  expect(audio).toMatchObject({
    mediaId: toneId,
    startedAt: before.audio?.startedAt,
    seek: before.audio?.seek,
    clip: { startMs: 5000, endMs: 110_000 },
  });
  if (!background || !audio) throw new Error('not put back');
  // The screen and the audio player play them there.
  const output = await outputPage(second.app);
  const player = await audioPage(second.app);
  await nearTheClock(
    output,
    `[data-layer="background"] video[data-media-id="${videoId}"]`,
    background,
    'the video',
  );
  await nearTheClock(player, `audio[data-media-id="${toneId}"]`, audio, 'the sound');
  await expect(win2.getByTestId('recovery-notice')).toContainText('the background and the sound');
  await second.app.close();
});

test('after a crash a video on the slide itself, and its sound, play on from where they would be, not from the start (Session 51)', async () => {
  test.setTimeout(150_000);
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-slide-video-'));
  const loop = await makeTestVideo(win, join(dir, 'Placeholder slide loop.webm'), {
    seconds: 6,
    hue: 120,
    tone: 440,
    width: 64,
    height: 36,
  });
  const [videoId = ''] = await importAndGetIds(win, [loop]);
  const words = join(dir, 'Placeholder Slide Video.txt');
  writeFileSync(words, '[Verse]\nPlaceholder words over a video\n');
  const [presentationId = ''] = await importAndGetIds(win, [words]);
  // The slide's own video, looping (not a background: it goes and comes with the slide).
  await win.evaluate(
    async ({ presentationId, videoId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(presentationId);
      if (!opened.ok) throw new Error(opened.message);
      const slide = opened.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('The presentation has no slide.');
      slide.elements = [
        {
          id: 'placeholder-slide-video',
          kind: 'video',
          mediaId: videoId,
          frame: { x: 0, y: 0, width: 1920, height: 1080 },
          fit: 'fit',
          loop: true,
        },
        ...slide.elements,
      ];
      const saved = await d.library.saveSlides(presentationId, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { presentationId, videoId },
  );
  await setUpScreen(win);
  const output = await outputPage(first.app);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );
  const picture = `[data-layer="slide"] video[data-media-id="${videoId}"]`;
  await expect(output.locator(picture)).toHaveCount(1);
  const shownAt = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.shownAt,
  );
  if (shownAt === undefined) throw new Error('The slide did not go up.');
  await savedLive(first.userData, (saved) => saved.slide?.slideIndex === 0);
  await letTimePass(win, 2000, 'the slide’s video plays on a moment before Drashti stops');
  await killApp(first.app);

  // Since Session 3 the slide went up again at the restart: its video and its sound began again from the top.
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  const slide = await win2.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide,
  );
  expect(slide).toMatchObject({ presentationId, slideIndex: 0, shownAt });
  expect(slide?.transition).toBeUndefined();
  const clock = { startedAt: shownAt, loop: true };
  const output2 = await outputPage(second.app);
  const player = await audioPage(second.app);
  await nearTheClock(output2, picture, clock, 'the slide’s video');
  await nearTheClock(player, 'audio[data-key^="slide:"]', clock, 'its sound');
  await second.app.close();
});

test('after a crash the first action lands on what recovery put back, never under it (Sessions 31–36)', async () => {
  test.setTimeout(150_000);
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-first-'));
  const show = join(dir, 'Placeholder First Action.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-RECOVERY-FIRST',
      groups: [
        {
          name: 'Verse',
          slides: [1, 2, 3, 4].map((n) => ({ text: [line(`Placeholder first action ${String(n)}`)] })),
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 1,
      }),
    presentationId,
  );
  await savedLive(first.userData, (saved) => saved.slide?.slideIndex === 1);
  await killApp(first.app);

  // The very first thing the next start does: Next, before the window has even settled. Recovery has put
  // slide 2 back by then (it runs before the engine takes any command), so Next goes on to slide 3.
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  const answer = await win2.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }),
  );
  expect(answer).toMatchObject({ ok: true, changed: true });
  const live = await win2.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return { presentationId: s.live.presentationId, slideIndex: s.layers.slide?.slideIndex ?? null };
  });
  expect(live).toEqual({ presentationId, slideIndex: 2 });
  // And it stays: nothing recovery does later puts slide 2 back over it.
  await expect(win2.getByTestId('recovery-notice')).toBeVisible();
  await holdStill(
    async () =>
      (await win2.evaluate(
        async () =>
          (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.slideIndex,
      )) === 2,
    1500,
    'what the first action did stays',
  );
  await second.app.close();
});

test('after a crash the screens come back, and how long that took is said: the recovery figure (Sessions 31–36, PERF-1)', async () => {
  test.setTimeout(180_000);
  // Said here; held to its budget by the Performance check, where timing is judged: in the whole suite CI's
  // Windows machine took 6.8 to 7.7 s (run 39042346766) for what takes it 3.3 to 5.0 s alone.
  const figure = await crashAndRecover();
  console.log(figure.line);
  expect(figure.ms).toBeGreaterThan(0);
});
