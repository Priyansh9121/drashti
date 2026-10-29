import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink, type StandIn } from './dropbox-stand-in';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Session 55, Part 7: sound with everything else. A sound keeps playing whatever goes up (a picture, a video with its
 * own sound, a PDF), and starts while a PDF is up without moving the slides; the music steps aside under a video with
 * sound, fading over about a second and never stopping, and Audio's switch turns that off (K); a loud and a quiet
 * file play at the same level, and a file's own Even loudness plays it as it is (L); Trim black and silence from a
 * video's menu, with Undo, and by itself for a From a Link… video (M); each file's length known before it plays, and
 * the library already there measured once after the start (P3). Generated sound and video only (FFmpeg's test
 * sources), and a made-up Dropbox.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function ff(args: string[]): void {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** A steady tone (FFmpeg's sine is 1/8 full scale, made louder or quieter by `volume`). */
function tone(file: string, o: { seconds: number; hz?: number; volume?: number }): string {
  ff([
    ...['-f', 'lavfi', '-i', `sine=f=${String(o.hz ?? 440)}:r=48000:d=${String(o.seconds)}`],
    ...['-af', `volume=${String(o.volume ?? 1)}`, '-ac', '2', file],
  ]);
  return file;
}

/** A small video with its own sound (a tone). */
function videoWithSound(file: string, seconds: number): string {
  ff([
    ...['-f', 'lavfi', '-i', `testsrc2=s=320x180:r=25:d=${String(seconds)}`],
    ...['-f', 'lavfi', '-i', `sine=f=660:r=48000:d=${String(seconds)}`],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file],
  ]);
  return file;
}

/** A video black and silent for 1.5 s, then 3 s of picture and a tone, then black and silent for 1 s. */
function edgesVideo(file: string, hz = 440): string {
  ff([
    ...['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=1.5'],
    ...['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=3'],
    ...['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=1'],
    ...['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1.5'],
    ...['-f', 'lavfi', '-i', `sine=f=${String(hz)}:r=48000:d=3`],
    ...['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1'],
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[4:a]aformat=channel_layouts=stereo[s];[3:a][s][5:a]concat=n=3:v=0:a=1[a]',
    ...['-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    ...['-c:a', 'aac', file],
  ]);
  return file;
}

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
const playSound = (win: Page, mediaId: string) =>
  dispatch(win, {
    type: 'playAudio',
    audio: { id: mediaId, title: 'Placeholder sound', mediaId, volume: 1, loop: true },
  });
const showVideo = (win: Page, mediaId: string, media: 'video' | 'image' = 'video') =>
  dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media, fit: 'fit', loop: false },
  });
const fileSound = (win: Page, mediaId: string) =>
  win.evaluate((id) => (globalThis as PageGlobals).drashti.sound.file(id), mediaId);
const markersOf = (win: Page, mediaId: string) =>
  win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), mediaId);
/** Measured by the sound pass, a moment after its import (or the start). */
const measured = async (win: Page, ids: string[], timeout = 30_000) => {
  for (const id of ids)
    await expect.poll(async () => (await fileSound(win, id))?.measured, { timeout }).toBe(true);
};
/** The gain an audio element plays with now (its even loudness, and the music's step aside). */
const gainOf = async (el: Locator) => Number((await el.getAttribute('data-gain')) ?? 'NaN');
/** How loud the audio player's way out is now (dBFS): the middle of a few readings. */
async function levelOf(audio: Page): Promise<number> {
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    seen.push(Number((await audio.locator('body').getAttribute('data-level')) ?? '-100'));
    await letTimePass(audio, 100, 'the audio player measures its way out each 50 ms');
  }
  return seen.sort((a, b) => a - b)[2] ?? -100;
}

async function start(env: Record<string, string> = {}) {
  const { app, userData } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win, userData, dir: mkdtempSync(join(tmpdir(), 'drashti-sound-everything-')) };
}

