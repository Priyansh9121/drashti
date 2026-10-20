import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * A visible delete, with Undo (Session 26a: "nothing has a visible delete"):
 * a trash button on the chosen (or hovered) row, and Delete in each row's
 * menu, doing what the Delete key does: a playlist, a playlist item (out of
 * the playlist only), a presentation, a media item (new: media could not be
 * removed at all), and music and a sound in it. Undo brings each back.
 */

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });
const song = (uuid: string, text: string) =>
  pp6Presentation({ uuid, groups: [{ name: 'Verse', uuid: `${uuid}-G`, slides: [line(text)] }] });

async function start() {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-delete-'));
  const one = join(dir, 'Placeholder Song One.pro6');
  writeFileSync(one, song('E2E-DEL-ONE', 'Placeholder Foxtrot words'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder Darshan.png'), { color: '#1e3a8a' });
  const tone = makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 2, hz: 440 });
  const tone2 = makeTestTone(join(dir, 'Placeholder tone two.wav'), { seconds: 2, hz: 330 });
  const [songId, pictureId] = await importAndGetIds(win, [one, picture, tone, tone2]);
  await win.evaluate(
    async ({ songId: s, pictureId: p }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder Sunday', null, false);
      const id = made.ok ? (made.ids[0] ?? '') : '';
      await d.playlists.addItems(id, null, [
        { kind: 'presentation', presentationId: s ?? '' },
        { kind: 'media', mediaId: p ?? '' },
      ]);
      await d.playlists.create('Placeholder Youth', null, false);
    },
    { songId, pictureId },
  );
  const undo = win.getByTestId('undo-removal');
  const panel = win.getByTestId('playlists');
  const node = (name: string) => panel.getByTestId('playlist-node').filter({ hasText: name });
  await expect(node('Placeholder Sunday')).toBeVisible();
  return { app, win, userData, undo, panel, node };
}

