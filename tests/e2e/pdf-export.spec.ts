/* Native export drafts. Install with both companion helpers only after review.
 * Run the separate oracle-preflight spec first. No fictional IPC is invoked.
 */
import { expect, test, type Locator } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawContent } from './deck-edit-fixtures';
import { editorGroup, slideEditorClosed, slideEditorWindow } from './helpers';
import {
  generatedPdf,
  openGeneratedPdf,
  PDF_LABELS,
  PDF_MARKERS,
  PDF_PAGES,
  requiredAt,
  savePdfCopy,
  usePdfTools,
} from './pdf-tools-fixtures';
import {
  inspectPdf,
  maximumDifference,
  occurrences,
  pdfRectInRaster,
  pixelsIn,
  whiteInk,
} from './pdf-export-oracle';

const words = (editor: Locator, text: string) =>
  editor.getByTestId('editor-slide').locator('[data-element]').filter({ hasText: text });
const oldInkRect = (height: number): [number, number, number, number] => [
  145,
  height / 2 + 2,
  278,
  height / 2 + 18,
];
const imageIds = (rows: ReturnType<typeof rawContent>, slideId: string) =>
  rows.elements
    .filter((row) => row.slide_id === slideId && row['kind'] === 'image')
    .map((row) => JSON.parse(String(row['props'])) as { mediaId?: string })
    .flatMap((props) => (props.mediaId ? [props.mediaId] : []));

test('replacing existing PDF words exports searchable words once, restores the patterned old-glyph area and leaves the original file exact', async () => {
  const info = test.info();
  test.setTimeout(180_000);
  const s = await openGeneratedPdf();
  try {
    const backgroundFile = join(s.folder, 'Placeholder pattern reference.pdf');
    writeFileSync(backgroundFile, generatedPdf(PDF_PAGES.map((page) => ({ ...page, oldWords: undefined }))));
    // Fixture/oracle preconditions: failure here is not the claimed UI RED.
    const source = await inspectPdf(s.source),
      background = await inspectPdf(backgroundFile);
    expect(source).toHaveLength(3);
    expect(background).toHaveLength(3);
    const sourceFirst = requiredAt(source, 0, 'first source raster');
    const backgroundFirst = requiredAt(background, 0, 'first background raster');
    const roi = pdfRectInRaster(backgroundFirst, oldInkRect(PDF_PAGES[0].height));
    expect(
      whiteInk(pixelsIn(sourceFirst, roi)),
      'old source glyphs really occupy the test region',
    ).toBeGreaterThan(20);
    expect(whiteInk(pixelsIn(backgroundFirst, roi))).toBe(0);
    const before = rawContent(s.userData, s.id);
    const firstId = before.slides[0]?.id;
    if (!firstId) throw new Error('fixture first page is not stored');
    const bakedImages = imageIds(before, firstId);
    expect(bakedImages, 'fixture import stored one full-page source raster').toHaveLength(1);

    // FIRST BEHAVIORAL RED: proposed contextual PDF-tools group is absent today.
    await usePdfTools(s.ed);
    const box = words(s.editor, PDF_PAGES[0].oldWords);
    await expect(box, 'change the existing source text, not a new overlay box').toHaveCount(1);
    await box.dblclick();
    const typing = s.editor.getByTestId('text-editing');
    await typing.fill(PDF_MARKERS.revised);
    await expect(typing).toHaveText(PDF_MARKERS.revised);
    // Save while typing must keep the last unblurred change.
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    s.unchanged();
    const saved = rawContent(s.userData, s.id);
    expect(
      imageIds(saved, firstId).some((id) => bakedImages.includes(id)),
      'edited page cannot retain the old whole-page glyph picture',
    ).toBe(false);
    await s.win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(s.app);
    await expect(words(reopened.editor, PDF_MARKERS.revised)).toHaveCount(1);
    await expect(words(reopened.editor, PDF_PAGES[0].oldWords)).toHaveCount(0);
    await usePdfTools(reopened.ed);
    const output = join(s.folder, 'Placeholder edited copy.pdf');
    await savePdfCopy(s.app, reopened.ed, output);
    s.unchanged();
    expect(readFileSync(output).equals(s.original), 'copy is an actual edited document').toBe(false);
    const exported = await inspectPdf(output);
    expect(exported).toHaveLength(3);
    const exportedFirst = requiredAt(exported, 0, 'first exported raster');
    const exportedSecond = requiredAt(exported, 1, 'second exported raster');
    expect(exported.map((page) => ({ width: page.width, height: page.height }))).toEqual([
      { width: 480, height: 320 },
      { width: 320, height: 480 },
      { width: 481.25, height: 319.5 },
    ]);
    expect(occurrences(exportedFirst.words, PDF_PAGES[0].oldWords)).toBe(0);
    expect(occurrences(exportedFirst.words, PDF_MARKERS.revised)).toBe(1);
    expect(occurrences(exportedSecond.words, PDF_PAGES[1].oldWords)).toBe(1);
    expect(occurrences(exportedFirst.words, PDF_PAGES[0].marker)).toBe(1);
    // Exact geometry above; this new 8-byte color bound is for known opaque strip
    // interiors, not a relaxation of the existing strict export geometry proof.
    expect(
      maximumDifference(pixelsIn(exportedFirst, roi), pixelsIn(backgroundFirst, roi)),
      'old-only ink is gone and its nonuniform background is restored',
    ).toBeLessThanOrEqual(8);
    expect(whiteInk(pixelsIn(exportedFirst, roi))).toBe(0);
    writeFileSync(info.outputPath('replacement-export.png'), exportedFirst.png);
    writeFileSync(info.outputPath('replacement-reference.png'), backgroundFirst.png);
    s.unchanged();
  } finally {
    try {
      await s.app.close();
    } finally {
      s.unchanged();
    }
  }
});

