import { beforeEach, describe, expect, it } from 'vitest';
import { pdfHandout } from '../../../shared/pdf-handout';
import { commit, noteOutside, undo, redo, useEditor } from './editor-store';
import { newSlide } from './ops';
import type { EditDoc } from '../../../shared/slide-edit';
const doc: EditDoc = {
  presentationId: 'placeholder',
  name: 'Placeholder',
  width: 400,
  height: 300,
  loop: false,
  transition: null,
  groups: [{ id: 'group', name: '', color: null, slides: [newSlide(null)] }],
};
beforeEach(() =>
  useEditor.setState({ doc, opened: doc, past: [], future: [], editing: null, sourceConversion: null }),
);
describe('PDF external Undo acknowledgement', () => {
  it('retains a refused step, then advances only when Main confirms Undo and Redo', async () => {
    let allowed = false;
    noteOutside({ undo: () => Promise.resolve(allowed), redo: () => Promise.resolve(allowed) });
    const past = useEditor.getState().past;
    undo();
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditor.getState().past).toBe(past);
    expect(useEditor.getState().future).toHaveLength(0);
    allowed = true;
    undo();
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().future).toHaveLength(1);
    allowed = false;
    redo();
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditor.getState().future).toHaveLength(1);
    allowed = true;
    redo();
    await Promise.resolve();
    await Promise.resolve();
    expect(useEditor.getState().past).toHaveLength(1);
    expect(useEditor.getState().future).toHaveLength(0);
  });
});

it('keeps a PDF hand-out and every page conversion in one Undo step', () => {
  const source = structuredClone(doc);
  const page = source.groups[0]?.slides[0];
  if (!page) throw new Error('Generated page missing.');
  page.documentPage = { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: 400, height: 300 };
  page.pageSize = { width: 400, height: 300 };
  useEditor.setState({ doc: source, opened: source, preparingSource: new Set() });
  commit(
    pdfHandout(source, {
      header: 'Placeholder header',
      footer: 'Placeholder footer',
      watermark: 'Placeholder draft',
      numbers: true,
    }),
  );
  expect(useEditor.getState().past).toHaveLength(1);
  expect(useEditor.getState().doc?.master?.elements).toHaveLength(4);
  expect(useEditor.getState().doc?.groups[0]?.slides[0]?.documentPage?.edited).toBe(true);
  undo();
  expect(useEditor.getState().doc).toBe(source);
  expect(useEditor.getState().doc?.master).toBeUndefined();
  expect(page.documentPage.edited).toBeUndefined();
  redo();
  expect(useEditor.getState().doc?.master?.elements).toHaveLength(4);
});
