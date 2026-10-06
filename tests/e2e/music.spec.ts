import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import { importAndGetIds, killApp, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';
import { makeTestTone } from './test-media';

/*
 * Audio playlists (Session 14): tracks one after another on the one audio
 * player, with fades; pause and play on; how they meet Clear audio, Put it
 * back and a sound put up; recovery; Simple Mode's Play and Pause; and the
 * remote's (the API's) play and pause. Generated tones only.
 */

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

const audioLayer = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.audio);

const dispatch = (win: Page, type: 'pauseMusic' | 'resumeMusic' | 'clearAll' | 'putBack' | 'musicNext') =>
  win.evaluate((t) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: t }), type);

/** The volumes an audio element had, sampled every 20 ms for a while (fades show as steps). */
function volumes(audio: Page, mediaId: string, ms: number): Promise<number[]> {
  return audio.evaluate(
    ({ id, ms }) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const t = setInterval(() => {
          const el = document.querySelector<HTMLAudioElement>(`audio[data-media-id="${id}"]`);
          seen.push(el ? el.volume : -1);
        }, 20);
        setTimeout(() => {
          clearInterval(t);
          resolve(seen);
        }, ms);
      }),
    { id: mediaId, ms },
  );
}

test('tracks play one after another with fades; pause, Clear audio, Put it back, a sound put up and recovery', async () => {
  test.setTimeout(150_000);
  const first = await launchApp(NETWORK_ENV);
  const win = await operatorPage(first.app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-music-e2e-'));
  const one = makeTestTone(join(dir, 'Placeholder tone one.wav'), { seconds: 3, hz: 440 });
  const two = makeTestTone(join(dir, 'Placeholder tone two.wav'), { seconds: 20, hz: 330 });
  await importAndGetIds(win, [one, two]);
  const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
  const idOf = (name: string) => media.find((m) => m.name.startsWith(name))?.id ?? '';
  const [toneOne, toneTwo] = [idOf('Placeholder tone one'), idOf('Placeholder tone two')];

  // A list from the Music panel: New, then the two sounds.
  const panel = win.getByTestId('music-panel');
  await panel.getByTestId('music-new').click();
  await panel.getByTestId('music-add').click();
  const add = win.getByTestId('music-add-dialog');
  await add.getByLabel('Placeholder tone one.wav').check();
  await add.getByLabel('Placeholder tone two.wav').check();
  await expectNoSeriousA11yIssues(win, 'adding sounds to music');
  await add.getByTestId('music-add-ticked').click();
  await expect(panel.getByTestId('music-track')).toHaveCount(2);
  await expectNoSeriousA11yIssues(win, 'the Music panel');

  // Play: the first track fades in on the audio player.
  const audio = await audioPage(first.app);
  await panel.getByTestId('music-play').click();
  await expect.poll(async () => (await audioLayer(win))?.mediaId).toBe(toneOne);
  const fadeIn = await volumes(audio, toneOne, 900);
  expect(fadeIn.some((v) => v >= 0 && v < 0.6)).toBe(true);
  expect(fadeIn.at(-1)).toBeCloseTo(1, 1);
  // Three seconds on, the next starts where it ended (its length learned by the audio player).
  const started = (await audioLayer(win))?.startedAt ?? 0;
  await expect.poll(async () => (await audioLayer(win))?.mediaId, { timeout: 15_000 }).toBe(toneTwo);
  const second = await audioLayer(win);
  expect(Math.abs((second?.startedAt ?? 0) - (started + 3000))).toBeLessThan(100);
  await expect(panel.getByTestId('music-now')).toContainText('Placeholder tone two');

  // Pause: it fades out and makes no sound; Play goes on from where it was.
  await panel.getByTestId('music-pause').click();
  const fadeOut = await volumes(audio, toneTwo, 1000);
  expect(fadeOut.filter((v) => v > 0 && v < 0.95).length).toBeGreaterThan(2);
  expect(fadeOut.at(-1)).toBe(-1);
  const paused = await audioLayer(win);
  expect(paused?.pausedAtMs).toBeGreaterThan(0);
  await panel.getByTestId('music-play').click();
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBeUndefined();
  await expect(audio.locator(`audio[data-media-id="${toneTwo}"]`)).toHaveCount(1);

  // Clear all stops it; Put it back brings it back where it would be by now.
  await dispatch(win, 'clearAll');
  await expect.poll(() => audioLayer(win)).toBeNull();
  await dispatch(win, 'putBack');
  await expect.poll(async () => (await audioLayer(win))?.mediaId).toBe(toneTwo);

  // A sound put up takes the audio layer: the music stops.
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'playAudio',
        audio: { id: 'placeholder-cue', title: 'Placeholder cue', mediaId: id, volume: 1, loop: false },
      }),
    toneOne,
  );
  await expect.poll(async () => (await audioLayer(win))?.music).toBeUndefined();

  // The remote (the API) plays and pauses it.
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  expect((await apiCall(port, '/api/v1/music/play', { method: 'POST', token })).status).toBe(200);
  await expect.poll(async () => (await audioLayer(win))?.music?.name).toBe('Music before sabha');
  expect((await apiCall(port, '/api/v1/music/pause', { method: 'POST', token })).status).toBe(200);
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBeGreaterThanOrEqual(0);
  expect((await apiCall(port, '/api/v1/music/play', { method: 'POST', token })).status).toBe(200);
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBeUndefined();

  // After an unexpected stop it comes back, playing on where it would be.
  const liveFile = join(first.userData, 'live-state.json');
  // Saved as it is now: playing (no longer paused).
  await expect
    .poll(() => {
      const text = existsSync(liveFile) ? readFileSync(liveFile, 'utf8') : '';
      return text.includes('"music"') && !text.includes('"pausedAtMs"');
    })
    .toBe(true);
  await killApp(first.app);
  const second2 = await relaunchApp(first.userData, NETWORK_ENV);
  const win2 = await operatorPage(second2.app);
  await operatorReady(win2);
  await expect.poll(async () => (await audioLayer(win2))?.music?.name).toBe('Music before sabha');
  expect((await audioLayer(win2))?.pausedAtMs).toBeUndefined();
  const audio2 = await audioPage(second2.app);
  await expect(audio2.locator('audio')).toHaveCount(1);
  await second2.app.close();
});

