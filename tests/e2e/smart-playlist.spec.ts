import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineCommand } from '../../src/shared/engine/commands';
import {
  makeTestDeck,
  placeholderDeckMedia,
  type TestDeckSlide,
} from '../../src/main/import/testing/make-deck';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  holdStill,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  relaunchApp,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * A smart playlist following a folder (Session 26c): a temporary folder of
 * placeholder files, with subfolders. Files are added, taken away and
 * changed while Drashti runs and while it is closed, and the playlist is
 * checked each time. The test switches make Drashti look every second and
 * wait half a second for a file to hold still.
 *
 * And (Session 57, Q57-25 and Q57-27; Session 58, NT-4) what its import does to a video playing: a deck in the folder,
 * changed, brings its video's new start point while that video plays behind the operator's slides. Nothing moves on
 * the screens; Next onto a slide with the same video carries on between the points it had; its next play takes the
 * new ones. Generated media, a deck and a presentation written by code, placeholder names only.
 */

const QUICK = { DRASHTI_TEST_SMART_SCAN_MS: '1000', DRASHTI_TEST_SMART_SETTLE_MS: '500' };

const ffmpeg = testFfmpeg();

/** A one-second placeholder video (FFmpeg's test pattern), each size a different file. */
function makeVideo(path: string, size: string): void {
  const r = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${size}:r=25`,
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
}

/**
 * The open playlist's whole order, as it is kept: "# Header", "Name", "Name (not in the folder)". Read from the
 * playlist itself (Session 44: the window shows a folder playlist a folder at a time, folder-playlists.spec.ts).
 */
const shown = (win: Page) =>
  win.evaluate(async () => {
    const open = document.querySelector('[data-testid="playlist-node"][data-open="true"]');
    const items = await (globalThis as PageGlobals).drashti.playlists.items(
      open?.getAttribute('data-node-id') ?? '',
    );
    return items.map((i) => {
      if (i.kind === 'header') return `# ${i.label}`;
      return 'gone' in i && i.gone === true ? `${i.label} (not in the folder)` : i.label;
    });
  });

