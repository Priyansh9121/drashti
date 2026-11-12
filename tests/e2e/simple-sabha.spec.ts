import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_IMPORT_LEFT_OUT, SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropboxStandIn, fileLink } from './dropbox-stand-in';
import { clearOfShowControls, expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { dropFiles, launchApp, operatorPage, operatorReady, outputPages } from './helpers';
import { mouseDrag } from './mouse-drag';
import { pasteLink } from './paste-link';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage, makeTestTone } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Simple Mode for a one-projector sabha (Session 55, Part 18, the owner's words of 29 Oct 2026): Pro Mode's window
 * with everything taken out but one playlist (the one open when Drashti switched to Simple Mode, or a new one when
 * there was none: PDFs and decks as rows, pictures, videos and sounds, moved about by dragging), bringing things into
 * it (Add files…, files dropped, From a Link…), the wallpapers, Next and Back, Clear all, Black-out, the Wallpaper
 * and the time bar, and a row's Rename and Delete from the right-click menu (since Session 56 also Pro Mode's
 * Audio, Slide, Background and Audio beside Clear all, and a row's Trim, When it ends and Edit slides:
 * simple-pro-parts.spec.ts). Nothing else: no stream, no stage controls, no messages, timers or lower thirds, no
 * screen setup. Back to Pro Mode with a double-click on Pro Mode, nothing typed. The main process lets Simple Mode
 * change its one playlist only. Generated pictures and sounds and placeholder names only; From a Link… through a
 * local stand-in, never the internet.
 */

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());
const onePlaylist = (win: Page) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist());

/** The system's file dialog answers with these files (as a person choosing them would). */
async function dialogPicks(app: ElectronApplication, files: string[]): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: chosen });
  }, files);
}

/** Into Simple Mode by the header's button, as a person does. */
async function intoSimple(win: Page): Promise<Locator> {
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  return simple;
}

/** The one playlist's rows' names, as the middle shows them. */
const rowNames = (middle: Locator) => middle.getByTestId('playlist-item').locator('[data-label]');

