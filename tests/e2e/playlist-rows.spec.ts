import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf, type TestPdfPage } from '../../src/main/import/testing/make-pdf';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { holdStill, importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import { mouseDrag } from './mouse-drag';
import { makeTestImage, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Session 55, Part 4: the playlist is where things go live, with the whole middle (the slides area under it went).
 * A PDF's pages and a presentation's slides are rows under its name ("<name>_1"…, a text slide's first line after
 * it), which folds them; one click on any row puts it up, a video's and a video input's too; each row that goes up
 * has a number, typed and Enter to put it up; a small picture beside Next says what it puts up; Oops (F9) puts back
 * what was up before the last change; a playlist is duplicated and practised from its menu; Simple Mode's rows go up
 * with one tap, and its time bar shows Play while something is paused (question 14). Part 14: the one right-click
 * menu, its Delete with Undo (from a playlist: out of it only, asked first while it is up; from the library: at once
 * when nothing uses it, never the owner's file). In CI's window, 1024 × 645, and at 1280 × 720. Part 4b: a slide's row
 * dragged within its deck changes this playlist's own order of its slides, and out of it, anywhere else in the
 * playlist, becomes an item of its own, each with one Undo, never changing the library's presentation. Its keyboard
 * move: Alt+↑ ↓ on a slide's row moves it a place within its deck (staying put at the deck's first or last row), and
 * "Make it an item of its own" in its menu (Shift+F10) does what the drag out does, each said and with Undo, the
 * keyboard staying on the moved row; Simple Mode too, as its drag is. Placeholder files only, made here.
 */

const PDF = 'Placeholder notices';
const WORDS = 'Placeholder words';
const VIDEO = 'Placeholder clip';
const PICTURE = 'Placeholder backdrop';
/** The PDF's pages (the first two, unless a test asks for three). */
const PAGES: TestPdfPage[] = [
  { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder page one' },
  { width: 960, height: 540, color: [20, 83, 45], text: 'Placeholder page two' },
  { width: 960, height: 540, color: [127, 29, 29], text: 'Placeholder page three' },
];

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

interface Show {
  app: ElectronApplication;
  win: Page;
  playlistId: string;
  items: { pdf: string; words: string; video: string; picture: string };
  ids: { pdf: string; words: string; video: string; picture: string };
  dir: string;
}

/**
 * A playlist of a PDF of two pages (or `pages`), a presentation of two text slides, a video and a picture, open in CI's
 * window.
 */
async function start(size: { width: number; height: number } = CI_WINDOW, pages = 2): Promise<Show> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, size);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-playlist-rows-'));
  const pdf = join(dir, `${PDF}.pdf`);
  writeFileSync(pdf, makeTestPdf(PAGES.slice(0, pages)));
  const files = [
    pdf,
    await makeTestVideo(win, join(dir, `${VIDEO}.webm`), { seconds: 2 }),
    await makeTestImage(win, join(dir, `${PICTURE}.png`), { color: '#1e3a8a' }),
  ];
  const [pdfId = '', videoId = '', pictureId = ''] = await importAndGetIds(win, files);
  const made = await win.evaluate(
    async (adding) => {
      const d = (globalThis as PageGlobals).drashti;
      const words = await d.library.newFromWords(
        adding.name,
        'Placeholder first line\nPlaceholder second line\n\nPlaceholder another slide',
      );
      if (!words.ok) throw new Error(words.message);
      const list = await d.playlists.create('Placeholder rows', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId: adding.pdfId },
        { kind: 'presentation', presentationId: words.id },
        { kind: 'media', mediaId: adding.videoId },
        { kind: 'media', mediaId: adding.pictureId },
      ]);
      if (!added.ok) throw new Error(added.message);
      return { playlistId: list.ids[0] ?? '', items: added.ids, wordsId: words.id };
    },
    { pdfId, videoId, pictureId, name: WORDS },
  );
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder rows' }).click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(4);
  const [pdfItem = '', wordsItem = '', videoItem = '', pictureItem = ''] = made.items;
  return {
    app,
    win,
    playlistId: made.playlistId,
    items: { pdf: pdfItem, words: wordsItem, video: videoItem, picture: pictureItem },
    ids: { pdf: pdfId, words: made.wordsId, video: videoId, picture: pictureId },
    dir,
  };
}

const row = (win: Page, itemId: string) =>
  win.getByTestId('open-playlist').locator(`[data-item-row="${itemId}"]`);
