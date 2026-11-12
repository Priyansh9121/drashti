import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  slideEditorClosed,
  slideEditorWindow,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage, makeTestTone } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Session 56 (alpha.16), the owner: Simple Mode's right column and bottom bar from Pro Mode's own parts, let through
 * Simple Mode's guards on Main (main/simple-mode.ts) and tested here in Simple Mode. No keys line ("Remove the keys
 * line"); Audio under LIVE ("in the empty space there… build nothing new for it, just make it reachable"): an audio
 * playlist made and played there, playing on under a video and stepping aside, as Pro Mode's; a row's Trim (a new
 * cut with its markers, Reset to original, and Trim black and silence) and When it ends; Edit slides (Pro's editor,
 * a PDF page's own words too), its save one Undo; Slide, Background and Audio beside Clear all, each taking its own
 * layer off; and the column laid out from CI's 1024 × 645 up, scrolling when short, nothing under the status bar.
 * Generated sound, video and pictures, a generated PDF, and placeholder words only.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function ff(args: string[]): void {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** A steady tone (FFmpeg's sine is 1/8 full scale, made quieter by `volume`). */
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
function edgesVideo(file: string): string {
  ff([
    ...['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=1.5'],
    ...['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=3'],
    ...['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=1'],
    ...['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1.5'],
    ...['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=3'],
    ...['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1'],
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[4:a]aformat=channel_layouts=stereo[s];[3:a][s][5:a]concat=n=3:v=0:a=1[a]',
    ...['-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    ...['-c:a', 'aac', file],
  ]);
  return file;
}

async function start(env: Record<string, string> = {}, size: { width: number; height: number } = CI_WINDOW) {
  const { app, userData } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, size);
  return { app, win, userData, dir: mkdtempSync(join(tmpdir(), 'drashti-simple-pro-parts-')) };
}

/** A playlist of these rows, made and opened in Pro Mode: Simple Mode works on the playlist open as it comes. */
async function playlistWith(
  win: Page,
  name: string,
  items: ({ kind: 'media'; mediaId: string } | { kind: 'presentation'; presentationId: string })[],
): Promise<string> {
  const id = await win.evaluate(
    async ({ name, items }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      const playlistId = made.ids[0] ?? '';
      const added = await d.playlists.addItems(playlistId, null, items);
      if (!added.ok) throw new Error(added.message);
      return playlistId;
    },
    { name, items },
  );
  await win.getByTestId('playlist-node').filter({ hasText: name }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(name);
  return id;
}

async function toSimple(win: Page): Promise<Locator> {
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  return simple;
}

const dispatch = (win: Page, command: unknown) =>
  win.evaluate(
    (c) =>
      (globalThis as PageGlobals).drashti.engine.dispatch(
        c as Parameters<PageGlobals['drashti']['engine']['dispatch']>[0],
      ),
    command,
  );
const layers = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers);
const fileSound = (win: Page, mediaId: string) =>
  win.evaluate((id) => (globalThis as PageGlobals).drashti.sound.file(id), mediaId);
const markersOf = (win: Page, mediaId: string) =>
  win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), mediaId);
const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
/** Each audio playlist as "name: track, track". */
const audioLists = (win: Page) =>
  win.evaluate(async () => {
    const view = await (globalThis as PageGlobals).drashti.music.view();
    return view.playlists.map((p) => `${p.name}: ${p.tracks.map((t) => t.name).join(', ')}`);
  });
/** Measured by the sound pass, a moment after its import. */
const measured = async (win: Page, ids: string[]) => {
  for (const id of ids)
    await expect.poll(async () => (await fileSound(win, id))?.measured, { timeout: 30_000 }).toBe(true);
};
/** The gain an audio element plays with now (its even loudness, and the music's step aside). */
const gainOf = async (el: Locator) => Number((await el.getAttribute('data-gain')) ?? 'NaN');

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/**
 * Every file in Drashti's own media folder (a copy made would be one more), but its still pictures (`stills/`, a
 * video's first picture made for its thumbnail as it is first shown, never a copy of the file).
 */
const mediaFiles = (userData: string): string[] =>
  readdirSync(join(userData, 'Media'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f !== 'stills' && !f.startsWith(`stills${sep}`))
    .sort();

/** The words of a presentation's slides, as the library keeps them. */
const wordsOf = (win: Page, presentationId: string) =>
  win.evaluate(async (id) => {
    const opened = await (globalThis as PageGlobals).drashti.library.slidesForEdit(id);
    if (!opened.ok) throw new Error(opened.message);
    return opened.doc.groups.flatMap((g) =>
      g.slides.flatMap((s) => s.elements.flatMap((e) => (e.kind === 'text' ? [e.text] : []))),
    );
  }, presentationId);

/** A point on the slide (slide pixels) as a point in the editor's window. */
async function onCanvas(ed: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = ed.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (!box) throw new Error('no canvas');
  return { x: box.x + x * scale, y: box.y + y * scale };
}

test('Simple Mode’s right column: no keys line; Audio under LIVE, as Pro Mode’s: an audio playlist made and played there, playing on under a video and stepping aside', async () => {
  test.setTimeout(240_000);
  const { app, win, dir } = await start();
  const [musicId = '', talkId = ''] = await importAndGetIds(win, [
    tone(join(dir, 'Placeholder music.wav'), { seconds: 60, volume: 0.5 }),
    videoWithSound(join(dir, 'Placeholder talk.mp4'), 3),
  ]);
  await measured(win, [musicId, talkId]);
  const even = 10 ** (((await fileSound(win, musicId))?.gainDb ?? 0) / 20);
  await playlistWith(win, 'Placeholder audio sabha', [{ kind: 'media', mediaId: talkId }]);
  const simple = await toSimple(win);
  const right = simple.getByTestId('column-right');

  // No keys line: the bar's buttons show their keys.
  await expect(simple.getByTestId('simple-keys')).toHaveCount(0);
  await expect(right).not.toContainText('Keys:');
  // Audio in the right column, under LIVE's Next and Back, above the bar along the bottom.
  const group = right.getByTestId('audio-group');
  await expect(group).toBeVisible();
  const placed = await win.evaluate(() => {
    const at = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    const audio = at('audio-group');
    const next = at('show-next');
    const bar = at('simple-buttons');
    return audio && next && bar
      ? { underNext: audio.top >= next.bottom, aboveBar: audio.top < bar.top }
      : null;
  });
  expect(placed).toEqual({ underNext: true, aboveBar: true });
  await expectNoSeriousA11yIssues(win, 'Simple Mode’s Audio with none yet', '[data-testid="audio-group"]');

  // Create playlist, in Audio's empty place: named in place.
  await group.getByTestId('music-empty').getByRole('button', { name: 'Create playlist' }).click();
  const name = win.getByRole('textbox', { name: 'Name of the audio playlist' });
  await expect(name).toBeFocused();
  await name.fill('Placeholder before sabha');
  await name.press('Enter');
  const list = group.getByTestId('music-playlist').filter({ hasText: 'Placeholder before sabha' });
  await expect(list).toHaveAttribute('aria-current', 'true');
  // Add sounds…: the library's sounds, ticked.
  await group.getByTestId('music-add').click();
  const adding = win.getByTestId('music-add-dialog');
  await adding.getByRole('checkbox', { name: /^Placeholder music/u }).click();
  await expect(adding.getByRole('checkbox', { name: /^Placeholder music/u })).toBeChecked();
  await adding.getByTestId('music-add-ticked').click();
  await expect(adding).toHaveCount(0);
  await expect.poll(() => audioLists(win)).toEqual(['Placeholder before sabha: Placeholder music.wav']);

  // Play: the track plays on the audio player, at its even loudness.
  const audio = await audioPage(app);
  const music = audio.locator(`audio[data-media-id="${musicId}"]`);
  await group.getByTestId('music-play').click();
  await expect(music).toHaveCount(1);
  const playing = () => music.evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0);
  await expect.poll(playing).toBe(true);
  await expect.poll(() => gainOf(music)).toBeCloseTo(even, 2);
  await expect(group.getByTestId('music-now')).toContainText('Placeholder music');

  // A video with its own sound, from the playlist's row: the music plays on under it, fading down, never stopping.
  await simple.getByTestId('playlist-item').filter({ hasText: 'Placeholder talk' }).click();
  await expect(audio.locator(`audio[data-media-id="${talkId}"]`)).toHaveCount(1);
  await expect.poll(() => gainOf(music), { timeout: 5000 }).toBeLessThan(even * 0.25);
  expect(await playing()).toBe(true);
  await expect(audio.locator('body')).toHaveAttribute('data-aside', 'true');
  // The video ends (3 s): the music comes back up.
  await expect.poll(() => gainOf(music), { timeout: 10_000 }).toBeCloseTo(even, 2);
  expect(await playing()).toBe(true);

  // Forward 15 s, in Audio's row with Play and Pause (Music's own, as in Pro Mode).
  const forward = group.getByTestId('skip-forward');
  await expect(forward).toBeEnabled();
  const at = await music.evaluate((el: HTMLAudioElement) => el.currentTime);
  await forward.click();
  await expect.poll(() => music.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(at + 10);
  // Pause: it fades out and makes no sound (the audio player lets its element go); Play goes on from there.
  await group.getByTestId('music-pause').click();
  await expect(music).toHaveCount(0);
  // Paused where Forward 15 s took it.
  await expect.poll(async () => (await layers(win)).audio?.pausedAtMs ?? 0).toBeGreaterThan(10_000);
  await group.getByTestId('music-play').click();
  await expect.poll(async () => (await layers(win)).audio?.pausedAtMs).toBeUndefined();
  await expect(music).toHaveCount(1);
  await expect.poll(playing).toBe(true);

  // Music steps aside's switch: Simple Mode's too.
  const aside = group.getByTestId('music-steps-aside-switch');
  await expect(aside).toHaveAttribute('aria-checked', 'true');
  await aside.click();
  await expect(aside).toHaveAttribute('aria-checked', 'false');
  await aside.click();
  await expect(aside).toHaveAttribute('aria-checked', 'true');

  // Renamed, deleted, and put back with Undo, as in Pro Mode.
  await group.getByRole('button', { name: 'Rename “Placeholder before sabha”' }).click();
  const field = win.getByRole('textbox', { name: 'Name of the audio playlist' });
  await field.fill('Placeholder dhun');
  await field.press('Enter');
  await expect.poll(() => audioLists(win)).toEqual(['Placeholder dhun: Placeholder music.wav']);
  await group.getByTestId('music-delete').click();
  await win.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => audioLists(win)).toEqual([]);
  await expect.poll(async () => (await layers(win)).audio).toBeNull();
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect.poll(() => audioLists(win)).toEqual(['Placeholder dhun: Placeholder music.wav']);
  await expectNoSeriousA11yIssues(win, 'Simple Mode’s Audio with a list', '[data-testid="audio-group"]');
  await app.close();
});

test('a row’s Trim in Simple Mode saves and resets a cut; Trim black and silence with Undo, When it ends and Even loudness', async () => {
  test.setTimeout(240_000);
  const { app, win, dir, userData } = await start();
  const clip = edgesVideo(join(dir, 'Placeholder edges.mp4'));
  const bytes = readFileSync(clip);
  const [videoId = ''] = await importAndGetIds(win, [clip]);
  await measured(win, [videoId]);
  const playlistId = await playlistWith(win, 'Placeholder trim sabha', [{ kind: 'media', mediaId: videoId }]);
  const simple = await toSimple(win);
  const row = simple.getByTestId('playlist-item').filter({ hasText: 'Placeholder edges' });
  const itemId = await row.getAttribute('data-item-id');
  const rowMedia = () =>
    win.evaluate(
      async ({ playlistId, itemId }) => {
        const items = await (globalThis as PageGlobals).drashti.playlists.items(playlistId);
        const item = items.find((i) => i.id === itemId);
        return item?.kind === 'media' ? item.mediaId : null;
      },
      { playlistId, itemId },
    );
  const originalMarkers = await markersOf(win, videoId);

  // Its menu: Trim, Trim black and silence, Even loudness and When it ends, as Pro Mode's; Rename and Delete.
  await row.click({ button: 'right' });
  const menu = win.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Trim (start, end and markers)…',
    'Trim black and silence',
    'Rename…',
    'Remove from playlist',
  ]);
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText(['Even loudness']);
  await expect(menu.getByRole('menuitemradio')).toHaveText(
    ['Wallpaper', 'Next item', 'Loop', 'Freeze'].map((c) => `When it ends: ${c}`),
  );
  await expectNoSeriousA11yIssues(win, 'a video row’s menu in Simple Mode', '[role="menu"]');

  // Trim saves a cut for this row and keeps the named marker in it.
  await menu.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
  const dialog = win.getByTestId('markers-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('markers-save-mp4')).toHaveCount(0);
  await expect(dialog).not.toContainText('Save as MP4');
  await dialog.getByTestId('markers-start').fill('0:00.5');
  await dialog.getByTestId('markers-end').fill('0:04.0');
  const preview = dialog.locator('video');
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await preview.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 2;
  });
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 1);
  await dialog.getByTestId('marker-name').fill('Placeholder chorus');
  await dialog.getByTestId('marker-add').click();
  await expect(dialog.getByTestId('markers-list')).toContainText('Placeholder chorus');
  await dialog.getByTestId('markers-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator('[data-label]')).toHaveText('Placeholder edges trimmed.mp4', { timeout: 30_000 });
  const trimmedId = await rowMedia();
  if (trimmedId === null) throw new Error('The trimmed video is missing from its playlist.');
  expect(trimmedId).not.toBe(videoId);
  expect(await markersOf(win, trimmedId)).toMatchObject({
    startMs: null,
    endMs: null,
    markers: [{ name: 'Placeholder chorus', atMs: 1520 }],
  });
  expect(await markersOf(win, videoId)).toEqual(originalMarkers);

  // Freeze keeps this video up even if it ends while Trim is open.
  await row.click({ button: 'right' });
  await menu.getByRole('menuitemradio', { name: 'When it ends: Freeze' }).click();
  await row.click();
  await expect
    .poll(async () => (await layers(win)).background)
    .toMatchObject({
      kind: 'media',
      mediaId: trimmedId,
    });
  const reopenTrim = async () => {
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
  };
  const reset = dialog.getByRole('button', { name: 'Reset to original', exact: true });
  await reopenTrim();
  await reset.click();
  await expect(dialog.getByTestId('markers-problem')).toHaveText(
    'Take the video off before resetting this row.',
  );
  expect(await rowMedia()).toBe(trimmedId);
  expect((await layers(win)).background).toMatchObject({ kind: 'media', mediaId: trimmedId });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await simple.getByTestId('simple-clear-all').click();
  await reopenTrim();
  await reset.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(rowMedia).toBe(videoId);
  await expect(row.locator('[data-label]')).toHaveText('Placeholder edges.mp4');
  await row.click({ button: 'right' });
  const freeze = menu.getByRole('menuitemradio', { name: 'When it ends: Freeze' });
  await expect(freeze).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'When it ends: Wallpaper' }).click();

  // Trim black and silence moves the original’s playback points and offers Undo.
  const before = { media: (await listMedia(win)).length, files: mediaFiles(userData) };
  await row.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Trim black and silence' }).click();
  await expect(win.getByTestId('operator-notice')).toContainText('now plays from 0:01.5 to 0:04.5', {
    timeout: 30_000,
  });
  const points = await markersOf(win, videoId);
  expect(points.startMs).toBeGreaterThanOrEqual(1400);
  expect(points.startMs).toBeLessThanOrEqual(1600);
  expect(points.endMs).toBeGreaterThanOrEqual(4400);
  expect(points.endMs).toBeLessThanOrEqual(4600);
  expect(readFileSync(clip).equals(bytes)).toBe(true);
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Trimmed “Placeholder edges.mp4” past its black and silence');
  await undo.getByRole('button', { name: /Undo/u }).click();
  await expect.poll(() => markersOf(win, videoId)).toEqual(originalMarkers);

  // When it ends (Session 55, Part 6), ticked as the row has it: Wallpaper to begin with; Next item, then Wallpaper.
  const whenEnds = () =>
    win.evaluate(async (id) => {
      const items = await (globalThis as PageGlobals).drashti.playlists.items(id);
      const video = items.find((i) => i.kind === 'media');
      return video?.kind === 'media' ? (video.whenEnds ?? 'wallpaper') : null;
    }, playlistId);
  await row.click({ button: 'right' });
  await expect(win.getByRole('menuitemradio', { name: 'When it ends: Wallpaper' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await win.getByRole('menuitemradio', { name: 'When it ends: Next item' }).click();
  await expect.poll(whenEnds).toBe('next');
  await row.click({ button: 'right' });
  await win.getByRole('menuitemradio', { name: 'When it ends: Wallpaper' }).click();
  await expect.poll(whenEnds).toBe('wallpaper');

  // Even loudness: unticked, it plays as it is in its file; ticked again, at the even level.
  await row.click({ button: 'right' });
  await expect(win.getByRole('menuitemcheckbox', { name: 'Even loudness' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await win.getByRole('menuitemcheckbox', { name: 'Even loudness' }).click();
  await expect.poll(async () => (await fileSound(win, videoId))?.even).toBe(false);
  await row.click({ button: 'right' });
  await win.getByRole('menuitemcheckbox', { name: 'Even loudness' }).click();
  await expect.poll(async () => (await fileSound(win, videoId))?.even).toBe(true);

  // Trim black and silence works by moving playback points only.
  expect((await listMedia(win)).length).toBe(before.media);
  expect(mediaFiles(userData)).toEqual(before.files);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.media.saves())).toEqual([]);
  // Standalone Save as MP4 and Convert remain Pro Mode’s actions.
  const copies = await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const save = await d.media.saveTrim({ mediaId, startMs: 500, endMs: 4000, addToLibrary: true });
    const convert = await d.media.convert([mediaId]);
    return [save.ok ? 'saved' : save.message, convert.ok ? 'converted' : convert.message];
  }, videoId);
  expect(copies).toEqual([SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSAL]);
  await app.close();
});

