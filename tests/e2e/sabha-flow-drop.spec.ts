import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_PDF_ONLY, ONLY_A_PDF } from '../../src/shared/sabha-flow-drop';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import {
  answerDialog,
  dialogsOpened,
  ENGLISH,
  flowKept,
  flowState,
  GUJARATI,
  lineOf,
  openPanel,
  seenAll,
  writeFlows,
} from './sabha-flow';
import { makeTestImage } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A PDF dropped on the Sabha flow panel (alpha.24, QA24-FLOWDROP-1; the owner: "also in sabha flow, pdf can be drag and
 * drop"). Dropped, it becomes the running order as Choose PDF… makes it (the same flow:choose and store, Main's dialog
 * never opened); of several files the first PDF is taken and the panel says so, the others left (never imported); with
 * a flow there it asks "Replace the running order?" first, Cancel keeping it and Now. The panel shows a drop state while
 * a PDF is over it, and the show keeps the keyboard. Files with no PDF among them go by, to the window's own import of
 * files dropped anywhere on it, as before the panel took drops (bughunt S2-1); and so does everything dropped on Simple
 * Mode's panel, whose running order is chosen in Pro Mode: into Simple Mode's playlist.
 *
 * The drop as helpers.ts dropFiles makes one (File objects behind a file input, so the preload tells their paths, then
 * dragenter, dragover and drop with them). Placeholder running orders only (sabha-flow-fixtures.ts).
 */

const DROP_HERE = 'Drop the PDF to use it as the running order';

/** Drop these files on `target` as the system's drag and drop does, the panel's drop state seen while they are over it. */
async function dropOn(win: Page, target: Locator, paths: string[], state: string): Promise<void> {
  await win.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'e2e-flow-drop-source';
    input.style.display = 'none';
    document.body.appendChild(input);
  });
  await win.setInputFiles('#e2e-flow-drop-source', paths);
  const dataTransfer = await win.evaluateHandle(() => {
    const input = document.getElementById('e2e-flow-drop-source') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dt.items.add(file);
    input.remove();
    return dt;
  });
  const overlay = win.getByTestId('flow-drop-overlay');
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText(state);
  await target.dispatchEvent('drop', { dataTransfer });
  await expect(overlay).toHaveCount(0);
}

/**
 * Drop these files on `target` as the system's drag and drop does, the panel never showing its drop state: it lets
 * them go by, to the window's own import (bughunt S2-1).
 */
async function dropPast(win: Page, target: Locator, paths: string[]): Promise<void> {
  await win.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'e2e-flow-drop-source';
    input.style.display = 'none';
    document.body.appendChild(input);
  });
  await win.setInputFiles('#e2e-flow-drop-source', paths);
  const dataTransfer = await win.evaluateHandle(() => {
    const input = document.getElementById('e2e-flow-drop-source') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dt.items.add(file);
    input.remove();
    return dt;
  });
  const overlay = win.getByTestId('flow-drop-overlay');
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await expect(overlay).toHaveCount(0);
  await target.dispatchEvent('drop', { dataTransfer });
  await expect(overlay).toHaveCount(0);
}

/** The open playlist's rows. */
const playlistRows = (win: Page) => win.getByTestId('open-playlist').getByTestId('playlist-item');

/** Placeholder files that are not running orders: words, and words in a file named as a PDF. */
function notRunningOrders(): { notes: string; pretend: string } {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-flow-drop-'));
  const notes = join(dir, 'Flowcheck notes.txt');
  const pretend = join(dir, 'Flowcheck pretend.pdf');
  writeFileSync(notes, 'Placeholder words only\n');
  writeFileSync(pretend, 'Placeholder words, not a PDF\n');
  return { notes, pretend };
}

