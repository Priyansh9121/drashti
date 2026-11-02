import { describe, expect, it } from 'vitest';
import { addSlideAfter, newSlide, newTextBox } from './ops';
import type { EditDoc, EditSlide, SlideLook } from '../../../shared/slide-edit';
import { editDocSchema } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { currentLook, useEditor } from './editor-store';

function fixture(): { doc: EditDoc; slide: EditSlide } {
  const slide: EditSlide = {
    id: 'placeholder-page',
    label: '',
    notes: '',
    background: '#ffffff',
    darken: null,
    enabled: true,
    transition: null,
    autoAdvanceMs: null,
    macroId: null,
    elements: [],
    cues: [],
  };
  return {
    slide,
    doc: {
      presentationId: 'placeholder-document',
      name: 'Placeholder pages',
      width: 1280,
      height: 720,
      transition: null,
      loop: false,
      groups: [{ id: 'placeholder-group', name: 'Placeholder', color: null, slides: [slide] }],
    },
  };
}

describe('a native page canvas independent of its original file', () => {
  it('retains a blank page size in a validated editor document without inventing an original hash', () => {
    const { doc, slide } = fixture();
    Object.assign(slide, { pageSize: { width: 481.25, height: 319.5 } });
    const parsed = editDocSchema.parse(doc).groups[0]?.slides[0];
    if (!parsed) throw new Error('The generated page disappeared.');
    const size: unknown = Reflect.get(parsed, 'pageSize');
    expect(size).toEqual({ width: 481.25, height: 319.5 });
    expect(parsed.documentPage).toBeUndefined();
  });

  it('draws a native blank page at its own fractional size and keeps the presentation size', () => {
    const { doc, slide } = fixture();
    Object.assign(slide, { pageSize: { width: 481.25, height: 319.5 } });
    expect(renderEditedSlide(doc, slide)).toMatchObject({ width: 481.25, height: 319.5 });
    expect({ width: doc.width, height: doc.height }).toEqual({ width: 1280, height: 720 });
  });

  it('gives a new blank slide after a PDF page the selected paper size', () => {
    const { doc, slide } = fixture();
    slide.documentPage = { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: 480, height: 320 };
    const blank = newSlide(null);
    const next = addSlideAfter(doc, slide.id, blank);
    const added = next.groups.flatMap((group) => group.slides).find((page) => page.id === blank.id);
    if (!added) throw new Error('The generated blank page was not added.');
    expect(renderEditedSlide(next, added)).toMatchObject({ width: 480, height: 320 });
    expect(added.documentPage).toBeUndefined();
  });
});

describe('new text uses the selected paper canvas', () => {
  const papers = [
    { name: 'landscape', width: 480, height: 320 },
    { name: 'portrait', width: 320, height: 480 },
    { name: 'fractional', width: 481.25, height: 319.5 },
  ];
  for (const paper of papers) for (const kind of ['prepared PDF', 'native'] as const) {
    it(`places the current look's new text inside a ${kind} ${paper.name} page without changing content or history`, () => {
      const originalState = useEditor.getState();
      const { doc, slide } = fixture();
      if (kind === 'prepared PDF')
        slide.documentPage = { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: paper.width, height: paper.height };
      else slide.pageSize = { width: paper.width, height: paper.height };
      const before = structuredClone(doc);
      const look: SlideLook = {
        langs: {}, background: null,
        frame: { x: 160, y: 90, width: 960, height: 540 },
        style: { fontFamily: null, fontSize: 60, fontWeight: 400, color: '#ffffff', align: 'left', verticalAlign: 'top', lineHeight: 1.2, shadow: false },
      };
      try {
        useEditor.setState({ doc, opened: doc, look, slideId: slide.id, past: [], future: [], gesture: null,
          selection: [], editing: null, sourceConversion: null, pdfTool: null, pdfDrawing: false });
        const sized = currentLook();
        if (!sized) throw new Error('Generated page lost its text look.');
        const box = newTextBox(sized);
        expect(useEditor.getState().doc).toBe(doc);
        expect(useEditor.getState().opened).toBe(doc);
        expect(doc).toEqual(before);
        expect(useEditor.getState().past).toEqual([]);
        expect(useEditor.getState().future).toEqual([]);
        expect(useEditor.getState().gesture).toBeNull();
        expect(useEditor.getState().sourceConversion).toBeNull();
        expect(slide.elements).toEqual([]);
        expect(box.frame.x).toBeGreaterThanOrEqual(0);
        expect(box.frame.y).toBeGreaterThanOrEqual(0);
        expect(box.frame.x + box.frame.width, 'new text fits the selected paper width').toBeLessThanOrEqual(paper.width);
        expect(box.frame.y + box.frame.height, 'new text fits the selected paper height').toBeLessThanOrEqual(paper.height);
      } finally {
        useEditor.setState(originalState, true);
      }
    });
  }
});