test('Pro Mode’s window with only what a one-projector sabha needs: the playlist open when it switched, in the middle; the playlists and the wallpapers; LIVE, Next and Back, the time bar and Audio; Clear all, Slide, Background and Audio, the Wallpaper and Black-out', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  const show = await setUpPlaceholderShow(win, { video: true });
  // The playlist open in Pro Mode when Drashti switches is Simple Mode's one playlist.
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  const simple = await intoSimple(win);
  expect(await onePlaylist(win)).toBe(show.playlistId);

  // Pro Mode's columns: the playlist open as it switched in the middle (its rows as Part 4 made them), and since Session
  // 56 (the owner's item 14) the playlists on the left, as in Pro Mode, that one marked open.
  const middle = simple.getByTestId('column-middle');
  await expect(middle.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  await expect(middle.getByTestId('playlist-item')).toHaveCount(6);
  const left = simple.getByTestId('column-left');
  await expect(left.getByTestId('playlist-tree')).toBeVisible();
  await expect(left.getByTestId('playlist-node').filter({ hasText: PLAYLIST })).toHaveAttribute(
    'data-open',
    'true',
  );
  await expect(simple.getByTestId('simple-playlist')).toHaveCount(0);
  // The wallpapers on the left, under the playlists, as in Pro Mode (Part 6).
  await expect(left.getByTestId('wallpapers')).toBeVisible();
  // LIVE, Next and Back on the right, and Audio under them (Session 56, the owner: Pro Mode's own).
  const right = simple.getByTestId('column-right');
  await expect(right.getByTestId('live-preview')).toBeVisible();
  await expect(right.getByTestId('show-next')).toBeVisible();
  await expect(right.getByTestId('show-back')).toBeVisible();
  await expect(right.getByTestId('audio-group')).toBeVisible();
  // Along the bottom: Clear all, Slide, Background and Audio beside it (Session 56), the Wallpaper and Black-out, and
  // no other clear.
  const bar = simple.getByTestId('simple-buttons');
  await expect(bar.getByRole('button')).toHaveText([
    /^Clear all/u,
    /^Slide/u,
    /^Background/u,
    /^Audio/u,
    /^Wallpaper/u,
    /^Black-out/u,
  ]);

  // Nothing else: no stream, phones, screens or library; no stage, messages, timers or lower thirds (More tools); no
  // Oops button, no playlist's menu, no Close.
  for (const name of [
    'Stream',
    'Phones',
    'Screens',
    'Library',
    'Oops',
    'Close the playlist',
    'Playlist actions',
  ])
    await expect(win.getByRole('button', { name, exact: true }), name).toHaveCount(0);
  for (const id of [
    'group-stage-toggle',
    'group-messages-toggle',
    'group-timers-toggle',
    'group-more-tools-toggle',
    'layer-bar',
    'playlist-close',
    'show-oops',
  ])
    await expect(win.getByTestId(id), id).toHaveCount(0);
  // No trash on the playlist's rows (Simple Mode's Delete is a row's right-click); the chosen playlist on the left has
  // its Delete, as in Pro Mode (Session 56).
  await expect(middle.getByTestId('row-delete')).toHaveCount(0);

  // One click on a slide's row puts it up; Next and Back go on from it.
  const kirtan = middle.getByTestId('slide-thumb').filter({ hasText: 'Placeholder Kirtan_2' });
  await kirtan.click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  await right.getByTestId('show-next').click();
  await expect(win.getByTestId('live-text')).toContainText('slide 3 of 5');
  await right.getByTestId('show-back').click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');
  // The video's row: it plays, its time bar on the right.
  await middle.getByTestId('playlist-item').filter({ hasText: 'Placeholder clip' }).click();
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ mediaId: show.videoMediaId });
  await expect(right.getByTestId('time-bars')).toBeVisible();

  // Clear all, then Put it back; Black-out and the Wallpaper, on and off, each taking the video off as it goes on, and
  // the video's row putting it up again, taking them off (Session 56, the owner's words: LIVE shows one thing at a
  // time; until then they covered it, playing on).
  await bar.getByTestId('simple-clear-all').click();
  await expect.poll(async () => (await state(win)).layers.background).toBeNull();
  await bar.getByTestId('simple-put-back').click();
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ mediaId: show.videoMediaId });
  await bar.getByTestId('simple-blackout').click();
  await expect.poll(async () => (await state(win)).blackout).toBe(true);
  await expect(bar.getByTestId('simple-blackout')).toHaveText(/^Black-out is on/u);
  await expect.poll(async () => (await state(win)).layers.background).toBeNull();
  await bar.getByTestId('simple-blackout').click();
  await expect.poll(async () => (await state(win)).blackout).toBe(false);
  await bar.getByTestId('simple-wallpaper').click();
  await expect.poll(async () => (await state(win)).wallpaper).toBe(true);
  await bar.getByTestId('simple-wallpaper').click();
  await expect.poll(async () => (await state(win)).wallpaper).toBe(false);
  await bar.getByTestId('simple-wallpaper').click();
  await expect.poll(async () => (await state(win)).wallpaper).toBe(true);
  await middle.getByTestId('playlist-item').filter({ hasText: 'Placeholder clip' }).click();
  await expect.poll(async () => (await state(win)).wallpaper).toBe(false);
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ mediaId: show.videoMediaId });

  // It fits 1280 × 720 and CI's 1024 × 645, nothing cut off, and passes the accessibility checks.
  await expectFits(simple, 'Simple Mode at 1280 × 720');
  await expectNoSeriousA11yIssues(win, 'Simple Mode at 1280 × 720');
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await expectFits(simple, 'Simple Mode at 1024 × 645');
  await expect(win.getByTestId('simple-leave')).toBeInViewport({ ratio: 1 });
  for (const id of ['simple-clear-all', 'simple-wallpaper', 'simple-blackout', 'show-next', 'show-back'])
    await expect(win.getByTestId(id), id).toBeInViewport({ ratio: 1 });
  await expectNoSeriousA11yIssues(win, 'Simple Mode at 1024 × 645');

  // Back to Pro Mode: one click is not enough; a double-click on Pro Mode, with nothing typed and nothing asked.
  const pro = win.getByTestId('simple-leave');
  await expect(pro).toContainText('Pro Mode');
  await pro.click();
  await expect(simple).toBeVisible();
  expect(await modeOf(win)).toBe('simple');
  await pro.dblclick();
  await expect(simple).toHaveCount(0);
  expect(await modeOf(win)).toBe('pro');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await app.close();
});