test('Edit slides in Simple Mode opens Pro’s slide editor from a row: its save one Undo, a PDF page’s own words too; a presentation no playlist holds stays Pro Mode’s', async () => {
  test.setTimeout(240_000);
  const { app, win, dir } = await start({ DRASHTI_TEST_NO_CONVERTER: '1' }, { width: 1440, height: 900 });
  const original = 'Placeholder page words MMMMMMMMMM';
  const pdf = join(dir, 'Placeholder simple notes.pdf');
  writeFileSync(
    pdf,
    makeTestPdf([
      { width: 960, height: 540, color: [0, 0, 0], text: original },
      { width: 960, height: 540, color: [18, 52, 86], text: 'Placeholder second page' },
    ]),
  );
  const kirtan = join(dir, 'Placeholder Simple Kirtan.txt');
  writeFileSync(kirtan, '[Verse]\nPlaceholder line one\n\nPlaceholder line two\n');
  const [pdfId = '', kirtanId = ''] = await importAndGetIds(win, [pdf, kirtan]);
  expect(pdfId).not.toBe('');
  expect(kirtanId).not.toBe('');
  await playlistWith(win, 'Placeholder edit sabha', [
    { kind: 'presentation', presentationId: kirtanId },
    { kind: 'presentation', presentationId: pdfId },
  ]);
  const simple = await toSimple(win);
  const rowOf = (name: string) =>
    simple.locator('[data-testid="playlist-item"][data-kind="presentation"]').filter({ hasText: name });

  // The kirtan's row: Edit slides… opens Pro's slide editor, a window of its own.
  await rowOf('Placeholder Simple Kirtan').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Edit slides…' }).click();
  const { ed, editor } = await slideEditorWindow(app);
  await expect(ed).toHaveTitle(/Placeholder Simple Kirtan/u);
  // A change: the first slide's words taken away; saved, the window closes, and Simple Mode's Undo puts them back.
  const elements = editor.getByTestId('editor-slide').locator('[data-element]');
  await expect(elements).toHaveCount(1);
  const p = await onCanvas(ed, 960, 540);
  await ed.mouse.click(p.x, p.y);
  await expect(editor.getByTestId('editor-status')).toContainText('Text box');
  await ed.keyboard.press('Delete');
  await expect(elements).toHaveCount(0);
  await editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  expect(await wordsOf(win, kirtanId)).not.toContain('Placeholder line one');
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Edited the slides of “Placeholder Simple Kirtan”');
  await undo.getByRole('button', { name: /Undo/u }).click();
  await expect.poll(() => wordsOf(win, kirtanId)).toContain('Placeholder line one');

  // The PDF's row: its page's own words, as Pro Mode's editor has them (its source prepared), deleted and saved.
  await rowOf('Placeholder simple notes').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Edit slides…' }).click();
  const second = await slideEditorWindow(app);
  const words = second.editor
    .getByTestId('editor-slide')
    .locator('[data-element]')
    .filter({ hasText: original });
  await expect(words, 'the PDF page’s own words, an editable box').toHaveCount(1);
  await words.click();
  await second.ed.keyboard.press('Delete');
  await expect(words).toHaveCount(0);
  await second.editor.getByTestId('save-slides').click();
  await slideEditorClosed(app);
  expect(await wordsOf(win, pdfId)).not.toContain(original);

  // A presentation no playlist holds: its editor and its save stay Pro Mode's, whatever a page sends.
  const refused = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const other = (await d.library.listPresentations()).find((x) => x.name === 'Language test slides');
    if (!other) return ['no placeholder presentation'];
    const opened = await d.slideEditor.open(other.id, null);
    const slides = await d.library.slidesForEdit(other.id);
    if (!slides.ok) return [slides.message];
    const saved = await d.library.saveSlides(other.id, slides.doc, slides.stamp, false);
    return [opened.ok ? 'opened' : opened.message, saved.ok ? 'saved' : saved.message];
  });
  expect(refused).toEqual([SIMPLE_MODE_REFUSAL, SIMPLE_MODE_REFUSAL]);
  await app.close();
});