test('a smart playlist follows a folder: files added, taken away and changed, in subfolders too, before and after a restart (Session 26c)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-smart-e2e-'));
  const folder = join(work, 'Placeholder Sabha');
  mkdirSync(join(folder, 'Week 1'), { recursive: true });
  const { app, userData } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  makeVideo(join(folder, 'Opening.mp4'), '320x180');
  writeFileSync(
    join(folder, 'Notice.pdf'),
    makeTestPdf([{ width: 960, height: 540, color: [20, 83, 45], text: 'Notice' }]),
  );
  await makeTestImage(win, join(folder, 'Week 1', 'Darshan.png'), { color: '#7c2d12' });
  makeVideo(join(folder, 'Week 1', 'Clip.mp4'), '352x198');
  // Not what a smart playlist takes: words, and a hidden file.
  writeFileSync(join(folder, 'Read me.txt'), 'placeholder words');
  await makeTestImage(win, join(folder, '.hidden.png'), { color: '#000000' });

  // + New › Smart Playlist from a Folder…
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  await expect(title).toHaveText('Placeholder Sabha');
  const node = win.getByTestId('playlist-node').first();
  await expect(node).toHaveAttribute('data-playlist-kind', 'smart');
  await expect(win.getByTestId('smart-folder')).toHaveText(folder);
  // It fills itself, in the folder's order: each folder's videos, then decks, then pictures.
  await expect
    .poll(() => shown(win), { timeout: 120_000 })
    .toEqual(['Opening.mp4', 'Notice', '# Week 1', 'Clip.mp4', 'Darshan.png']);
  await expect(win.getByTestId('smart-state')).toHaveText('What goes in the folder joins by itself.');
  await expectNoSeriousA11yIssues(win, 'a smart playlist', '[data-testid="open-playlist"]');

  // Moved by hand: Darshan first. It stays there.
  const playlistId = (await node.getAttribute('data-node-id')) ?? '';
  const items = () =>
    win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), playlistId);
  const darshan = (await items()).find((i) => i.label === 'Darshan.png');
  await win.evaluate(
    ({ id, item }) => (globalThis as PageGlobals).drashti.playlists.moveItems(id, [item], 0),
    { id: playlistId, item: darshan?.id ?? '' },
  );
  await expect
    .poll(() => shown(win))
    .toEqual(['Darshan.png', 'Opening.mp4', 'Notice', '# Week 1', 'Clip.mp4']);

  // Added: each joins at the end of its folder's part; a new subfolder gets a part of its own.
  makeVideo(join(folder, 'Week 1', 'Later.mp4'), '384x216');
  mkdirSync(join(folder, 'Week 2', 'Pictures'), { recursive: true });
  await makeTestImage(win, join(folder, 'Week 2', 'Pictures', 'Cover.png'), { color: '#1e3a8a' });
  await expect
    .poll(() => shown(win), { timeout: 60_000 })
    .toEqual([
      'Darshan.png',
      'Opening.mp4',
      'Notice',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
    ]);

  // On the screens: changing its file never touches what is up.
  const cover = (await items()).find((i) => i.label === 'Cover.png');
  await win.evaluate(
    ({ playlistId, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId, itemId }),
    { playlistId, itemId: cover?.id ?? '' },
  );
  const up = () =>
    win.evaluate(async () => {
      const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
      return bg?.kind === 'media' ? bg.mediaId : null;
    });
  const coverMedia = cover?.kind === 'media' ? cover.mediaId : '';
  await expect.poll(up).toBe(coverMedia);

  // Changed: imported again, its item replaced in place (the same item, now the new picture).
  await makeTestImage(win, join(folder, 'Week 2', 'Pictures', 'Cover.png'), {
    color: '#a16207',
    width: 96,
  });
  await expect
    .poll(
      async () => {
        const now = (await items()).find((i) => i.id === cover?.id);
        return now?.kind === 'media' ? now.mediaId : null;
      },
      { timeout: 60_000 },
    )
    .not.toBe(coverMedia);
  expect((await items()).map((i) => i.id)).toContain(cover?.id);
  expect(await up()).toBe(coverMedia);

  // Taken away: marked, not removed.
  rmSync(join(folder, 'Notice.pdf'));
  await expect
    .poll(() => shown(win), { timeout: 30_000 })
    .toEqual([
      'Darshan.png',
      'Opening.mp4',
      'Notice (not in the folder)',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
    ]);
  await expect(win.getByTestId('smart-remove-missing')).toHaveText('Remove the missing (1)');
  const clipItem = (await items()).find((i) => i.label === 'Clip.mp4');
  await app.close();

  // Closed: a file added, one changed and one taken away; Drashti catches up when it starts.
  makeVideo(join(folder, 'Week 2', 'While closed.mp4'), '416x234');
  const clip = readFileSync(join(folder, 'Week 1', 'Clip.mp4'));
  rmSync(join(folder, 'Week 1', 'Clip.mp4'));
  makeVideo(join(folder, 'Week 1', 'Clip.mp4'), '448x252');
  expect(readFileSync(join(folder, 'Week 1', 'Clip.mp4')).equals(clip)).toBe(false);
  rmSync(join(folder, 'Opening.mp4'));
  const again = await relaunchApp(userData, QUICK);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await win2.setViewportSize({ width: 1280, height: 720 });
  await win2.getByTestId('playlist-node').first().click();
  await expect
    .poll(() => shown(win2), { timeout: 60_000 })
    .toEqual([
      'Darshan.png',
      'Opening.mp4 (not in the folder)',
      'Notice (not in the folder)',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
      '# Week 2',
      'While closed.mp4',
    ]);
  // The changed clip is the new one, in the same item.
  const after = await win2.evaluate(
    (id) => (globalThis as PageGlobals).drashti.playlists.items(id),
    playlistId,
  );
  const clipNow = after.find((i) => i.id === clipItem?.id);
  expect(
    clipNow?.kind === 'media' && clipItem?.kind === 'media' && clipNow.mediaId !== clipItem.mediaId,
  ).toBe(true);

  // The folder gone (a USB stick taken out): said plainly, the items kept; back, it carries on.
  renameSync(folder, join(work, 'Away'));
  await expect(win2.getByTestId('smart-bar')).toHaveAttribute('data-state', 'folder-gone', {
    timeout: 30_000,
  });
  await expect(win2.getByTestId('smart-state')).toContainText('The folder is not there');
  expect(await shown(win2)).toHaveLength(10);
  renameSync(join(work, 'Away'), folder);
  await expect(win2.getByTestId('smart-bar')).toHaveAttribute('data-state', 'following', { timeout: 30_000 });

  // One button takes out the missing; Undo brings them back, still marked.
  await win2.getByTestId('smart-remove-missing').click();
  await expect
    .poll(() => shown(win2))
    .toEqual([
      'Darshan.png',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
      '# Week 2',
      'While closed.mp4',
    ]);
  await expect(win2.getByTestId('smart-remove-missing')).toHaveCount(0);
  await win2.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect.poll(() => shown(win2)).toContain('Notice (not in the folder)');
  await expect(win2.getByTestId('smart-remove-missing')).toHaveText('Remove the missing (2)');
  await again.app.close();
  rmSync(work, { recursive: true, force: true });
});

/** The show as the engine has it, for the window. */
const engineState = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

async function dispatch(win: Page, command: EngineCommand): Promise<void> {
  const done = await win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
  expect(done.ok, `${command.type} was refused`).toBe(true);
}

/** What says where the video behind the slides is: its file, when it started, any jump, and its points. */
async function backdrop(win: Page) {
  const bg = (await engineState(win)).layers.background;
  if (bg?.kind !== 'media') return null;
  return { mediaId: bg.mediaId, startedAt: bg.startedAt, seek: bg.seek ?? null, clip: bg.clip ?? null };
}

/**
 * A PowerPoint deck of one slide whose video (`video`, embedded) plays by itself and loops, trimmed by `startMs` at its
 * start as PowerPoint trims (nothing off its end): a deck brings its videos' trims in as the file's points (Session 54).
 */
