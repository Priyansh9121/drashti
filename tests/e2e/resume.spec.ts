import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  openSection,
  operatorPage,
  operatorReady,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Resume where it stopped, last played and play counts (alpha.20: the owner's Q60-34 item 3 and "last played", his
 * "Yes, all A" to Q60-39: P1 A, P6 (e) A and (j) A). A video or sound 10 minutes or longer taken off before its last 30
 * seconds keeps where it was; the next time it goes up it starts at its start as always, and "Resume at …" is offered for
 * its first 30 seconds: pressed, every screen and the sound go there together; played to its end, it is forgotten. Simple
 * Mode has it too. Each file's plays are counted, with when it last played, in Media and Media information. An audio
 * playlist stopped part-way plays on from the track it stopped on. Generated media only, placeholder names.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function ff(args: string[]): string {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    timeout: 180_000,
  });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return args.at(-1) ?? '';
}

/** A video of `seconds` at one frame a second (small and quick to make), with a quiet tone. */
const longVideo = (file: string, seconds: number) =>
  ff([
    ...['-f', 'lavfi', '-i', `color=c=0x3a6ea5:s=64x36:r=1:d=${String(seconds)}`],
    ...['-f', 'lavfi', '-i', `sine=f=330:r=48000:d=${String(seconds)}`],
    ...['-af', 'volume=0.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    ...['-c:a', 'aac', '-b:a', '32k', '-shortest', file],
  ]);

/** A sound of `seconds`: a quiet tone. */
const sound = (file: string, seconds: number, hz = 440) =>
  ff([
    ...['-f', 'lavfi', '-i', `sine=f=${String(hz)}:r=48000:d=${String(seconds)}`],
    ...['-af', 'volume=0.2', '-c:a', 'aac', '-b:a', '32k', file],
  ]);

async function start(): Promise<{ app: ElectronApplication; win: Page; dir: string }> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win, dir: mkdtempSync(join(tmpdir(), 'drashti-resume-')) };
}

const dispatch = (win: Page, command: unknown) =>
  win.evaluate(
    (c) =>
      (globalThis as PageGlobals).drashti.engine.dispatch(
        c as Parameters<PageGlobals['drashti']['engine']['dispatch']>[0],
      ),
    command,
  );

const snapshot = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;

const upAsBackground = async (win: Page, mediaId: string) =>
  expect(
    (
      await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop: false },
      })
    ).ok,
  ).toBe(true);

const upAsSound = async (win: Page, mediaId: string) =>
  expect(
    (
      await dispatch(win, {
        type: 'playAudio',
        audio: { id: mediaId, title: 'Placeholder talk', mediaId, volume: 1, loop: false },
      })
    ).ok,
  ).toBe(true);

/** Moved to `toMs`, once its length is known (the engine refuses a move before). */
async function moveTo(win: Page, layer: 'background' | 'audio', toMs: number): Promise<void> {
  await expect
    .poll(async () => (await dispatch(win, { type: 'moveTo', playing: { layer }, toMs })).ok, {
      timeout: 30_000,
      message: 'moved, once its length is known',
    })
    .toBe(true);
}

/** Where the hall's sound plays this file now (seconds), in the audio player. */
async function heardAt(app: ElectronApplication, mediaId: string): Promise<number> {
  const audio = app.windows().find((w) => w.url().includes('audio.html'));
  if (!audio) return -1;
  return audio.evaluate(
    (id) => document.querySelector<HTMLMediaElement>(`audio[data-media-id="${id}"]`)?.currentTime ?? -1,
    mediaId,
  );
}