const slideRows = (win: Page, itemId: string) => row(win, itemId).getByTestId('slide-thumb');

test('the playlist has the whole middle: a PDF’s and a presentation’s slides are rows under their names, and one click puts one up', async () => {
  test.setTimeout(180_000);
  const { app, win, items, ids } = await start();
  // The slides area under the playlist is gone: the playlist has the whole middle.
  await expect(win.getByTestId('slide-grid')).toHaveCount(0);
  // A PDF's pages as rows under its name, "<name>_1" and "<name>_2"; a text slide's row says its first line.
  await expect(slideRows(win, items.pdf)).toHaveCount(2);
  await expect(slideRows(win, items.pdf).getByTestId('slide-label')).toHaveText([`${PDF}_1`, `${PDF}_2`]);
  await expect(slideRows(win, items.words)).toHaveCount(2);
  await expect(slideRows(win, items.words).first().getByTestId('slide-line')).toHaveText(
    'Placeholder first line',
  );
  await expect(slideRows(win, items.words).nth(1).getByTestId('slide-line')).toHaveText(
    'Placeholder another slide',
  );
  // Numbered for jumping: 1 and 2 the PDF's, 3 and 4 the words', 5 the video, 6 the picture.
  await expect(slideRows(win, items.pdf).nth(1)).toHaveAttribute('data-row-number', '2');
  await expect(row(win, items.video).getByTestId('playlist-item')).toHaveAttribute('data-row-number', '5');

  // One click on the PDF's second page: up at once, from the playlist.
  await slideRows(win, items.pdf).nth(1).click();
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({
      presentationId: ids.pdf,
      slideIndex: 1,
      playlist: { itemId: items.pdf },
    });
  await expect(slideRows(win, items.pdf).nth(1)).toHaveAttribute('aria-current', 'true');
  // Next goes on from the live row, on into the next item's first slide.
  await win.getByTestId('show-next').click();
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({
      presentationId: ids.words,
      slideIndex: 0,
    });
  await expect(slideRows(win, items.words).first()).toHaveAttribute('aria-current', 'true');
  // Next up: a small picture beside Next of what it puts up.
  await expect(win.getByTestId('next-up')).toHaveAttribute('data-kind', 'slide');

  // The PDF's name folds its slides, and opens them again.
  const pdfName = row(win, items.pdf).getByTestId('playlist-item');
  await pdfName.click();
  await expect(pdfName).toHaveAttribute('aria-expanded', 'false');
  await expect(slideRows(win, items.pdf)).toHaveCount(0);
  await pdfName.click();
  await expect(slideRows(win, items.pdf)).toHaveCount(2);

  // One click on the picture's row: up as the background.
  await row(win, items.picture).getByTestId('playlist-item').click();
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ mediaId: ids.picture });
  await expectNoSeriousA11yIssues(win, 'the playlist’s rows, a slide up');
  await app.close();
});

test('jump by number: a row’s number and Enter put it up, the number showing as it is typed; Esc takes it away', async () => {
  test.setTimeout(180_000);
  const { app, win, items, ids } = await start();
  await win.locator('body').click({ position: { x: 5, y: 5 } });
  await win.keyboard.press('4');
  await expect(win.getByTestId('jump-number')).toHaveText('4');
  await win.keyboard.press('Enter');
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({
      presentationId: ids.words,
      slideIndex: 1,
      playlist: { itemId: items.words },
    });
  await expect(win.getByTestId('jump-box')).toHaveCount(0);
  // Esc takes a number away: nothing more goes up.
  await win.keyboard.press('6');
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('jump-box')).toHaveCount(0);
  await win.keyboard.press('Enter');
  await letTimePass(win, 400, 'an Enter after Esc puts nothing up');
  expect((await state(win)).live.presentationId).toBe(ids.words);
  await app.close();
});