test('a PDF dropped on the Sabha flow panel is the running order as Choose PDF… makes it; other files go by to the window’s import as before; of several files the first PDF, said; with a flow there, Replace the running order? first; the show keeps the keyboard', async () => {
  test.setTimeout(240_000);
  const pdfs = await writeFlows({ english: ENGLISH, gujarati: GUJARATI });
  const { notes, pretend } = notRunningOrders();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const pictures = mkdtempSync(join(tmpdir(), 'drashti-flow-drop-pictures-'));
  const picture = await makeTestImage(win, join(pictures, 'Flowcheck picture.png'), { color: '#14532d' });
  const second = await makeTestImage(win, join(pictures, 'Flowcheck second.png'), { color: '#1e3a8a' });
  // Main's file dialog stood in for, and counted: a drop never opens it.
  await answerDialog(app, null);
  const panel = await openPanel(win);
  const rows = panel.getByTestId('flow-row');
  const problem = panel.getByTestId('flow-problem');
  const note = panel.getByTestId('flow-note');
  // The window's own import of files dropped anywhere on it: with no playlist open, it asks where they go.
  const whereTheyGo = win.getByTestId('drop-new-dialog');
  // The show's own control has the keyboard throughout: a drop of a PDF never takes it.
  const show = win.getByTestId('blackout-button');

  // Not a PDF: the panel lets it go by and the window imports it, as anywhere on the window (alpha.23's way; bughunt
  // S2-1). With no playlist open, the small window asks where it goes; Enter makes a playlist for it, opened.
  await dropPast(win, panel, [picture]);
  await expect(whereTheyGo).toBeVisible();
  await win.keyboard.press('Enter');
  await expect(whereTheyGo).toHaveCount(0);
  await expect(playlistRows(win)).toHaveText([/Flowcheck picture/u]);
  // With a playlist open, at its end.
  await dropPast(win, panel, [second]);
  await expect(playlistRows(win)).toHaveText([/Flowcheck picture/u, /Flowcheck second/u], {
    timeout: 30_000,
  });
  await expect(problem).toHaveCount(0);
  expect(await flowKept(win)).toBeNull();
  await expect(whereTheyGo).toHaveCount(0);
  await show.focus();
  await expect(show).toBeFocused();

  // Named as a PDF but not one inside: Main's own words, as Choose PDF… says them for such a file; never imported.
  await dropOn(win, panel, [pretend], DROP_HERE);
  await expect(problem).toHaveText('That file is not a PDF: choose the running order saved as a PDF.');
  expect(await flowKept(win)).toBeNull();
  await expect(playlistRows(win)).toHaveCount(2);
  // Main takes only a full path to a PDF, whatever the window sends.
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.flow.choose('Flowcheck English order.pdf')),
  ).toEqual({ ok: false, message: ONLY_A_PDF });

  // One PDF: read and shown, Main's dialog never opened, nothing more said.
  await dropOn(win, panel, [pdfs.english], DROP_HERE);
  await expect(panel.getByTestId('flow-file')).toHaveText(ENGLISH.fileName, { timeout: 30_000 });
  await expect(rows).toHaveCount(ENGLISH.items.length);
  const dropped = await seenAll(rows);
  expect(dropped).toEqual(ENGLISH.items.map(lineOf));
  expect(await flowKept(win)).toEqual({ fileName: ENGLISH.fileName, status: 'read' });
  await expect(problem).toHaveCount(0);
  await expect(note).toHaveCount(0);
  expect(await dialogsOpened(app)).toBe(0);
  await expect(whereTheyGo).toHaveCount(0);
  await expect(playlistRows(win)).toHaveCount(2);
  await expect(show).toBeFocused();

  // The very flow Choose PDF… makes of the same file: Replace… with it, through Main's dialog.
  const droppedId = (await flowState(win))?.flowId ?? '';
  await answerDialog(app, pdfs.english);
  await panel.getByTestId('flow-replace').click();
  await expect.poll(async () => (await flowState(win))?.flowId ?? droppedId).not.toBe(droppedId);
  await expect(rows).toHaveCount(ENGLISH.items.length);
  expect(await seenAll(rows)).toEqual(dropped);
  expect(await dialogsOpened(app)).toBe(1);
  // Now on item 2, to be kept by a Cancel below.
  await rows.nth(1).click();
  await expect.poll(async () => (await flowState(win))?.now).toBe(1);
  await show.focus();

  // A flow there: "Replace the running order?" first. Cancel keeps it, and Now; the keyboard goes back to the show.
  await dropOn(win, panel, [pdfs.gujarati, pdfs.english], DROP_HERE);
  const confirm = win.getByRole('alertdialog', { name: 'Replace the running order?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute('data-testid', 'flow-replace-confirm');
  await expect(confirm).toContainText(GUJARATI.fileName);
  await expect(confirm).toContainText(ENGLISH.fileName);
  await expectNoSeriousA11yIssues(win, 'Replace the running order?', '[data-testid="flow-replace-confirm"]');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(await flowKept(win)).toEqual({ fileName: ENGLISH.fileName, status: 'read' });
  expect((await flowState(win))?.now).toBe(1);
  await expect(show).toBeFocused();

  // Replace: the first PDF dropped is chosen, Now starts again, and the panel says only the first was used.
  await dropOn(win, panel, [pdfs.gujarati, pdfs.english], DROP_HERE);
  await confirm.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel.getByTestId('flow-file')).toHaveText(GUJARATI.fileName, { timeout: 30_000 });
  await expect(note).toHaveText(FIRST_PDF_ONLY);
  await expect(rows).toHaveCount(GUJARATI.items.length);
  expect(await seenAll(rows)).toEqual(GUJARATI.items.map(lineOf));
  expect((await flowState(win))?.now ?? null).toBeNull();
  expect(await dialogsOpened(app)).toBe(1);
  await expect(show).toBeFocused();
  await expectFits(panel, 'the Sabha flow panel saying what a drop left out, at 1024 × 645');

  // Folded, its heading takes a drop too, and opens: a PDF among other files, the PDF taken, the others said and left
  // (the panel's drop, never also imported into the open playlist).
  await panel.getByTestId('sabha-flow-toggle').click();
  await expect(panel.getByTestId('sabha-flow-body')).toHaveCount(0);
  await show.focus();
  await dropOn(win, panel, [notes, pdfs.english], DROP_HERE);
  await expect(panel.getByTestId('sabha-flow-toggle')).toHaveAttribute('aria-expanded', 'true');
  await confirm.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(panel.getByTestId('flow-file')).toHaveText(ENGLISH.fileName, { timeout: 30_000 });
  await expect(note).toHaveText('Only the PDF was used: the other file is not a PDF.');
  expect(await seenAll(rows)).toEqual(dropped);
  await expect(show).toBeFocused();
  await expect(whereTheyGo).toHaveCount(0);
  await expect(playlistRows(win)).toHaveCount(2);
  await app.close();
});

