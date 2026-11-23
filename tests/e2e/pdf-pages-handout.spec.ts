import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { importAndGetIds, slideEditorClosed, type PageGlobals } from './helpers';
import { openGeneratedPdf, savePdfCopy, usePdfTools, generatedPdf, PDF_PAGES } from './pdf-tools-fixtures';
import { inspectPdf } from './pdf-export-oracle';

test('extracts chosen pages to a PDF copy in reading order without changing the original', async () => {
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Extract pages…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-pages-dialog');
    await dialog.getByLabel('Pages').fill('1, 3');
    await dialog.getByLabel('New PDF file').check();
    const output = join(s.folder, 'Placeholder extracted.pdf');
    await s.app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, output);
    await dialog.getByRole('button', { name: 'Extract pages', exact: true }).click();
    await expect.poll(() => existsSync(output)).toBe(true);
    const pages = await inspectPdf(output);
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => [page.width, page.height])).toEqual(
      [PDF_PAGES[0], PDF_PAGES[2]].map((page) => [page.width, page.height]),
    );
    expect(pages[0]?.words).toContain(PDF_PAGES[0].marker);
    expect(pages[1]?.words).toContain(PDF_PAGES[2].marker);
    const bytes = readFileSync(output);
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => existsSync(output)).toBe(false);
    await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => existsSync(output)).toBe(true);
    expect(readFileSync(output)).toEqual(bytes);
    const changed = Buffer.from('Placeholder file changed outside Drashti');
    writeFileSync(output, changed);
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.ed.getByTestId('editor-note')).toContainText('The extracted PDF changed');
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    expect(readFileSync(output)).toEqual(changed);
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});

test('replaces one page and undoes it, then splits before the chosen page with Undo', async () => {
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Replace page…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-insert-dialog');
    await expect(dialog.getByLabel('Page number')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(s.ed.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    const sourceFile = join(s.folder, 'Placeholder replacement.pdf');
    const replacement = [
      {
        width: 360,
        height: 240,
        marker: 'Placeholder replacement A',
        oldWords: 'Placeholder replaced words A',
      },
      {
        width: 240,
        height: 360,
        marker: 'Placeholder replacement B',
        oldWords: 'Placeholder replaced words B',
      },
    ];
    const sourceBytes = generatedPdf(replacement);
    writeFileSync(sourceFile, sourceBytes);
    const [sourceId] = await importAndGetIds(s.win, [sourceFile]);
    expect(sourceId).toBeTruthy();
    await s.ed.getByRole('button', { name: 'Replace page…', exact: true }).click();
    const replace = s.ed.getByTestId('pdf-insert-dialog');
    await replace.getByLabel('Page number').fill('2');
    await replace.getByTestId('pdf-insert-source').filter({ hasText: 'Placeholder replacement' }).click();
    await replace.getByRole('button', { name: 'Replace page', exact: true }).click();
    await expect(replace).toHaveCount(0);
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    await expect(s.editor.getByTestId('editor-slide')).toContainText('Placeholder replaced words B');
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText(PDF_PAGES[0].oldWords);
    await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText('Placeholder replaced words B');
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText(PDF_PAGES[0].oldWords);
    expect(readFileSync(sourceFile)).toEqual(sourceBytes);
    await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
    const beforeSplit = await s.win.evaluate(() =>
      (globalThis as PageGlobals).drashti.library.listPresentations(),
    );
    await s.ed.getByRole('button', { name: 'Split…', exact: true }).click();
    await s.ed
      .getByTestId('pdf-pages-dialog')
      .getByRole('button', { name: 'Split presentation', exact: true })
      .click();
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(1);
    const tail = (
      await s.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())
    ).filter((row) => !beforeSplit.some((old) => old.id === row.id));
    expect(tail).toHaveLength(1);
    expect(tail[0]?.slideCount).toBe(2);
    const tailId = tail[0]?.id;
    if (!tailId) throw new Error('Generated split part missing.');
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    await expect
      .poll(async () =>
        (await s.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())).some(
          (row) => row.id === tailId,
        ),
      )
      .toBe(false);
    await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(1);
    await expect
      .poll(async () =>
        (await s.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())).some(
          (row) => row.id === tailId,
        ),
      )
      .toBe(true);
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});

