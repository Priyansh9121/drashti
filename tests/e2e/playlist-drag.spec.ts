import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import { dropFiles, importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { mouseDrag } from './mouse-drag';
import { makeTestImage } from './test-media';

/*
 * Dragging into a playlist with the mouse (Session 26a): Priyansh dragged a
 * deck's presentation into an empty playlist on the alpha.3 dry run, and
 * nothing happened. Every way in: from a chosen row and an unchosen one, from
 * Presentations, Media and search results, a deck made from a .pptx, into an
 * empty open playlist, a full one and a playlist's row in the list; and files
 * from the Finder or Explorer dropped on the open playlist.
 *
 * The mouse moves are real (page.mouse), but the drag is Chromium's own,
 * replayed by Playwright: not a native macOS drag session (mouse-drag.ts).
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });
const song = (uuid: string, text: string) =>
  pp6Presentation({ uuid, groups: [{ name: 'Verse', uuid: `${uuid}-G`, slides: [line(text)] }] });

/** Each item as "kind:label" (polled: the list updates after a drop's round trip to the main process). */
const labels = (items: Locator) =>
  items.evaluateAll((els) =>
    els.map(
      (e) =>
        `${e.getAttribute('data-kind') ?? ''}:${e.querySelector('[data-label]')?.textContent.trim() ?? ''}`,
    ),
  );

/** A library like the one Priyansh tried: songs, pictures and a deck made from a .pptx. */
async function setUp(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-drag-'));
  const files: string[] = [];
  for (const [n, word] of [
    ['One', 'Alpha'],
    ['Two', 'Bravo'],
    ['Three', 'Charlie'],
  ] as const) {
    const file = join(dir, `Placeholder Song ${n}.pro6`);
    writeFileSync(file, song(`E2E-DRAG-${n.toUpperCase()}`, `Placeholder ${word} words`));
    files.push(file);
  }
  files.push(await makeTestImage(page, join(dir, 'Placeholder Picture A.png'), { color: '#1e3a8a' }));
  files.push(await makeTestImage(page, join(dir, 'Placeholder Picture B.png'), { color: '#7c2d12' }));
  const deck = join(dir, 'Placeholder Katha.pptx');
  writeFileSync(
    deck,
    makeTestPptx([
      { color: '14532D', text: 'Placeholder slide one' },
      { color: '581C87', text: 'Placeholder slide two' },
    ]),
  );
  files.push(deck);
  const ids = await importAndGetIds(page, files);
  expect(
    ids.every((id) => id !== ''),
    'every file imported',
  ).toBe(true);
  await page.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.playlists.create('Placeholder Empty', null, false);
    await d.playlists.create('Placeholder Other', null, false);
  });
  return dir;
}

async function start() {
  // The stand-in saves a .pptx as PDF, as PowerPoint would (CI's computers have no PowerPoint).
  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const dir = await setUp(win);
  const panel = win.getByTestId('playlists');
  const node = (name: string) => panel.getByTestId('playlist-node').filter({ hasText: name });
  const items = win.getByTestId('open-playlist').getByTestId('playlist-item');
  const presentation = (name: string) =>
    win.getByTestId('presentation-list').getByRole('button', { name: new RegExp(`^${name}`, 'u') });
  await expect(node('Placeholder Empty')).toBeVisible();
  return { app, win, dir, node, items, presentation };
}

test('dragging presentations and a .pptx deck into an empty open playlist and a full one, from a chosen row and an unchosen one', async () => {
  const { app, win, node, items, presentation } = await start();
  await node('Placeholder Empty').click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-title')).toHaveText(
    'Placeholder Empty',
  );
  const list = win.getByTestId('open-playlist').getByTestId('playlist-items');
  await expect(list).toHaveAttribute('data-count', '0');

  // The chosen row (it has Add to playlist under it), into the empty playlist: what Priyansh did.
  await presentation('Placeholder Katha').click();
  await expect(win.getByTestId('add-to-playlist')).toBeVisible();
  await mouseDrag(win, presentation('Placeholder Katha'), list, 'middle');
  await expect.poll(() => labels(items)).toEqual(['presentation:Placeholder Katha']);
  // Its card says what it is and how many slides (Session 26a).
  await expect(items.first().getByTestId('item-what')).toHaveText('Deck · 2 slides');

  // An unchosen row, with the chosen one above it, to the end.
  await mouseDrag(win, presentation('Placeholder Song One'), items.last(), 'bottom');
  // And between two items of a full playlist.
  await mouseDrag(win, presentation('Placeholder Song Two'), items.last(), 'top');
  await expect
    .poll(() => labels(items))
    .toEqual([
      'presentation:Placeholder Katha',
      'presentation:Placeholder Song Two',
      'presentation:Placeholder Song One',
    ]);
  // A chosen row again, now that a playlist item is chosen (it has Up and Down under it).
  await items.first().click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item-moves')).toBeVisible();
  await presentation('Placeholder Song Three').click();
  await mouseDrag(win, presentation('Placeholder Song Three'), items.first(), 'top');
  await expect
    .poll(() => labels(items))
    .toEqual([
      'presentation:Placeholder Song Three',
      'presentation:Placeholder Katha',
      'presentation:Placeholder Song Two',
      'presentation:Placeholder Song One',
    ]);
  // Anywhere on the open playlist (Session 26a): dropped on its name, it goes at the end.
  await mouseDrag(win, presentation('Placeholder Katha'), win.getByTestId('playlist-title'), 'middle');
  await expect.poll(async () => (await labels(items)).at(-1)).toBe('presentation:Placeholder Katha');
  await expect(items).toHaveCount(5);
  await app.close();
});

