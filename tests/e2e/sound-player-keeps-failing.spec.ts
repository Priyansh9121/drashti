import type { ElectronApplication } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  dispatch,
  makeClip,
  notices,
  openNewPlaylist,
  openPlaylist,
  OUT,
  row,
  SCREENS,
  shown,
  wallpaperAndPicture,
} from './hall-looks';
import { makeTestTone } from './test-media';
import {
  askWindow,
  poisonKills,
  poisonOff,
  poisonWindow,
  screenLook,
  upNow,
  watchdogEvents,
} from './keeps-failing';

/*
 * The sound player that keeps failing (x53; the owner's Q60-31 bug hunt, x52's D6c; his Q60-50 A). Drashti's sound plays
 * in a hidden window of its own, the sound player. Until now one that went down each time it loaded a video's sound was
 * given up on after six times in a minute: every sound gone for two minutes, nobody told, and the next video silent
 * (x52-1120-161434-29576, both systems). Now the video it keeps going down on comes off with its sound and a notice
 * naming it, as a video that fails does (x46's take-off), and the sound player is back at once without it; and one
 * that keeps failing with nothing to blame says so in a red notice, in Pro Mode and Simple Mode, with Try again.
 * Generated media and placeholder names only.
 */

const SOUND = 'audio.html';

/** The sound of a file in the sound player, asked by Main (its page may have crashed: Playwright cannot follow it). */
const soundOf = (app: ElectronApplication, mediaId: string) =>
  askWindow(
    app,
    SOUND,
    `(() => { const e = document.querySelector('audio[data-media-id="${mediaId}"]'); return e ? (!e.paused && e.currentTime > 0.05 ? 'plays' : 'paused') : 'none'; })()`,
  );

/** Whether the sound player is up and follows the show (its revision), or why not. */
const playerNow = (app: ElectronApplication) =>
  askWindow(app, SOUND, `document.body.dataset.rev === undefined ? 'loading' : 'follows'`);

