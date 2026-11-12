import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  dropFiles,
  holdStill,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  relaunchApp,
} from './helpers';
import { makeTestImage, makeTestTone, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Wallpapers and the end of a video (Session 55, Part 6). The wallpapers are in the Playlists panel itself, under
 * the playlists, just above the bar of clears: pictures dragged in from the Finder or Explorer, or brought in with
 * Import…, anything else refused with the reason; as many as wanted, one chosen and kept over a restart; Rename and
 * Delete with Undo through the one right-click menu. The chosen one shows on the audience screens whenever nothing is
 * up (a screen just plugged in, at the start, after Clear all, when a video ends); with none chosen they are black, and
 * a video's last picture stays. A wallpaper can be several pictures in turn, with seconds each and a fade. Each
 * video's row says what happens when it ends (Wallpaper, Next item, Loop or Freeze), kept per row; in its last 10
 * seconds its row and the time under LIVE turn amber, and the stage shows the time left. The screens are Drashti's
 * pretend displays, set by themselves (Part 1: the first the audience's, the next the stage's), as windows.
 * Generated pictures, tones and videos only; placeholder names.
 */

const AUTO = {
  DRASHTI_TEST_AUTO_SCREENS: 'pretend',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_DISPLAY_CHANGES: '1',
};

/** Plug in this many of Drashti's pretend displays (they set themselves: the audience, then the stage). */
const plugIn = (app: ElectronApplication, n: number) =>
  app.evaluate((_electron, count) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(count);
  }, n);

/** The open screen showing the audience's or the stage's picture, ready to draw. */
async function screenOf(app: ElectronApplication, role: 'audience' | 'stage'): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        found = undefined;
        for (const page of outputPages(app)) {
          if (page.isClosed()) continue;
          const its = await page
            .evaluate(() => document.querySelector('[data-testid="output-root"]')?.getAttribute('data-role'))
            .catch(() => null);
          if (its === role) found = page;
        }
        return found !== undefined;
      },
      { timeout: 20_000, message: `the ${role} screen opens` },
    )
    .toBe(true);
  if (!found) throw new Error(`no ${role} screen`);
  await outputReady(found);
  return found;
}

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The wallpapers as the library has them, in order: each "name", "name *" for the chosen one, its pictures' count. */
const wallpapers = (win: Page) =>
  win.evaluate(async () => {
    const view = await (globalThis as PageGlobals).drashti.wallpapers.view();
    return view.wallpapers.map(
      (w) => `${w.name}${w.id === view.chosenId ? ' *' : ''} (${String(w.pictures.length)})`,
    );
  });

/** What a screen shows with nothing up: 'wallpaper' or 'black'; null while something is up. */
const nothingUp = (screen: Page) => screen.getByTestId('scene').first().getAttribute('data-nothing-up');

/** The wallpaper's picture a screen shows now (the one up, not the one fading in). */
const wallpaperPicture = (screen: Page) =>
  screen.locator('[data-testid="wallpaper-picture"][data-wallpaper-role="current"]').first();

const tile = (win: Page, name: string): Locator =>
  win.getByTestId('wallpapers').getByTestId('wallpaper-tile').filter({ hasText: name });

const row = (win: Page, itemId: string) =>
  win.getByTestId('open-playlist').locator(`[data-item-row="${itemId}"]`).getByTestId('playlist-item');

/** A playlist of these media, open in the middle; its id and its rows' ids. */
async function openPlaylistOf(
  win: Page,
  name: string,
  mediaIds: string[],
): Promise<{ playlistId: string; items: string[] }> {
  const made = await win.evaluate(
    async ({ name, mediaIds }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create(name, null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(
        list.ids[0] ?? '',
        null,
        mediaIds.map((mediaId) => ({ kind: 'media' as const, mediaId })),
      );
      if (!added.ok) throw new Error(added.message);
      return { playlistId: list.ids[0] ?? '', items: added.ids };
    },
    { name, mediaIds },
  );
  await win.getByTestId('playlist-node').filter({ hasText: name }).click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(mediaIds.length);
  return made;
}

/** The background is a video that has played to its end (its length known, by the engine's clock). */
const videoEnded = (win: Page, mediaId: string) =>
  win.evaluate(async (id) => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    const bg = s.layers.background;
    return (
      bg?.kind === 'media' &&
      bg.mediaId === id &&
      bg.durationMs !== undefined &&
      Date.now() - bg.startedAt > bg.durationMs + 300
    );
  }, mediaId);

