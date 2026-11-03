import { describe, expect, it } from 'vitest';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { slideCanvas } from '../../../shared/document-page';
import { resizePresentation } from '../../../shared/slide-size';
import { sourceContentChanges } from './source-conversion';
import { newSlide } from './ops';

function fixture(): EditDoc {
  const page: EditSlide = {
    ...newSlide(null),
    id: 'placeholder-page',
    pageSize: { width: 480, height: 320 },
    documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: 480, height: 320 },
    elements: [
      {
        id: 'placeholder-shape',
        kind: 'shape',
        frame: { x: 48, y: 32, width: 96, height: 64 },
        fill: '#123456',
        cornerRadius: 4,
        opacity: 1,
        outline: { color: '#ffffff', width: 2 },
      },
    ],
    guides: { x: [240], y: [160] },
  };
  return {
    presentationId: 'placeholder-document',
    name: 'Placeholder master paper',
    width: 1280,
    height: 720,
    transition: null,
    loop: false,
    groups: [{ id: 'placeholder-group', name: '', color: null, slides: [page] }],
  };
}
function first(doc: EditDoc) {
  const page = doc.groups[0]?.slides[0];
  if (!page) throw new Error('Missing generated page.');
  return page;
}

describe('master and mixed paper consistency', () => {
  it('fits the master from its own canvas to the selected paper without mutating it', () => {
    const doc = fixture();
    const shape = first(doc).elements[0];
    if (!shape) throw new Error('Missing generated shape.');
    doc.master = {
      ...newSlide(null),
      id: 'placeholder-master',
      elements: [
        {
          ...shape,
          id: 'placeholder-master-shape',
          frame: { x: 128, y: 72, width: 256, height: 144 },
        },
      ],
    };
    const before = structuredClone(doc);
    const rendered = renderEditedSlide(doc, first(doc));
    expect(rendered.elements[0]?.frame).toEqual({ x: 48, y: 52, width: 96, height: 54 });
    expect(rendered.masterElementIds).toEqual(['placeholder-master-shape']);
    expect(doc).toEqual(before);
  });
  for (const fit of [true, false]) {
    it(`resizes from each paper's dimensions with fit=${String(fit)}`, () => {
      const doc = fixture();
      const before = structuredClone(doc);
      const next = resizePresentation(doc, { width: 960, height: 640 }, fit);
      expect(slideCanvas(first(next), next)).toEqual({ width: 960, height: 640 });
      expect(first(next).elements[0]?.frame).toEqual(
        fit ? { x: 96, y: 64, width: 192, height: 128 } : first(doc).elements[0]?.frame,
      );
      expect(first(next).guides).toEqual(fit ? { x: [480], y: [320] } : first(doc).guides);
      expect(first(next).elements[0]).toMatchObject(
        fit ? { cornerRadius: 8, outline: { width: 4 } } : { cornerRadius: 4, outline: { width: 2 } },
      );
      expect(doc).toEqual(before);
    });
  }
  it('resizes independent paper even when the target equals the document default', () => {
    const doc = fixture();
    const next = resizePresentation(doc, { width: 1280, height: 720 });
    expect(slideCanvas(first(next), next)).toEqual({ width: 1280, height: 720 });
    expect(first(next).elements[0]?.frame).toEqual({ x: 208, y: 72, width: 216, height: 144 });
  });
  it('does not convert an independent source paper when only the document default changes', () => {
    const doc = fixture();
    expect(sourceContentChanges(doc, { ...doc, width: 1600, height: 900 })).toEqual([]);
  });
  it('treats an empty master as no rendered change', () => {
    const doc = fixture();
    expect(
      sourceContentChanges(doc, { ...doc, master: { ...newSlide(null), id: 'placeholder-master' } }),
    ).toEqual([]);
  });
  it('converts only pages that inherit a changed master', () => {
    const doc = fixture();
    first(doc).design = { skipMaster: true };
    doc.groups[0]?.slides.push({
      ...structuredClone(first(doc)),
      id: 'placeholder-inherited',
      design: undefined,
    });
    const next = { ...doc, master: { ...newSlide(null), id: 'placeholder-master', background: '#112233' } };
    expect(sourceContentChanges(doc, next)).toEqual(['placeholder-inherited']);
  });
});