test('Simple Mode’s bar: Slide, Background and Audio beside Clear all, as Pro Mode’s, each taking its own layer off (and F2, F3 and F5)', async () => {
  test.setTimeout(150_000);
  const { app, win, dir } = await start();
  const [pictureId = '', soundId = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { color: '#1d4e89' }),
    makeTestTone(join(dir, 'Placeholder bell.wav'), { seconds: 30 }),
  ]);
  const presentationId = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  const simple = await toSimple(win);
  const bar = simple.getByTestId('simple-buttons');
  const clear = (layer: 'slide' | 'background' | 'audio') => bar.getByTestId(`simple-clear-${layer}`);
  const all = ['slide', 'background', 'audio'] as const;
  // Nothing up: each dimmed, saying so.
  for (const layer of all) {
    await expect(clear(layer)).toHaveAttribute('data-dimmed', 'true');
    await expect(clear(layer)).toHaveAccessibleName(new RegExp(`^Clear ${layer}`, 'u'));
  }
  /** A slide, a picture behind it, and a sound: each layer has something up. */
  const upAll = async () => {
    await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: pictureId, media: 'image', fit: 'fit', loop: false },
    });
    await dispatch(win, {
      type: 'playAudio',
      audio: { id: soundId, title: 'Placeholder bell', mediaId: soundId, volume: 1, loop: true },
    });
    await expect
      .poll(async () => {
        const l = await layers(win);
        return [l.slide !== null, l.background !== null, l.audio !== null];
      })
      .toEqual([true, true, true]);
  };
  const upNow = async () => {
    const l = await layers(win);
    return { slide: l.slide !== null, background: l.background !== null, audio: l.audio !== null };
  };
  await upAll();
  // In the order of their keys, beside Clear all, before the Wallpaper and Black-out; lit, with their keys.
  const names = await bar
    .locator('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  expect(names).toEqual([
    'simple-clear-all',
    'simple-clear-slide',
    'simple-clear-background',
    'simple-clear-audio',
    'simple-wallpaper',
    'simple-blackout',
  ]);
  for (const [layer, key] of [
    ['slide', 'F2'],
    ['background', 'F3'],
    ['audio', 'F5'],
  ] as const) {
    await expect(clear(layer)).toHaveAttribute('data-lit', 'true');
    await expect(clear(layer)).toHaveAccessibleName(new RegExp(`^Clear ${layer} \\(on screen\\)`, 'u'));
    await expect(clear(layer).locator('kbd')).toHaveText(key);
  }
  // Each takes its own layer off, and only it.
  await clear('slide').click();
  await expect.poll(upNow).toEqual({ slide: false, background: true, audio: true });
  await expect(clear('slide')).toHaveAttribute('data-dimmed', 'true');
  await clear('background').click();
  await expect.poll(upNow).toEqual({ slide: false, background: false, audio: true });
  await clear('audio').click();
  await expect.poll(upNow).toEqual({ slide: false, background: false, audio: false });
  // Their keys too, as the buttons show them.
  await upAll();
  await win.locator('body').click({ position: { x: 600, y: 8 } });
  await win.keyboard.press('F2');
  await expect.poll(upNow).toEqual({ slide: false, background: true, audio: true });
  await win.keyboard.press('F3');
  await expect.poll(upNow).toEqual({ slide: false, background: false, audio: true });
  await win.keyboard.press('F5');
  await expect.poll(upNow).toEqual({ slide: false, background: false, audio: false });
  await expectNoSeriousA11yIssues(win, 'Simple Mode’s bar', '[data-testid="simple-buttons"]');
  await app.close();
});