/** Choose a wallpaper (through the bridge, as the window's click does). */
const choose = (win: Page, id: string | null) =>
  win.evaluate(async (which) => {
    const done = await (globalThis as PageGlobals).drashti.wallpapers.choose(which);
    if (!done.ok) throw new Error(done.message);
  }, id);

/** Make wallpapers of pictures in the library (through the bridge, as a drop does); their ids. */
const addWallpapers = (win: Page, mediaIds: string[]) =>
  win.evaluate(async (ids) => {
    const added = await (globalThis as PageGlobals).drashti.wallpapers.add(ids, null);
    if (!added.ok) throw new Error(added.message);
    return added.ids;
  }, mediaIds);

test('wallpapers in the Playlists panel: pictures dropped or imported, anything else refused with the reason; one chosen, on a screen just plugged in and kept over a restart; Rename and Delete with Undo through the one menu', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp(AUTO);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-wallpapers-'));

  // In the Playlists panel itself, under the playlists, just above the bar of clears; none yet.
  const section = win.getByRole('region', { name: 'Playlists' }).getByTestId('wallpapers');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Wallpapers' })).toBeVisible();
  await expect(section.getByTestId('wallpapers-empty')).toBeVisible();
  const placed = await win.evaluate(() => {
    const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    const walls = box('wallpapers');
    const bar = box('layer-bar');
    const lists = box('playlists');
    return walls && bar && lists
      ? { aboveBar: walls.bottom <= bar.top + 1, underPlaylists: walls.top >= lists.top + 40 }
      : null;
  });
  expect(placed).toEqual({ aboveBar: true, underPlaylists: true });
  await expectFits(section, 'the wallpapers, none yet, in CI’s window');

  // Two pictures dragged in from the Finder or Explorer: a wallpaper each, named as the file is.
  const blue = await makeTestImage(win, join(dir, 'Placeholder darshan blue.png'), { color: '#1e3a8a' });
  const green = await makeTestImage(win, join(dir, 'Placeholder darshan green.png'), { color: '#14532d' });
  await dropFiles(win, section, [blue, green], { overlay: false });
  await expect(section.getByTestId('wallpaper-tile')).toHaveText([
    /Placeholder darshan blue/u,
    /Placeholder darshan green/u,
  ]);
  expect(await wallpapers(win)).toEqual(['Placeholder darshan blue (1)', 'Placeholder darshan green (1)']);

  // Anything else is refused, with the reason, and nothing is added.
  const sound = makeTestTone(join(dir, 'Placeholder bhajan.wav'), { seconds: 1 });
  const notes = join(dir, 'Placeholder notes.txt');
  writeFileSync(notes, 'Placeholder words\n');
  await dropFiles(win, section, [sound, notes], { overlay: false });
  const notices = win.getByTestId('import-notice');
  await expect(notices).toHaveCount(2);
  await expect(notices.filter({ hasText: 'Placeholder bhajan.wav' })).toContainText('is a sound');
  await expect(notices.filter({ hasText: 'Placeholder notes.txt' })).toContainText('is not a picture');
  await expect(notices.first()).toContainText('Wallpapers are pictures only.');
  expect(await wallpapers(win)).toHaveLength(2);

  // Import…: the system's dialog for pictures (answered here by the test).
  const sunrise = await makeTestImage(win, join(dir, 'Placeholder sunrise.jpg.png'), { color: '#7c2d12' });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, sunrise);
  await section.getByTestId('wallpapers-import').click();
  await expect(section.getByTestId('wallpaper-tile')).toHaveCount(3);
  await expect(tile(win, 'Placeholder sunrise')).toBeVisible();
  // In CI's window the playlists keep most of the column: the wallpapers take at most about half of it.
  const heights = await win.evaluate(() => {
    const h = (id: string) =>
      document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().height ?? 0;
    return { playlists: h('playlists'), wallpapers: h('wallpapers') };
  });
  expect(heights.playlists, 'the playlists’ height').toBeGreaterThanOrEqual(180);
  expect(heights.wallpapers, 'the wallpapers’ height').toBeLessThanOrEqual(heights.playlists);
  await expectFits(section, 'the wallpapers, three of them, in CI’s window');

  // One click chooses it: kept by the library, and in the engine's state for every screen.
  await expect(tile(win, 'Placeholder darshan green')).toHaveAttribute('aria-pressed', 'false');
  await tile(win, 'Placeholder darshan green').click();
  await expect(tile(win, 'Placeholder darshan green')).toHaveAttribute('aria-pressed', 'true');
  expect(await wallpapers(win)).toEqual([
    'Placeholder darshan blue (1)',
    'Placeholder darshan green * (1)',
    'Placeholder sunrise.jpg (1)',
  ]);
  const greenId = (await state(win)).chosenWallpaper?.pictures[0] ?? '';
  expect(greenId).not.toBe('');
  // LIVE shows it, with nothing up.
  await expect(win.getByTestId('live-preview').getByTestId('scene').first()).toHaveAttribute(
    'data-nothing-up',
    'wallpaper',
  );

  // A display plugged in shows it at once (nothing is up).
  await plugIn(app, 1);
  const hall = await screenOf(app, 'audience');
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');
  await expect(wallpaperPicture(hall)).toHaveAttribute('data-media-id', greenId);

  // Rename, through the one right-click menu, with Undo.
  await tile(win, 'Placeholder darshan green').click({ button: 'right' });
  const menu = win.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Rename…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'a wallpaper’s menu', '[role="menu"]');
  await menu.getByRole('menuitem', { name: 'Rename…' }).click();
  await win.getByTestId('rename-field').fill('Placeholder evening');
  await win.getByTestId('rename-save').click();
  await expect(tile(win, 'Placeholder evening')).toHaveAttribute('aria-pressed', 'true');
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(tile(win, 'Placeholder darshan green')).toHaveAttribute('aria-pressed', 'true');

  // Delete, through the same menu: the chosen one, on the screens, asks first; Undo brings it back, chosen.
  await tile(win, 'Placeholder darshan green').click({ button: 'right' });
  await win.getByRole('menu').getByRole('menuitem', { name: 'Delete…' }).click();
  const ask = win.getByTestId('wallpaper-delete-confirm');
  await expect(ask).toContainText('Placeholder darshan green');
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect(tile(win, 'Placeholder darshan green')).toHaveCount(0);
  expect((await state(win)).chosenWallpaper ?? null).toBeNull();
  await expect.poll(() => nothingUp(hall)).toBe('black');
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(tile(win, 'Placeholder darshan green')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');
  // One not chosen goes at once, with Undo.
  await tile(win, 'Placeholder darshan blue').click({ button: 'right' });
  await win.getByRole('menu').getByRole('menuitem', { name: 'Delete…' }).click();
  await expect(tile(win, 'Placeholder darshan blue')).toHaveCount(0);
  await expect(ask).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(section.getByTestId('wallpaper-tile')).toHaveCount(3);
  await expectNoSeriousA11yIssues(win, 'the wallpapers', '[data-testid="wallpapers"]');

  // At 1280 × 720 too.
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await expectFits(section, 'the wallpapers at 1280 × 720');
  await app.close();

  // A restart: still chosen, and on the screen from the start.
  const again = await relaunchApp(userData, { ...AUTO, DRASHTI_EXTRA_DISPLAYS: '1' });
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await expect(tile(next, 'Placeholder darshan green')).toHaveAttribute('aria-pressed', 'true');
  const hallAgain = await screenOf(again.app, 'audience');
  await expect.poll(() => nothingUp(hallAgain)).toBe('wallpaper');
  await expect(wallpaperPicture(hallAgain)).toHaveAttribute('data-media-id', greenId);
  await again.app.close();
});

