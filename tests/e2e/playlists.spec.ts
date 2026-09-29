import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Playlist, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { importAndGetIds, launchApp, operatorPage } from './helpers';
import { makeTestImage } from './test-media';

/*
 * Playlists in the operator window: an imported playlist with its folder,
 * header and a placeholder; building a new playlist by dragging from the
 * library; reordering; headers; removing with Undo.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });
const song = (uuid: string, text: string) =>
  pp6Presentation({ uuid, groups: [{ name: 'Verse', uuid: `${uuid}-G`, slides: [line(text)] }] });

/**
 * Drag with the mouse, as the operator does: onto the top, middle or bottom
 * of the target. Moved in steps (Playwright's dragTo in one move sometimes
 * never starts the drag, or drops without its data).
 */
async function drag(page: Page, source: Locator, target: Locator, where: 'top' | 'middle' | 'bottom') {
  await source.hover();
  const from = await source.boundingBox();
  const box = await target.boundingBox();
  if (!from || !box) throw new Error('the drag source or drop target is not visible');
  const y = box.y + (where === 'top' ? 3 : where === 'bottom' ? box.height - 3 : box.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8);
  await page.mouse.move(box.x + box.width / 2, y, { steps: 5 });
  await page.mouse.up();
}

/** Each item as "kind:label" (poll it: the list updates after a drop's round trip to the main process). */
const labels = (items: Locator) =>
  items.evaluateAll((els) =>
    els.map(
      (e) =>
        `${e.getAttribute('data-kind') ?? ''}:${e.querySelector('[data-label]')?.textContent.trim() ?? ''}`,
    ),
  );