test('Oops (F9) puts back what was up before the last change, step by step; a finished video starts again on a click', async () => {
  test.setTimeout(180_000);
  const { app, win, items, ids } = await start();
  await expect(win.getByTestId('show-oops')).toBeDisabled();
  // The video, then by mistake the picture.
  await row(win, items.video).getByTestId('playlist-item').click();
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ mediaId: ids.video });
  const video = (await state(win)).layers.background;
  await row(win, items.picture).getByTestId('playlist-item').click();
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ mediaId: ids.picture });
  // Oops: the video is back, carrying on from when it first went up.
  await win.keyboard.press('F9');
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ mediaId: ids.video });
  expect((await state(win)).layers.background).toMatchObject({
    startedAt: video?.kind === 'media' ? video.startedAt : -1,
  });
  // Its button does the same: before the video, nothing was up.
  await win.getByTestId('show-oops').click();
  await expect.poll(async () => (await state(win)).layers.background).toBeNull();

  // The two-second video played to its end: a click on its row starts it again from its start point.
  await row(win, items.video).getByTestId('playlist-item').click();
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ mediaId: ids.video });
  const first = (await state(win)).layers.background;
  await expect
    .poll(async () => {
      const bg = (await state(win)).layers.background;
      return bg?.kind === 'media' ? (bg.durationMs ?? 0) : 0;
    })
    .toBeGreaterThan(0);
  await letTimePass(win, 3000, 'the video plays to its end');
  await row(win, items.video).getByTestId('playlist-item').click();
  await expect
    .poll(async () => {
      const bg = (await state(win)).layers.background;
      return bg?.kind === 'media' ? bg.startedAt : null;
    })
    .toBeGreaterThan(first?.kind === 'media' ? first.startedAt : 0);
  await app.close();
});

test('a playlist duplicated and practised from its menu; the one right-click menu takes a row out of the playlist with Undo', async () => {
  test.setTimeout(180_000);
  const { app, win, playlistId, items } = await start();
  const menu = win.getByTestId('open-playlist').getByRole('button', { name: 'Playlist actions' });
  // Duplicate: "<name> copy", with its rows in their order.
  await menu.click();
  await win.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(win.getByTestId('playlist-node').filter({ hasText: 'Placeholder rows copy' })).toHaveCount(1);
  const copy = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const node = (await d.playlists.tree()).find((n) => n.name === 'Placeholder rows copy');
    return node ? (await d.playlists.items(node.id)).map((i) => i.label) : [];
  });
  expect(copy).toHaveLength(4);

  // Practise it: in the window only, a banner says so, nothing on the screens.
  await menu.click();
  await win.getByRole('menuitem', { name: 'Practise this playlist' }).click();
  await expect(win.getByTestId('practice-banner')).toContainText('Practising “Placeholder rows”');
  await win.getByTestId('practice-thumb').nth(1).click();
  await letTimePass(win, 300, 'a practice slide put up');
  expect((await state(win)).layers.slide).toBeNull();
  await win.getByTestId('practice-leave').click();
  await expect(win.getByTestId('practice-banner')).toHaveCount(0);

  // The one right-click menu on the picture's row: its Delete takes it out of this playlist only, with Undo.
  await row(win, items.picture).getByTestId('playlist-item').click({ button: 'right' });
  await expect(win.getByRole('menuitem', { name: 'Picture editor…' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Rename…' })).toBeVisible();
  await expect(
    win.getByRole('menuitem', { name: process.platform === 'win32' ? 'Show in Explorer' : 'Show in Finder' }),
  ).toBeVisible();
  await win.getByRole('menuitem', { name: 'Remove from playlist' }).click();
  await expect(row(win, items.picture)).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(row(win, items.picture)).toHaveCount(1);
  expect(
    await win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).length,
      playlistId,
    ),
  ).toBe(4);
  await app.close();
});

