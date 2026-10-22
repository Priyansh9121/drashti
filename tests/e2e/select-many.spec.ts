import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, openLibrary, operatorPage, operatorReady } from './helpers';
import { makeTestTone } from './test-media';

/*
 * Choosing many, deleting many (Session 44; Priyansh: "i should be able to select via arrow drag and scroll via
 * select drag arrow and delete multiple stuff at once"): a box dragged with the mouse from an empty place in a
 * list (scrolling it by itself at its edge), Shift-click and Cmd-click (Ctrl-click), Cmd-A (Ctrl-A); then
 * Delete, Backspace or the Delete button takes them all, and one Undo brings them all back. A box never starts
 * on a show control. The count is said to a screen reader. Placeholder names and generated tones only.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Drag a box in `list` from one point to another (in the list's own pixels), holding it there a while. */
async function dragBox(
  win: Page,
  list: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
  holdMs = 0,
): Promise<void> {
  const box = await list.boundingBox();
  if (!box) throw new Error('the list is not in view');
  await win.mouse.move(box.x + from.x, box.y + from.y);
  await win.mouse.down();
  await win.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  await expect(win.getByTestId('select-box')).toHaveCount(1);
  if (holdMs > 0)
    await letTimePass(win, holdMs, 'the list scrolls by itself while the box is held at its edge');
  await win.mouse.up();
  await expect(win.getByTestId('select-box')).toHaveCount(0);
}

const marked = (items: Locator) =>
  items.evaluateAll((els) => els.filter((e) => e.getAttribute('data-marked') === 'true').length);

test('a playlist’s items: a box that scrolls the list, Shift and Cmd clicks, Cmd-A, Delete for all, one Undo', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  // Thirty headers: more than the open playlist shows at once.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder long sabha', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(
      made.ids[0] ?? '',
      null,
      Array.from({ length: 30 }, (_, i) => ({
        kind: 'header' as const,
        label: `Placeholder part ${String(i + 1)}`,
      })),
    );
  });
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder long sabha' }).click();
  const list = win.getByTestId('open-playlist').getByTestId('playlist-items');
  const items = list.getByTestId('playlist-item');
  await expect(items).toHaveCount(30);

  // A box from the list's left edge (an empty place), down past its bottom edge and held: the list scrolls
  // by itself and the box takes the rows it reaches.
  const size = await list.boundingBox();
  const height = size?.height ?? 0;
  await dragBox(win, list, { x: 5, y: 6 }, { x: 40, y: height - 4 }, 1500);
  const chose = await marked(items);
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const shown = await list.evaluate((el) => Math.floor(el.clientHeight / 40));
  expect(chose, 'the box went on past the rows first in view').toBeGreaterThan(shown);
  await expect(win.getByTestId('open-playlist').getByTestId('chosen-said')).toHaveText(
    `${String(chose)} items chosen`,
  );
  await expectNoSeriousA11yIssues(win, 'a playlist with many items chosen');

  // Delete takes them all at once; one Undo brings them all back.
  await items.nth(1).focus();
  await win.keyboard.press('Delete');
  await expect(items).toHaveCount(30 - chose);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(items).toHaveCount(30);

  // Shift-click a range, Cmd-click one more.
  await items.nth(2).click();
  await items.nth(5).click({ modifiers: ['Shift'] });
  await items.nth(8).click({ modifiers: [mod] });
  await expect.poll(() => marked(items)).toBe(5);
  // Cmd-A: every one; the bar's Remove takes them all, and Undo brings them back.
  await items.nth(0).focus();
  await win.keyboard.press(`${mod}+A`);
  await expect.poll(() => marked(items)).toBe(30);
  await win.getByTestId('open-playlist').getByTestId('chosen-delete').click();
  await expect(items).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(items).toHaveCount(30);

  // A press on a show control never starts a box: the slide grid's picture of a slide is one.
  await win.getByTestId('playlist-close').click();
  const sheet = await openLibrary(win);
  await sheet.getByTestId('presentation-row').first().click();
  const thumb = win.getByTestId('slide-thumb').first();
  const t = await thumb.boundingBox();
  if (!t) throw new Error('no slide shown');
  await win.mouse.move(t.x + 10, t.y + 10);
  await win.mouse.down();
  await win.mouse.move(t.x + 80, t.y + 60, { steps: 6 });
  await expect(win.getByTestId('select-box')).toHaveCount(0);
  await win.mouse.up();
  await app.close();
});