test('dragging pictures from Media, chosen and unchosen, and onto a playlist’s row in the list', async () => {
  const { app, win, node, items, presentation } = await start();
  await node('Placeholder Empty').click();
  const list = win.getByTestId('open-playlist').getByTestId('playlist-items');
  await win.getByTestId('library-tab-media').click();
  const picture = (name: string) => win.getByTestId('media-item').filter({ hasText: name });
  // A chosen picture (Add to playlist under it), into the empty playlist.
  await picture('Placeholder Picture A').click();
  await expect(win.getByTestId('add-to-playlist')).toBeVisible();
  await mouseDrag(win, picture('Placeholder Picture A'), list, 'middle');
  await expect.poll(() => labels(items)).toEqual(['media:Placeholder Picture A.png']);
  await expect(items.first().getByTestId('item-what')).toHaveText('Picture');
  // An unchosen picture below the chosen one: starting the drag chooses it.
  await mouseDrag(win, picture('Placeholder Picture B'), items.last(), 'bottom');
  await expect
    .poll(() => labels(items))
    .toEqual(['media:Placeholder Picture A.png', 'media:Placeholder Picture B.png']);
  // Back up an unchosen one, above the chosen one.
  await mouseDrag(win, picture('Placeholder Picture A'), items.first(), 'top');
  await expect
    .poll(() => labels(items))
    .toEqual([
      'media:Placeholder Picture A.png',
      'media:Placeholder Picture A.png',
      'media:Placeholder Picture B.png',
    ]);

  // Onto a playlist's row in the list (no playlist open): it goes at the end.
  await win.getByTestId('playlist-close').click();
  await mouseDrag(win, picture('Placeholder Picture B'), node('Placeholder Other'), 'middle');
  await expect(node('Placeholder Other')).toContainText('1');
  await win.getByTestId('library-tab-presentations').click();
  await presentation('Placeholder Song One').click();
  await mouseDrag(win, presentation('Placeholder Song One'), node('Placeholder Other'), 'middle');
  await expect(node('Placeholder Other')).toContainText('2');
  await node('Placeholder Other').click();
  await expect
    .poll(() => labels(items))
    .toEqual(['media:Placeholder Picture B.png', 'presentation:Placeholder Song One']);
  await app.close();
});

test('a search result can be dragged into a playlist', async () => {
  const { app, win, node, items } = await start();
  await node('Placeholder Empty').click();
  await win.getByTestId('library-search').fill('Bravo');
  const hit = win.getByTestId('search-hit').filter({ hasText: 'Placeholder Song Two' });
  await expect(hit).toBeVisible();
  await mouseDrag(win, hit, win.getByTestId('open-playlist').getByTestId('playlist-items'), 'middle');
  await expect.poll(() => labels(items)).toEqual(['presentation:Placeholder Song Two']);
  await app.close();
});

/** The three songs, in order, in Placeholder Empty. */
const addSongs = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const tree = await d.playlists.tree();
    const empty = tree.find((n) => n.name === 'Placeholder Empty');
    const presentations = await d.library.listPresentations();
    const ids = ['Placeholder Song One', 'Placeholder Song Two', 'Placeholder Song Three'].map(
      (name) => presentations.find((p) => p.name === name)?.id ?? '',
    );
    if (empty)
      await d.playlists.addItems(
        empty.id,
        null,
        ids.map((presentationId) => ({ kind: 'presentation', presentationId })),
      );
  });
const one = 'presentation:Placeholder Song One';
const two = 'presentation:Placeholder Song Two';
const three = 'presentation:Placeholder Song Three';

