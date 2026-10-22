import type { ElectronApplication } from '@playwright/test';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXAMPLE_TEMPLATES,
  KIRTAN_PRESENTATION_NAME,
  PLACEHOLDERS_CHECKED_KEY,
  TEST_PRESENTATION_NAME,
} from '../../src/main/db/seed';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, NO_PLACEHOLDERS, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Deleting the test presentations (Session 50). A new library starts without Drashti's two placeholder
 * presentations, with the example sabha templates. In a library an earlier Drashti made, each goes at the
 * first start of this one only when it is as Drashti made it and in no playlist, the log says so, and it
 * happens once. And the presentation open in the middle has Delete… in its header's menu, asked first, with
 * Undo, as the library's trash. Session 51: while a playlist item is open there it says Delete from the
 * library…, and the question (the library's trash's too) says it also leaves every playlist. Quiet; nothing
 * here needs a display wider than 1024.
 */

/** The question's line on playlists, from the library's trash and the middle's menu alike (Session 51). */
const LEAVES_PLAYLISTS = 'It also leaves every playlist it is in: each shows it as removed from the library.';

/** The library's presentations and sabha templates, by name, as the operator window is told them. */
async function library(app: ElectronApplication): Promise<{ presentations: string[]; templates: string[] }> {
  const win = await operatorPage(app);
  await operatorReady(win);
  return win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      presentations: (await d.library.listPresentations()).map((p) => p.name),
      templates: (await d.playlists.templates()).map((t) => t.name),
    };
  });
}

/** Drashti's log, line by line, each without its time and level. */
const logLines = (userData: string) =>
  readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/^\S+ \[\w+\] /u, ''));

/** What the log said of each placeholder presentation it removed or kept. */
const saidOfPlaceholders = (userData: string) =>
  logLines(userData).filter((line) => /^(Removed|Kept) the placeholder presentation “/u.test(line));

test('a new library starts without the placeholder presentations, with the example sabha templates', async () => {
  const { app, userData } = await launchApp(NO_PLACEHOLDERS);
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(await library(app)).toEqual({
    presentations: [],
    templates: EXAMPLE_TEMPLATES.map((t) => t.name),
  });
  // Nothing to open: the middle shows nothing chosen, with its steps.
  await expect(win.getByTestId('start-here')).toBeVisible();
  await expect(win.getByTestId('slide-grid')).toHaveCount(0);
  await app.close();
  // A restart keeps it so, though it is given the tests' switch this time (decided at the first start).
  const again = await relaunchApp(userData);
  expect((await library(again.app)).presentations).toEqual([]);
  await again.app.close();
  const said = logLines(userData);
  expect(said).toContain('Added the example sabha templates');
  expect(said).not.toContain('Added the placeholder presentations');
  expect(saidOfPlaceholders(userData)).toEqual([]);
});

test('an earlier Drashti’s library: the first start removes each placeholder as it was made and in no playlist, once', async () => {
  test.setTimeout(120_000);
  // A library with the placeholders, as every new one had before, and the sample kirtan in a playlist.
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await operatorReady(win);
  await win.evaluate(async (kirtanName) => {
    const d = (globalThis as PageGlobals).drashti;
    const kirtan = (await d.library.listPresentations()).find((p) => p.name === kirtanName);
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (!kirtan || !made.ok) throw new Error('There is no sample kirtan, or the playlist was not made');
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: kirtan.id },
    ]);
    if (!added.ok) throw new Error(added.message);
  }, KIRTAN_PRESENTATION_NAME);
  expect((await library(first.app)).presentations).toEqual([
    TEST_PRESENTATION_NAME,
    KIRTAN_PRESENTATION_NAME,
  ]);
  await first.app.close();
  // As an earlier Drashti left it: never looked at by this one.
  const db = new Database(join(first.userData, 'drashti.sqlite'));
  try {
    expect(db.prepare('DELETE FROM app_meta WHERE key = ?').run(PLACEHOLDERS_CHECKED_KEY).changes).toBe(1);
  } finally {
    db.close();
  }

  const second = await relaunchApp(first.userData);
  expect((await library(second.app)).presentations).toEqual([KIRTAN_PRESENTATION_NAME]);
  await second.app.close();
  expect(saidOfPlaceholders(first.userData)).toEqual([
    `Removed the placeholder presentation “${TEST_PRESENTATION_NAME}”: unchanged and in no playlist`,
    `Kept the placeholder presentation “${KIRTAN_PRESENTATION_NAME}”: in a playlist`,
  ]);

  // Once: the next start leaves the library as it is, and says nothing more of them.
  const third = await relaunchApp(first.userData);
  expect((await library(third.app)).presentations).toEqual([KIRTAN_PRESENTATION_NAME]);
  await third.app.close();
  expect(saidOfPlaceholders(first.userData)).toHaveLength(2);
});

