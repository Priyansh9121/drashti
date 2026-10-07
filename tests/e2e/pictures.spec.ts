import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { expectNoSeriousA11yIssues } from './a11y';
import type { OutputGlobals, PageGlobals } from './helpers';
import { dropFiles, launchApp, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';
import { canvasPixels, near } from './pixels';

/*
 * PDF, PowerPoint and Keynote as pictures (Session 15). A generated PDF
 * dropped on the library, like any import: each page becomes a slide holding
 * its picture over the whole slide (a 4:3 page fitted with black either
 * side), its comments the slide's notes, drawn in a hidden window that goes
 * when it is done, while slide changes keep reaching the screen. A
 * PowerPoint file with nothing on the computer to save it as PDF (CI's
 * runners have neither Keynote nor PowerPoint; the tests say so anyway) is
 * reported plainly, with what to do.
 */

const BLUE: [number, number, number] = [30, 58, 138];
const RED: [number, number, number] = [127, 29, 29];
const GREEN: [number, number, number] = [20, 83, 45];

test('a PDF dropped on the library becomes slides of its pages as pictures, with its comments as notes', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pictures-e2e-'));
  const pdf = join(dir, 'Placeholder announcements.pdf');
  writeFileSync(
    pdf,
    makeTestPdf([
      {
        width: 960,
        height: 540,
        color: BLUE,
        text: 'Placeholder page one',
        note: 'Placeholder note, page one',
      },
      { width: 720, height: 540, color: RED, text: 'Placeholder page two' },
      {
        width: 960,
        height: 540,
        color: GREEN,
        text: 'Placeholder page three',
        note: 'Placeholder note, page three',
      },
    ]),
  );
  await setUpScreen(win, 'Main Hall', 0);
  const output = await outputPage(app);
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const kirtan = (
    await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())
  )[0]?.id;

  // Slides keep changing while the pages are drawn: each change still reaches the screen.
  await dropFiles(win, win.getByTestId('library-drop'), [pdf]);
  const painted: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await win.evaluate(
      ({ id, i }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId: id,
          slideIndex: i % 2,
        }),
      { id: kirtan ?? '', i },
    );
    if (!r.ok || !r.changed) continue;
    const rev = r.rev;
    painted.push(
      await output
        .waitForFunction(
          (want) => ((globalThis as OutputGlobals).drashtiPaintLog ?? []).some((p) => p.rev >= want),
          rev,
          { timeout: 2000 },
        )
        .then(() => true)
        .catch(() => false),
    );
  }
  expect(painted.every(Boolean)).toBe(true);
  // The drawing window is never shown, and goes once the document is drawn.
  const shownPictureWindows = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.getTitle() === 'Drashti pictures' && w.isVisible())
        .length,
  );
  expect(shownPictureWindows).toBe(0);

  // Something is live, so the report waits in the status bar: open it.
  const report = win.getByTestId('import-report');
  const result = win.getByTestId('import-result');
  await expect(result.getByRole('button', { name: 'Report' })).toBeVisible({ timeout: 60_000 });
  await result.getByRole('button', { name: 'Report' }).click();
  await expect(report).toBeVisible();
  await expect(report.getByTestId('report-summary')).toContainText('1 presentation');
  await expect(report).toContainText('Each of the 3 pages became a slide holding its picture');
  await expect(report).toContainText('2 slides have speaker notes');
  await expectNoSeriousA11yIssues(win, 'the report for a PDF made into pictures');
  // With notes, the item is listed under "Imported with notes" and again under "Imported".
  await report.getByTestId('report-item').first().getByRole('button', { name: 'Open' }).click();
  await expect(report).toHaveCount(0);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.getTitle() === 'Drashti pictures'),
      ),
    )
    .toBe(false);

  // Three slides, with the comments as their notes.
  const thumbs = win.getByTestId('slide-thumb');
  await expect(thumbs).toHaveCount(3);
  const doc = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const id = (await d.library.listPresentations()).find((p) => p.name === 'Placeholder announcements')?.id;
    return id ? d.library.getPresentation(id) : null;
  });
  expect(doc?.groups.flatMap((g) => g.slides).map((s) => s.notes)).toEqual([
    'Placeholder note, page one',
    '',
    'Placeholder note, page three',
  ]);

  // Each page fills the screen as its picture; the 4:3 page has black either side.
  const top = { x: 960, y: 200 };
  const side = { x: 100, y: 540 };
  await thumbs.nth(0).click();
  await expect.poll(async () => near((await canvasPixels(output, [top]))[0], BLUE)).toBe(true);
  await thumbs.nth(1).click();
  await expect.poll(async () => near((await canvasPixels(output, [top]))[0], RED)).toBe(true);
  expect(near((await canvasPixels(output, [side]))[0], [0, 0, 0], 12)).toBe(true);
  await thumbs.nth(2).click();
  await expect.poll(async () => near((await canvasPixels(output, [top]))[0], GREEN)).toBe(true);
  await app.close();
});

test('a PowerPoint file with nothing on the computer to save it as PDF is reported plainly', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pictures-e2e-'));
  const deck = join(dir, 'Placeholder deck.pptx');
  writeFileSync(
    deck,
    makeTestPptx([{ color: '1E3A8A', text: 'Placeholder slide', notes: 'Placeholder note' }]),
  );
  await dropFiles(win, win.getByTestId('library-drop'), [deck]);
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible({ timeout: 60_000 });
  const item = report.getByTestId('report-item');
  await expect(item).toHaveAttribute('data-outcome', 'failed');
  await expect(item).toContainText('no Keynote or PowerPoint');
  await expect(item).toContainText('File > Save As, PDF');
  await app.close();
});
