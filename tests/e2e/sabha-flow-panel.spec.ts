import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowScanPage, flowTablePage, makeFlowPdf } from '../../src/main/documents/testing/sabha-flow-pdfs';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, relaunchApp, setUpScreen } from './helpers';
import { headingProblems } from './operator-layout';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The operator window's Sabha flow panel (alpha.23, QA23-FLOW-1 and QA23-FLOW-2; the owner: "a different window on
 * left side with toggle button saying sabha flow ... the window should show the pdf ... and say whats on number 1, 2,
 * 3, 4, 5 and so on", and "if we are on 1, it should say next up this program, video"). At the top of the left column,
 * its heading the toggle (folded to begin with, remembered); Choose PDF…, the read list (each item as "1 · Program ·
 * Details · Duration · Presenter", a merged cell on each row it covers, the total at the bottom; a row's click marks it
 * Now), the PDF page (zoomable), Replace… and Remove; a PDF with no text says so and shows its page only. Never on a
 * screen. Simple Mode has it only when chosen in Simple Mode Features…, without its setup. Now and Next up themselves
 * are a22-flow-next's (tests/e2e/sabha-flow-now-next.spec.ts); the scenarios across the panel and a phone are
 * a22-flow-tests'.
 *
 * Placeholder PDFs only, made here by a22-flow-core's maker (the reader's own tests use it: pdf-lib, the bundled Noto
 * fonts with ToUnicode maps, a table's borders as lines): never a real running order.
 */

const ROWS = [
  '1 · Opening · Placeholder words one · 10 min · Speaker A',
  '2 · Video · Placeholder clip · 15 min · Speaker B',
  '3 · Talk · Placeholder words three · 15 min · Speaker B',
  '4 · Closing · Placeholder words four · 5 min · Speaker C',
];

/** Choose PDF… (or Replace…) answered with this file: Main's file dialog, stood in for by the test. */
async function chooseThis(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, file);
}

/** What a person reads in an element: its words without those only a screen reader hears (.sr-only). */
const seen = (el: Locator) =>
  el.evaluate((node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
    return copy.textContent.replace(/\s+/gu, ' ').trim();
  });

async function seenAll(list: Locator): Promise<string[]> {
  const out: string[] = [];
  for (const el of await list.all()) out.push(await seen(el));
  return out;
}

/** Now, as Main keeps it. */
const flowNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.flow.get()).state);

const WIDTHS = [44, 140, 190, 70, 106];

/**
 * Three placeholder running orders: an English table whose rows 2 and 3 share one Duration and one Presenter cell, with
 * a title, subtitle and total; a Gujarati one; and a 25-page scan (pictures, no text: more pages than the 20 drawn).
 */
async function makePdfs(): Promise<{ table: string; gujarati: string; scan: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-flow-'));
  const table = join(dir, 'placeholder-flow.pdf');
  const gujarati = join(dir, 'placeholder-gujarati.pdf');
  const scan = join(dir, 'placeholder-scan.pdf');
  writeFileSync(
    table,
    await makeFlowPdf([
      flowTablePage({
        title: 'Placeholder evening',
        subtitle: 'A test running order',
        headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: WIDTHS,
        rows: [
          ['1', 'Opening', 'Placeholder words one', '10 min', 'Speaker A'],
          ['2', 'Video', 'Placeholder clip', { text: '15 min', rows: 2 }, { text: 'Speaker B', rows: 2 }],
          ['3', 'Talk', 'Placeholder words three', null, null],
          ['4', 'Closing', 'Placeholder words four', '5 min', 'Speaker C'],
        ],
        total: 'Total 45 min',
        borders: 'lines',
      }),
    ]),
  );
  writeFileSync(
    gujarati,
    await makeFlowPdf([
      flowTablePage({
        title: 'નમૂનો કાર્યક્રમ',
        headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત', 'સમય', 'વક્તા'],
        widths: WIDTHS,
        rows: [
          ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'],
          ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો', '૫ મિનિટ', 'વક્તા બે'],
        ],
        total: 'કુલ સમય: ૧૦ મિનિટ',
        borders: 'boxes',
      }),
    ]),
  );
  writeFileSync(scan, await makeFlowPdf(Array.from({ length: 25 }, () => flowScanPage())));
  return { table, gujarati, scan };
}