test('playlists, the library’s presentations and Audio’s lists and sounds: many chosen, deleted at once, one Undo', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-select-many-'));
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  const tones = [440, 330, 550].map((hz, i) =>
    makeTestTone(join(dir, `Placeholder tone ${String(i + 1)}.wav`), { seconds: 1, hz }),
  );
  const toneIds = await importAndGetIds(win, tones);
  await win.evaluate(async (ids) => {
    const d = (globalThis as PageGlobals).drashti;
    for (const name of ['Placeholder one', 'Placeholder two', 'Placeholder three'])
      await d.playlists.create(name, null, false);
    for (const name of ['Placeholder music A', 'Placeholder music B']) {
      const made = await d.music.create(name);
      if (made.ok && made.id) await d.music.addTracks(made.id, ids, null);
    }
    await Promise.all(
      ['Placeholder words one', 'Placeholder words two'].map((name) =>
        d.library.newFromWords(name, `${name} line\n`),
      ),
    );
  }, toneIds);

  // Playlists: Cmd-click two, Delete: one question, one Undo.
  const node = (name: string) => win.getByTestId('playlist-node').filter({ hasText: name });
  await node('Placeholder one').click();
  await node('Placeholder three').click({ modifiers: [mod] });
  await expect(win.getByTestId('chosen-bar').first()).toContainText('2 playlists and folders chosen');
  await node('Placeholder three').press('Delete');
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText('Delete 2 playlists?');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(node('Placeholder one')).toHaveCount(0);
  await expect(node('Placeholder three')).toHaveCount(0);
  await expect(node('Placeholder two')).toHaveCount(1);
  await expect(win.getByTestId('undo-removal')).toContainText('Deleted 2 playlists');
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(node('Placeholder one')).toHaveCount(1);
  await expect(node('Placeholder three')).toHaveCount(1);

  // The library's presentations: Cmd-A, the bar's Delete: one question for all, one Undo.
  const sheet = await openLibrary(win);
  const rows = sheet.getByTestId('presentation-row');
  const before = await rows.count();
  // A box from the list's left edge over the first two rows (it draws only the rows in view; the box goes by
  // where they lie).
  const library = sheet.getByTestId('presentation-list');
  await dragBox(win, library, { x: 3, y: 4 }, { x: 60, y: 100 });
  await expect(sheet.getByTestId('chosen-bar')).toContainText('2 presentations chosen');
  await rows.first().click();
  await win.keyboard.press(`${mod}+A`);
  await expect(sheet.getByTestId('chosen-bar')).toContainText(`${String(before)} presentations chosen`);
  await expectNoSeriousA11yIssues(
    win,
    'the library with every presentation chosen',
    '[data-testid="library-sheet"]',
  );
  await sheet.getByTestId('chosen-delete').click();
  await expect(confirm).toContainText(`Delete ${String(before)} presentations?`);
  // What becomes of their playlists' cards, for several (Session 51).
  await expect(confirm).toContainText(
    'Any playlist they are in keeps their cards, marked Removed from the library, and Next goes past them.',
  );
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(rows).toHaveCount(before);
  await win.getByTestId('library-close').click();

  // Audio: both lists by Cmd-A, then Backspace; one Undo. Then two sounds taken out at once.
  const panel = win.getByTestId('music-panel');
  const lists = panel.getByTestId('music-playlist');
  await lists.first().click();
  await win.keyboard.press(`${mod}+A`);
  await expect(panel.getByTestId('chosen-bar')).toContainText('2 audio playlists chosen');
  await lists.first().press('Backspace');
  await expect(win.getByRole('alertdialog')).toContainText('Delete 2 audio playlists?');
  await win.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(lists).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(lists).toHaveCount(2);
  const tracks = panel.getByTestId('music-track');
  await expect(tracks).toHaveCount(3);
  await tracks
    .nth(0)
    .getByRole('button', { name: /^Play from/u })
    .click({ modifiers: [mod] });
  await tracks
    .nth(2)
    .getByRole('button', { name: /^Play from/u })
    .click({ modifiers: [mod] });
  await expect(panel.getByTestId('chosen-said').last()).toHaveText('2 sounds chosen');
  await panel.getByTestId('chosen-bar').last().getByTestId('chosen-delete').click();
  await expect(tracks).toHaveCount(1);
  await expect(tracks).toContainText('Placeholder tone 2');
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(tracks).toHaveText([/Placeholder tone 1/u, /Placeholder tone 2/u, /Placeholder tone 3/u]);
  await expectNoSeriousA11yIssues(win, 'Audio with sounds chosen', '[data-testid="audio-group"]');
  await app.close();
});
