import { describe, expect, it } from 'vitest';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { selectPdfPages, replacePdfPage, splitPdfPages } from './pdf-pages';

const page = (id: string, n: number): EditSlide => ({
  id,
  label: id,
  notes: '',
  background: null,
  darken: null,
  enabled: true,
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
  elements: [],
  cues: [],
  documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page: n, width: 400, height: 300 },
  sourceOccurrenceId: id,
});
const fixture = (): EditDoc => ({
  presentationId: 'placeholder',
  name: 'Placeholder',
  width: 400,
  height: 300,
  transition: null,
  loop: false,
  groups: [
    { id: 'group', name: '', color: null, slides: [page('one', 0), page('two', 1), page('three', 2)] },
  ],
  master: { ...page('master', 0), documentPage: undefined },
});
describe('PDF structural page operations', () => {
  it('extracts chosen pages and the one master without changing source occurrence identities or the input', () => {
    const before = fixture();
    const snapshot = structuredClone(before);
    const selected = selectPdfPages(before, [0, 2]);
    expect(selected?.groups[0]?.slides.map((p) => p.id)).toEqual(['one', 'three']);
    expect(selected?.master).toEqual(before.master);
    expect(selected?.groups[0]?.slides[1]?.sourceOccurrenceId).toBe('three');
    expect(before).toEqual(snapshot);
    for (const indices of [[], [3], [-1], [0, 0], [2, 0], [0.5]])
      expect(selectPdfPages(before, indices)).toBeNull();
  });
  it('replaces exactly one page, keeping the imported replacement provenance and every other page', () => {
    const before = fixture();
    const replacement = page('replacement', 7);
    const after = replacePdfPage(before, 'two', replacement);
    expect(after?.groups[0]?.slides.map((p) => p.id)).toEqual(['one', 'replacement', 'three']);
    expect(after?.groups[0]?.slides[1]?.documentPage?.page).toBe(7);
    expect(before.groups[0]?.slides[1]?.id).toBe('two');
    expect(replacePdfPage(before, 'master', replacement)).toBeNull();
    expect(replacePdfPage(before, 'missing', replacement)).toBeNull();
    expect(replacePdfPage(before, 'two', page('one', 7))).toBeNull();
  });
  it('keeps an added native page when splitting a PDF presentation', () => {
    const doc = fixture();
    const first = doc.groups[0]?.slides[0];
    if (!first) throw new Error('Generated first page missing.');
    delete first.documentPage;
    const parts = splitPdfPages(doc, 'two');
    expect(parts?.map((part) => part.groups.flatMap((group) => group.slides.map((page) => page.id)))).toEqual(
      [['one'], ['two', 'three']],
    );
  });
  it('splits before the chosen page into two nonempty ordered parts sharing the master', () => {
    const before = fixture();
    const parts = splitPdfPages(before, 'two');
    expect(parts?.map((d) => d.groups.flatMap((g) => g.slides.map((p) => p.id)))).toEqual([
      ['one'],
      ['two', 'three'],
    ]);
    expect(parts?.map((d) => d.master)).toEqual([before.master, before.master]);
    expect(splitPdfPages(before, 'one')).toBeNull();
    expect(splitPdfPages(before, 'missing')).toBeNull();
    expect(before.groups[0]?.slides).toHaveLength(3);
  });
});