test('Rename and Delete from the library, each with Undo: Delete at once when nothing uses it, never touching the owner’s file', async () => {
  test.setTimeout(180_000);
  const { app, win, dir } = await start();
  const loose = join(dir, 'Placeholder loose.png');
  await makeTestImage(win, loose, { color: '#14532d' });
  const [looseId = ''] = await importAndGetIds(win, [loose]);
  expect(looseId).not.toBe('');
  await win.getByTestId('library-button').click();
  await win.getByTestId('library-tab-media').click();
  // Rename… (the one right-click menu): the library's name changes, with Undo.
  await win.getByTestId('media-item').filter({ hasText: 'Placeholder loose' }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Rename…' }).click();
  await win.getByTestId('rename-field').fill('Placeholder renamed');
  await win.getByTestId('rename-save').click();
  await expect(win.getByTestId('rename-dialog')).toHaveCount(0);
  await expect(win.getByTestId('media-item').filter({ hasText: 'Placeholder renamed' })).toHaveCount(1);
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  const looseRow = win.getByTestId('media-item').filter({ hasText: 'Placeholder loose' });
  await expect(looseRow).toHaveCount(1);
  await looseRow.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Delete…' }).click();
  // Used nowhere: no question, gone at once, with Undo.
  await expect(win.getByTestId('media-remove-confirm')).toHaveCount(0);
  await expect(looseRow).toHaveCount(0);
  expect(existsSync(loose)).toBe(true);
  await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
  await expect(looseRow).toHaveCount(1);
  await app.close();
});

test('Simple Mode: one tap on a slide’s row puts it up; its time bar shows Play while something is paused', async () => {
  test.setTimeout(180_000);
  const { app, win, items, ids } = await start();
  // A video up and paused (in Pro Mode here; a phone's Pause the same), then Simple Mode, which refuses Pause itself.
  await row(win, items.video).getByTestId('playlist-item').click();
  await expect.poll(async () => (await state(win)).layers.background).toMatchObject({ mediaId: ids.video });
  await expect
    .poll(async () => {
      const bg = (await state(win)).layers.background;
      return bg?.kind === 'media' ? (bg.durationMs ?? 0) : 0;
    })
    .toBeGreaterThan(0);
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'pausePlaying',
      playing: { layer: 'background' },
    }),
  );
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // Its bar shows Play (the owner's answer to question 14), never Pause.
  await expect(win.getByTestId('time-bar-play')).toBeVisible();
  await expect(win.getByTestId('time-bar-pause')).toHaveCount(0);
  await win.getByTestId('time-bar-play').click();
  await expect
    .poll(async () => {
      const bg = (await state(win)).layers.background;
      return bg?.kind === 'media' ? (bg.seek?.paused ?? false) : null;
    })
    .toBe(false);
  await expect(win.getByTestId('time-bar-play')).toHaveCount(0);
  await expect(win.getByTestId('time-bar-pause')).toHaveCount(0);

  // One tap on a slide's row puts it up, from the playlist (Pro Mode's rows since Session 55, Part 18).
  const simpleRow = win
    .getByTestId('simple-mode')
    .getByTestId('slide-thumb')
    .filter({ hasText: `${PDF}_2` });
  await simpleRow.click();
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({
      presentationId: ids.pdf,
      slideIndex: 1,
      playlist: { itemId: items.pdf },
    });
  await expect(simpleRow).toHaveAttribute('aria-current', 'true');
  await app.close();
});

/** The PDF's pages' ids, in the library's own order. */
const pageIds = (win: Page, pdfId: string) =>
  win.evaluate(async (id) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(id);
    return doc ? doc.groups.flatMap((g) => g.slides.map((s) => s.id)) : [];
  }, pdfId);
const shownSlide = async (win: Page) => (await state(win)).layers.slide?.slide.id ?? null;
const undo = (win: Page) => win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();

test('a slide’s row dragged within its deck changes this playlist’s order only, with Undo; a click and Next follow it', async () => {
  test.setTimeout(180_000);
  const { app, win, playlistId, items, ids } = await start(CI_WINDOW, 3);
  const pages = await pageIds(win, ids.pdf);
  expect(pages).toHaveLength(3);
  const labels = slideRows(win, items.pdf).getByTestId('slide-label');
  await expect(labels).toHaveText([`${PDF}_1`, `${PDF}_2`, `${PDF}_3`]);
  // The third page dragged above the first: each row keeps its name.
  await mouseDrag(win, slideRows(win, items.pdf).nth(2), slideRows(win, items.pdf).first(), 'top');
  await expect(labels).toHaveText([`${PDF}_3`, `${PDF}_1`, `${PDF}_2`]);
  // This playlist's own order; the library's presentation as it was.
  expect(await pageIds(win, ids.pdf)).toEqual(pages);
  // A click on the first row puts page three up; Next goes on to page one, in the playlist's order.
  await slideRows(win, items.pdf).first().click();
  await expect.poll(() => shownSlide(win)).toBe(pages[2]);
  await win.getByTestId('show-next').click();
  await expect.poll(() => shownSlide(win)).toBe(pages[0]);
  await expect(slideRows(win, items.pdf).nth(1)).toHaveAttribute('aria-current', 'true');
  // Undo: the presentation's order again, page one still up, its row (now the first) live.
  await undo(win);
  await expect(labels).toHaveText([`${PDF}_1`, `${PDF}_2`, `${PDF}_3`]);
  await expect(slideRows(win, items.pdf).first()).toHaveAttribute('aria-current', 'true');
  expect((await state(win)).live).toMatchObject({ slideIndex: 0, playlist: { itemId: items.pdf } });
  expect(
    await win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id))[0],
      playlistId,
    ),
  ).toMatchObject({ order: { mode: 'presentation' } });
  await app.close();
});

