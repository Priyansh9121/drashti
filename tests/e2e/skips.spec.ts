import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
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
import { makeTestTone, makeTestVideo } from './test-media';

/*
 * Back 15 s, Forward 15 s and Last 10 s (Session 50): under the live picture for the background video and a
 * single sound, and beside an audio playlist's Play and Pause, in Pro Mode. Each lands in step on two screens
 * and the audio player, as a jump to a marker does, never past the file's start or end: Back within the first
 * 15 s goes to the start, Forward within the last 15 s to the end (a file played once holds it), and so does
 * Last 10 s on a file shorter than 10 s; an audio playlist goes on to its next track; paused, it moves where
 * playing will start. Simple Mode has none. Generated media only, quiet, on displays no wider than 1024.
 */

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/** When a file started and where it jumped to, as the engine has it. */
interface Timing {
  startedAt: number;
  seek?: { at: number; toMs: number };
}

const backgroundLayer = (win: Page) =>
  win.evaluate(async () => {
    const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
    return bg?.kind === 'media' ? bg : null;
  });

const audioLayer = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.audio);

const timingOf = (layer: { startedAt: number; seek?: { at: number; toMs: number } } | null): Timing => {
  if (!layer) throw new Error('nothing playing');
  return { startedAt: layer.startedAt, ...(layer.seek ? { seek: layer.seek } : {}) };
};

/**
 * How far a window's copy of a file played once (no start or end points) is from where the clock says, in
 * seconds, the median of a few samples; null while it is not there, has no length yet, or is not playing.
 */
function offsetOf(page: Page, selector: string, t: Timing): Promise<number | null> {
  return page.evaluate(
    async ({ selector, t }) => {
      const samples: number[] = [];
      for (let i = 0; i < 7; i++) {
        const v = document.querySelector<HTMLMediaElement>(selector);
        if (!v || !Number.isFinite(v.duration) || v.paused) return null;
        const from = t.seek ? t.seek.toMs / 1000 : 0;
        const elapsed = (Date.now() - (t.seek ? t.seek.at : t.startedAt)) / 1000;
        samples.push(v.currentTime - Math.min(v.duration, from + elapsed));
        // eslint-disable-next-line no-restricted-syntax -- in the page: samples 60 ms apart while it plays
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      samples.sort((a, b) => a - b);
      return samples[3] ?? null;
    },
    { selector, t },
  );
}

/** Each copy held at its end: paused there, as a file played once holds its last frame. */
const heldAtEnd = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const v = document.querySelector<HTMLMediaElement>(s);
    return (
      v !== null && Number.isFinite(v.duration) && v.paused && Math.abs(v.currentTime - v.duration) < 0.1
    );
  }, selector);

const FRAME = 1 / 30;
/** The sound near the screens (as markers.spec.ts allows a jump: within what broadcasters accept). */
const SOUND_MARGIN = 0.15;

/** Wait until every copy is near the clock, the screens within two frames of each other, the sound near them. */
async function inStep(copies: { page: Page; selector: string }[], t: Timing, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  const seen: string[] = [];
  for (;;) {
    const offsets = await Promise.all(copies.map((c) => offsetOf(c.page, c.selector, t)));
    seen.push(offsets.map((o) => (o === null ? 'none' : o.toFixed(3))).join(' '));
    // Two screens and the audio player, or the audio player alone.
    const [first, second, heard] = offsets;
    const near = offsets.every((o) => o !== null && Math.abs(o) < 0.25);
    const screens = first == null || second == null || Math.abs(first - second) < 2 * FRAME;
    const sound =
      first == null ||
      second == null ||
      heard == null ||
      Math.abs(heard - (first + second) / 2) < SOUND_MARGIN;
    if (near && screens && sound) return;
    if (Date.now() > end)
      throw new Error(`${what}: not in step after 15 s. Offsets, each look:\n${seen.join('\n')}`);
  }
}

