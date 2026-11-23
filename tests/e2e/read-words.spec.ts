import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LETTERS_FOUND_AT_LEAST,
  LETTERS_RIGHT_AT_LEAST,
  letterScore,
  PAGE_ONE,
  PAGE_TWO,
  scannedPdf,
} from '../../src/main/ocr/testing/scanned-pages';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, openLibrary, operatorPage } from './helpers';
import { drawScannedPage } from './ocr-pages';

/*
 * Book OCR (alpha.21, the owner's Q60-58: "A, Tesseract inside"): New presentation's Read Words from a Page… reads a
 * scanned picture's words, or a PDF's pages', with Tesseract inside Drashti (no internet), into the words box to be
 * read over before Make slides. The pages are drawn while the test runs: placeholder Gujarati words in Noto Sans
 * Gujarati, never kirtan text. The bounds are the trial's (src/main/ocr/testing/scanned-pages.ts).
 */

const words = (editor: Locator) => editor.getByTestId('words-text');

/** The chooser answers `files` (the system's dialog, answered by the test). */
const chooseFiles = (app: ElectronApplication, files: string[]) =>
  app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: chosen });
  }, files);

async function newPresentation(win: Page): Promise<Locator> {
  await openLibrary(win);
  await win.getByRole('button', { name: 'New…' }).click();
  const editor = win.getByTestId('words-editor');
  await expect(editor).toBeVisible();
  return editor;
}

/** Whether the reading process is running (it is started for a reading and goes once it is done or stopped). */
const readerRunning = (app: ElectronApplication) =>
  app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().some((m) => m.type === 'Utility' && m.name === 'Drashti words reader'),
  );

test('a scanned picture’s Gujarati words come into New presentation, to be read over, then Make slides', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-read-words-'));
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const scan = join(dir, 'Placeholder scanned page.png');
  writeFileSync(scan, (await drawScannedPage(win, PAGE_ONE)).png);

  const editor = await newPresentation(win);
  await chooseFiles(app, [scan]);
  await editor.getByRole('button', { name: 'Read Words from a Page…' }).click();
  // The words come into the box: nearly every letter of the page, and little else.
  await expect(words(editor)).not.toHaveValue('', { timeout: 90_000 });
  const read = await words(editor).inputValue();
  const score = letterScore(PAGE_ONE.join('\n'), read);
  expect(score.found, `letters found in: ${read}`).toBeGreaterThanOrEqual(LETTERS_FOUND_AT_LEAST);
  expect(score.right, `letters right in: ${read}`).toBeGreaterThanOrEqual(LETTERS_RIGHT_AT_LEAST);
  await expect(editor.getByTestId('read-words-note')).toHaveText(
    'Read 1 page. Check the words against the page before you make the slides.',
  );
  await expect.poll(() => readerRunning(app)).toBe(false);

  // Read over, named, then made into slides as typed words are.
  await editor.getByRole('textbox', { name: 'Name' }).fill('Placeholder Scanned Page');
  await editor.getByRole('button', { name: /Make slides/ }).click();
  await expect(editor).toHaveCount(0);
  await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toHaveText(
    'Placeholder Scanned Page',
  );
  await app.close();
});

test('a scanned PDF: the pages asked for are read, in order, after what is typed; past its end it says how many it has', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-read-words-'));
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const book = join(dir, 'Placeholder scanned book.pdf');
  const pages = [
    await drawScannedPage(win, PAGE_ONE),
    await drawScannedPage(win, PAGE_TWO),
    await drawScannedPage(win, PAGE_ONE),
  ];
  writeFileSync(book, scannedPdf(pages));

  const editor = await newPresentation(win);
  await words(editor).fill('[Verse 1]\nPlaceholder typed line');
  await chooseFiles(app, [book]);
  await editor.getByRole('button', { name: 'Read Words from a Page…' }).click();
  const pagesRow = editor.getByRole('group', { name: 'Pages to read' });
  await expect(pagesRow).toContainText('Placeholder scanned book.pdf');
  await expectNoSeriousA11yIssues(win, 'New presentation with pages to read', '[data-testid="words-editor"]');

  // Past the end: nothing read, and it says how many pages the PDF has.
  await pagesRow.getByRole('spinbutton', { name: 'From page' }).fill('4');
  await pagesRow.getByRole('spinbutton', { name: 'To page' }).fill('4');
  await pagesRow.getByRole('button', { name: 'Read These Pages' }).click();
  await expect(editor.getByTestId('read-words-note')).toHaveText(
    'The PDF has 3 pages: choose pages from 1 to 3.',
    { timeout: 60_000 },
  );
  await expect(words(editor)).toHaveValue('[Verse 1]\nPlaceholder typed line');

  // Pages 2 and 3: page 2's words, then page 3's (page 1's again), after the typed words; page 1 not read.
  await pagesRow.getByRole('spinbutton', { name: 'From page' }).fill('2');
  await pagesRow.getByRole('spinbutton', { name: 'To page' }).fill('3');
  await pagesRow.getByRole('button', { name: 'Read These Pages' }).click();
  await expect(editor.getByTestId('read-words-note')).toHaveText(
    'Read 2 pages. Check the words against the pages before you make the slides.',
    { timeout: 120_000 },
  );
  const text = await words(editor).inputValue();
  expect(text.startsWith('[Verse 1]\nPlaceholder typed line\n\n')).toBe(true);
  const read = text.slice('[Verse 1]\nPlaceholder typed line\n\n'.length);
  const score = letterScore([...PAGE_TWO, ...PAGE_ONE].join('\n'), read);
  expect(score.found, `letters found in: ${read}`).toBeGreaterThanOrEqual(LETTERS_FOUND_AT_LEAST);
  expect(score.right, `letters right in: ${read}`).toBeGreaterThanOrEqual(LETTERS_RIGHT_AT_LEAST);
  // In order: page 2's words before page 3's; the sample line (pages 1 and 3) read once, so page 1 was not.
  expect(read.indexOf('પુસ્તક')).toBeGreaterThanOrEqual(0);
  expect(read.indexOf('પુસ્તક')).toBeLessThan(read.indexOf('મંગળવાર'));
  expect(read.split('નમૂના').length - 1).toBe(1);
  await expect(pagesRow).toHaveCount(0);
  await app.close();
});

test('Stop Reading stops a reading at once: the words stay as they were and the reading process goes', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-read-words-'));
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const book = join(dir, 'Placeholder long scanned book.pdf');
  const page = await drawScannedPage(win, PAGE_TWO);
  writeFileSync(book, scannedPdf([page, page, page, page, page, page, page, page]));

  const editor = await newPresentation(win);
  await words(editor).fill('Placeholder typed line');
  await chooseFiles(app, [book]);
  await editor.getByRole('button', { name: 'Read Words from a Page…' }).click();
  const pagesRow = editor.getByRole('group', { name: 'Pages to read' });
  await pagesRow.getByRole('spinbutton', { name: 'To page' }).fill('8');
  await pagesRow.getByRole('button', { name: 'Read These Pages' }).click();
  const progress = editor.getByRole('progressbar', { name: 'Reading words' });
  await expect(progress).toBeVisible();
  await expect.poll(() => readerRunning(app), { timeout: 60_000 }).toBe(true);
  await editor.getByRole('button', { name: 'Stop Reading' }).click();
  await expect(progress).toHaveCount(0);
  await expect(editor.getByTestId('read-words-note')).toHaveText('Reading stopped: no words were added.');
  await expect(words(editor)).toHaveValue('Placeholder typed line');
  await expect.poll(() => readerRunning(app)).toBe(false);
  await app.close();
});