test('each row has a visible delete (playlist, playlist item, presentation, media, music and a sound), and Undo brings each back', async () => {
  test.setTimeout(150_000);
  const { app, win, undo, panel, node } = await start();
  const undoLast = () => undo.getByRole('button', { name: /Undo/ }).click();

  // A playlist: its row's trash, shown on the chosen row (a Tab stop); it asks first.
  await node('Placeholder Youth').focus();
  await expect(panel.getByRole('button', { name: 'Delete playlist “Placeholder Youth”' })).toHaveCount(0);
  await node('Placeholder Youth').click({ button: 'right' });
  await win.keyboard.press('Escape');
  const youthDelete = panel.getByRole('button', { name: 'Delete playlist “Placeholder Youth”' });
  await expect(youthDelete).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the playlists with a delete button');
  await youthDelete.click();
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText('Delete playlist “Placeholder Youth”?');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(node('Placeholder Youth')).toHaveCount(0);
  await expect(undo).toContainText('Deleted playlist “Placeholder Youth”');
  await undoLast();
  await expect(node('Placeholder Youth')).toBeVisible();

  // A playlist item: out of the playlist only, no question; the keyboard reaches its trash.
  await node('Placeholder Sunday').click();
  const items = win.getByTestId('open-playlist').getByTestId('playlist-item');
  await expect(items).toHaveCount(2);
  await items.first().click();
  const itemDelete = win
    .getByTestId('open-playlist')
    .getByRole('button', { name: 'Remove “Placeholder Song One” from the playlist' });
  await expect(itemDelete).toBeVisible();
  // Last in its Tab order: after Up (off at the top) and Down.
  await items.first().focus();
  await win.keyboard.press('Tab');
  await expect(win.getByTestId('open-playlist').getByRole('button', { name: 'Down' })).toBeFocused();
  await win.keyboard.press('Tab');
  await expect(itemDelete).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(items).toHaveCount(1);
  await expect(undo).toContainText('Removed “Placeholder Song One” from “Placeholder Sunday”');
  await undoLast();
  await expect(items).toHaveCount(2);
  await expect(items.first().locator('[data-label]')).toHaveText('Placeholder Song One');
  // Still in the library: nothing but the playlist lost it.
  await openLibrary(win);
  await expect(
    win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Placeholder Song One' }),
  ).toHaveCount(1);

  // A presentation: its row's trash asks, as the Delete key does.
  const row = win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: 'Placeholder Song One' });
  await row.click();
  await win.getByRole('button', { name: 'Delete “Placeholder Song One”' }).click();
  await expect(confirm).toContainText('Delete “Placeholder Song One”?');
  await expectNoSeriousA11yIssues(win, 'the question before deleting a presentation');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await expect(undo).toContainText('Deleted “Placeholder Song One”');
  await undoLast();
  await expect(row).toHaveCount(1);
  // Delete… in its menu (right-click) too.
  await row.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Delete…' }).click();
  await expect(confirm).toContainText('Delete “Placeholder Song One”?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toHaveCount(1);

  // A media item (new): the question says where it is used; it leaves the playlist; Undo puts it back.
  await win.getByTestId('library-tab-media').click();
  const picture = win.getByTestId('media-item').filter({ hasText: 'Placeholder Darshan' });
  await picture.click();
  await win.getByRole('button', { name: 'Delete “Placeholder Darshan.png”' }).click();
  const mediaConfirm = win.getByTestId('media-remove-confirm');
  await expect(mediaConfirm).toContainText('Delete “Placeholder Darshan.png”?');
  await expect(mediaConfirm.getByTestId('media-usage')).toContainText(
    'The playlist “Placeholder Sunday”: taken out of it.',
  );
  await expectNoSeriousA11yIssues(win, 'the question before deleting media');
  await mediaConfirm.getByRole('button', { name: 'Delete' }).click();
  await expect(picture).toHaveCount(0);
  await expect(items).toHaveCount(1);
  await expect(undo).toContainText('Deleted “Placeholder Darshan.png”');
  await chooseMenuItem(app, 'undo');
  await expect(picture).toHaveCount(1);
  await expect(items).toHaveCount(2);
  await expect(items.last()).toHaveAttribute('data-kind', 'media');
  // The Delete key on the media list asks the same question.
  await picture.click();
  await win.keyboard.press('Delete');
  await expect(mediaConfirm).toBeVisible();
  await mediaConfirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(picture).toHaveCount(1);

  // Music and a sound in it.
  const music = win.getByTestId('music-panel');
  await win.getByTestId('audio-add').click();
  await win.getByRole('menuitem', { name: 'Create playlist' }).click();
  await win.getByRole('textbox', { name: 'Name of the audio playlist' }).press('Enter');
  await music.getByTestId('music-add').click();
  const add = win.getByTestId('music-add-dialog');
  await add.getByLabel('Placeholder tone.wav').check();
  await add.getByLabel('Placeholder tone two.wav').check();
  await add.getByTestId('music-add-ticked').click();
  const tracks = music.getByTestId('music-track');
  await expect(tracks).toHaveCount(2);
  await music.getByRole('button', { name: 'Remove “Placeholder tone.wav” from the music' }).click();
  await expect(tracks).toHaveCount(1);
  await undoLast();
  await expect(tracks).toHaveCount(2);
  await expect(tracks.first()).toContainText('Placeholder tone.wav');
  await music.getByTestId('music-delete').click();
  const musicConfirm = win.getByRole('alertdialog', { name: /Delete music/ });
  await musicConfirm.getByRole('button', { name: 'Delete' }).click();
  await expect(music.getByTestId('music-playlist')).toHaveCount(0);
  await expect(undo).toContainText('Deleted music');
  await undoLast();
  await expect(tracks).toHaveCount(2);
  await app.close();
});

test('deleted media is gone for good at the next start (its file too), never while it can be undone', async () => {
  const { app, win, userData } = await start();
  const listMedia = (page: typeof win) =>
    page.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
  const picture = (await listMedia(win)).find((m) => m.name === 'Placeholder Darshan.png');
  if (!picture) throw new Error('the picture was not imported');
  const pathOf = () => {
    const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
    try {
      return db.prepare('SELECT path, missing, deleted_at FROM media WHERE id = ?').get(picture.id) as {
        path: string;
        missing: number;
        deleted_at: string | null;
      };
    } finally {
      db.close();
    }
  };
  const stored = pathOf().path;
  expect(stored).not.toBe('');
  const removed = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.media.remove([id]),
    picture.id,
  );
  expect(removed.ok).toBe(true);
  expect((await listMedia(win)).map((m) => m.name)).not.toContain('Placeholder Darshan.png');
  // Its file stays while Undo can still bring it back.
  expect(existsSync(join(userData, 'Media', stored))).toBe(true);
  await app.close();

  // The next start: it can no longer be undone, so its file goes; its row stays as a missing file.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await expect.poll(() => existsSync(join(userData, 'Media', stored))).toBe(false);
  expect(pathOf()).toMatchObject({ path: '', missing: 1 });
  expect((await listMedia(win2)).map((m) => m.name)).not.toContain('Placeholder Darshan.png');
  await again.app.close();
});