test('Sabha flow at the top of the left column: its toggle, Choose PDF…, the read list in order with merged cells and the total, a row marked Now, the PDF page zoomed, kept over a restart, a Gujarati one, a scan, Remove, fitting 1024 × 645, never on a screen', async () => {
  test.setTimeout(180_000);
  const { table, gujarati, scan } = await makePdfs();
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await setUpScreen(win);
  const output = await outputPage(app);

  // The toggle, saying Sabha flow, at the top of the left column under Library, folded to begin with.
  const left = win.getByTestId('column-left');
  const toggle = left.getByRole('button', { name: 'Sabha flow', exact: true });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const libraryBox = await left.getByTestId('library-button').boundingBox();
  const toggleBox = await toggle.boundingBox();
  // The playlists' head: a heading "Playlists" in a fresh data folder (the Playlists or templates tabs come only with
  // View › Show Books, Templates and Kirtan Details, PlaylistPanel.tsx ViewTabs; a22-flow-next's CI 56605 showed the heading).
  const playlistsBox = await left.getByRole('heading', { name: 'Playlists', exact: true }).boundingBox();
  expect(toggleBox?.y ?? 0).toBeGreaterThan(libraryBox?.y ?? Infinity);
  expect(toggleBox?.y ?? Infinity).toBeLessThan(playlistsBox?.y ?? 0);
  const panel = win.getByTestId('sabha-flow');
  await expect(panel.getByTestId('sabha-flow-body')).toHaveCount(0);

  // Open: nothing chosen yet.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByTestId('flow-empty')).toContainText('No Sabha flow yet');
  await expectFits(panel, 'the Sabha flow panel, empty, at 1024 × 645');

  // Choose PDF…: each numbered item as a row, in order, a merged cell on each row it covers, the total at the bottom.
  await chooseThis(app, table);
  await panel.getByRole('button', { name: 'Choose PDF…' }).click();
  const rows = panel.getByTestId('flow-row');
  await expect(rows).toHaveCount(4, { timeout: 30_000 });
  expect(await seenAll(rows)).toEqual(ROWS);
  // Named by its own words, each part in its own language (Chromium's exact name: a space round each heard comma).
  await expect(rows.first()).toHaveAccessibleName('1 , Opening , Placeholder words one , 10 min , Speaker A');
  await expect(panel.getByTestId('flow-file')).toHaveText('placeholder-flow.pdf');
  await expect(panel.getByTestId('flow-read-list')).toHaveAttribute('lang', 'en');
  await expect(panel.getByTestId('flow-read-list')).toContainText('Placeholder evening');
  const total = panel.getByTestId('flow-total');
  await expect(total).toContainText('45 min');
  await total.scrollIntoViewIfNeeded();
  expect((await total.boundingBox())?.y ?? 0).toBeGreaterThan(
    (await rows.last().boundingBox())?.y ?? Infinity,
  );

  // A row's click marks it Now (Now and Next up themselves are a22-flow-next's, sabha-flow-now-next.spec.ts): the list
  // says which (aria-current), and Main keeps it.
  await expect(rows.first()).not.toHaveAttribute('aria-current', 'step');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-current', 'step');
  await expect.poll(async () => (await flowNow(win))?.now).toBe(0);
  const flowId = (await flowNow(win))?.flowId ?? '';
  // From the keyboard: Enter on a row marks it; one row is Now at a time.
  await rows.nth(1).focus();
  await win.keyboard.press('Enter');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(rows.first()).not.toHaveAttribute('aria-current', 'step');
  await rows.nth(2).click();
  await expect.poll(() => flowNow(win)).toEqual({ flowId, now: 2 });

  // At 1024 × 645 nothing of it is cut short, and its headings fit.
  await expectFits(panel, 'the Sabha flow panel, read, at 1024 × 645');
  expect(await headingProblems(win)).toEqual([]);
  await expectNoSeriousA11yIssues(win, 'Sabha flow, its read list', '[data-testid="sabha-flow"]');

  // Never on a screen: the hall's output shows none of it.
  expect(await output.locator('body').innerText()).not.toContain('Placeholder words');

  // The PDF page: drawn, at the panel's width, then zoomed in, and fitted again.
  await panel.getByRole('tab', { name: 'PDF page' }).click();
  const picture = panel.getByRole('img', { name: 'Page 1 of 1', exact: true });
  await expect(picture).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const fitted = (await picture.boundingBox())?.width ?? 0;
  await panel.getByRole('button', { name: 'Zoom in' }).click();
  await expect(panel.getByTestId('flow-zoom')).toHaveValue('125%');
  await expect.poll(async () => (await picture.boundingBox())?.width ?? 0).toBeGreaterThan(fitted * 1.2);
  await panel.getByRole('button', { name: 'Fit to the panel' }).click();
  await expect(panel.getByTestId('flow-zoom')).toHaveValue('100%');
  await expectFits(panel, 'the Sabha flow panel, its page, at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'Sabha flow, its PDF page', '[data-testid="sabha-flow"]');

  // Kept over a restart: the panel open, the flow, and Now.
  await app.close();
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  const panel2 = win2.getByTestId('sabha-flow');
  await expect(win2.getByRole('button', { name: 'Sabha flow', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const rows2 = panel2.getByTestId('flow-row');
  await expect(rows2).toHaveCount(4, { timeout: 30_000 });
  await expect(rows2.nth(2)).toHaveAttribute('aria-current', 'step');

  // Replace… with a Gujarati one: its rows in Gujarati, lang gu, and Now starts again.
  await chooseThis(again.app, gujarati);
  await panel2.getByRole('button', { name: 'Replace… (choose another PDF)' }).click();
  await expect(panel2.getByTestId('flow-file')).toHaveText('placeholder-gujarati.pdf', { timeout: 30_000 });
  await expect(panel2.getByTestId('flow-read-list')).toHaveAttribute('lang', 'gu');
  expect(await seenAll(rows2)).toEqual([
    '૧ · પહેલો કાર્યક્રમ · નમૂનો વિગત · ૫ મિનિટ · વક્તા એક',
    '૨ · બીજો કાર્યક્રમ · નમૂનો · ૫ મિનિટ · વક્તા બે',
  ]);
  await expect(panel2.getByTestId('flow-total')).toHaveText('કુલ સમય: ૧૦ મિનિટ');
  await expect(rows2.first()).not.toHaveAttribute('aria-current', 'step');
  expect((await flowNow(win2))?.now ?? null).toBeNull();

  // Replace… with a 25-page PDF that has no text: said in plain words, its pages only, the 20 Main drew (a22-review-flow
  // M2: never a line for each page it did not), with one line saying so.
  await chooseThis(again.app, scan);
  await panel2.getByRole('button', { name: 'Replace… (choose another PDF)' }).click();
  await expect(panel2.getByTestId('flow-status')).toContainText('no words Drashti can read', {
    timeout: 60_000,
  });
  await expect(panel2.getByTestId('flow-row')).toHaveCount(0);
  await expect(panel2.getByRole('tablist')).toHaveCount(0);
  await expect(panel2.getByRole('img', { name: 'Page 1 of 25', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel2.getByTestId('flow-page')).toHaveCount(20, { timeout: 30_000 });
  await expect(panel2.getByTestId('flow-pages-capped')).toHaveText('Only the first 20 pages are shown.');
  await expect(panel2.getByTestId('flow-page-view')).not.toContainText('couldn’t be drawn');
  await expectFits(panel2, 'the Sabha flow panel, a PDF with no text, at 1024 × 645');

  // Remove asks first, then the panel is empty again.
  await panel2.getByRole('button', { name: 'Remove the Sabha flow' }).click();
  const confirm = win2.getByTestId('flow-remove-confirm');
  await expect(confirm).toContainText('placeholder-scan.pdf');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(panel2.getByTestId('flow-empty')).toBeVisible();
  expect(await win2.evaluate(() => (globalThis as PageGlobals).drashti.flow.get())).toEqual({
    flow: null,
    state: null,
  });

  // Folded again, it is its heading alone.
  await win2.getByRole('button', { name: 'Sabha flow', exact: true }).click();
  await expect(panel2.getByTestId('sabha-flow-body')).toHaveCount(0);
  await again.app.close();
});

test('Simple Mode has the Sabha flow only when chosen in Simple Mode Features…: at the top of its left column, marking Now, without Choose PDF…, Replace… or Remove', async () => {
  test.setTimeout(150_000);
  const { table } = await makePdfs();
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const setMode = async (mode: 'pro' | 'simple') => {
    await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode);
    await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
  };
  // Chosen in Pro Mode.
  await win.getByRole('button', { name: 'Sabha flow', exact: true }).click();
  await chooseThis(app, table);
  await win.getByTestId('sabha-flow').getByRole('button', { name: 'Choose PDF…' }).click();
  await expect(win.getByTestId('flow-row')).toHaveCount(4, { timeout: 30_000 });

  // Off to begin with: Simple Mode has none of it.
  await setMode('simple');
  await expect(win.getByTestId('sabha-flow')).toHaveCount(0);
  await setMode('pro');

  // Chosen: there, as in Pro Mode, marking Now, and nothing that sets it up.
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setSimpleFeature('sabha-flow', true)),
  ).toEqual({ ok: true, chosen: ['sabha-flow'] });
  await setMode('simple');
  const panel = win.getByTestId('sabha-flow');
  await expect(win.getByTestId('column-left').getByTestId('sabha-flow')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Sabha flow', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const rows = panel.getByTestId('flow-row');
  await expect(rows).toHaveCount(4);
  await expect(panel.getByTestId('flow-replace')).toHaveCount(0);
  await expect(panel.getByTestId('flow-remove')).toHaveCount(0);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect
    .poll(async () =>
      win.evaluate(async () => (await (globalThis as PageGlobals).drashti.flow.get()).state?.now),
    )
    .toBe(1);
  // Choosing or removing it stays Pro Mode's, in the main process too.
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.flow.remove())).toBeNull();
  await expect(rows).toHaveCount(4);
  await expectFits(panel, 'Simple Mode’s Sabha flow at 1024 × 645');
  await app.close();
});
