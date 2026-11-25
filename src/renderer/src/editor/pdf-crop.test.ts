import { beforeEach, expect, it } from 'vitest';
import { documentPageSchema } from '../../../shared/document-page';
import type { EditDoc } from '../../../shared/slide-edit';
import { commit, redo, undo, useEditor } from './editor-store';
import { newSlide } from './ops';
import { cropPdfPages } from './pdf-crop';
import { turnPdfPageRight } from './pdf-page-ops';
const crop = { x: 0.125, y: 0.25, w: 0.5, h: 0.5 };
const fixture = (): EditDoc => ({
  presentationId: 'generated-pdf',
  name: 'Generated PDF',
  width: 800,
  height: 600,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'g',
      name: '',
      color: null,
      slides: Array.from({ length: 4 }, (_, n) => ({
        ...newSlide(null),
        id: `p${n}`,
        pageSize: { width: 400, height: 600 },
        documentPage: { sha256: 'a'.repeat(64), ext: 'pdf' as const, page: 3 - n, width: 400, height: 600 },
      })),
    },
  ],
});
beforeEach(() => {
  const doc = fixture();
  useEditor.setState({
    doc,
    opened: doc,
    slideId: 'p0',
    past: [],
    future: [],
    gesture: null,
    selection: [],
    editing: null,
    sourceConversion: null,
    coalesce: null,
  });
});
it('round-trips page crop and rejects boxes beyond the page, empty or non-finite', () => {
  const ref = fixture().groups[0]?.slides[0]?.documentPage;
  expect(documentPageSchema.parse({ ...ref, crop })).toMatchObject({ crop });
  for (const invalid of [
    { ...crop, w: 0 },
    { ...crop, x: 0.9 },
    { ...crop, y: NaN },
  ])
    expect(documentPageSchema.safeParse({ ...ref, crop: invalid }).success).toBe(false);
});

for (const [choice, indices] of [
  ['this', [1]],
  ['every', [0, 1, 2, 3]],
  ['odd', [0, 2]],
  ['even', [1, 3]],
] as const) {
  it(`crops ${choice} pages in current reading order, preserving originals and other pages`, () => {
    const before = fixture();
    const after = cropPdfPages(before, 'p1', crop, choice);
    const pages = after.groups.flatMap((g) => g.slides);
    expect(pages.map((p) => p.documentPage?.crop)).toEqual(
      [0, 1, 2, 3].map((i) => ((indices as readonly number[]).includes(i) ? crop : undefined)),
    );
    expect(before.groups.flatMap((g) => g.slides).every((p) => p.documentPage?.crop === undefined)).toBe(
      true,
    );
    expect(pages.map((p) => p.documentPage?.page)).toEqual([3, 2, 1, 0]);
    expect(pages.every((p) => p.documentPage?.edited === undefined)).toBe(true);
  });
}
it('one Undo and Redo cover a batch crop and whole-page reset separately', () => {
  const before = useEditor.getState().doc;
  if (!before) throw new Error('Missing generated document');
  commit(cropPdfPages(before, 'p0', crop, 'every'));
  const cropped = useEditor.getState().doc;
  if (!cropped) throw new Error('Missing cropped document');
  commit(cropPdfPages(cropped, 'p0', { x: 0, y: 0, w: 1, h: 1 }, 'every'));
  undo();
  expect(useEditor.getState().doc).toEqual(cropped);
  undo();
  expect(useEditor.getState().doc).toEqual(before);
  redo();
  expect(useEditor.getState().doc).toEqual(cropped);
});
it('turns the crop clockwise with the page and restores it after four turns', () => {
  const before = cropPdfPages(fixture(), 'p0', crop, 'this');
  let after = turnPdfPageRight(before, 'p0');
  expect(after.groups[0]?.slides[0]?.documentPage?.crop).toEqual({ x: 0.25, y: 0.125, w: 0.5, h: 0.5 });
  for (let i = 0; i < 3; i++) after = turnPdfPageRight(after, 'p0');
  expect(after.groups[0]?.slides[0]?.documentPage?.crop).toEqual(crop);
});

it('four turns retain decimal crop edges without floating point drift or negative zero', () => {
  const crop = { x: 0.1, y: 0.2, w: 0.6, h: 0.7 };
  let doc = cropPdfPages(fixture(), 'p0', crop, 'this');
  for (let n = 0; n < 4; n++) doc = turnPdfPageRight(doc, 'p0');
  expect(doc.groups[0]?.slides[0]?.documentPage?.crop).toEqual(crop);
});

it('Keep crop with the crop each chosen page already has changes nothing: the same document, no step for Undo', () => {
  const before = useEditor.getState().doc;
  if (!before) throw new Error('Missing generated document');
  // The whole page on pages that show the whole page already.
  expect(cropPdfPages(before, 'p0', { x: 0, y: 0, w: 1, h: 1 }, 'this')).toBe(before);
  expect(cropPdfPages(before, 'p0', { x: 0, y: 0, w: 1, h: 1 }, 'every')).toBe(before);
  commit(cropPdfPages(before, 'p0', crop, 'every'));
  const cropped = useEditor.getState().doc;
  if (!cropped) throw new Error('Missing cropped document');
  // The same crop again, on every page or on some of them, as the dialog opens on it.
  for (const pages of ['this', 'every', 'odd', 'even'] as const)
    expect(cropPdfPages(cropped, 'p1', { ...crop }, pages)).toBe(cropped);
  commit(cropPdfPages(cropped, 'p1', { ...crop }, 'odd'));
  expect(useEditor.getState().past).toHaveLength(1);
  undo();
  expect(useEditor.getState().doc).toEqual(before);
  // One page that differs is still a change, of that page alone.
  const one = cropPdfPages(cropped, 'p1', { ...crop, x: 0.25 }, 'this');
  expect(one).not.toBe(cropped);
  expect(one.groups[0]?.slides.map((s) => s.documentPage?.crop?.x)).toEqual([0.125, 0.25, 0.125, 0.125]);
});