test('a sound plays on whatever goes up; the music steps aside under a video with sound, and Audio’s switch turns that off', async () => {
  test.setTimeout(180_000);
  const { app, win, dir } = await start();
  const [musicId = '', talkId = '', pictureId = ''] = await importAndGetIds(win, [
    tone(join(dir, 'Placeholder music.wav'), { seconds: 60, volume: 0.5 }),
    videoWithSound(join(dir, 'Placeholder talk.mp4'), 3),
    await makeTestImage(win, join(dir, 'Placeholder backdrop.png')),
  ]);
  await measured(win, [musicId, talkId]);
  const even = 10 ** (((await fileSound(win, musicId))?.gainDb ?? 0) / 20);
  const audio = await audioPage(app);
  const music = audio.locator(`audio[data-media-id="${musicId}"]`);
  expect((await playSound(win, musicId)).ok).toBe(true);
  await expect(music).toHaveCount(1);
  await expect.poll(() => gainOf(music)).toBeCloseTo(even, 2);
  const playing = () => music.evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0);
  await expect.poll(playing).toBe(true);

  // A picture: the sound plays on, as loud.
  await showVideo(win, pictureId, 'image');
  await letTimePass(win, 600, 'a picture never makes the music step aside');
  expect(await gainOf(music)).toBeCloseTo(even, 2);
  expect(await playing()).toBe(true);

  // A video with sound: its own sound plays too, and the music fades down over about a second, never stopping.
  await audio.evaluate((id) => {
    const seen: number[] = [];
    const timer = setInterval(() => {
      seen.push(
        Number(document.querySelector(`audio[data-media-id="${id}"]`)?.getAttribute('data-gain') ?? -1),
      );
    }, 40);
    (globalThis as { asideSeen?: { seen: number[]; timer: ReturnType<typeof setInterval> } }).asideSeen = {
      seen,
      timer,
    };
  }, musicId);
  await showVideo(win, talkId);
  await expect(audio.locator(`audio[data-media-id="${talkId}"]`)).toHaveCount(1);
  await expect.poll(() => gainOf(music), { timeout: 5000 }).toBeLessThan(even * 0.25);
  const fade = await audio.evaluate(() => {
    const s = (globalThis as { asideSeen?: { seen: number[]; timer: ReturnType<typeof setInterval> } })
      .asideSeen;
    if (s) clearInterval(s.timer);
    return s?.seen ?? [];
  });
  // On its way down, several steps between: a fade, not a cut.
  expect(fade.filter((v) => v < even * 0.9 && v > even * 0.25).length, fade.join(' ')).toBeGreaterThan(3);
  expect(await playing()).toBe(true);
  await expect(audio.locator('body')).toHaveAttribute('data-aside', 'true');

  // The video ends (3 s): the music comes back up.
  await expect.poll(() => gainOf(music), { timeout: 10_000 }).toBeCloseTo(even, 2);
  await expect(audio.locator('body')).toHaveAttribute('data-aside', 'false');

  // Up again and cleared while it plays: back up too.
  await dispatch(win, { type: 'clearLayer', layer: 'background' });
  await showVideo(win, talkId);
  await expect.poll(() => gainOf(music), { timeout: 5000 }).toBeLessThan(even * 0.25);
  await dispatch(win, { type: 'clearLayer', layer: 'background' });
  await expect.poll(() => gainOf(music), { timeout: 5000 }).toBeCloseTo(even, 2);

  // Audio's switch off: the music stays as loud under a video.
  const aside = win.getByTestId('music-steps-aside-switch');
  await expect(aside).toHaveAttribute('aria-checked', 'true');
  // Its row fits the live column in CI's window and at 1280 × 720, nothing cut or scrolling sideways.
  const fits = () =>
    win.getByTestId('music-steps-aside').evaluate((el) => {
      const column = el.closest('aside')?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth + 1 && column !== undefined && box.right <= column.right + 1;
    });
  await aside.scrollIntoViewIfNeeded();
  expect(await fits()).toBe(true);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  expect(await fits()).toBe(true);
  await expectNoSeriousA11yIssues(
    win,
    'Audio with its Music steps aside switch',
    '[data-testid="audio-group"]',
  );
  await aside.click();
  await expect(aside).toHaveAttribute('aria-checked', 'false');
  await showVideo(win, talkId);
  await expect(audio.locator(`audio[data-media-id="${talkId}"]`)).toHaveCount(1);
  await letTimePass(win, 1500, 'the music would have stepped aside by now');
  expect(await gainOf(music)).toBeCloseTo(even, 2);
  await aside.click();
  await expect(aside).toHaveAttribute('aria-checked', 'true');
  await app.close();
});

