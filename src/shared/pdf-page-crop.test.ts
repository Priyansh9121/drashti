import { expect, it } from 'vitest';
import { renderEditedSlide } from './slide-design';
import type { EditDoc } from './slide-edit';
const crop = { x: 0.125, y: 0.25, w: 0.5, h: 0.5 };
it('editor thumbnails compose cropped geometry while full-page editing and printing keep the original canvas', () => {
  const page = {
    id: 'page',
    label: '',
    notes: '',
    background: null,
    darken: null,
    enabled: true,
    transition: null,
    autoAdvanceMs: null,
    macroId: null,
    cues: [],
    elements: [],
    pageSize: { width: 400, height: 600 },
    documentPage: { sha256: 'a'.repeat(64), ext: 'pdf' as const, page: 0, crop },
  };
  const doc: EditDoc = {
    presentationId: 'generated',
    name: 'Generated',
    width: 1920,
    height: 1080,
    transition: null,
    loop: false,
    groups: [{ id: 'g', name: '', color: null, slides: [page] }],
  };
  expect(renderEditedSlide(doc, page)).toMatchObject({
    width: 200,
    height: 300,
    pageCrop: { x: 50, y: 150, width: 400, height: 600 },
  });
  expect(renderEditedSlide(doc, page, true)).toMatchObject({ width: 400, height: 600 });
  expect(renderEditedSlide(doc, page, true).pageCrop).toBeUndefined();
});