test('Simple Mode from CI’s 1024 × 645 up: Audio under the time bar and above the bar along the bottom, nothing under the status bar, the column scrolling when short', async () => {
  test.setTimeout(180_000);
  const { app, win, dir } = await start();
  const sounds = ['Placeholder one', 'Placeholder two', 'Placeholder three'].map((n, i) =>
    makeTestTone(join(dir, `${n}.wav`), { seconds: 30, hz: 330 + i * 110 }),
  );
  const ids = await importAndGetIds(win, [
    ...sounds,
    videoWithSound(join(dir, 'Placeholder long talk.mp4'), 60),
  ]);
  const videoId = ids[3] ?? '';
  // An audio playlist of three sounds, playing; a video playing from the playlist (the time bar shows both).
  await win.evaluate(
    async (soundIds) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.music.create('Placeholder before sabha');
      if (!list.ok || list.id === undefined) throw new Error('not made');
      await d.music.addTracks(list.id, soundIds, null);
      await d.music.play(list.id, 0);
    },
    ids.slice(0, 3),
  );
  await playlistWith(win, 'Placeholder layout sabha', [{ kind: 'media', mediaId: videoId }]);
  const simple = await toSimple(win);
  await simple.getByTestId('playlist-item').filter({ hasText: 'Placeholder long talk' }).click();
  await expect(simple.getByTestId('time-bar-row')).toHaveCount(2);
  const column = simple.getByRole('complementary', { name: 'Live', exact: true });

  for (const size of [CI_WINDOW, { width: 1280, height: 720 }, { width: 1440, height: 820 }]) {
    const where = `${String(size.width)} × ${String(size.height)}`;
    await sizeOperatorWindow(app, win, size);
    await column.evaluate((el) => {
      el.scrollTop = 0;
    });
    const problems = await win.evaluate(() => {
      const out: string[] = [];
      const at = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const live = at('[data-testid="simple-mode"] aside[aria-label="Live"]');
      const audio = at('[data-testid="audio-group"]');
      const times = at('[data-testid="time-bars"]');
      const bar = at('[data-testid="simple-buttons"]');
      const status = at('footer[aria-label="Status"]');
      if (!live || !audio || !times || !bar || !status) return ['a part is missing'];
      if (document.documentElement.scrollHeight > innerHeight + 1) {
        // Named: what is placed out of the flow below the window (it escapes any column's scroll), and where.
        const below = [...document.body.querySelectorAll('*')].filter((el) => {
          const r = el.getBoundingClientRect();
          const at = getComputedStyle(el).position;
          return r.height > 0 && r.bottom > innerHeight + 1 && (at === 'absolute' || at === 'fixed');
        });
        const what = below.slice(0, 3).map((el) => {
          const place = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
          const kind = el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
          return `${kind} in ${place}`;
        });
        out.push(
          `the page scrolls down to ${String(document.documentElement.scrollHeight)} px (${what.join(', ')})`,
        );
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
      if (audio.top < times.bottom - 0.5) out.push('Audio is not under the time bar');
      if (live.bottom > bar.top + 0.5) out.push('the right column runs under the bar along the bottom');
      if (bar.bottom > status.top + 0.5) out.push('the bar runs under the status bar');
      if (status.bottom > innerHeight + 0.5) out.push('the status bar is cut off');
      if (audio.left < live.left - 0.5 || audio.right > live.right + 0.5)
        out.push('Audio sticks out of its column');
      return out;
    });
    expect(problems, where).toEqual([]);
    // Short, the column scrolls on its own: its last button comes into sight above the bar.
    const last = simple.getByTestId('music-add');
    await last.scrollIntoViewIfNeeded();
    await expect(last, where).toBeInViewport({ ratio: 1 });
    const above = await last.evaluate((el) => {
      const bar = document.querySelector('[data-testid="simple-buttons"]')?.getBoundingClientRect();
      return bar !== undefined && el.getBoundingClientRect().bottom <= bar.top + 0.5;
    });
    expect(above, where).toBe(true);
    if (size.height <= CI_WINDOW.height)
      expect(await column.evaluate((el) => el.scrollHeight > el.clientHeight), where).toBe(true);
    // Back at its top, Next and Back are whole and in sight.
    await column.evaluate((el) => {
      el.scrollTop = 0;
    });
    for (const id of ['show-back', 'show-next'])
      await expect(simple.getByTestId(id), `${id} at ${where}`).toBeInViewport({ ratio: 1 });
  }
  await app.close();
});
