import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_PDF_ONLY, FLOW_CHOSEN_IN_PRO, ONLY_A_PDF } from '../../src/shared/sabha-flow-drop';
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
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A PDF dropped on the Sabha flow panel (alpha.24, QA24-FLOWDROP-1; the owner: "also in sabha flow, pdf can be drag and
 * drop"). Dropped, it becomes the running order as Choose PDF… makes it (the same flow:choose and store, Main's dialog
 * never opened); anything else is refused in words, the window's own import never taking it; of several files the
 * first PDF is taken and the panel says so; with a flow there it asks "Replace the running order?" first, Cancel
 * keeping it and Now. The panel shows a drop state while files are over it, and the show keeps the keyboard. Simple
 * Mode's panel takes none: the running order is chosen in Pro Mode.
 *
 * The drop as helpers.ts dropFiles makes one (File objects behind a file input, so the preload tells their paths, then
 * dragenter, dragover and drop with them). Placeholder running orders only (sabha-flow-fixtures.ts).
 */

const DROP_HERE = 'Drop the PDF to use it as the running order';
const PRO_ONLY = 'The running order is chosen in Pro Mode';

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

/** Placeholder files that are not running orders: words, and words in a file named as a PDF. */
function notRunningOrders(): { notes: string; pretend: string } {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-flow-drop-'));
  const notes = join(dir, 'Flowcheck notes.txt');
  const pretend = join(dir, 'Flowcheck pretend.pdf');
  writeFileSync(notes, 'Placeholder words only\n');
  writeFileSync(pretend, 'Placeholder words, not a PDF\n');
  return { notes, pretend };
}

test('a PDF dropped on the Sabha flow panel is the running order as Choose PDF… makes it; anything else refused in words; of several files the first PDF, said; with a flow there, Replace the running order? first; the show keeps the keyboard', async () => {
  test.setTimeout(240_000);
  const pdfs = await writeFlows({ english: ENGLISH, gujarati: GUJARATI });
  const { notes, pretend } = notRunningOrders();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  // Main's file dialog stood in for, and counted: a drop never opens it.
  await answerDialog(app, null);
  const panel = await openPanel(win);
  const rows = panel.getByTestId('flow-row');
  const problem = panel.getByTestId('flow-problem');
  const note = panel.getByTestId('flow-note');
  // The window's own import of files dropped elsewhere asks where they go: it never hears of a drop on the panel.
  const whereTheyGo = win.getByTestId('drop-new-dialog');
  // The show's own control has the keyboard throughout: a drop never takes it.
  const show = win.getByTestId('blackout-button');
  await show.focus();
  await expect(show).toBeFocused();

  // Not a PDF: refused in words, nothing chosen.
  await dropOn(win, panel, [notes], DROP_HERE);
  await expect(problem).toHaveText(`“Flowcheck notes.txt” is not a PDF, so it was not used. ${ONLY_A_PDF}`);
  expect(await flowKept(win)).toBeNull();
  await expect(whereTheyGo).toHaveCount(0);
  await expect(show).toBeFocused();

  // Named as a PDF but not one inside: Main's own words, as Choose PDF… says them for such a file.
  await dropOn(win, panel, [pretend], DROP_HERE);
  await expect(problem).toHaveText('That file is not a PDF: choose the running order saved as a PDF.');
  expect(await flowKept(win)).toBeNull();
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

  // Folded, its heading takes a drop too, and opens: a PDF among other files, the PDF taken, the others said.
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
  await app.close();
});

test('Simple Mode’s Sabha flow takes no drop: it says the running order is chosen in Pro Mode, and keeps the flow', async () => {
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

  await dropOn(win, panel, [pdfs.gujarati], PRO_ONLY);
  await expect(panel.getByTestId('flow-problem')).toHaveText(FLOW_CHOSEN_IN_PRO);
  await expect(win.getByTestId('flow-replace-confirm')).toHaveCount(0);
  await expect(win.getByTestId('drop-new-dialog')).toHaveCount(0);
  expect(await flowKept(win)).toEqual({ fileName: ENGLISH.fileName, status: 'read' });
  // Main refuses it in Simple Mode too, whatever the window sends.
  expect(
    await win.evaluate((file) => (globalThis as PageGlobals).drashti.flow.choose(file), pdfs.gujarati),
  ).toMatchObject({ ok: false });
  expect(await flowKept(win)).toEqual({ fileName: ENGLISH.fileName, status: 'read' });
  await expectFits(panel, 'Simple Mode’s Sabha flow saying it is chosen in Pro Mode, at 1024 × 645');
  await app.close();
});