/** A skip button in a place (a row under the live picture, or the Music panel's), once it can be pressed. */
async function skipButton(
  place: Locator,
  name: 'Back 15 s' | 'Forward 15 s' | 'Last 10 s',
): Promise<Locator> {
  const button = place.getByRole('button', { name });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  return button;
}

test('the background video: Back 15 s, Forward 15 s and Last 10 s under the live picture land in step on two screens and the audio player', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-skips-video-'));
  // Shorter than 10 s and than 15 s: every skip meets its start or its end. Long enough that a slow computer's
  // in-step wait after Back never lets it reach its end by itself before Forward.
  const file = await makeTestVideo(win, join(dir, 'Placeholder skip clip.webm'), {
    seconds: 9,
    hue: 30,
    tone: 520,
  });
  const [mediaId = ''] = await importAndGetIds(win, [file]);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  for (const o of [a, b]) await outputReady(o);
  const audio = await audioPage(app);
  const picture = `[data-layer="background"] video[data-media-id="${mediaId}"]`;
  const copies = [
    { page: a, selector: picture },
    { page: b, selector: picture },
    { page: audio, selector: `audio[data-media-id="${mediaId}"]` },
  ];

  // A video played once as the background: its row under the live picture has the three, once its length is known.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'video', fit: 'fill', loop: false },
      }),
    mediaId,
  );
  const row = win.getByTestId('playing-background');
  const back = await skipButton(row, 'Back 15 s');
  const forward = await skipButton(row, 'Forward 15 s');
  const last = await skipButton(row, 'Last 10 s');
  await inStep(copies, timingOf(await backgroundLayer(win)), 'playing');
  await expectNoSeriousA11yIssues(win, 'the background video’s skip buttons');
  const length = (await backgroundLayer(win))?.durationMs ?? 0;
  expect(length).toBeGreaterThan(5000);

  // Back within the first 15 s: to the start, everywhere.
  await letTimePass(win, 2000, 'the video plays two seconds in, within its first 15 s');
  await back.click();
  await expect.poll(async () => (await backgroundLayer(win))?.seek?.toMs).toBe(0);
  await inStep(copies, timingOf(await backgroundLayer(win)), 'Back 15 s to the start');

  // Forward within the last 15 s: to the end, where each copy holds (it is played once).
  await forward.click();
  await expect.poll(async () => (await backgroundLayer(win))?.seek?.toMs).toBe(length);
  for (const c of copies) await expect.poll(() => heldAtEnd(c.page, c.selector)).toBe(true);

  // Back 15 s from the end: the start again, playing in step.
  await back.click();
  await expect.poll(async () => (await backgroundLayer(win))?.seek?.toMs).toBe(0);
  await inStep(copies, timingOf(await backgroundLayer(win)), 'Back 15 s from the end');

  // Last 10 s on a file shorter than 10 s: the end too.
  await last.click();
  await expect.poll(async () => (await backgroundLayer(win))?.seek?.toMs).toBe(length);
  for (const c of copies) await expect.poll(() => heldAtEnd(c.page, c.selector)).toBe(true);
  await app.close();
});