test('the chosen wallpaper shows whenever nothing is up: after Clear all and when a video ends; several pictures go round with a fade; none chosen, black, and a video’s last picture stays', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ ...AUTO, DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-wallpapers-'));
  const [blueId = '', greenId = '', pictureId = '', videoId = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, 'Placeholder blue.png'), { color: '#1e3a8a' }),
    await makeTestImage(win, join(dir, 'Placeholder green.png'), { color: '#14532d' }),
    await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { color: '#581c87' }),
    await makeTestVideo(win, join(dir, 'Placeholder clip.webm'), { seconds: 2 }),
  ]);
  const [wallId = ''] = await addWallpapers(win, [blueId]);
  await choose(win, wallId);
  const hall = await screenOf(app, 'audience');
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');
  await expect(wallpaperPicture(hall)).toHaveAttribute('data-media-id', blueId);

  // Something up covers it; Clear all (F1) brings it back.
  const { items } = await openPlaylistOf(win, 'Placeholder evening', [pictureId, videoId]);
  const [pictureItem = '', videoItem = ''] = items;
  await row(win, pictureItem).click();
  await expect.poll(() => nothingUp(hall)).toBeNull();
  // The Wallpaper (F12, Part 13): the chosen wallpaper over what is up; again, what was up shows again.
  await win.keyboard.press('F12');
  await expect(hall.getByTestId('wallpaper').getByTestId('wallpaper-picture').first()).toHaveAttribute(
    'data-media-id',
    blueId,
  );
  await win.keyboard.press('F12');
  await expect(hall.getByTestId('wallpaper')).toHaveCount(0);
  expect((await state(win)).layers.background).toMatchObject({ mediaId: pictureId });
  await win.keyboard.press('F1');
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');

  // A video that ends: the wallpaper (When it ends' default), and the video is no longer up.
  await row(win, videoItem).click();
  await expect.poll(() => nothingUp(hall)).toBeNull();
  await expect
    .poll(async () => (await state(win)).layers.background, { timeout: 20_000, message: 'the video ends' })
    .toBeNull();
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');

  // Several pictures in turn: a picture dropped on a wallpaper goes into it, then seconds each and a fade.
  const green = join(dir, 'Placeholder green again.png');
  await makeTestImage(win, green, { color: '#14532d' });
  await dropFiles(win, tile(win, 'Placeholder blue'), [green], { overlay: false });
  await expect(tile(win, 'Placeholder blue').getByTestId('wallpaper-count')).toHaveText('2');
  await tile(win, 'Placeholder blue').click({ button: 'right' });
  await win.getByRole('menu').getByRole('menuitem', { name: 'Edit wallpaper…' }).click();
  const editor = win.getByTestId('wallpaper-editor');
  await expect(editor.getByTestId('wallpaper-editor-picture')).toHaveCount(2);
  await editor.getByLabel('Seconds each').fill('3');
  await editor.getByLabel('Fade (seconds)').fill('1');
  await expectFits(editor, 'the wallpaper’s editor in CI’s window');
  await expectNoSeriousA11yIssues(win, 'the wallpaper’s editor', '[data-testid="wallpaper-editor"]');
  await editor.getByTestId('wallpaper-editor-done').click();
  await expect(editor).toHaveCount(0);
  const chosen = (await state(win)).chosenWallpaper;
  expect(chosen?.pictures.length).toBe(2);
  expect([chosen?.secondsEach, chosen?.fadeMs]).toEqual([3, 1000]);
  const secondId = chosen?.pictures[1] ?? '';
  // In turn on the screen: the second picture, then the first again.
  await expect
    .poll(() => wallpaperPicture(hall).getAttribute('data-media-id'), { timeout: 10_000 })
    .toBe(secondId);
  await expect
    .poll(() => wallpaperPicture(hall).getAttribute('data-media-id'), { timeout: 10_000 })
    .toBe(blueId);
  expect(greenId).not.toBe('');

  // None chosen (a click on the chosen one): black, and a video's last picture stays at its end.
  await tile(win, 'Placeholder blue').click();
  await expect(tile(win, 'Placeholder blue')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => nothingUp(hall)).toBe('black');
  await row(win, videoItem).click();
  await expect.poll(() => videoEnded(win, videoId), { timeout: 20_000 }).toBe(true);
  await holdStill(
    async () => (await nothingUp(hall)) === null && (await videoEnded(win, videoId)),
    2000,
    'the video’s last picture stays up',
  );
  await app.close();
});