test('deleting PDF text, turning and reordering its page exports exact page sizes and Unicode once, without old rotated glyphs', async () => {
  const info = test.info();
  test.setTimeout(180_000);
  const s = await openGeneratedPdf();
  try {
    const referenceFile = join(s.folder, 'Placeholder rotated clean reference.pdf');
    const referencePage = { ...PDF_PAGES[1], oldWords: undefined, rotation: 90 as const };
    writeFileSync(referenceFile, generatedPdf([referencePage]));
    const source = await inspectPdf(s.source),
      reference = await inspectPdf(referenceFile);
    expect(source).toHaveLength(3);
    expect(reference).toHaveLength(1);
    const sourceSecond = requiredAt(source, 1, 'second source raster');
    const referenceFirst = requiredAt(reference, 0, 'rotated reference raster');
    expect({ width: sourceSecond.width, height: sourceSecond.height }).toEqual({ width: 320, height: 480 });
    const sourceRoi = pdfRectInRaster(sourceSecond, oldInkRect(PDF_PAGES[1].height));
    expect(whiteInk(pixelsIn(sourceSecond, sourceRoi))).toBeGreaterThan(20);
    const rotatedRoi = pdfRectInRaster(referenceFirst, oldInkRect(PDF_PAGES[1].height));
    expect(whiteInk(pixelsIn(referenceFirst, rotatedRoi))).toBe(0);
    const before = rawContent(s.userData, s.id);
    const middleId = before.slides[1]?.id;
    if (!middleId) throw new Error('fixture middle page is not stored');
    const bakedImages = imageIds(before, middleId);
    expect(bakedImages).toHaveLength(1);

    // FIRST BEHAVIORAL RED is the missing real contextual group.
    await usePdfTools(s.ed);
    await s.editor.getByTestId('editor-slide-thumb').nth(1).click();
    const old = words(s.editor, PDF_PAGES[1].oldWords);
    await expect(old).toHaveCount(1);
    await old.click();
    await s.ed.keyboard.press('Delete');
    await expect(old).toHaveCount(0);
    await s.ed.getByRole('button', { name: PDF_LABELS.rotateRight, exact: true }).click();
    // Reuse the actual 17a strip/drag interaction, not an invented page IPC.
    await editorGroup(s.ed, 'Slides');
    await s.editor.getByTestId('slides-strip').check();
    const thumbs = s.editor.getByTestId('editor-slide-thumb');
    const ids = await thumbs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slide-id')));
    const [firstSlideId, secondSlideId, thirdSlideId] = [
      requiredAt(ids, 0, 'first source thumbnail id'),
      requiredAt(ids, 1, 'second source thumbnail id'),
      requiredAt(ids, 2, 'third source thumbnail id'),
    ];
    if (!firstSlideId || !secondSlideId || !thirdSlideId)
      throw new Error('fixture source thumbnail id is empty');
    const from = await thumbs.nth(1).boundingBox(),
      to = await thumbs.nth(0).boundingBox();
    if (!from || !to) throw new Error('existing strip drag setup has no bounds');
    await s.ed.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await s.ed.mouse.down();
    await s.ed.mouse.move(to.x + 3, to.y + to.height / 2, { steps: 16 });
    await s.ed.mouse.up();
    await expect
      .poll(() => thumbs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slide-id'))))
      .toEqual([secondSlideId, firstSlideId, thirdSlideId]);
    await thumbs.nth(1).click(); // A receives an additional generated Unicode box.
    await editorGroup(s.ed, 'Insert');
    await s.editor.getByTestId('add-text').click();
    const text = `${PDF_MARKERS.added} ${PDF_MARKERS.gujarati} ${PDF_MARKERS.devanagari}`;
    await s.editor.getByTestId('text-editing').fill(text);
    await expect(s.editor.getByTestId('text-editing')).toHaveText(text);
    await s.editor.getByTestId('save-slides').click();
    await slideEditorClosed(s.app);
    const after = rawContent(s.userData, s.id);
    expect(after.slides.map((row) => row.id)).toEqual([
      requiredAt(before.slides, 1, 'second source slide').id,
      requiredAt(before.slides, 0, 'first source slide').id,
      requiredAt(before.slides, 2, 'third source slide').id,
    ]);
    expect(imageIds(after, middleId).some((id) => bakedImages.includes(id))).toBe(false);
    s.unchanged();
    await s.win.getByTestId('edit-slides').click();
    const reopened = await slideEditorWindow(s.app);
    await usePdfTools(reopened.ed);
    const output = join(s.folder, 'Placeholder turned reordered copy.pdf');
    await savePdfCopy(s.app, reopened.ed, output);
    const exported = await inspectPdf(output);
    expect(exported).toHaveLength(3);
    const exportedFirst = requiredAt(exported, 0, 'first exported raster');
    const exportedSecond = requiredAt(exported, 1, 'second exported raster');
    expect(exported.map((page) => ({ width: page.width, height: page.height }))).toEqual([
      { width: 480, height: 320 },
      { width: 480, height: 320 },
      { width: 481.25, height: 319.5 },
    ]);
    for (const [index, marker] of [PDF_PAGES[1].marker, PDF_PAGES[0].marker, PDF_PAGES[2].marker].entries())
      expect(occurrences(requiredAt(exported, index, 'ordered exported raster').words, marker)).toBe(1);
    const allWords = exported.map((page) => page.words).join('\n');
    expect(occurrences(allWords, PDF_PAGES[1].oldWords)).toBe(0);
    for (const marker of [PDF_MARKERS.added, PDF_MARKERS.gujarati, PDF_MARKERS.devanagari]) {
      expect(occurrences(exportedSecond.words, marker)).toBe(1);
      expect(occurrences(allWords, marker)).toBe(1);
    }
    expect(
      maximumDifference(pixelsIn(exportedFirst, rotatedRoi), pixelsIn(referenceFirst, rotatedRoi)),
      'deleted glyphs stay gone after rotation, with the correct rotated strip pattern',
    ).toBeLessThanOrEqual(8);
    expect(whiteInk(pixelsIn(exportedFirst, rotatedRoi))).toBe(0);
    writeFileSync(info.outputPath('deleted-turned-export.png'), exportedFirst.png);
    writeFileSync(info.outputPath('deleted-turned-reference.png'), referenceFirst.png);
    s.unchanged();
  } finally {
    try {
      await s.app.close();
    } finally {
      s.unchanged();
    }
  }
});