test('a slide’s own sound plays over an audio playlist: the music plays on, lowered, and comes back as that sound ends', async () => {
  test.setTimeout(150_000);
  const { app, win, dir } = await start();
  const bell = tone(join(dir, 'Placeholder bell.wav'), { seconds: 2, hz: 880 });
  const show = join(dir, 'Placeholder with its own sound.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-OVER-MUSIC',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              audio: bell,
              audioOnce: true,
              text: [{ rtf: cocoaRtf([['Placeholder with its own sound', 80, [255, 255, 255]]]) }],
            },
          ],
        },
      ],
    }),
  );
  const [musicId = '', presentationId = ''] = await importAndGetIds(win, [
    tone(join(dir, 'Placeholder before sabha.wav'), { seconds: 60, volume: 0.5 }),
    show,
  ]);
  await measured(win, [musicId]);
  const even = 10 ** (((await fileSound(win, musicId))?.gainDb ?? 0) / 20);
  // An audio playlist plays.
  const listId = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.music.create('Placeholder before sabha');
    if (!list.ok || !list.id) throw new Error('not made');
    await d.music.addTracks(list.id, [id], null);
    await d.music.play(list.id, 0);
    return list.id;
  }, musicId);
  const audio = await audioPage(app);
  const track = audio.locator(`audio[data-media-id="${musicId}"]`);
  await expect.poll(() => gainOf(track)).toBeCloseTo(even, 2);

  // The slide with its own sound: its sound plays over the music, which plays on, lowered (never stopped for it).
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0, arrangementId: null });
  await expect(audio.locator('audio[data-key^="over:"]')).toHaveCount(1);
  const layer = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.audio,
  );
  expect(layer?.music?.playlistId).toBe(listId);
  expect(layer?.mediaId).toBe(musicId);
  expect(layer?.over?.cue).toBe(true);
  await expect.poll(() => gainOf(track), { timeout: 5000 }).toBeLessThan(even * 0.25);
  expect(await track.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true);
  // Its sound plays once (2 s): the music comes back up.
  await expect.poll(() => gainOf(track), { timeout: 10_000 }).toBeCloseTo(even, 2);
  await app.close();
});

test('a sound’s row clicked while a PDF is up plays it, and Next goes on with the PDF', async () => {
  test.setTimeout(120_000);
  const { app, win, dir } = await start();
  const pdf = join(dir, 'Placeholder notices.pdf');
  writeFileSync(
    pdf,
    makeTestPdf([
      { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder page one' },
      { width: 960, height: 540, color: [20, 83, 45], text: 'Placeholder page two' },
    ]),
  );
  const [pdfId = '', toneId = ''] = await importAndGetIds(win, [
    pdf,
    tone(join(dir, 'Placeholder bhajan.wav'), { seconds: 30 }),
  ]);
  const items = await win.evaluate(
    async ({ pdfId, toneId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create('Placeholder sabha', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId: pdfId },
        { kind: 'media', mediaId: toneId },
      ]);
      if (!added.ok) throw new Error(added.message);
      return added.ids;
    },
    { pdfId, toneId },
  );
  const [pdfItem = '', toneItem = ''] = items;
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder sabha' }).click();
  const row = (itemId: string) => win.getByTestId('open-playlist').locator(`[data-item-row="${itemId}"]`);
  await expect(row(pdfItem).getByTestId('slide-thumb')).toHaveCount(2);
  const state = () =>
    win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
  // The PDF's first page, then the sound's row: the sound plays, the page stays up.
  await row(pdfItem).getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await state()).live.slideIndex).toBe(0);
  await row(toneItem).click();
  await expect.poll(async () => (await state()).layers.audio?.mediaId).toBe(toneId);
  expect((await state()).live).toMatchObject({ presentationId: pdfId, slideIndex: 0 });
  // Next: the PDF's next page, the sound playing on.
  await dispatch(win, { type: 'next' });
  await expect.poll(async () => (await state()).live.slideIndex).toBe(1);
  expect((await state()).layers.audio?.mediaId).toBe(toneId);
  await app.close();
});

