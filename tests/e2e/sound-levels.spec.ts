import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gainOfDb, MUSIC_ASIDE_DB } from '../../src/shared/sound';
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
  relaunchApp,
  setUpScreen,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestTone, makeTestVideo } from './test-media';
import { snapshot } from './time-bar-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * X33, the owner's ask of 19 Nov 2026: "a volume button for both audio and video ... including a mute checkbox like a
 * green or red toggle", and "while a wallpaper is there, we can run audio as well together". Above Audio, under LIVE,
 * in Pro and Simple Mode: Audio's level (the audio playlists and every sound) and Video's (the videos' sound), 0 to
 * 100 %, each with a switch, green "Sound on" or red "Muted"; the status bar says what is muted. Read where the hall
 * hears it: each element in the audio player, its gain (data-gain: its even loudness × the music stepping aside × its
 * kind's level) and its volume, and how loud the way out is (data-level). A generated tone and test video only.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

const dispatch = (win: Page, command: unknown) =>
  win.evaluate(
    (c) =>
      (globalThis as PageGlobals).drashti.engine.dispatch(
        c as Parameters<PageGlobals['drashti']['engine']['dispatch']>[0],
      ),
    command,
  );
const fileSound = (win: Page, mediaId: string) =>
  win.evaluate((id) => (globalThis as PageGlobals).drashti.sound.file(id), mediaId);
/** Measured by the sound pass, a moment after its import: its even gain is then what it plays with from now on. */
async function measured(win: Page, ids: string[]): Promise<void> {
  for (const id of ids)
    await expect.poll(async () => (await fileSound(win, id))?.measured, { timeout: 30_000 }).toBe(true);
}
/** A file's even gain as the engine's state says it (1: as it is). */
async function evenGain(win: Page, mediaId: string): Promise<number> {
  return (await snapshot(win)).sound?.gains[mediaId] ?? 1;
}
/** What an element in the audio player plays at now: its own volume × its gain. */
const playsAt = (el: Locator) =>
  el.evaluate((a: HTMLAudioElement) => a.volume * Number(a.dataset['gain'] ?? 'NaN'));
/** How loud the audio player's way out is now (dBFS): the middle of a few readings. */
async function levelOf(audio: Page): Promise<number> {
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    seen.push(Number((await audio.locator('body').getAttribute('data-level')) ?? '-100'));
    await letTimePass(audio, 100, 'the audio player measures its way out each 50 ms');
  }
  return seen.sort((a, b) => a - b)[2] ?? -100;
}

/**
 * Watch every element in the audio player from now (each 100 ms): its own mark (an element started again would be a new
 * one, with none), whether it is paused, and where it is in its file. Returns what was seen of each, by its key.
 */
async function watchPlaying(audio: Page): Promise<() => Promise<Record<string, string[]>>> {
  await audio.evaluate(() => {
    const seen: Record<string, string[]> = {};
    for (const el of document.querySelectorAll<HTMLAudioElement>('audio[data-key]'))
      el.dataset['watched'] = 'yes';
    const timer = setInterval(() => {
      for (const el of document.querySelectorAll<HTMLAudioElement>('audio[data-key]')) {
        const key = el.dataset['key'] ?? '';
        (seen[key] ??= []).push(
          `${el.dataset['watched'] ?? 'new'} ${el.paused ? 'paused' : 'playing'} ${el.currentTime.toFixed(2)}`,
        );
      }
    }, 100);
    (globalThis as { levelsWatch?: unknown }).levelsWatch = { seen, timer };
  });
  return () =>
    audio.evaluate(() => {
      const w = (globalThis as { levelsWatch?: { seen: Record<string, string[]>; timer: number } })
        .levelsWatch;
      if (w) clearInterval(w.timer);
      return w?.seen ?? {};
    });
}

/** Each element watched played on the whole time: the same element, never paused, always further on in its file. */
function playedOn(seen: Record<string, string[]>, keys: string[]): void {
  for (const key of keys) {
    const lines = seen[key] ?? [];
    expect(lines.length, key).toBeGreaterThan(20);
    let last = -1;
    for (const line of lines) {
      const [mark, state, at] = line.split(' ');
      expect(mark, `${key}: ${line}`).toBe('yes');
      expect(state, `${key}: ${line}`).toBe('playing');
      // Never moved back (nothing seeks it): each reading as far on as the one before, or further (within the quarter
      // second the clock's own keeping in step may nudge it).
      expect(Number(at), `${key}: ${line}`).toBeGreaterThanOrEqual(last - 0.25);
      last = Math.max(last, Number(at));
    }
    // And it went on: several seconds further on by the end.
    const first = Number(lines[0]?.split(' ')[2] ?? 0);
    expect(last - first, key).toBeGreaterThan(3);
  }
}

/** A level's slider moved to `value`, as a hand dragging it does (an input event; React reads the value it lands on). */
async function slide(range: Locator, value: number): Promise<void> {
  await range.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** The keys of the elements in the audio player now. */
const keys = (audio: Page) =>
  audio.evaluate(() =>
    [...document.querySelectorAll<HTMLAudioElement>('audio[data-key]')].map((el) => el.dataset['key'] ?? ''),
  );

/** The one key that starts so. */
function keyOf(prefix: string, all: string[]): string {
  const key = all.find((k) => k.startsWith(prefix));
  if (!key) throw new Error(`no sound playing as ${prefix}: ${all.join(', ')}`);
  return key;
}

async function start() {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win, userData, dir: mkdtempSync(join(tmpdir(), 'drashti-sound-levels-')) };
}

/** One of the two levels: its slider, its switch, and the switch's words. */
function controls(win: Page, kind: 'audio' | 'video') {
  return {
    slider: win.getByTestId(`sound-level-${kind}-slider`),
    mute: win.getByTestId(`sound-mute-${kind}`),
  };
}

test('Audio’s and Video’s levels and mutes, live: each sound plays at its level and silent while muted, never stopped, started again or moved, the hall’s video playing on; the levels kept after a restart, with the sound on', async () => {
  test.setTimeout(240_000);
  const { app, win, dir, userData } = await start();
  const [musicId = '', videoId = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder music.wav'), { seconds: 240, hz: 440 }),
    await makeTestVideo(win, join(dir, 'Placeholder talk.webm'), { seconds: 120, tone: 660, hue: 30 }),
  ]);
  await measured(win, [musicId, videoId]);
  const hall = await (async () => {
    await setUpScreen(win, 'Main Hall', 0);
    await expect.poll(() => outputPages(app).length).toBe(1);
    const [page] = outputPages(app) as [Page];
    await outputReady(page);
    return page;
  })();
  const audio = await audioPage(app);
  const music = audio.locator(`audio[data-media-id="${musicId}"]`);
  const talk = audio.locator(`audio[data-media-id="${videoId}"]`);
  // The music, and a video with its own sound as the background, both going round.
  expect(
    (
      await dispatch(win, {
        type: 'playAudio',
        audio: { id: musicId, title: 'Placeholder music', mediaId: musicId, volume: 1, loop: true },
      })
    ).ok,
  ).toBe(true);
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: videoId, media: 'video', fit: 'fit', loop: true },
  });
  await expect(music).toHaveAttribute('data-kind', 'audio');
  await expect(talk).toHaveAttribute('data-kind', 'video');
  const evenMusic = await evenGain(win, musicId);
  const evenTalk = await evenGain(win, videoId);
  const aside = gainOfDb(MUSIC_ASIDE_DB);
  // Both at 100 % to begin with: the music stepped aside under the video, the video at its even loudness.
  await expect.poll(() => playsAt(music), { timeout: 5000 }).toBeCloseTo(evenMusic * aside, 2);
  await expect.poll(() => playsAt(talk)).toBeCloseTo(evenTalk, 2);
  const hallVideo = hall.locator(`[data-layer="background"] video[data-media-id="${videoId}"]`);
  await expect(hallVideo).toHaveCount(1);
  await expect
    .poll(() => hallVideo.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0))
    .toBe(true);
  const hallFrom = await hallVideo.evaluate((v: HTMLVideoElement) => v.currentTime);

  // Above Audio, under LIVE: two lines, each with its level and its switch, green Sound on.
  const block = win.getByTestId('sound-levels');
  await expect(block).toHaveCount(1);
  await block.scrollIntoViewIfNeeded();
  await expect(block).toBeVisible();
  const a = controls(win, 'audio');
  const v = controls(win, 'video');
  await expect(a.slider).toHaveValue('100');
  await expect(v.slider).toHaveValue('100');
  for (const c of [a, v]) {
    await expect(c.mute).toHaveAttribute('role', 'switch');
    await expect(c.mute).toHaveAttribute('aria-checked', 'true');
    await expect(c.mute).toHaveText('Sound on');
  }
  await expect(win.getByTestId('sound-muted-status')).toHaveText('');
  const watched = await watchPlaying(audio);

  // Audio to 50 %: the music (still stepped aside) at half; the video's sound as it was.
  await slide(a.slider, 50);
  await expect.poll(() => playsAt(music)).toBeCloseTo(evenMusic * aside * 0.5, 2);
  expect(await playsAt(talk)).toBeCloseTo(evenTalk, 2);
  // Video by the keyboard: five steps down, to 95 %.
  await v.slider.focus();
  for (let i = 0; i < 5; i++) await win.keyboard.press('ArrowLeft');
  await expect(v.slider).toHaveValue('95');
  await expect.poll(() => playsAt(talk)).toBeCloseTo(evenTalk * 0.95, 2);
  expect(await playsAt(music)).toBeCloseTo(evenMusic * aside * 0.5, 2);

  // Audio muted: red, Muted, said in the status bar; the music silent, playing on; the video's sound as it was.
  await a.mute.click();
  await expect(a.mute).toHaveAttribute('aria-checked', 'false');
  await expect(a.mute).toHaveText('Muted');
  await expect(win.getByTestId('sound-muted-status')).toHaveText('Audio muted');
  await expect.poll(() => playsAt(music)).toBe(0);
  expect(await playsAt(talk)).toBeCloseTo(evenTalk * 0.95, 2);
  // Sound on again by the keyboard: back at its level.
  await a.mute.focus();
  await win.keyboard.press('Space');
  await expect(a.mute).toHaveText('Sound on');
  await expect(win.getByTestId('sound-muted-status')).toHaveText('');
  await expect.poll(() => playsAt(music)).toBeCloseTo(evenMusic * aside * 0.5, 2);

  // Video muted: its sound silent, and none of the video heard, the music comes back up from stepping aside.
  await v.mute.click();
  await expect(v.mute).toHaveText('Muted');
  await expect(win.getByTestId('sound-muted-status')).toHaveText('Video muted');
  await expect.poll(() => playsAt(talk)).toBe(0);
  await expect.poll(() => playsAt(music), { timeout: 5000 }).toBeCloseTo(evenMusic * 0.5, 2);
  // Both muted: nothing at all comes out, and both play on.
  await a.mute.click();
  await expect(win.getByTestId('sound-muted-status')).toHaveText('Audio and Video muted');
  await expect.poll(() => levelOf(audio), { timeout: 5000 }).toBeLessThanOrEqual(-90);
  // A level moved while muted stays silent until the sound is on again, then plays at it.
  await slide(a.slider, 70);
  await letTimePass(win, 300, 'a level moved while muted makes no sound');
  expect(await playsAt(music)).toBe(0);
  await a.mute.click();
  await v.mute.click();
  await expect(win.getByTestId('sound-muted-status')).toHaveText('');
  await expect.poll(() => playsAt(talk)).toBeCloseTo(evenTalk * 0.95, 2);
  await expect.poll(() => playsAt(music), { timeout: 5000 }).toBeCloseTo(evenMusic * aside * 0.7, 2);
  await expect.poll(() => levelOf(audio)).toBeGreaterThan(-60);

  // Throughout: the same two elements, never paused, never moved back, always further on; the hall's video too.
  const now = await keys(audio);
  playedOn(await watched(), [keyOf(`audio:${musicId}@`, now), keyOf(`background:${videoId}@`, now)]);
  expect(await hallVideo.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  expect(await hallVideo.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(hallFrom + 3);

  // It fits CI's operator window, and passes axe (with Audio muted, its red and its status line too).
  const fits = () =>
    block.evaluate((el) => {
      const column = el.closest('aside')?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth + 1 && column !== undefined && box.right <= column.right + 1;
    });
  expect(await fits()).toBe(true);
  await expectNoSeriousA11yIssues(win, 'the sound’s levels, sound on', '[data-testid="sound-levels"]');
  await a.mute.click();
  await expectNoSeriousA11yIssues(win, 'the sound’s levels, Audio muted', '[data-testid="sound-levels"]');
  await expectNoSeriousA11yIssues(win, 'the status bar’s Audio muted', '[data-testid="sound-muted-status"]');
  await app.close();

  // Started again: the levels as they were left (Audio 70 %, Video 95 %), and the sound on, whatever was muted.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await sizeOperatorWindow(again.app, win2, CI_WINDOW);
  await expect(controls(win2, 'audio').slider).toHaveValue('70');
  await expect(controls(win2, 'video').slider).toHaveValue('95');
  await expect(controls(win2, 'audio').mute).toHaveText('Sound on');
  await expect(controls(win2, 'video').mute).toHaveText('Sound on');
  await expect(win2.getByTestId('sound-muted-status')).toHaveText('');
  expect((await snapshot(win2)).sound?.levels).toEqual({
    audio: { level: 0.7, muted: false },
    video: { level: 0.95, muted: false },
  });

  // Simple Mode has the same two lines under LIVE: Video muted there too, and said.
  await win2.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const simple = win2.getByTestId('sound-levels');
  await expect(simple).toHaveCount(1);
  await simple.scrollIntoViewIfNeeded();
  await expect(simple).toBeVisible();
  await controls(win2, 'video').mute.click();
  await expect(controls(win2, 'video').mute).toHaveText('Muted');
  await expect(win2.getByTestId('sound-muted-status')).toHaveText('Video muted');
  expect((await snapshot(win2)).sound?.levels?.video).toEqual({ level: 0.95, muted: true });
  await controls(win2, 'video').mute.click();
  await expect(win2.getByTestId('sound-muted-status')).toHaveText('');
  await expectNoSeriousA11yIssues(win2, 'Simple Mode’s sound levels', '[data-testid="sound-levels"]');
  await again.app.close();
});