test('a video whose sound brings the sound player down each time it loads: after the second time it comes off with a notice naming it, the sound player is back at once and the next video is heard; never given up', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-sound-keeps-failing-'));
  const first = makeClip(join(dir, 'Placeholder sound brings it down.mp4'), 'h264', 120, 740);
  const second = makeClip(join(dir, 'Placeholder next sound.mp4'), 'h264', 120, 784);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = (await hall.page.getByTestId('output-root').getAttribute('data-screen')) ?? '';
    await wallpaperAndPicture(win, dir);
    const [id = '', next = ''] = await importAndGetIds(win, [first, second]);
    const items = await win.evaluate(
      async ({ a, b }) => {
        const d = (globalThis as PageGlobals).drashti;
        const list = await d.playlists.create('Placeholder sound player', null, false);
        if (!list.ok) throw new Error(list.message);
        const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
          { kind: 'media', mediaId: a },
          { kind: 'media', mediaId: b },
        ]);
        if (!added.ok) throw new Error(added.message);
        return added.ids;
      },
      { a: id, b: next },
    );
    await openPlaylist(win, 'Placeholder sound player');
    await row(win, items[0] ?? '').click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('VIDEO');
    await expect.poll(() => soundOf(app, id), { timeout: 20_000, message: 'its sound plays' }).toBe('plays');

    const t0 = Date.now();
    await poisonWindow(app, SOUND, `audio[data-media-id="${id}"]`);
    const offAfter = await expect
      .poll(() => upNow(win), { timeout: 15_000 })
      .not.toBe(id)
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const backAfter = await expect
      .poll(() => playerNow(app), { timeout: 15_000 })
      .toBe('follows')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 3000, 'the sound player stays up');
    const told = await notices(win);
    const hallLook = await screenLook(app, screenId);
    // The next video, from its row: its sound is heard (the poison stays on, for the first file only).
    await row(win, items[1] ?? '').click();
    const heardAfter = await expect
      .poll(() => soundOf(app, next), { timeout: 20_000 })
      .toBe('plays')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const events = (await watchdogEvents(app)).filter((e) => e.includes('audio player'));
    await poisonOff(app, SOUND);
    const result = {
      kills: await poisonKills(app, SOUND),
      offAfterMs: offAfter,
      playerBackAfterMs: backAfter,
      heardNextAfterMs: heardAfter,
      hallLook,
      told,
      watchdog: events,
    };
    console.log(`X53 ${process.platform} (sound) ${JSON.stringify(result)}`);
    expect(
      offAfter,
      `the video comes off once the sound player keeps going down on it: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(told).toContainEqual(expect.stringMatching(/Placeholder sound brings it down[\s\S]*sound/u));
    expect(backAfter, 'the sound player back at once').toBeGreaterThan(0);
    expect(hallLook, 'the hall on the Wallpaper meanwhile').toBe('WALL');
    expect(heardAfter, 'the next video is heard').toBeGreaterThan(0);
    expect(result.kills, 'down twice, then never again').toBeLessThanOrEqual(3);
    expect(
      events.some((e) => e.includes(' gave-up ')),
      'never given up',
    ).toBe(false);
  } finally {
    await app.close();
  }
});

test('the sound player going down each time it loads with nothing to blame: after six times in a minute a red notice says Drashti’s sound has stopped, in Pro Mode and Simple Mode; Try again brings it back', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect
      .poll(() => playerNow(app), { timeout: 30_000, message: 'the sound player starts' })
      .toBe('follows');
    // Nothing up: it goes down each time it loads, whatever plays.
    await poisonWindow(app, SOUND, 'body');
    await expect
      .poll(async () => (await watchdogEvents(app)).some((e) => e.includes(' gave-up audio player')), {
        timeout: 60_000,
        message: 'given up after six times in a minute',
      })
      .toBe(true);
    const notice = win.getByTestId('sound-player-stopped-notice');
    await expect(notice, 'the red notice says so').toBeVisible({ timeout: 5000 });
    await expect(notice).toHaveAttribute('role', 'alert');
    await expect(notice).toContainText('Drashti’s sound has stopped');
    // Simple Mode says it too.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    const simple = win.getByTestId('simple-mode').getByTestId('sound-player-stopped-notice');
    await expect(simple).toBeVisible();
    // Whatever made it fail is gone: Try again brings it back, and the notice goes.
    await poisonOff(app, SOUND);
    await simple.getByTestId('sound-player-try-again').click();
    await expect
      .poll(() => playerNow(app), { timeout: 20_000, message: 'the sound player back' })
      .toBe('follows');
    await expect(simple).toHaveCount(0, { timeout: 10_000 });
    await letTimePass(win, 1000, 'it stays');
    expect(await playerNow(app)).toBe('follows');
  } finally {
    await app.close();
  }
});

// Q60-52 A (the owner's, x53's question): a sound file (the music, not a video) that brings the sound player down each
// time it loads: after the second time it comes off as Clear audio takes it, said by its name; the player back at once.
test('the music that brings the sound player down each time it loads: after the second time it comes off as Clear audio takes it, with a notice naming it; the sound player back at once and a video heard; never given up', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-sound-music-fails-'));
  const tone = makeTestTone(join(dir, 'Placeholder music brings it down.wav'), { seconds: 60, hz: 523 });
  const clip = makeClip(join(dir, 'Placeholder video after the music.mp4'), 'h264', 120, 659);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = (await hall.page.getByTestId('output-root').getAttribute('data-screen')) ?? '';
    await wallpaperAndPicture(win, dir);
    const [toneId = '', videoId = ''] = await importAndGetIds(win, [tone, clip]);
    await dispatch(win, {
      type: 'playAudio',
      audio: { id: 'placeholder-music', title: 'Placeholder music', mediaId: toneId, volume: 1, loop: true },
    });
    await expect
      .poll(() => soundOf(app, toneId), { timeout: 20_000, message: 'the music plays' })
      .toBe('plays');

    const t0 = Date.now();
    await poisonWindow(app, SOUND, `audio[data-media-id="${toneId}"]`);
    const musicUp = () =>
      win.evaluate(
        async () =>
          (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.audio?.mediaId ?? null,
      );
    const offAfter = await expect
      .poll(musicUp, { timeout: 15_000 })
      .toBeNull()
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const backAfter = await expect
      .poll(() => playerNow(app), { timeout: 15_000 })
      .toBe('follows')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 2000, 'the sound player stays up');
    const told = await notices(win);
    // A video put up now is heard (the poison stays on, for the music only).
    const { item } = await openNewPlaylist(win, 'Placeholder after the music', videoId);
    await row(win, item).click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('VIDEO');
    const heardAfter = await expect
      .poll(() => soundOf(app, videoId), { timeout: 20_000 })
      .toBe('plays')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const events = (await watchdogEvents(app)).filter((e) => e.includes('audio player'));
    await poisonOff(app, SOUND);
    const result = {
      kills: await poisonKills(app, SOUND),
      musicOffAfterMs: offAfter,
      playerBackAfterMs: backAfter,
      videoHeardAfterMs: heardAfter,
      hallLook: await screenLook(app, screenId),
      told,
      watchdog: events,
    };
    console.log(`X53 ${process.platform} (music) ${JSON.stringify(result)}`);
    expect(
      offAfter,
      `the music comes off once the sound player keeps going down on it: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(told).toContainEqual(expect.stringMatching(/Placeholder music brings it down[\s\S]*came off/u));
    expect(backAfter, 'the sound player back at once').toBeGreaterThan(0);
    expect(heardAfter, 'a video put up after is heard').toBeGreaterThan(0);
    expect(result.kills, 'down twice, then never again').toBeLessThanOrEqual(3);
    expect(
      events.some((e) => e.includes(' gave-up ')),
      'never given up',
    ).toBe(false);
  } finally {
    await app.close();
  }
});