test('none open: a new playlist; Add files… and files dropped bring in only what a sabha plays; a row dragged, Rename and Delete, each with Undo; the wallpapers; nothing of a playlist that is Pro Mode’s, whoever asks', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  // Another playlist, never opened: Simple Mode must not take it, or change it.
  const other = await setUpPlaceholderShow(win);
  const simple = await intoSimple(win);
  const one = await onePlaylist(win);
  expect(one).not.toBeNull();
  expect(one).not.toBe(other.playlistId);
  const tree = await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
  // Named for the day it was made, at the top of Pro Mode's list.
  expect(tree.find((n) => n.id === one)?.name).toMatch(/^Sabha, \d{1,2} \w{3} \d{4}$/u);
  const middle = simple.getByTestId('column-middle');
  await expect(middle.getByTestId('playlist-title')).toHaveText(/^Sabha, /u);
  await expect(middle.getByTestId('playlist-item')).toHaveCount(0);

  // Add files…: a picture and a sound in; lyrics left out, saying why (Simple Mode makes no presentation of words).
  const dir = mkdtempSync(join(tmpdir(), 'drashti-simple-'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder simple picture.png'), { color: '#7c2d12' });
  const tone = makeTestTone(join(dir, 'Placeholder simple tone.wav'), { seconds: 2, hz: 440 });
  const lyrics = join(dir, 'Placeholder simple lyrics.txt');
  writeFileSync(lyrics, 'Placeholder line one\n');
  await dialogPicks(app, [picture, tone, lyrics]);
  await middle.getByTestId('playlist-add-files').click();
  await expect(rowNames(middle)).toHaveText([
    'Placeholder simple picture.png',
    'Placeholder simple tone.wav',
  ]);
  const notice = win.getByTestId('operator-notice');
  await expect(notice).toContainText('Placeholder simple lyrics.txt');
  await expect(notice).toContainText(SIMPLE_IMPORT_LEFT_OUT);
  const presentations = await win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name),
  );
  expect(presentations).not.toContain('Placeholder simple lyrics');

  // Files dropped on a row land there; dropped anywhere else, at the end.
  const second = await makeTestImage(win, join(dir, 'Placeholder dropped picture.png'), { color: '#1e3a8a' });
  await dropFiles(win, middle.getByTestId('playlist-item').first(), [second], { overlay: false, at: 'top' });
  await expect(rowNames(middle)).toHaveText([
    'Placeholder dropped picture.png',
    'Placeholder simple picture.png',
    'Placeholder simple tone.wav',
  ]);
  const third = makeTestTone(join(dir, 'Placeholder dropped tone.wav'), { seconds: 1, hz: 660 });
  await dropFiles(win, simple.getByTestId('column-right'), [third], { overlay: false });
  await expect(rowNames(middle)).toHaveText([
    'Placeholder dropped picture.png',
    'Placeholder simple picture.png',
    'Placeholder simple tone.wav',
    'Placeholder dropped tone.wav',
  ]);

  // Moved about by dragging, with Undo.
  const items = middle.getByTestId('playlist-item');
  await mouseDrag(win, items.nth(2), items.first(), 'top');
  await expect(rowNames(middle).first()).toHaveText('Placeholder simple tone.wav');
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(rowNames(middle).first()).toHaveText('Placeholder dropped picture.png');

  // The right-click menu: Rename… and Delete only, each with Undo.
  const pictureRow = items.filter({ hasText: 'Placeholder simple picture' });
  await pictureRow.click({ button: 'right' });
  await expect(win.getByRole('menu').getByRole('menuitem')).toHaveText(['Rename…', 'Remove from playlist']);
  await win.getByRole('menuitem', { name: 'Rename…' }).click();
  await win.getByTestId('rename-field').fill('Placeholder renamed picture');
  await win.getByTestId('rename-save').click();
  await expect(rowNames(middle).nth(1)).toHaveText(/^Placeholder renamed picture/u);
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(rowNames(middle).nth(1)).toHaveText(/^Placeholder simple picture/u);
  await items.filter({ hasText: 'Placeholder simple picture' }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Remove from playlist' }).click();
  await expect(items).toHaveCount(3);
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(items).toHaveCount(4);

  // The wallpapers (Part 6): Import…, a click chooses one; their menu, Rename… and Delete….
  const backdrop = await makeTestImage(win, join(dir, 'Placeholder wallpaper.png'), { color: '#365314' });
  await dialogPicks(app, [backdrop]);
  const wallpapers = simple.getByTestId('wallpapers');
  await wallpapers.getByTestId('wallpapers-import').click();
  const tile = wallpapers.getByTestId('wallpaper-tile').filter({ hasText: 'Placeholder wallpaper' });
  await expect(tile).toHaveCount(1);
  await tile.click();
  await expect
    .poll(async () => (await state(win)).chosenWallpaper?.name ?? null)
    .toBe('Placeholder wallpaper');
  await tile.click({ button: 'right' });
  await expect(win.getByRole('menu').getByRole('menuitem')).toHaveText(['Rename…', 'Delete…']);
  await win.keyboard.press('Escape');

  // The main process lets Simple Mode change the playlists as Pro Mode's left column does (Session 56), never what of
  // them is Pro Mode's, whatever a page sends: Duplicate, a template, a slot, sharing with phones, a row's timers.
  const refused = await win.evaluate(async (otherId) => {
    const d = (globalThis as PageGlobals).drashti;
    const [first] = await d.playlists.items(otherId);
    return {
      duplicate: await d.playlists.duplicate(otherId),
      template: await d.playlists.saveAsTemplate(otherId, { name: 'Placeholder template', slots: [] }),
      slot: await d.playlists.addSlot(otherId, null, { label: 'Placeholder slot', category: null }),
      share: await d.playlists.share(otherId, true),
      timers: await d.playlists.setTimers(first?.id ?? '', []),
    };
  }, other.playlistId);
  const no = { ok: false, message: SIMPLE_MODE_REFUSAL };
  expect(refused).toMatchObject({
    duplicate: no,
    template: no,
    slot: no,
    share: no,
    timers: no,
  });
  expect(
    (await win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), other.playlistId))
      .length,
  ).toBe(5);
  // Nothing was made: no copy, no template.
  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return [...(await d.playlists.tree()), ...(await d.playlists.templates())].map((n) => n.name);
  });
  expect(made.filter((n) => n === 'Placeholder template' || n.endsWith(' copy'))).toEqual([]);
  await app.close();
});

