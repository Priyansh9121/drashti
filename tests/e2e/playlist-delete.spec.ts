import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';
import { KIRTAN, PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { sizeOperatorWindow } from './window-size';

/*
 * Deleting playlists (Session 56, the owner's words of 11 Nov 2026, item 3): "when the open playlist, or the last one,
 * is deleted, the middle closes it too." The middle never goes on showing a deleted playlist, or what of it was chosen
 * (a slide of its kirtan put up, say); Undo brings the playlist back, open again, as Undo brings other things back
 * where they were. The same with a folder that holds the open playlist, and in Simple Mode. Placeholder names only.
 */

/** A playlist's or folder's row in the list on the left. */
const node = (win: Page, name: string): Locator => win.getByTestId('playlist-node').filter({ hasText: name });

/** Delete… from its row's right-click menu, and Delete in the question. */
async function deleteFromList(win: Page, name: string): Promise<void> {
  await node(win, name).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Delete…' }).click();
  await win.getByTestId('remove-confirm').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(node(win, name)).toHaveCount(0);
}

/** What the middle shows: the open playlist's name, a presentation's slides, the steps to start, or nothing. */
async function middleShows(win: Page): Promise<string> {
  const middle = win.getByTestId('column-middle');
  if ((await middle.getByTestId('open-playlist').count()) > 0)
    return `playlist ${(await middle.getByTestId('playlist-title').textContent()) ?? ''}`;
  if ((await middle.getByTestId('slide-grid').count()) > 0)
    return `slides of ${(await middle.getByTestId('slide-grid').getAttribute('data-presentation-id')) ?? ''}`;
  if ((await middle.getByTestId('start-here').count()) > 0) return 'the steps to start';
  if ((await middle.getByTestId('no-playlist-open').count()) > 0) return 'no playlist open';
  return 'nothing';
}

/** A playlist made beside the others, as New playlist makes one (named at once). */
const makePlaylist = (win: Page, name: string, parentId: string | null = null, isFolder = false) =>
  win.evaluate(
    async ({ name, parentId, isFolder }) => {
      const made = await (globalThis as PageGlobals).drashti.playlists.create(name, parentId, isFolder);
      if (!made.ok) throw new Error(made.message);
      return made.ids[0] ?? '';
    },
    { name, parentId, isFolder },
  );

async function proWithShow(): Promise<{ app: ElectronApplication; win: Page; kirtanId: string }> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  const show = await setUpPlaceholderShow(win);
  return { app, win, kirtanId: show.kirtanId };
}

test('Pro Mode: the open playlist deleted closes in the middle, never its kirtan left there; Undo brings it back open; the last one deleted leaves the middle empty, a folder with the open one in it too', async () => {
  test.setTimeout(150_000);
  const { app, win, kirtanId } = await proWithShow();
  await makePlaylist(win, 'Placeholder youth evening');
  // Open, and a slide of its kirtan put up from its row (the kirtan is then the middle's chosen presentation too).
  await node(win, PLAYLIST).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  await win
    .getByTestId('slide-thumb')
    .filter({ hasText: `${KIRTAN}_2` })
    .click();
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');

  // Deleted while open: the middle closes it, and shows nothing of it (never the kirtan's slides on their own).
  await deleteFromList(win, PLAYLIST);
  await expect.poll(() => middleShows(win)).toBe('the steps to start');
  expect(await middleShows(win)).not.toContain(kirtanId);
  // What was up stays up: deleting a playlist never touches the screens.
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 5');

  // Undo: back, and open again in the middle.
  await chooseMenuItem(app, 'undo');
  await expect(node(win, PLAYLIST)).toBeVisible();
  await expect.poll(() => middleShows(win)).toBe(`playlist ${PLAYLIST}`);

  // Another open (not the last): deleted, the middle closes it too, and opens nothing by itself.
  await node(win, 'Placeholder youth evening').click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder youth evening');
  await deleteFromList(win, 'Placeholder youth evening');
  await expect.poll(() => middleShows(win)).toBe('the steps to start');

  // A folder holding the open playlist: deleted, the middle closes it.
  const folder = await makePlaylist(win, 'Placeholder week', null, true);
  await makePlaylist(win, 'Placeholder inside', folder);
  await node(win, 'Placeholder inside').click();
  await expect(win.getByTestId('playlist-title')).toHaveText('Placeholder inside');
  await deleteFromList(win, 'Placeholder week');
  await expect.poll(() => middleShows(win)).toBe('the steps to start');

  // The last one, open, with its kirtan chosen: deleted, the middle is empty, never a stale one.
  await node(win, PLAYLIST).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
  await win
    .getByTestId('slide-thumb')
    .filter({ hasText: `${KIRTAN}_3` })
    .click();
  await deleteFromList(win, PLAYLIST);
  await expect(win.getByTestId('playlist-node')).toHaveCount(0);
  await expect.poll(() => middleShows(win)).toBe('the steps to start');
  await app.close();
});