test('even loudness: a loud and a quiet sound play at the same level; a file’s own Even loudness plays it as it is', async () => {
  test.setTimeout(150_000);
  const { app, win, dir } = await start();
  // 18 dB apart in their files.
  const [loudId = '', quietId = ''] = await importAndGetIds(win, [
    tone(join(dir, 'Placeholder loud.wav'), { seconds: 60, volume: 4 }),
    tone(join(dir, 'Placeholder quiet.wav'), { seconds: 60, volume: 0.5 }),
  ]);
  await measured(win, [loudId, quietId]);
  const loud = await fileSound(win, loudId);
  const quiet = await fileSound(win, quietId);
  expect((loud?.lufs ?? 0) - (quiet?.lufs ?? 0)).toBeCloseTo(18, 0);
  expect(loud?.gainDb).toBeLessThan(0);
  expect(quiet?.gainDb).toBeGreaterThan(0);
  const audio = await audioPage(app);
  await playSound(win, loudId);
  await expect(audio.locator(`audio[data-media-id="${loudId}"]`)).toHaveCount(1);
  await letTimePass(win, 1500, 'the sound plays steadily');
  const loudLevel = await levelOf(audio);
  await playSound(win, quietId);
  await expect(audio.locator(`audio[data-media-id="${loudId}"]`)).toHaveCount(0);
  await letTimePass(win, 1500, 'the sound plays steadily');
  const quietLevel = await levelOf(audio);
  // Heard (not silent), and within 2 dB of each other in the hall.
  expect(loudLevel).toBeGreaterThan(-40);
  expect(Math.abs(loudLevel - quietLevel), `${String(loudLevel)} against ${String(quietLevel)}`).toBeLessThan(
    2,
  );

  // Its own switch, in its right-click menu: as it is in its file, said so.
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  await win.getByTestId('media-item').filter({ hasText: 'Placeholder quiet' }).click({ button: 'right' });
  const tick = win.getByRole('menuitemcheckbox', { name: 'Even loudness' });
  await expect(tick).toHaveAttribute('aria-checked', 'true');
  await tick.click();
  await expect(win.getByTestId('operator-notice')).toContainText('plays as it is in its file');
  await expect
    .poll(() => gainOf(audio.locator(`audio[data-media-id="${quietId}"]`)), { timeout: 5000 })
    .toBe(1);
  await letTimePass(win, 600, 'the gain eases to its new level');
  // Its own level again: about 9 dB down (it was made 8.8 dB louder).
  expect(await levelOf(audio)).toBeLessThan(quietLevel - 6);
  // On again, from the same menu.
  await win.getByTestId('media-item').filter({ hasText: 'Placeholder quiet' }).click({ button: 'right' });
  await expect(tick).toHaveAttribute('aria-checked', 'false');
  await tick.click();
  await expect(win.getByTestId('operator-notice')).toContainText('plays at the even loudness');
  await app.close();
});

let standIn: StandIn | null = null;
test.afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