test('music plays on while the Wallpaper is up, as loud, and the Wallpaper stays up (alpha.16: "Music plays on")', async () => {
  test.setTimeout(150_000);
  const { app, win, dir } = await start();
  const [musicId = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder before sabha.wav'), { seconds: 120, hz: 523 }),
  ]);
  await measured(win, [musicId]);
  await setUpScreen(win, 'Main Hall', 0);
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app) as [Page];
  await outputReady(hall);
  const audio = await audioPage(app);
  const music = audio.locator(`audio[data-media-id="${musicId}"]`);
  expect(
    (
      await dispatch(win, {
        type: 'playAudio',
        audio: { id: musicId, title: 'Placeholder before sabha', mediaId: musicId, volume: 1, loop: true },
      })
    ).ok,
  ).toBe(true);
  const even = await evenGain(win, musicId);
  await expect.poll(() => playsAt(music), { timeout: 5000 }).toBeCloseTo(even, 2);
  await expect
    .poll(() => music.evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0))
    .toBe(true);
  const watched = await watchPlaying(audio);

  // The Wallpaper up, by its button along the bottom.
  const wallpaper = win.getByTestId('wallpaper-button');
  await wallpaper.click();
  await expect(wallpaper).toHaveText(/is on/u);
  await expect(hall.getByTestId('wallpaper')).toBeVisible();
  await letTimePass(win, 4000, 'the music plays on under the Wallpaper');
  // Up all the while, the music playing on as loud (a cover is seen, not heard: nothing steps aside for it).
  expect((await snapshot(win)).wallpaper).toBe(true);
  await expect(wallpaper).toHaveText(/is on/u);
  await expect(hall.getByTestId('wallpaper')).toBeVisible();
  expect(await playsAt(music)).toBeCloseTo(even, 2);
  expect(await levelOf(audio)).toBeGreaterThan(-60);
  playedOn(await watched(), [keyOf(`audio:${musicId}@`, await keys(audio))]);
  expect((await snapshot(win)).layers.audio?.mediaId).toBe(musicId);
  await app.close();
});