test('the sound: a single sound’s under the live picture, an audio playlist’s beside its Play and Pause, on to the next track and while paused; none in Simple Mode', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-skips-sound-'));
  const [long = '', one = '', two = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder long tone.wav'), { seconds: 40, hz: 440 }),
    makeTestTone(join(dir, 'Placeholder track one.wav'), { seconds: 20, hz: 330 }),
    makeTestTone(join(dir, 'Placeholder track two.wav'), { seconds: 12, hz: 550 }),
  ]);
  const audio = await audioPage(app);
  const copy = (id: string) => [{ page: audio, selector: `audio[data-media-id="${id}"]` }];

  // A single sound: its row under the live picture.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'playAudio',
        audio: { id: 'placeholder-sound', title: 'Placeholder sound', mediaId: id, volume: 1, loop: false },
      }),
    long,
  );
  const row = win.getByTestId('playing-sound');
  const back = await skipButton(row, 'Back 15 s');
  const forward = await skipButton(row, 'Forward 15 s');
  const last = await skipButton(row, 'Last 10 s');
  await expectNoSeriousA11yIssues(win, 'the sound’s skip buttons');
  await letTimePass(win, 2000, 'the sound plays two seconds in, within its first 15 s');
  await back.click();
  await expect.poll(async () => (await audioLayer(win))?.seek?.toMs).toBe(0);
  await inStep(copy(long), timingOf(await audioLayer(win)), 'Back 15 s to the start');
  await last.click();
  await expect.poll(async () => (await audioLayer(win))?.seek?.toMs).toBe(30_000);
  await inStep(copy(long), timingOf(await audioLayer(win)), 'Last 10 s');
  await back.click();
  // About 15 s back from where it was (30 s and the in-step wait, a few seconds on a slow computer).
  await expect.poll(async () => (await audioLayer(win))?.seek?.toMs ?? 0).toBeLessThan(25_000);
  const fifteen = (await audioLayer(win))?.seek?.toMs ?? 0;
  expect(fifteen).toBeGreaterThanOrEqual(15_000);
  await inStep(copy(long), timingOf(await audioLayer(win)), 'Back 15 s');
  await forward.click();
  await expect.poll(async () => (await audioLayer(win))?.seek?.toMs ?? 0).toBeGreaterThanOrEqual(30_000);
  await inStep(copy(long), timingOf(await audioLayer(win)), 'Forward 15 s');
  // Within the last 15 s: to the end, where it stops.
  await forward.click();
  await expect.poll(async () => (await audioLayer(win))?.seek?.toMs).toBe(40_000);
  await expect.poll(() => heldAtEnd(audio, `audio[data-media-id="${long}"]`)).toBe(true);

  // An audio playlist: its three are beside Play and Pause in the Music panel, not under the live picture.
  const listId = await win.evaluate(
    async ({ one, two }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.music.create('Placeholder before sabha');
      if (!list.ok || !list.id) throw new Error('not made');
      await d.music.addTracks(list.id, [one, two], null);
      return list.id;
    },
    { one, two },
  );
  const panel = win.getByTestId('music-panel');
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.music.play(id, 0), listId);
  await expect.poll(async () => (await audioLayer(win))?.mediaId).toBe(one);
  const skips = panel.getByTestId('music-skips');
  const musicForward = await skipButton(skips, 'Forward 15 s');
  await expect(row).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'the Music panel’s skip buttons');
  await musicForward.click();
  await expect.poll(async () => (await audioLayer(win))?.seek?.toMs ?? 0).toBeGreaterThanOrEqual(15_000);
  // Within the last 15 s of track one: on to track two, as at any end.
  await musicForward.click();
  await expect.poll(async () => (await audioLayer(win))?.mediaId).toBe(two);
  await inStep(copy(two), timingOf(await audioLayer(win)), 'the next track');

  // Paused: the skips move where playing will start, and nothing sounds meanwhile.
  await panel.getByTestId('music-pause').click();
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBeGreaterThanOrEqual(0);
  await (await skipButton(skips, 'Last 10 s')).click();
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBe(2000);
  await expect(audio.locator(`audio[data-media-id="${two}"]`)).toHaveCount(0);
  await (await skipButton(skips, 'Back 15 s')).click();
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBe(0);
  await panel.getByTestId('music-play').click();
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBeUndefined();
  await inStep(copy(two), timingOf(await audioLayer(win)), 'playing from where the skips left it');

  // Simple Mode, as asked, has none.
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-music')).toBeVisible();
  for (const name of ['Back 15 s', 'Forward 15 s', 'Last 10 s'])
    await expect(win.getByRole('button', { name })).toHaveCount(0);
  await app.close();
});
