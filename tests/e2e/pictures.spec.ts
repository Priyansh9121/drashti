import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { makeTestPptx } from '../../src/main/import/testing/make-pptx';
import { addTestPptxShadow } from '../../src/main/import/testing/pptx-shadow';
import { expectNoSeriousA11yIssues } from './a11y';
import type { OutputGlobals, PageGlobals } from './helpers';
import {
  dropFiles,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
} from './helpers';
import { importItem } from './import-details';
import { makeTestImage } from './test-media';
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
  await expect(output.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  const kirtan = (
    await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())
  )[0]?.id;

  // Slides keep changing while the pages are drawn: each change still reaches the screen.
  await openLibrary(win);
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

  const result = win.getByTestId('import-result');
  await expect(result).toContainText('Imported 1 presentation', { timeout: 60_000 });
  await expect(result.getByRole('button', { name: 'Report' })).toHaveCount(0);
  const item = await importItem(win, pdf);
  expect(item?.outcome).toBe('imported');
  const notes = item?.issues.map((issue) => issue.message).join(' ') ?? '';
  expect(notes).toContain('Each of the 3 pages became a slide holding its picture');
  expect(notes).toContain('2 slides have speaker notes');
  await expectNoSeriousA11yIssues(win, 'the library after importing a PDF');
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder announcements/u })
    .click();
  await expect(win.getByTestId('import-report')).toHaveCount(0);
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

test('a PDF’s pages are drawn several at once while nothing is up and the stream is off, else one at a time (Session 56)', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp({
    DRASHTI_TEST_NO_CONVERTER: '1',
    DRASHTI_TEST_ON_AIR_HOOK: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pictures-e2e-'));
  const pdf = (name: string) => {
    const file = join(dir, `${name}.pdf`);
    writeFileSync(
      file,
      makeTestPdf(
        Array.from({ length: 6 }, (_, i) => ({
          width: 960,
          height: 540,
          color: [20 + i * 30, 40, 90] as [number, number, number],
          text: `${name} page ${String(i + 1)}`,
        })),
      ),
    );
    return file;
  };
  /** How many windows drew the last PDF at once, as Drashti's log says. */
  const atOnce = () => {
    const lines = readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('Pictures: drew 6 page(s) of 6'));
    return Number(/, (\d+) at once/u.exec(lines.at(-1) ?? '')?.[1] ?? 0);
  };
  const slidesOf = (id: string) =>
    win.evaluate(
      async (presentation) =>
        (
          (await (globalThis as PageGlobals).drashti.library.getPresentation(presentation))?.groups ?? []
        ).flatMap((g) => g.slides).length,
      id,
    );
  // Nothing up and the stream off: two or three windows, every page in its place.
  const [quiet = ''] = await importAndGetIds(win, [pdf('Placeholder quiet')]);
  expect(await slidesOf(quiet)).toBe(6);
  expect(atOnce()).toBeGreaterThanOrEqual(2);
  // The stream on air: one at a time.
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true);
  });
  const [onAir = ''] = await importAndGetIds(win, [pdf('Placeholder on air')]);
  expect(await slidesOf(onAir)).toBe(6);
  expect(atOnce()).toBe(1);
  await app.evaluate(() => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false);
  });
  // A slide up on the screens (a show): one at a time too.
  await win.evaluate(async (id) => {
    await (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'goLive',
      presentationId: id,
      slideIndex: 0,
    });
  }, quiet);
  const [showing = ''] = await importAndGetIds(win, [pdf('Placeholder during the show')]);
  expect(await slidesOf(showing)).toBe(6);
  expect(atOnce()).toBe(1);
  await app.close();
});

test('a PowerPoint file with nothing on the computer to save it as PDF is reported plainly', async () => {
  // A slide Drashti cannot draw itself (a shadow): since IM-6 (Session 57) a still deck it can draw comes in as
  // editable slides with no converter, so only such a slide still needs PowerPoint or Keynote.
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pictures-e2e-'));
  const deck = join(dir, 'Placeholder deck.pptx');
  writeFileSync(
    deck,
    makeTestPptx([{ color: '1E3A8A', text: 'Placeholder slide', notes: 'Placeholder note' }]),
  );
  await addTestPptxShadow(deck);
  await openLibrary(win);
  await dropFiles(win, win.getByTestId('library-drop'), [deck]);
  const notice = win.getByTestId('import-notice').filter({ hasText: 'Placeholder deck.pptx' });
  await expect(notice).toContainText('no Keynote or PowerPoint', { timeout: 60_000 });
  await expect(notice).toContainText('File > Save As, PDF');
  expect((await importItem(win, deck))?.outcome).toBe('failed');
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  await app.close();
});

test('a deck’s pages stay out of the Media list: a PDF and a picture imported, Media shows only the picture (Session 26a)', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-pictures-e2e-'));
  const pdf = join(dir, 'Placeholder katha.pdf');
  writeFileSync(
    pdf,
    makeTestPdf([
      { width: 960, height: 540, color: BLUE, text: 'Placeholder page one' },
      { width: 960, height: 540, color: RED, text: 'Placeholder page two' },
      { width: 960, height: 540, color: GREEN, text: 'Placeholder page three' },
    ]),
  );
  const picture = await makeTestImage(win, join(dir, 'Placeholder darshan.png'), { color: '#7c2d12' });
  const ids = await importAndGetIds(win, [pdf, picture]);
  expect(ids.every((id) => id !== '')).toBe(true);
  // The deck is a presentation of its three pages...
  await openLibrary(win);
  const deck = win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: 'Placeholder katha' });
  await expect(deck).toContainText('3 slides');
  await deck.click();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(3);
  // ...and Media lists only the picture.
  await win.getByTestId('library-tab-media').click();
  const items = win.getByTestId('media-item');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('Placeholder darshan.png');
  const listed = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
  expect(listed.map((m) => m.name)).toEqual(['Placeholder darshan.png']);
  await app.close();
});