test('From a Link…: pasting a Dropbox link imports it into the open playlist; a local stand-in, never the internet', async () => {
  test.setTimeout(150_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-simple-link-'));
  const tone = makeTestTone(join(work, 'Placeholder link tone.wav'), { seconds: 2, hz: 523 });
  const standIn = await dropboxStandIn(
    { toneSSSSSSSSSSS: { name: 'Placeholder link tone.wav', body: readFileSync(tone), type: 'audio/wav' } },
    {},
  );
  try {
    const { app } = await launchApp({
      DRASHTI_TEST_LINK_ORIGIN: standIn.origin,
      DRASHTI_TEST_DOWNLOADS_DIR: join(work, 'Downloads'),
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
    const simple = await intoSimple(win);
    const middle = simple.getByTestId('column-middle');
    await middle.getByTestId('playlist-from-link').click();
    await pasteLink(win, fileLink('toneSSSSSSSSSSS', 'Placeholder link tone.wav'));
    await expect(win.getByTestId('import-report')).toHaveCount(0);
    await expect(rowNames(middle)).toHaveText([/^Placeholder link tone/u], { timeout: 60_000 });
    expect(standIn.requests.every((r) => r.host.includes('dropbox'))).toBe(true);
    await app.close();
  } finally {
    await standIn.close();
  }
});

test('a projector plugged in while Simple Mode is on: used at once for the audience, said in a line over none of its controls, the chosen wallpaper on it; Simple Mode still fits 1024 × 645 and 1280 × 720', async () => {
  test.setTimeout(150_000);
  // Part 1's pretend displays: one plugged in while Drashti runs, set by itself, nothing asked.
  const { app } = await launchApp({
    DRASHTI_TEST_AUTO_SCREENS: 'pretend',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_DISPLAY_CHANGES: '1',
    DRASHTI_TEST_DISPLAY_SERIALS: 'PJ-A,PJ-B',
    DRASHTI_TEST_KEEP_SCREENS: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const simple = await intoSimple(win);
  // A wallpaper brought in and chosen in Simple Mode (Part 6), before the projector comes.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-simple-projector-'));
  const backdrop = await makeTestImage(win, join(dir, 'Placeholder projector wallpaper.png'), {
    color: '#0f766e',
  });
  await dialogPicks(app, [backdrop]);
  await simple.getByTestId('wallpapers-import').click();
  const tile = simple.getByTestId('wallpaper-tile').filter({ hasText: 'Placeholder projector wallpaper' });
  await tile.click();
  await expect
    .poll(async () => (await state(win)).chosenWallpaper?.name ?? null)
    .toBe('Placeholder projector wallpaper');
  // Plugged in: the audience picture at once, said in one line, with no Change… (Simple Mode changes no screen).
  await app.evaluate((_electron, n) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(n);
  }, 1);
  const said = win.getByTestId('screens-said');
  await expect(said.getByTestId('screens-said-text')).toHaveText(
    '“Extra display 1” shows the audience picture.',
  );
  await expect(said.getByTestId('screens-said-change')).toHaveCount(0);
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await clearOfShowControls(win, said);
  // Nothing up: the chosen wallpaper on it.
  await expect.poll(() => outputPages(app).length).toBe(1);
  const [hall] = outputPages(app);
  if (!hall) throw new Error('a screen expected');
  await expect(hall.getByTestId('scene').first()).toHaveAttribute('data-nothing-up', 'wallpaper');
  // Simple Mode with the line in it still fits, at CI's size and at 1280 × 720.
  await expectFits(simple, 'Simple Mode at 1024 × 645, a projector just plugged in');
  for (const id of ['simple-clear-all', 'simple-wallpaper', 'simple-blackout', 'show-next', 'simple-leave'])
    await expect(win.getByTestId(id), id).toBeInViewport({ ratio: 1 });
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await expectFits(simple, 'Simple Mode at 1280 × 720, a projector just plugged in');
  await expectNoSeriousA11yIssues(win, 'Simple Mode, a projector just plugged in');
  await app.close();
});