test('reordering a playlist by dragging, from the chosen item and an unchosen one, with Undo, Up and Down, and Alt+arrows', async () => {
  const { app, win, node, items } = await start();
  await addSongs(win);
  await node('Placeholder Empty').click();
  await expect.poll(() => labels(items)).toEqual([one, two, three]);
  // The chosen item (Up and Down under it) to the end.
  await items.first().click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item-moves')).toBeVisible();
  await mouseDrag(win, items.first(), items.last(), 'bottom');
  await expect.poll(() => labels(items)).toEqual([two, three, one]);
  // An unchosen item below the chosen one (whose Up and Down hide as the drag starts) to the top.
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item-moves')).toBeVisible();
  await mouseDrag(win, items.nth(1), items.first(), 'top');
  await expect.poll(() => labels(items)).toEqual([three, two, one]);
  // Undo takes the move back.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => labels(items)).toEqual([two, three, one]);
  // Up and Down, and Alt+arrows, still move the chosen item.
  await items.nth(2).click();
  await win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item-moves')
    .getByRole('button', { name: 'Up' })
    .click();
  await expect.poll(() => labels(items)).toEqual([two, one, three]);
  await win.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => labels(items)).toEqual([one, two, three]);
  await win.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => labels(items)).toEqual([two, one, three]);
  await app.close();
});

test('after a move the keyboard never leaves the item, not for a frame: a key pressed straight after a move is never lost', async () => {
  const { app, win, node, items } = await start();
  await addSongs(win);
  await node('Placeholder Empty').click();
  await expect.poll(() => labels(items)).toEqual([one, two, three]);
  await items.first().click();
  await expect(items.first()).toBeFocused();
  // Each time the list is drawn anew, where the keyboard is. On nothing, or on a button just turned off,
  // a key pressed then went nowhere (Checkpoint D: an Alt+Down on Windows CI, a frame after an Alt+Up).
  await win.evaluate(() => {
    const list = document.querySelector('[data-testid="open-playlist"] [data-testid="playlist-items"]');
    if (!list) throw new Error('no open playlist');
    const lost: string[] = [];
    (globalThis as { keyboardLost?: string[] }).keyboardLost = lost;
    new MutationObserver(() => {
      const now = document.activeElement;
      if (now === null || now === document.body) lost.push('on nothing');
      else if (now instanceof HTMLButtonElement && now.disabled)
        lost.push(`on ${now.textContent.trim()}, which had gone off`);
    }).observe(list, { childList: true, subtree: true });
  });
  // The item down from itself: its row is taken out of the list and put back lower.
  await win.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => labels(items)).toEqual([two, one, three]);
  // Up again from its Up, which goes off at the top.
  await win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item-moves')
    .getByRole('button', { name: 'Up' })
    .focus();
  await win.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => labels(items)).toEqual([one, two, three]);
  await expect(items.first()).toBeFocused();
  expect(await win.evaluate(() => (globalThis as { keyboardLost?: string[] }).keyboardLost)).toEqual([]);
  await app.close();
});

test('files from the Finder or Explorer dropped on the open playlist are imported and added where they land, in order', async () => {
  const { app, win, dir, node, items, presentation } = await start();
  await node('Placeholder Empty').click();
  const list = win.getByTestId('open-playlist').getByTestId('playlist-items');
  await presentation('Placeholder Song One').click();
  await mouseDrag(win, presentation('Placeholder Song One'), list, 'middle');
  await mouseDrag(win, presentation('Placeholder Song Two'), items.last(), 'bottom');
  await expect
    .poll(() => labels(items))
    .toEqual(['presentation:Placeholder Song One', 'presentation:Placeholder Song Two']);
  // Two new files, dropped between the two items: imported, then added there, in the order dropped.
  const picture = await makeTestImage(win, join(dir, 'Placeholder Picture C.png'), { color: '#365314' });
  const four = join(dir, 'Placeholder Song Four.pro6');
  writeFileSync(four, song('E2E-DRAG-FOUR', 'Placeholder Delta words'));
  await dropFiles(win, items.last(), [picture, four], { overlay: false, at: 'top' });
  await expect
    .poll(() => labels(items), { timeout: 30_000 })
    .toEqual([
      'presentation:Placeholder Song One',
      'media:Placeholder Picture C.png',
      'presentation:Placeholder Song Four',
      'presentation:Placeholder Song Two',
    ]);
  // Dropped on the empty part below the items: at the end.
  const five = join(dir, 'Placeholder Song Five.pro6');
  writeFileSync(five, song('E2E-DRAG-FIVE', 'Placeholder Echo words'));
  await dropFiles(win, list, [five], { overlay: false });
  await expect.poll(() => labels(items), { timeout: 30_000 }).toHaveLength(5);
  await expect.poll(async () => (await labels(items)).at(-1)).toBe('presentation:Placeholder Song Five');
  await app.close();
});
