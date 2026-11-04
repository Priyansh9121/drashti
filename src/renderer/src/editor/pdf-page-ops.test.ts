import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaElement, ShapeElement } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { editingCanvas } from '../../../shared/document-page';
import { commit, undo, useEditor } from './editor-store';
import { findSlide, newSlide } from './ops';
import { deletePdfPage, turnPdfPageRight } from './pdf-page-ops';

const picture: MediaElement = {
  id: 'picture',
  kind: 'image',
  mediaId: 'generated-image',
  fit: 'fill',
  frame: { x: 30, y: 40, width: 60, height: 20 },
  rotation: 25,
  flipX: true,
  crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
};
const shape: ShapeElement = {
  id: 'shape',
  kind: 'shape',
  shape: 'triangle',
  frame: { x: 100, y: 70, width: 40, height: 80 },
  fill: '#126733',
  cornerRadius: 0,
  opacity: 1,
};
const page = (id: string, index: number): EditSlide => ({
  ...newSlide(null),
  id,
  documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page: index, width: 480, height: 320 },
  pageSize: { width: 480, height: 320 },
  elements: structuredClone([picture, shape]),
  guides: { x: [50, 300], y: [20, 200] },
});
const fixture = (): EditDoc => ({
  presentationId: 'placeholder-pdf',
  name: 'Placeholder PDF',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    { id: 'a', name: '', color: null, slides: [page('first', 0), page('second', 1)] },
    { id: 'b', name: '', color: null, slides: [page('third', 2)] },
  ],
});
const requiredPage = (doc: EditDoc, id: string): EditSlide => {
  const value = findSlide(doc, id);
  if (!value) throw new Error('Generated page is missing.');
  return value;
};

describe('native PDF page actions', () => {
  beforeEach(() => {
    const doc = fixture();
    useEditor.setState({
      doc,
      opened: doc,
      slideId: 'first',
      past: [],
      future: [],
      gesture: null,
      selection: [],
      editing: null,
      sourceConversion: null,
      coalesce: null,
    });
  });

  it('turns actual object centers and rotations once, swaps only this page size and preserves picture crop/source identity', () => {
    const before = fixture();
    const after = turnPdfPageRight(before, 'first');
    const turned = requiredPage(after, 'first');
    expect(turned.pageSize).toEqual({ width: 320, height: 480 });
    expect([after.width, after.height]).toEqual([1920, 1080]);
    expect(turned.elements[0]).toEqual({
      ...picture,
      frame: { x: 240, y: 50, width: 60, height: 20 },
      rotation: 115,
    });
    expect(turned.elements[1]).toEqual({
      ...shape,
      frame: { x: 190, y: 80, width: 40, height: 80 },
      rotation: 90,
    });
    expect(turned.guides).toEqual({ x: [120, 300], y: [50, 300] });
    expect(turned.documentPage).toEqual({ ...requiredPage(before, 'first').documentPage, rotation: 0 });
    expect(requiredPage(after, 'second')).toBe(requiredPage(before, 'second'));
    expect(requiredPage(before, 'first').elements).toEqual([picture, shape]);
  });

  it('four turns restore exact fractional geometry and preserve every object ID and source page index', () => {
    const before = fixture();
    const original = requiredPage(before, 'first');
    original.pageSize = { width: 481.25, height: 319.5 };
    let after = before;
    for (let n = 0; n < 4; n++) after = turnPdfPageRight(after, 'first');
    const final = requiredPage(after, 'first');
    expect(final.pageSize).toEqual(original.pageSize);
    expect(final.elements).toEqual(original.elements);
    expect(final.guides).toEqual(original.guides);
    expect(final.documentPage?.page).toBe(0);
    expect(final.documentPage?.sha256).toBe(original.documentPage?.sha256);
  });

  it('uses prepared page geometry before the first edit and refuses an ambiguous unapplied old rotation', () => {
    const doc = fixture();
    const first = requiredPage(doc, 'first');
    delete first.pageSize;
    expect(editingCanvas(first.documentPage, doc)).toEqual({ width: 480, height: 320 });
    expect(requiredPage(turnPdfPageRight(doc, 'first'), 'first').pageSize).toEqual({
      width: 320,
      height: 480,
    });
    if (!first.documentPage) throw new Error('Generated source metadata missing.');
    first.documentPage.rotation = 90;
    expect(turnPdfPageRight(doc, 'first')).toBe(doc);
  });

  it('commits a real turn and source conversion as one Undo, restoring original source playback on Undo', () => {
    const before = useEditor.getState().doc;
    if (!before) throw new Error('Generated document missing.');
    commit(turnPdfPageRight(before, 'first'));
    expect(useEditor.getState().past).toEqual([before]);
    const after = useEditor.getState().doc;
    if (!after) throw new Error('Turned document missing.');
    expect(requiredPage(after, 'first').documentPage?.edited).toBe(true);
    expect(requiredPage(after, 'first').pageSize).toEqual({ width: 320, height: 480 });
    undo();
    expect(useEditor.getState().doc).toBe(before);
    expect(requiredPage(before, 'first').documentPage?.edited).toBeUndefined();
  });

  it('deletes only the selected page and chooses the following page across groups without renumbering sources', () => {
    const before = fixture();
    const result = deletePdfPage(before, 'second');
    expect(result?.show).toBe('third');
    expect(
      result?.doc.groups.map((group) => group.slides.map((slide) => [slide.id, slide.documentPage?.page])),
    ).toEqual([[['first', 0]], [['third', 2]]]);
    expect(requiredPage(before, 'second').documentPage?.page).toBe(1);
  });

  it('keeps a final page and ignores unknown, non-PDF or master page actions', () => {
    const doc = fixture();
    const only = requiredPage(doc, 'first');
    const single = {
      ...doc,
      groups: [{ ...doc.groups[0], id: 'only', name: '', color: null, slides: [only] }],
    };
    expect(deletePdfPage(single, 'first')).toBeNull();
    expect(deletePdfPage(doc, 'missing')).toBeNull();
    expect(turnPdfPageRight(doc, 'missing')).toBe(doc);
    delete only.documentPage;
    expect(turnPdfPageRight(doc, 'first')).toBe(doc);
    expect(deletePdfPage(doc, 'first')).toBeNull();
    doc.master = { ...page('master', 3) };
    expect(turnPdfPageRight(doc, 'master')).toBe(doc);
    expect(deletePdfPage(doc, 'master')).toBeNull();
  });
});