test('Trim black and silence: from a video’s menu with Undo, and by itself for a From a Link… video; the file never cut', async () => {
  test.setTimeout(240_000);
  const made = mkdtempSync(join(tmpdir(), 'drashti-sound-trim-'));
  const clip = edgesVideo(join(made, 'Placeholder edges.mp4'));
  const bytes = readFileSync(clip);
  // The link's file is another (its tone higher), so it comes in as a file of its own.
  const linked = readFileSync(edgesVideo(join(made, 'Placeholder link clip.mp4'), 550));
  standIn = await dropboxStandIn(
    { edgeAAAAAAAAAAA: { name: 'Placeholder link clip.mp4', body: linked, type: 'video/mp4' } },
    {},
  );
  const { app, win } = await start({
    DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
    DRASHTI_TEST_DOWNLOADS_DIR: join(made, 'Videos'),
  });
  const [videoId = ''] = await importAndGetIds(win, [clip]);
  expect(await markersOf(win, videoId)).toMatchObject({ startMs: null, endMs: null });

  // Its menu: Trim black and silence sets its points past them, says where, and Undo puts them back.
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  await win.getByTestId('media-item').filter({ hasText: 'Placeholder edges' }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Trim black and silence' }).click();
  await expect(win.getByTestId('operator-notice')).toContainText('now plays from 0:01.5 to 0:04.5', {
    timeout: 30_000,
  });
  const points = await markersOf(win, videoId);
  expect(points.startMs).toBeGreaterThanOrEqual(1400);
  expect(points.startMs).toBeLessThanOrEqual(1600);
  expect(points.endMs).toBeGreaterThanOrEqual(4400);
  expect(points.endMs).toBeLessThanOrEqual(4600);
  // The file itself is never cut.
  expect(readFileSync(clip).equals(bytes)).toBe(true);
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Trimmed “Placeholder edges.mp4” past its black and silence');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(async () => (await markersOf(win, videoId)).startMs).toBeNull();
  expect((await markersOf(win, videoId)).endMs).toBeNull();

  // From a Link… (a made-up Dropbox): its points are set by themselves once it is in.
  await chooseMenuItem(app, 'import-from-link');
  await win.getByTestId('link-kind-dropbox').click();
  await win.getByTestId('link-text').fill(fileLink('edgeAAAAAAAAAAA', 'Placeholder link clip.mp4'));
  await expect(win.getByTestId('link-name')).toHaveText('Placeholder link clip.mp4');
  await win.getByTestId('link-download').click();
  await expect(win.getByTestId('link-saved')).toBeVisible({ timeout: 60_000 });
  const linkedId = async () =>
    (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).find((m) =>
      m.name.startsWith('Placeholder link clip'),
    )?.id ?? '';
  await expect.poll(linkedId, { timeout: 60_000 }).not.toBe('');
  const linkId = await linkedId();
  await expect.poll(async () => (await markersOf(win, linkId)).startMs, { timeout: 60_000 }).not.toBeNull();
  const linkPoints = await markersOf(win, linkId);
  expect(linkPoints.startMs).toBeGreaterThanOrEqual(1400);
  expect(linkPoints.endMs).toBeLessThanOrEqual(4600);
  await app.close();
});

test('each file’s length is known before it plays, and the library already there is measured once after the start', async () => {
  test.setTimeout(180_000);
  // As a library from before Part 7: nothing read at import, nothing measured.
  const first = await start({ DRASHTI_TEST_SOUND_PASS: 'off', DRASHTI_TEST_NO_CONVERT_AT_IMPORT: '1' });
  const [oldId = ''] = await importAndGetIds(first.win, [
    tone(join(first.dir, 'Placeholder old tone.wav'), { seconds: 7 }),
  ]);
  // A file's length as a playlist's row has it (from the library: before Part 7, only once a screen had played it).
  const lists = new Map<string, string>();
  const lengthOf = async (win: Page, mediaId: string) => {
    let listId = lists.get(mediaId);
    if (listId === undefined) {
      listId = await win.evaluate(async (id) => {
        const d = (globalThis as PageGlobals).drashti;
        const list = await d.playlists.create(`Placeholder lengths ${id.slice(0, 8)}`, null, false);
        if (!list.ok) throw new Error(list.message);
        const added = await d.playlists.addItems(list.ids[0] ?? '', null, [{ kind: 'media', mediaId: id }]);
        if (!added.ok) throw new Error(added.message);
        return list.ids[0] ?? '';
      }, mediaId);
      lists.set(mediaId, listId);
    }
    return win.evaluate(async (id) => {
      const [item] = await (globalThis as PageGlobals).drashti.playlists.items(id);
      return item?.kind === 'media' ? (item.durationMs ?? null) : null;
    }, listId);
  };
  expect(await lengthOf(first.win, oldId)).toBeNull();
  expect((await fileSound(first.win, oldId))?.measured).toBe(false);
  await first.app.close();

  // Started again: the library's files are measured once, a while after the start (here 1 s), lengths too.
  const again = await relaunchApp(first.userData, { DRASHTI_TEST_SOUND_PASS: '1000' });
  const win = await operatorPage(again.app);
  await operatorReady(win);
  await measured(win, [oldId]);
  await expect.poll(() => lengthOf(win, oldId)).toBe(7000);

  // A file imported now: its length is there at once, before it has ever played (an MP4's own length, about 4 s).
  const [newId = ''] = await importAndGetIds(win, [
    videoWithSound(join(first.dir, 'Placeholder new talk.mp4'), 4),
  ]);
  const known = (await lengthOf(win, newId)) ?? 0;
  expect(known).toBeGreaterThan(3900);
  expect(known).toBeLessThan(4200);
  // Up as the background, the screens know its time left from the start.
  await showVideo(win, newId);
  const bg = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );
  // (The audio player, playing its sound, may say the browser's own reading of it a moment later: within a frame.)
  expect(Math.abs((bg?.kind === 'media' ? (bg.durationMs ?? 0) : 0) - known)).toBeLessThan(100);
  await again.app.close();
});