test('When it ends, in each video’s menu: Wallpaper (the default), Next item, Loop or Freeze, kept per row', async () => {
  test.setTimeout(240_000);
  const { app, userData } = await launchApp({ ...AUTO, DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-wallpapers-'));
  const [wallPicture = '', pictureId = '', videoId = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, 'Placeholder wall.png'), { color: '#1e3a8a' }),
    await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { color: '#581c87' }),
    await makeTestVideo(win, join(dir, 'Placeholder clip.webm'), { seconds: 2 }),
  ]);
  const [wallId = ''] = await addWallpapers(win, [wallPicture]);
  await choose(win, wallId);
  const hall = await screenOf(app, 'audience');
  const { playlistId, items } = await openPlaylistOf(win, 'Placeholder ends', [videoId, pictureId]);
  const [videoItem = '', pictureItem = ''] = items;
  const whenEnds = () =>
    win.evaluate(
      async ({ playlistId, itemId }) => {
        const all = await (globalThis as PageGlobals).drashti.playlists.items(playlistId);
        const it = all.find((i) => i.id === itemId);
        return it?.kind === 'media' ? (it.whenEnds ?? 'wallpaper') : null;
      },
      { playlistId, itemId: videoItem },
    );
  const choices = ['Wallpaper', 'Next item', 'Loop', 'Freeze'].map((c) => `When it ends: ${c}`);
  /** Choose in the video row's menu. */
  const set = async (choice: string) => {
    await row(win, videoItem).click({ button: 'right' });
    await win.getByRole('menuitemradio', { name: `When it ends: ${choice}` }).click();
    await expect(win.getByRole('menu')).toHaveCount(0);
  };

  // The menu: four choices, Wallpaper ticked to begin with.
  await row(win, videoItem).click({ button: 'right' });
  const radios = win.getByRole('menu').getByRole('menuitemradio');
  await expect(radios).toHaveText(choices);
  await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
  await expectNoSeriousA11yIssues(win, 'a video row’s menu with When it ends', '[role="menu"]');
  await win.keyboard.press('Escape');
  // A picture's row has none.
  await row(win, pictureItem).click({ button: 'right' });
  await expect(win.getByRole('menu').getByRole('menuitemradio')).toHaveCount(0);
  await win.keyboard.press('Escape');

  // Loop: it plays again from its start point, on and on.
  await set('Loop');
  expect(await whenEnds()).toBe('loop');
  await row(win, videoItem).click();
  await expect
    .poll(async () => (await state(win)).layers.background)
    .toMatchObject({ mediaId: videoId, loop: true });
  await holdStill(
    async () => {
      const bg = (await state(win)).layers.background;
      return bg?.kind === 'media' && bg.mediaId === videoId && (await nothingUp(hall)) === null;
    },
    3500,
    'a looping video stays up past its end',
  );

  // Next item: at its end, the next row goes up.
  await set('Next item');
  await win.keyboard.press('F1');
  await row(win, videoItem).click();
  await expect
    .poll(async () => (await state(win)).live.playlist?.itemId, {
      timeout: 20_000,
      message: 'the next row goes up',
    })
    .toBe(pictureItem);
  expect((await state(win)).layers.background).toMatchObject({ mediaId: pictureId });

  // Freeze: its last picture stays, even with a wallpaper chosen.
  await set('Freeze');
  await win.keyboard.press('F1');
  await row(win, videoItem).click();
  await expect.poll(() => videoEnded(win, videoId), { timeout: 20_000 }).toBe(true);
  await holdStill(
    async () => (await nothingUp(hall)) === null && (await videoEnded(win, videoId)),
    2000,
    'a frozen video’s last picture stays',
  );

  // Wallpaper again (the default): at its end, the wallpaper.
  await set('Wallpaper');
  await win.keyboard.press('F1');
  await row(win, videoItem).click();
  await expect
    .poll(async () => (await state(win)).layers.background, { timeout: 20_000, message: 'the video ends' })
    .toBeNull();
  await expect.poll(() => nothingUp(hall)).toBe('wallpaper');

  // Kept per row, over a restart.
  await set('Freeze');
  await app.close();
  const again = await relaunchApp(userData, AUTO);
  const next = await operatorPage(again.app);
  await operatorReady(next);
  await next.getByTestId('playlist-node').filter({ hasText: 'Placeholder ends' }).click();
  await row(next, videoItem).click({ button: 'right' });
  await expect(next.getByRole('menuitemradio', { name: 'When it ends: Freeze' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await again.app.close();
});

test('the last 10 seconds of a video: its row and the time under LIVE turn amber, and the stage shows the time left', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ ...AUTO, DRASHTI_EXTRA_DISPLAYS: '2' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-wallpapers-'));
  const [videoId = ''] = await importAndGetIds(win, [
    await makeTestVideo(win, join(dir, 'Placeholder long clip.webm'), { seconds: 12 }),
  ]);
  const stage = await screenOf(app, 'stage');
  const { items } = await openPlaylistOf(win, 'Placeholder long', [videoId]);
  const [videoItem = ''] = items;
  const bar = win.locator('[data-testid="time-bar-row"][data-playing="background"]');
  const endsIn = stage.getByTestId('stage-ends-in');

  // Up, its length known, and held where it is: more than 10 seconds left, nothing amber, nothing on the stage.
  await row(win, videoItem).click();
  await expect
    .poll(async () => {
      const bg = (await state(win)).layers.background;
      return bg?.kind === 'media' && bg.durationMs !== undefined;
    })
    .toBe(true);
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'pausePlaying',
      playing: { layer: 'background' },
    }),
  );
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'moveTo',
      playing: { layer: 'background' },
      toMs: 500,
    }),
  );
  await expect(bar).toBeVisible();
  await expect(row(win, videoItem)).not.toHaveAttribute('data-last-seconds', 'true');
  await expect(bar).not.toHaveAttribute('data-last-seconds', 'true');
  await expect(endsIn).toHaveCount(0);

  // Moved to its last 10 seconds: amber, and the time left on the stage.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'moveTo',
      playing: { layer: 'background' },
      toMs: 4500,
    }),
  );
  await expect(row(win, videoItem)).toHaveAttribute('data-last-seconds', 'true');
  await expect(bar).toHaveAttribute('data-last-seconds', 'true');
  await expect(endsIn).toBeVisible();
  await expect(endsIn).toContainText(/0:0[789]/u);
  await expectFits(
    win.getByTestId('open-playlist'),
    'the playlist with a video’s last seconds, in CI’s window',
  );

  // Played on to its end: nothing is amber any more, and the stage says nothing of it.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'resumePlaying',
      playing: { layer: 'background' },
    }),
  );
  await expect(endsIn).toHaveCount(0, { timeout: 20_000 });
  await expect(row(win, videoItem)).not.toHaveAttribute('data-last-seconds', 'true');
  await app.close();
});