test('Simple Mode plays and pauses the music, and changes no list', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  // The system's media controls and media keys never reach the show's sound (Session 15).
  expect(await app.evaluate(({ app: a }) => a.commandLine.getSwitchValue('disable-features'))).toContain(
    'HardwareMediaKeyHandling',
  );
  const dir = mkdtempSync(join(tmpdir(), 'drashti-music-simple-'));
  const tone = makeTestTone(join(dir, 'Placeholder simple tone.wav'), { seconds: 30 });
  await importAndGetIds(win, [tone]);
  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const media = await d.library.listMedia();
    const list = await d.music.create('Placeholder before sabha');
    if (!list.ok || !list.id) throw new Error('not made');
    await d.music.addTracks(list.id, [media[0]?.id ?? ''], null);
    return list.id;
  });
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  const strip = win.getByTestId('simple-music');
  await expect(strip).toContainText('Music: Placeholder before sabha');
  await expectNoSeriousA11yIssues(win, 'Simple Mode with music');
  await strip.getByTestId('simple-music-play').click();
  await expect.poll(async () => (await audioLayer(win))?.music?.playlistId).toBe(made);
  await strip.getByTestId('simple-music-pause').click();
  await expect.poll(async () => (await audioLayer(win))?.pausedAtMs).toBeGreaterThanOrEqual(0);
  // No list can be changed in Simple Mode.
  const refused = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.music.rename(id, 'Changed'),
    made,
  );
  expect(refused.ok).toBe(false);
  // It still fits at 1280 x 720 with nothing scrolling.
  const scrolls = await win.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
  expect(scrolls).toBeLessThanOrEqual(720);
  await app.close();
});