function trimmedDeck(path: string, video: string, poster: string, startMs: number): void {
  const slide: TestDeckSlide = {
    key: 'trimmed',
    bg: '111111',
    transition: { kind: 'fade', dur: 500 },
    notes: 'Placeholder notes: the backdrop video, trimmed at its start.',
    shapes: [
      {
        id: 2,
        type: 'video',
        name: 'Placeholder backdrop',
        media: 'clip1',
        poster: 'poster1',
        x: 1_524_000,
        y: 857_250,
        w: 9_144_000,
        h: 5_143_500,
        trim: { st: startMs, end: 0 },
        loop: true,
      },
    ],
    effects: [{ kind: 'play', target: 2, dur: 6000, start: 'after' }],
  };
  const media = { ...placeholderDeckMedia(), clip1: readFileSync(video), poster1: readFileSync(poster) };
  writeFileSync(path, makeTestDeck([slide], media));
}

const words = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

test('a deck a smart playlist imports again never moves the video playing: no jump, Next carries on between its points, its next play takes the new ones (Q57-25, Q57-27)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-smart-points-'));
  const folder = join(work, 'Placeholder Followed');
  mkdirSync(folder);
  // No picture converter: the deck comes in as Drashti plays it, its video and trim with it (as without Office).
  const { app } = await launchApp({ ...QUICK, DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const video = await makeTestVideo(win, join(work, 'Placeholder backdrop.mp4'), { seconds: 6, h264: true });
  const poster = await makeTestImage(win, join(work, 'Placeholder poster.png'), { color: '#1e3a8a' });

  // The operator's own imports: the video, with no points of its own, and a presentation whose two slides have it
  // behind them.
  const [mediaId = ''] = await importAndGetIds(win, [video]);
  const shared = join(work, 'Placeholder Shared Backdrop.pro6');
  writeFileSync(
    shared,
    pp6Presentation({
      uuid: 'E2E-SMART-POINTS',
      groups: [
        {
          name: 'Verse',
          slides: [
            { background: { path: video, kind: 'video', loop: true }, ...words('Placeholder first words') },
            { background: { path: video, kind: 'video', loop: true }, ...words('Placeholder second words') },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [shared]);
  const points = () => win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), mediaId);
  expect(await points()).toMatchObject({ startMs: null, endMs: null });

  // A smart playlist follows a folder holding a deck that plays the same video trimmed by 1 s: the deck comes in by
  // itself, and the file takes that start point.
  const deck = join(folder, 'Placeholder Trimmed Deck.pptx');
  trimmedDeck(deck, video, poster, 1000);
  const made = await win.evaluate(
    (f) => (globalThis as PageGlobals).drashti.playlists.createSmartFrom([f]),
    folder,
  );
  expect(made).toMatchObject({ problems: [], files: [] });
  const labels = () =>
    win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.label),
      made.made[0] ?? '',
    );
  await expect.poll(labels, { timeout: 120_000 }).toEqual(['Placeholder Trimmed Deck']);
  const OLD = { startMs: 1000, endMs: null };
  const NEW = { startMs: 2500, endMs: null };
  await expect.poll(points, { timeout: 30_000 }).toMatchObject(OLD);

  // Up: the first slide, the video behind it playing between the points it has now.
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  const before = await engineState(win);
  const playing = await backdrop(win);
  expect(playing).toMatchObject({ mediaId, clip: OLD });

  // The deck changes in the folder (its video now trimmed by 2.5 s): the smart playlist imports it again by itself,
  // and the file takes the new point. Its notice, the one naming the file (in whatever words), comes once that import
  // has finished and the show has heard of it.
  const named = win.getByTestId('import-notice').filter({ hasText: 'Placeholder backdrop.mp4' });
  await expect(named).toHaveCount(0);
  trimmedDeck(deck, video, poster, 2500);
  await expect(named).toBeVisible({ timeout: 120_000 });
  expect(await points()).toMatchObject(NEW);

  // No jump: the video keeps its time and the points it was playing between, on every screen, and nothing goes up
  // again.
  const after = await engineState(win);
  expect(await backdrop(win)).toEqual(playing);
  expect(after.layers.slide).toMatchObject({
    presentationId,
    slideIndex: 0,
    shownAt: before.layers.slide?.shownAt,
  });
  await holdStill(
    async () => JSON.stringify(await backdrop(win)) === JSON.stringify(playing),
    1500,
    'the video playing keeps its time and its points after the import',
  );

  // Next, onto the slide with the same video behind it: the video carries on, between the same points.
  await dispatch(win, { type: 'next' });
  expect((await engineState(win)).layers.slide).toMatchObject({ presentationId, slideIndex: 1 });
  expect(await backdrop(win)).toEqual(playing);

  // Its next play takes the new point.
  await dispatch(win, { type: 'clearAll' });
  expect(await backdrop(win)).toBeNull();
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  const again = await backdrop(win);
  expect(again).toMatchObject({ mediaId, clip: NEW });
  expect(again?.startedAt).toBeGreaterThan(playing?.startedAt ?? Infinity);
  await app.close();
  rmSync(work, { recursive: true, force: true });
});