test('a slide’s row dragged out of its deck becomes an item of its own where it lands, the deck keeping the rest, with one Undo', async () => {
  test.setTimeout(180_000);
  const { app, win, playlistId, items, ids } = await start(CI_WINDOW, 3);
  const pages = await pageIds(win, ids.pdf);
  // Page two up from the deck, then its row dragged out, below the picture (the end of the playlist).
  await slideRows(win, items.pdf).nth(1).click();
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({ slideIndex: 1, playlist: { itemId: items.pdf } });
  await mouseDrag(win, slideRows(win, items.pdf).nth(1), row(win, items.picture), 'bottom');
  const all = win.getByTestId('open-playlist').getByTestId('playlist-item');
  await expect(all).toHaveCount(5);
  const made = (await all.last().getAttribute('data-item-id')) ?? '';
  await expect(slideRows(win, items.pdf).getByTestId('slide-label')).toHaveText([`${PDF}_1`, `${PDF}_3`]);
  await expect(slideRows(win, made).getByTestId('slide-label')).toHaveText([`${PDF}_2`]);
  // Still up as it was, from its own item now.
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({ slideIndex: 0, slideCount: 1, playlist: { itemId: made } });
  expect(await shownSlide(win)).toBe(pages[1]);
  await expect(slideRows(win, made).first()).toHaveAttribute('aria-current', 'true');
  // The library's presentation as it was; nothing in the middle runs past its right edge in CI's window.
  expect(await pageIds(win, ids.pdf)).toEqual(pages);
  expect(
    await win.getByTestId('column-middle').evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  // One Undo: the deck has its three pages again and the new item is gone; page two stays up, in the deck.
  await undo(win);
  await expect(all).toHaveCount(4);
  await expect(slideRows(win, items.pdf).getByTestId('slide-label')).toHaveText([
    `${PDF}_1`,
    `${PDF}_2`,
    `${PDF}_3`,
  ]);
  await expect
    .poll(async () => (await state(win)).live)
    .toMatchObject({ slideIndex: 1, playlist: { itemId: items.pdf } });
  expect(
    await win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).length,
      playlistId,
    ),
  ).toBe(4);
  await app.close();
});

/** The open playlist's items' ids, in its order. */
const itemIds = (win: Page) =>
  win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id') ?? ''));
/** The open playlist's first item as the library keeps it. */
const firstItem = (win: Page, playlistId: string) =>
  win.evaluate(async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id))[0], playlistId);