test('keeps a header footer watermark and page numbers on one master through PDF export and Undo', async () => {
  const s = await openGeneratedPdf();
  try {
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Hand-out…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-handout-dialog');
    await dialog.getByLabel('Header').fill('Placeholder header');
    await dialog.getByLabel('Footer').fill('Placeholder footer');
    await dialog.getByLabel('Watermark').fill('Placeholder draft');
    await dialog.getByLabel('Page numbers').check();
    await dialog.getByRole('button', { name: 'Keep hand-out', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).toContainText('Placeholder header');
    const output = join(s.folder, 'Placeholder handout.pdf');
    await savePdfCopy(s.app, s.ed, output);
    const pages = await inspectPdf(output);
    expect(pages).toHaveLength(3);
    for (const [i, page] of pages.entries()) {
      expect(page.words).toContain('Placeholder header');
      expect(page.words).toContain('Placeholder footer');
      expect(page.words).toContain('Placeholder draft');
      expect(page.words).toContain(String(i + 1));
    }
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(s.editor.getByTestId('editor-slide')).not.toContainText('Placeholder header');
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});

test('extracts selected pages to a new library presentation with reversible creation', async () => {
  const s = await openGeneratedPdf();
  try {
    const before = await s.win.evaluate(() =>
      (globalThis as PageGlobals).drashti.library.listPresentations(),
    );
    await usePdfTools(s.ed);
    await s.ed.getByRole('button', { name: 'Extract pages…', exact: true }).click();
    const dialog = s.ed.getByTestId('pdf-pages-dialog');
    await dialog.getByLabel('Pages').fill('2-3');
    await dialog.getByRole('button', { name: 'Extract pages', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const copies = (
      await s.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())
    ).filter((row) => !before.some((old) => old.id === row.id));
    expect(copies).toHaveLength(1);
    expect(copies[0]?.slideCount).toBe(2);
    const copy = copies[0];
    if (!copy) throw new Error('Extracted placeholder presentation missing.');
    await s.ed.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () =>
        (await s.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())).some(
          (row) => row.id === copy.id,
        ),
      )
      .toBe(false);
    await s.ed.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(async () =>
        (await s.win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations())).some(
          (row) => row.id === copy.id,
        ),
      )
      .toBe(true);
    await expect(s.editor.getByTestId('editor-slide-thumb')).toHaveCount(3);
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});

// QA21-TAKEPDF-1 A (the lead: nothing that works on air today may stop working): only the new page actions wait for
// the stream and recording to be off; a mark, Save, a single Make a slide and Save a PDF copy go on during a show.
test('on air, a mark, a single Make a slide, Save a PDF copy and Save go on, while Extract, Replace, Split and Hand-out wait', async () => {
  const s = await openGeneratedPdf(undefined, undefined, { DRASHTI_TEST_ON_AIR_HOOK: '1' });
  try {
    await usePdfTools(s.ed);
    const button = (name: string) => s.ed.getByRole('button', { name, exact: true });
    // Split is offered from the second page on; this is the first.
    const waiting = ['Extract pages…', 'Replace page…', 'Hand-out…'];
    const goingOn = ['Highlight', 'Insert pages…', 'Make a slide…', 'Save a PDF copy…'];
    const status = await s.win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    const send = async (live: 'off' | 'starting', recording: 'off' | 'starting') => {
      await s.app.evaluate(
        ({ BrowserWindow }, payload) => {
          const editor = BrowserWindow.getAllWindows().find(
            (win) => win.webContents.getURL() === payload.url,
          );
          if (!editor) throw new Error('Generated PDF editor missing.');
          editor.webContents.send('stream:changed', payload.status);
        },
        {
          url: s.ed.url(),
          status: {
            ...status,
            live: { ...status.live, state: live },
            recording: { ...status.recording, state: recording },
          },
        },
      );
    };
    for (const [live, recording] of [
      ['starting', 'off'],
      ['off', 'starting'],
    ] as const) {
      await send(live, recording);
      await expect(s.ed.getByTestId('pdf-pages-wait')).toContainText(
        'Extract, Replace, Split and Hand-out wait until the stream and recording are off.',
      );
      for (const name of waiting) await expect(button(name), name).toBeDisabled();
      for (const name of goingOn) await expect(button(name), name).toBeEnabled();
      await send('off', 'off');
      await expect(s.ed.getByTestId('pdf-pages-wait')).toHaveCount(0);
      for (const name of [...waiting, ...goingOn]) await expect(button(name), name).toBeEnabled();
    }

    // Main on air (its test hook): Extract pages… is refused in its own words and opens nothing.
    const onAir = (on: boolean) =>
      s.app.evaluate((_electron, on) => {
        const hook = (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir;
        if (!hook) throw new Error('The on-air test hook is missing.');
        hook(on);
      }, on);
    await onAir(true);
    await button('Extract pages…').click();
    await expect(s.ed.getByTestId('editor-note')).toContainText(
      'Extract pages, Replace page, Split and Hand-out wait while the stream is on air or recording.',
    );
    await expect(s.ed.getByTestId('pdf-pages-dialog')).toHaveCount(0);

    // A highlight drawn on the page, on air.
    await button('Highlight').click();
    const page = await s.editor.getByTestId('editor-slide').boundingBox();
    if (!page) throw new Error('The generated PDF page has no canvas.');
    await s.ed.mouse.move(page.x + page.width * 0.16, page.y + page.height * 0.28);
    await s.ed.mouse.down();
    await s.ed.mouse.move(page.x + page.width * 0.6, page.y + page.height * 0.4, { steps: 12 });
    await s.ed.mouse.up();
    // A single Make a slide… of the whole page, into the library, on air.
    await button('Make a slide…').click();
    const making = s.ed.getByTestId('make-slide');
    await making.getByRole('radio', { name: 'The library only', exact: true }).check();
    await making.getByRole('button', { name: 'Make the slide', exact: true }).click();
    await expect(s.ed.getByTestId('editor-note')).toContainText('Made “Placeholder PDF tools, page 1”');
    // Save a PDF copy…, on air.
    await savePdfCopy(s.app, s.ed, join(s.folder, 'Placeholder copy on air.pdf'));
    // Save, on air: the highlight is kept with the page.
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    const highlights = await s.win.evaluate(async (id) => {
      const edit = await (globalThis as PageGlobals).drashti.library.slidesForEdit(id);
      if (!edit.ok) throw new Error(edit.message);
      const first = edit.doc.groups.flatMap((g) => g.slides)[0];
      return (first?.elements ?? []).filter((el) => el.kind === 'shape' && el.pdfMark?.tool === 'highlight')
        .length;
    }, s.id);
    expect(highlights, 'the highlight drawn on air is saved with its page').toBe(1);
    await onAir(false);
    s.unchanged();
  } finally {
    await s.app.close();
    s.unchanged();
  }
});
