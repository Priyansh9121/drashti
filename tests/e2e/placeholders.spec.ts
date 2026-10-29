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
 * library…, the question (the library's trash's too) says the playlists keep its card, marked, and Next goes
 * past it, and Undo shows that card again. Quiet; nothing here needs a display wider than 1024.
 */

/** The question's line on playlists, from the library's trash and the middle's menu alike (Session 51). */
const CARDS_KEPT =
  'Any playlist it is in keeps its card, marked Removed from the library, and Next goes past it.';

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

test('Delete… in the menu of the presentation open in the middle: used nowhere, it goes at once with Undo; in a playlist it asks first, saying which', async () => {
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
  // The one right-click menu (Session 55, Part 14): Edit slides…, Rename…, Show in Finder and Delete….
  const del = win.getByRole('menuitem', { name: 'Delete…', exact: true });
  const confirm = win.getByTestId('remove-confirm');

  // From the keyboard: the menu takes the focus on its first choice; Esc closes it alone, back on its button.
  await more.focus();
  await win.keyboard.press('Enter');
  await expect(win.getByRole('menuitem', { name: 'Edit slides…' })).toBeFocused();
  await expect(del).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(del).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(grid).toHaveAttribute('data-presentation-id', testId);

  // Used nowhere and not up: Delete… asks nothing (Session 55, Part 14); it goes, the middle shows nothing chosen,
  // and Undo is offered.
  await more.click();
  await del.click();
  await expect(confirm).toHaveCount(0);
  await expect(win.getByTestId('start-here')).toBeVisible();
  await expect(grid).toHaveCount(0);
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText(`Deleted “${TEST_PRESENTATION_NAME}”`);
  expect((await library(app)).presentations).toEqual([KIRTAN_PRESENTATION_NAME]);

  // Undo: back in the library, and open in the middle again.
  await undo.getByRole('button', { name: /Undo/u }).click();
  await expect(grid).toHaveAttribute('data-presentation-id', testId);
  expect((await library(app)).presentations).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME]);

  // In a playlist: it asks first, saying which playlist and what becomes of its card; Cancel keeps it.
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (!made.ok) throw new Error(made.message);
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: id },
    ]);
    if (!added.ok) throw new Error(added.message);
  }, testId);
  await more.click();
  await del.click();
  await expect(confirm).toContainText(`Delete “${TEST_PRESENTATION_NAME}”?`);
  await expect(confirm.getByTestId('remove-in-playlists')).toHaveText('It is in “Placeholder Sunday”.');
  await expect(confirm).toContainText(CARDS_KEPT);
  await expect(confirm).toContainText('You can bring it back with Undo');
  await expectNoSeriousA11yIssues(win, 'the question before deleting a presentation in a playlist');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(grid).toHaveAttribute('data-presentation-id', testId);
  await app.close();
});

test('a playlist’s row takes its presentation out of that playlist only; deleted from the library its card stays, marked, and Undo brings it back', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // The test presentation in a playlist.
  await win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === name)?.id ?? '';
    const made = await d.playlists.create('Placeholder Sunday', null, false);
    if (id === '' || !made.ok) throw new Error('There is no test presentation, or the playlist was not made');
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: id },
    ]);
    if (!added.ok) throw new Error(added.message);
  }, TEST_PRESENTATION_NAME);
  await win
    .getByTestId('playlists')
    .getByTestId('playlist-node')
    .filter({ hasText: 'Placeholder Sunday' })
    .click();
  const card = win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .filter({ hasText: TEST_PRESENTATION_NAME });
  // Its row's menu (Session 55, Part 14): Remove from playlist (this playlist only), never Delete from the library.
  await card.click({ button: 'right' });
  await expect(win.getByRole('menuitem', { name: 'Remove from playlist' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: /^Delete/u })).toHaveCount(0);
  await win.keyboard.press('Escape');

  // From the library: it asks first, saying which playlist and that its card stays, marked.
  await win.getByTestId('library-button').click();
  await win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: TEST_PRESENTATION_NAME })
    .click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
  const confirm = win.getByTestId('remove-confirm');
  await expect(confirm).toContainText(`Delete “${TEST_PRESENTATION_NAME}”?`);
  await expect(confirm.getByTestId('remove-in-playlists')).toHaveText('It is in “Placeholder Sunday”.');
  await expect(confirm).toContainText(CARDS_KEPT);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await win.getByTestId('library-close').click();
  await expect(card).toContainText('Removed from the library');
  expect((await library(app)).presentations).toEqual([KIRTAN_PRESENTATION_NAME]);
  // Undo: back in the library and in the playlist.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(card).not.toContainText('Removed from the library');
  expect((await library(app)).presentations).toEqual([TEST_PRESENTATION_NAME, KIRTAN_PRESENTATION_NAME]);
  await app.close();
});