test('a long video taken off part-way: "Resume at 6:00" the next time, every screen and the sound there together; played to its end, never again', async () => {
  test.setTimeout(300_000);
  const { app, win, dir } = await start();
  try {
    const [id = ''] = await importAndGetIds(win, [longVideo(join(dir, 'Placeholder katha.mp4'), 630)]);
    expect(id).not.toBe('');
    await upAsBackground(win, id);
    // Paused, then moved to 6:00 (a move while paused waits there), then taken off: kept exactly at 6:00. (Playing, it
    // would be kept where it had played on to as it was taken off: the sound's test below.)
    await moveTo(win, 'background', 300_000);
    expect(
      (await dispatch(win, { type: 'pausePlaying', playing: { layer: 'background' } })).ok,
      'paused',
    ).toBe(true);
    await moveTo(win, 'background', 360_000);
    await dispatch(win, { type: 'clearLayer', layer: 'background' });
    await expect.poll(async () => (await snapshot(win)).layers.background).toBeNull();

    // Up again: it starts at its start as always, and the place it was taken off is offered.
    await upAsBackground(win, id);
    const offer = win.getByRole('button', { name: /Resume at 6:00/u });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousA11yIssues(win, 'Resume at under the time bars', '[data-testid="resume-offer"]');
    await offer.click();
    await expect
      .poll(async () => {
        const bg = (await snapshot(win)).layers.background;
        return bg?.kind === 'media' ? (bg.seek?.toMs ?? 0) : 0;
      })
      .toBe(360_000);
    await expect.poll(() => heardAt(app, id), { timeout: 15_000 }).toBeGreaterThan(359);
    expect(await heardAt(app, id)).toBeLessThan(366);
    await expect(offer).toHaveCount(0);

    // Taken off in its last 30 seconds: played to its end, forgotten.
    await moveTo(win, 'background', 615_000);
    await dispatch(win, { type: 'clearLayer', layer: 'background' });
    await expect.poll(async () => (await snapshot(win)).layers.background).toBeNull();
    await upAsBackground(win, id);
    await letTimePass(win, 3000, 'an offer would show by now');
    await expect(win.getByRole('button', { name: /Resume at/u })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a long sound: its plays counted and when it last played, in Media and Media information; "Resume at 2:00" in Simple Mode too', async () => {
  test.setTimeout(300_000);
  const { app, win, dir } = await start();
  try {
    const [id = ''] = await importAndGetIds(win, [sound(join(dir, 'Placeholder pravachan.m4a'), 660)]);
    expect(id).not.toBe('');
    await upAsSound(win, id);
    await moveTo(win, 'audio', 120_000);
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });
    await expect.poll(async () => (await snapshot(win)).layers.audio).toBeNull();

    // Counted once for its one showing, with the day it played.
    await expect
      .poll(async () => {
        const all = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
        const m = all.find((x) => x.id === id);
        return m ? `${String(m.playCount ?? 0)} ${m.lastPlayedAt ? 'dated' : 'undated'}` : 'none';
      })
      .toBe('1 dated');
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    const row = win.getByTestId('media-item').filter({ hasText: 'Placeholder pravachan' });
    await expect(row.getByTestId('media-note')).toContainText('played');
    await row.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Media information…' }).click();
    const info = win.getByTestId('media-info');
    await expect(
      info.getByRole('region', { name: 'In Drashti', exact: true }).locator('[data-label="Played"] dd'),
    ).toHaveText(/^Once, last on /u);
    await win.keyboard.press('Escape');

    // Simple Mode: up again, offered where it was taken off.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await upAsSound(win, id);
    const offer = win.getByRole('button', { name: /Resume at 2:00/u });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await offer.click();
    await expect.poll(() => heardAt(app, id), { timeout: 15_000 }).toBeGreaterThan(119);
    expect(await heardAt(app, id)).toBeLessThan(126);
  } finally {
    await app.close();
  }
});

test('an audio playlist stopped part-way plays on from the track it stopped on at the Audio panel’s Play; a track’s own row plays that track', async () => {
  test.setTimeout(240_000);
  const { app, win, dir } = await start();
  try {
    const ids = await importAndGetIds(win, [
      sound(join(dir, 'Placeholder dhun one.m4a'), 30, 330),
      sound(join(dir, 'Placeholder dhun two.m4a'), 30, 440),
      sound(join(dir, 'Placeholder dhun three.m4a'), 30, 550),
    ]);
    await win.evaluate(async (mediaIds) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.music.create('Placeholder before sabha');
      if (!made.ok || !made.id) throw new Error('no audio playlist');
      const added = await d.music.addTracks(made.id, mediaIds, null);
      if (!added.ok) throw new Error(added.message);
    }, ids);
    const playing = async () => (await snapshot(win)).layers.audio?.mediaId ?? null;
    // The Audio panel as the operator has it: the list shown, its tracks' rows, and its Play.
    await openSection(win, 'audio');
    await win.getByTestId('music-playlist').filter({ hasText: 'Placeholder before sabha' }).click();
    const panel = win.getByTestId('music-panel');
    const track = (name: string) => panel.getByRole('button', { name: `Play from ${name}` });
    await track('Placeholder dhun two').click();
    await expect.poll(playing).toBe(ids[1]);
    // Clear audio part-way: Play plays on from that track.
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });
    await expect.poll(playing).toBeNull();
    await panel.getByTestId('music-play').click();
    await expect.poll(playing).toBe(ids[1]);
    // A track's own row plays that track.
    await dispatch(win, { type: 'clearLayer', layer: 'audio' });
    await expect.poll(playing).toBeNull();
    await track('Placeholder dhun one').click();
    await expect.poll(playing).toBe(ids[0]);
  } finally {
    await app.close();
  }
});