test('Simple Mode’s Sabha flow takes no drop: a PDF dropped on it goes into Simple Mode’s playlist, as anywhere on its window, and the flow stays (bughunt S2-1)', async () => {
  test.setTimeout(150_000);
  const pdfs = await writeFlows({ english: ENGLISH, gujarati: GUJARATI });
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // Chosen in Pro Mode.
  await answerDialog(app, pdfs.english);
  const proPanel = await openPanel(win);
  await proPanel.getByTestId('flow-choose').click();
  await expect(proPanel.getByTestId('flow-file')).toHaveText(ENGLISH.fileName, { timeout: 30_000 });
  // Simple Mode with the Sabha flow chosen in Simple Mode Features….
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSimpleFeature('sabha-flow', true)),
  ).toEqual({ ok: true, chosen: ['sabha-flow'] });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toHaveCount(1);
  const panel = win.getByTestId('sabha-flow');
  await expect(panel.getByTestId('flow-row')).toHaveCount(ENGLISH.items.length);

  // The day's playlist Simple Mode came with, open and empty.
  await expect(win.getByTestId('open-playlist')).toBeVisible();
  await expect(playlistRows(win)).toHaveCount(0);
  await dropPast(win, panel, [pdfs.gujarati]);
  await expect(playlistRows(win)).toHaveText([/Flowcheck Gujarati order/u], { timeout: 60_000 });
  await expect(panel.getByTestId('flow-problem')).toHaveCount(0);
  await expect(win.getByTestId('flow-replace-confirm')).toHaveCount(0);
  await expect(win.getByTestId('drop-new-dialog')).toHaveCount(0);
  expect(await flowKept(win)).toEqual({ fileName: ENGLISH.fileName, status: 'read' });
  // Main refuses it in Simple Mode too, whatever the window sends.
  expect(
    await win.evaluate((file) => (globalThis as PageGlobals).drashti.flow.choose(file), pdfs.gujarati),
  ).toMatchObject({ ok: false });
  expect(await flowKept(win)).toEqual({ fileName: ENGLISH.fileName, status: 'read' });
  await expectFits(panel, 'Simple Mode’s Sabha flow after a drop, at 1024 × 645');
  await app.close();
});