for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
  test(`a slide’s row moved from the keyboard at ${String(size.width)} × ${String(size.height)}: Alt+↓ within its deck and “Make it an item of its own”, each said and with Undo`, async () => {
    test.setTimeout(180_000);
    const { app, win, playlistId, items, ids } = await start(size, 3);
    const pages = await pageIds(win, ids.pdf);
    const deck = slideRows(win, items.pdf);
    const labels = deck.getByTestId('slide-label');
    const said = win.getByTestId('undo-said');
    const order = [items.pdf, items.words, items.video, items.picture];
    const three = [`${PDF}_1`, `${PDF}_2`, `${PDF}_3`];
    await expect(labels).toHaveText(three);

    // Alt+↓ on its second row: a place down within its deck, keeping its name; the keyboard stays on it, and the
    // move is said as an item's is.
    await deck.nth(1).focus();
    await win.keyboard.press('Alt+ArrowDown');
    const moved = [`${PDF}_1`, `${PDF}_3`, `${PDF}_2`];
    await expect(labels).toHaveText(moved);
    await expect(deck.nth(2)).toBeFocused();
    await expect(said).toHaveText(`Moved “${PDF}_2” down in this playlist`);
    expect(await firstItem(win, playlistId)).toMatchObject({
      order: { mode: 'slides', slideIds: [pages[0], pages[2], pages[1]] },
    });
    // At its deck's last row it stays put: the deck never moves, and nothing crosses into the next item.
    await win.keyboard.press('Alt+ArrowDown');
    await holdStill(
      async () =>
        (await labels.allTextContents()).join('|') === moved.join('|') &&
        (await itemIds(win)).join('|') === order.join('|'),
      600,
      'Alt+↓ on the deck’s last row moves nothing',
    );
    await expect(deck.nth(2)).toBeFocused();
    // And at its first, Alt+↑.
    await deck.first().focus();
    await win.keyboard.press('Alt+ArrowUp');
    await holdStill(
      async () =>
        (await labels.allTextContents()).join('|') === moved.join('|') &&
        (await itemIds(win)).join('|') === order.join('|'),
      600,
      'Alt+↑ on the deck’s first row moves nothing',
    );
    // The library's presentation as it was. Undo: the presentation's own order again.
    expect(await pageIds(win, ids.pdf)).toEqual(pages);
    await undo(win);
    await expect(labels).toHaveText(three);
    await expect(said).toHaveText(`Undone: Moved “${PDF}_2” down in this playlist`);
    await expect.poll(() => firstItem(win, playlistId)).toMatchObject({ order: { mode: 'presentation' } });

    // “Make it an item of its own” from the keyboard's menu (Shift+F10) on its second row: an item of its own straight
    // after the deck, the deck keeping the rest; the keyboard on its row, and it is said.
    await deck.nth(1).focus();
    await win.keyboard.press('Shift+F10');
    const menu = win.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox ? menuBox.x >= 0 && menuBox.x + menuBox.width <= size.width : false).toBe(true);
    expect(menuBox ? menuBox.y + menuBox.height <= size.height : false).toBe(true);
    await menu.getByRole('menuitem', { name: 'Make it an item of its own' }).press('Enter');
    const all = win.getByTestId('open-playlist').getByTestId('playlist-item');
    await expect(all).toHaveCount(5);
    const made = (await all.nth(1).getAttribute('data-item-id')) ?? '';
    expect(order).not.toContain(made);
    await expect(labels).toHaveText([`${PDF}_1`, `${PDF}_3`]);
    await expect(slideRows(win, made).getByTestId('slide-label')).toHaveText([`${PDF}_2`]);
    await expect(slideRows(win, made).first()).toBeFocused();
    await expect(said).toHaveText(`Took “${PDF}_2” out of “${PDF}”`);
    // The library's presentation as it was; nothing in the middle runs past its right edge.
    expect(await pageIds(win, ids.pdf)).toEqual(pages);
    expect(
      await win.getByTestId('column-middle').evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    // One Undo: the deck has its three pages again and the new item is gone.
    await undo(win);
    await expect(all).toHaveCount(4);
    await expect(labels).toHaveText(three);
    await expect.poll(() => itemIds(win)).toEqual(order);
    await expect.poll(() => firstItem(win, playlistId)).toMatchObject({ order: { mode: 'presentation' } });
    await app.close();
  });
}

test('Simple Mode: Alt+↓ moves a slide’s row within its deck as its drag does there, with Undo; its menu stays Rename and Delete', async () => {
  test.setTimeout(180_000);
  const { app, win, items } = await start(CI_WINDOW, 3);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const deck = slideRows(win, items.pdf);
  const labels = deck.getByTestId('slide-label');
  await deck.nth(1).focus();
  await win.keyboard.press('Alt+ArrowDown');
  await expect(labels).toHaveText([`${PDF}_1`, `${PDF}_3`, `${PDF}_2`]);
  await expect(deck.nth(2)).toBeFocused();
  await expect(win.getByTestId('undo-said')).toHaveText(`Moved “${PDF}_2” down in this playlist`);
  await undo(win);
  await expect(labels).toHaveText([`${PDF}_1`, `${PDF}_2`, `${PDF}_3`]);
  // A slide's row's menu in Simple Mode: Delete alone (Rename and Delete only, as the owner asked for Simple Mode).
  await deck.nth(1).focus();
  await win.keyboard.press('Shift+F10');
  await expect(win.getByRole('menu').getByRole('menuitem')).toHaveText([`Remove “${PDF}” from playlist`]);
  await win.keyboard.press('Escape');
  await app.close();
});

for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
  test(`the playlist’s rows and the menu fit at ${String(size.width)} × ${String(size.height)}`, async () => {
    test.setTimeout(120_000);
    const { app, win, items } = await start(size);
    const middle = win.getByTestId('column-middle');
    const box = await middle.boundingBox();
    const first = await slideRows(win, items.pdf).first().boundingBox();
    expect(box && first ? first.x + first.width <= box.x + box.width + 1 : false).toBe(true);
    // Nothing in the middle runs past its right edge.
    const over = await middle.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await slideRows(win, items.words).first().click({ button: 'right' });
    const menuBox = await win.getByRole('menu').boundingBox();
    expect(menuBox ? menuBox.x >= 0 && menuBox.x + menuBox.width <= size.width : false).toBe(true);
    expect(menuBox ? menuBox.y + menuBox.height <= size.height : false).toBe(true);
    await win.keyboard.press('Escape');
    await app.close();
  });
}