test('Delete… in the menu of the presentation open in the middle asks first, deletes it, and Undo brings it back', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const testId = await win.evaluate(
    async (name) =>
      (await (globalThis as PageGlobals).drashti.library.listPresentations()).find((p) => p.name === name)
        ?.id ?? '',
    TEST_PRESENTATION_NAME,
  );
  expect(testId).not.toBe('');
  // The first presentation opens in the middle by itself.
  const grid = win.getByTestId('slide-grid');
  await expect(grid).toHaveAttribute('data-presentation-id', testId);
  const more = grid.getByRole('button', { name: 'Presentation actions' });
  // Opened from the library, not a playlist: plain Delete….
  const del = win.getByRole('menuitem', { name: 'Delete…', exact: true });
  const confirm = win.getByTestId('remove-confirm');

  // From the keyboard: the menu takes the focus on Delete…; Esc closes it alone, back on its button.
  await more.focus();
  await win.keyboard.press('Enter');
  await expect(del).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(del).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(grid).toHaveAttribute('data-presentation-id', testId);
  // It asks first, in the library's trash's words; Cancel keeps it.
  await win.keyboard.press('Enter');
  await expect(del).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(confirm).toContainText(`Delete “${TEST_PRESENTATION_NAME}”?`);
  await expect(confirm).toContainText(LEAVES_PLAYLISTS);
  await expect(confirm).toContainText('You can bring it back with Undo');
  await expectNoSeriousA11yIssues(win, 'the question before deleting the presentation open in the middle');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(grid).toHaveAttribute('data-presentation-id', testId);

  // Delete: that one goes, the middle shows nothing chosen, and Undo is offered.
  await more.click();
  await del.click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(win.getByTestId('start-here')).toBeVisible();
  await expect(grid).toHaveCount(0);
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText(`Deleted “${TEST_PRESENTATION_NAME}”`);
  expect((await library(app)).presentations).toEqual([KIRTAN_PRESENTATION_NAME]);

  // Undo: back in the library, and open in the middle again.
  await undo.getByRole('button', { name: /Undo/u }).click();
  await expect(grid).toHaveAttribute('data-presentation-id', testId);
  expect((await library(app)).presentations).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME]);
  await app.close();
});

test('while a playlist item is open the menu says Delete from the library…, and the question says it leaves every playlist', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // The test presentation in a playlist.
  const testId = await win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === name)?.id ?? '';
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (id === '' || !made.ok) throw new Error('There is no test presentation, or the playlist was not made');
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: id },
    ]);
    if (!added.ok) throw new Error(added.message);
    return id;
  }, TEST_PRESENTATION_NAME);

  // Opened from the playlist: its card is the one the middle shows.
  await win
    .getByTestId('playlists')
    .getByTestId('playlist-node')
    .filter({ hasText: 'Placeholder Sunday' })
    .click();
  const card = win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .filter({ hasText: TEST_PRESENTATION_NAME });
  await card.click();
  await expect(card).toHaveAttribute('aria-current', 'true');
  const grid = win.getByTestId('slide-grid');
  await expect(grid).toHaveAttribute('data-presentation-id', testId);

  // Its menu says the library, never plain Delete… (which reads as the card's own trash, out of this playlist).
  await grid.getByRole('button', { name: 'Presentation actions' }).click();
  const fromLibrary = win.getByRole('menuitem', { name: 'Delete from the library…', exact: true });
  await expect(fromLibrary).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Delete…', exact: true })).toHaveCount(0);
  await fromLibrary.click();
  // The library's trash's question, saying it also leaves every playlist.
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText(`Delete “${TEST_PRESENTATION_NAME}”?`);
  await expect(confirm).toContainText(LEAVES_PLAYLISTS);
  await expect(confirm).toContainText('You can bring it back with Undo');
  await confirm.getByRole('button', { name: 'Delete' }).click();

  // As it says: out of the library, nothing chosen in the middle, and the card says it was removed.
  await expect(win.getByTestId('start-here')).toBeVisible();
  await expect(card).toContainText('Removed from the library');
  expect((await library(app)).presentations).toEqual([KIRTAN_PRESENTATION_NAME]);
  // Undo: back in the library and in the playlist.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(card).not.toContainText('Removed from the library');
  expect((await library(app)).presentations).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME]);
  await app.close();
});