test('the idle rotation became a wallpaper, not chosen: its quote drawn as a picture, its words on black', async () => {
  test.setTimeout(150_000);
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  // An alpha.13 library (schema 49) holding the idle rotation's settings and a quote (main/old-library-selftest.ts).
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    DRASHTI_USER_DATA_DIR: userData,
    DRASHTI_SELFTEST: 'old-library',
    DRASHTI_TEST_QUIET: '1',
    DRASHTI_SELFTEST_LIBRARY: JSON.stringify({
      schema: 49,
      held: true,
      groups: [{ name: 'Hall', role: 'audience', languages: ['gu', 'translit'], display: 0 }],
    }),
  });
  const code = await new Promise<number | null>((resolve) => {
    spawn(electron, ['.'], { env, stdio: 'ignore' }).on('exit', resolve);
  });
  expect(code).toBe(0);
  expect(existsSync(join(userData, 'drashti.sqlite'))).toBe(true);

  const { app } = await launchApp({}, userData);
  const win = await operatorPage(app);
  await operatorReady(win);
  // One wallpaper, the quote drawn by this window into it; not chosen, so the screens stay black.
  await expect
    .poll(() => wallpapers(win), { timeout: 30_000, message: 'the quote is drawn into its wallpaper' })
    .toEqual(['Idle rotation (1)']);
  await expect(tile(win, 'Idle rotation')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(win)).chosenWallpaper ?? null).toBeNull();
  // The picture: 1920 × 1080, black at its corners, its words light in the middle.
  const look = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const view = await d.wallpapers.view();
    const id = view.wallpapers[0]?.pictures[0]?.mediaId ?? '';
    const img = new Image();
    // Read back by this page (the media scheme allows it), as a still is made.
    img.crossOrigin = 'anonymous';
    img.src = `drashti-media://media/${id}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    const middle = ctx.getImageData(
      0,
      Math.round(img.naturalHeight * 0.4),
      img.naturalWidth,
      Math.round(img.naturalHeight * 0.2),
    ).data;
    let light = 0;
    for (let i = 0; i < middle.length; i += 4) if ((middle[i] ?? 0) > 200) light++;
    return { size: [img.naturalWidth, img.naturalHeight], corner: at(5, 5), light: light > 500 };
  });
  expect(look).toEqual({ size: [1920, 1080], corner: [0, 0, 0], light: true });
  await app.close();
});