test('playlists: imported ones with their placeholders, and building one by dragging from the library', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-playlists-'));
  const one = join(dir, 'Placeholder Song One.pro6');
  const two = join(dir, 'Placeholder Song Two.pro6');
  writeFileSync(one, song('E2E-ONE', 'Placeholder song one'));
  writeFileSync(two, song('E2E-TWO', 'Placeholder song two'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder Picture.png'));
  const list = join(dir, 'Default.pro6pl');
  writeFileSync(
    list,
    pp6Playlist([
      {
        name: 'Sunday',
        entries: [
          { header: 'Opening' },
          {
            document: '/Users/mandir/Documents/ProPresenter6/Placeholder Song One.pro6',
            name: 'Placeholder Song One',
          },
          { document: '/Users/mandir/Documents/ProPresenter6/Not Here.pro6', name: 'Not Here' },
        ],
      },
    ]),
  );
  await importAndGetIds(win, [one, two, picture]);
  await importAndGetIds(win, [list]);

  const panel = win.getByTestId('playlists');
  const tree = panel.getByTestId('playlist-tree');
  const node = (name: string) => tree.getByTestId('playlist-node').filter({ hasText: name });
  const items = panel.getByTestId('playlist-item');
  const presentations = win.getByTestId('presentation-list');

  // The imported folder and playlist, with the item the import could not find counted.
  await expect(node('Services')).toHaveAttribute('data-kind', 'folder');
  await expect(node('Sunday').getByTestId('node-placeholders')).toHaveText('1 missing');
  await node('Sunday').click();
  await expect(panel.getByTestId('playlist-title')).toHaveText('Sunday');
  await expect
    .poll(() => labels(items))
    .toEqual(['header:Opening', 'presentation:Placeholder Song One', 'placeholder:Not Here']);

  // Dropping a presentation on the placeholder puts it there.
  await drag(
    win,
    presentations.getByRole('button', { name: /Placeholder Song Two/ }),
    items.nth(2),
    'middle',
  );
  await expect(items.nth(2)).toHaveAttribute('data-kind', 'presentation');
  await expect(items.nth(2).locator('[data-label]')).toHaveText('Placeholder Song Two');
  // Clicking a presentation item shows its slides.
  await items.nth(1).click();
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Song One',
  );
  await panel.getByTestId('playlists-back').click();
  await expect(node('Sunday').getByTestId('node-placeholders')).toHaveCount(0);

  // A new playlist, named in place.
  await panel.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'New playlist' }).click();
  const rename = panel.getByTestId('rename-field');
  await expect(rename).toBeFocused();
  await rename.fill('Evening Sabha');
  await rename.press('Enter');
  await expect(node('Evening Sabha')).toBeVisible();

  // Dropping on a playlist in the list adds to its end.
  await drag(
    win,
    presentations.getByRole('button', { name: /Placeholder Song One/ }),
    node('Evening Sabha'),
    'middle',
  );
  await expect(node('Evening Sabha')).toContainText('1');
  await node('Evening Sabha').click();
  await expect(items).toHaveCount(1);

  // Drag in a presentation before it, and a picture from the media list after it.
  await drag(win, presentations.getByRole('button', { name: /Placeholder Song Two/ }), items.first(), 'top');
  await win.getByTestId('library-tab-media').click();
  const media = win.getByTestId('media-item').filter({ hasText: 'Placeholder Picture' });
  await expect(media).toContainText('Picture');
  await drag(win, media, items.last(), 'bottom');
  await expect
    .poll(() => labels(items))
    .toEqual([
      'presentation:Placeholder Song Two',
      'presentation:Placeholder Song One',
      'media:Placeholder Picture.png',
    ]);

  // A header, named in place, then dragged to the top.
  await panel.getByRole('button', { name: 'Playlist actions' }).click();
  await win.getByRole('menuitem', { name: 'Add a header' }).click();
  await expect(rename).toBeFocused();
  await rename.fill('Placeholder Dhun');
  await rename.press('Enter');
  await expect(items.last().locator('[data-label]')).toHaveText('Placeholder Dhun');
  await drag(win, items.last(), items.first(), 'top');
  await expect
    .poll(() => labels(items))
    .toEqual([
      'header:Placeholder Dhun',
      'presentation:Placeholder Song Two',
      'presentation:Placeholder Song One',
      'media:Placeholder Picture.png',
    ]);

  // Removing an item: Delete, then Undo puts it back where it was.
  await items.nth(2).click();
  await win.keyboard.press('Delete');
  await expect(items).toHaveCount(3);
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Removed “Placeholder Song One” from “Evening Sabha”');
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect(items).toHaveCount(4);
  await expect(items.nth(2).locator('[data-label]')).toHaveText('Placeholder Song One');
  await expect(undo).toHaveCount(0);

  // Removing the playlist asks first; Undo brings it back with its items.
  await panel.getByTestId('playlists-back').click();
  await node('Evening Sabha').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Remove…' }).click();
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText('Remove playlist “Evening Sabha”?');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(node('Evening Sabha')).toHaveCount(0);
  await expect(undo).toContainText('Removed playlist “Evening Sabha”');
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('undo')?.click();
  });
  await expect(node('Evening Sabha')).toBeVisible();
  await node('Evening Sabha').click();
  await expect(items).toHaveCount(4);

  // Removing a folder takes its playlists with it (the new one was made beside Sunday, in
  // the same folder); the library keeps the presentations, and Undo brings it all back.
  await panel.getByTestId('playlists-back').click();
  await node('Services').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Remove…' }).click();
  await expect(confirm).toContainText('Remove folder “Services”?');
  await expect(confirm).toContainText('The 2 playlists in it go too.');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(tree.getByTestId('playlist-node')).toHaveCount(0);
  await win.getByTestId('library-tab-presentations').click();
  // The two sample presentations a new library starts with, and the two imported.
  await expect(presentations.getByRole('button')).toHaveCount(4);
  await undo.getByRole('button', { name: /Undo/ }).click();
  await expect(tree.getByTestId('playlist-node')).toHaveCount(3);

  await app.close();
});
