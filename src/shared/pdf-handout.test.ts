import { describe, expect, it } from 'vitest';
import { pdfHandout } from './pdf-handout';
import { renderEditedSlide } from './slide-design';
import { editDocSchema, type EditDoc, type EditSlide } from './slide-edit';
const page = (id: string): EditSlide => ({
  id,
  label: '',
  notes: '',
  background: null,
  darken: null,
  enabled: true,
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
  elements: [],
  cues: [],
  pageSize: { width: 400, height: 300 },
});
const fixture = (): EditDoc => ({
  presentationId: 'placeholder',
  name: 'Placeholder',
  width: 400,
  height: 300,
  transition: null,
  loop: false,
  groups: [{ id: 'g', name: '', color: null, slides: [page('one'), page('two')] }],
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Generated fixture is missing.');
  return value;
}
describe('PDF hand-out one master', () => {
  it('keeps one master, resolves page numbers for each editor page and leaves the source document unchanged', () => {
    const before = fixture();
    const doc = pdfHandout(before, {
      header: 'Placeholder header',
      footer: 'Placeholder footer',
      watermark: 'Placeholder draft',
      numbers: true,
    });
    expect(editDocSchema.safeParse(doc).success).toBe(true);
    expect(doc.master?.elements).toHaveLength(4);
    expect(before.master).toBeUndefined();
    for (const [i, slide] of required(doc.groups[0]).slides.entries()) {
      const rendered = renderEditedSlide(doc, slide);
      expect(rendered.elements.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual([
        'Placeholder header',
        'Placeholder footer',
        'Placeholder draft',
        String(i + 1),
      ]);
    }
    const second = pdfHandout(doc, {
      header: 'Placeholder changed',
      footer: '',
      watermark: '',
      numbers: false,
    });
    expect(second.master?.id).toBe(doc.master?.id);
    expect(second.master?.elements).toHaveLength(1);
    expect(second.master?.elements[0]).toMatchObject({ text: 'Placeholder changed' });
    expect(doc.master?.elements).toHaveLength(4);
  });
  it('anchors hand-out words to each mixed paper edge instead of centering a landscape master on portrait paper', () => {
    const doc = pdfHandout(fixture(), {
      header: 'Placeholder header',
      footer: 'Placeholder footer',
      watermark: '',
      numbers: true,
    });
    const page = required(required(doc.groups[0]).slides[1]);
    page.pageSize = { width: 300, height: 500 };
    const rendered = renderEditedSlide(doc, page);
    const header = required(rendered.elements.find((e) => e.name === 'PDF hand-out header'));
    const numbers = required(rendered.elements.find((e) => e.name === 'PDF hand-out numbers'));
    expect(header.frame.y).toBeCloseTo(12.5, 8);
    expect(numbers.frame.y + numbers.frame.height).toBeCloseTo(487.5, 8);
  });
  it('preserves existing master elements and resolves numbers again after page reordering', () => {
    let doc = pdfHandout(fixture(), { header: '', footer: '', watermark: '', numbers: true });
    const existing = {
      ...required(required(doc.master).elements[0]),
      id: 'existing',
      name: 'Existing master words',
      text: 'Placeholder existing',
    };
    doc = {
      ...doc,
      master: { ...required(doc.master), elements: [existing, ...required(doc.master).elements] },
    };
    doc = pdfHandout(doc, { header: 'Placeholder new', footer: '', watermark: '', numbers: true });
    expect(doc.master?.elements[0]).toEqual(existing);
    const reversed = {
      ...doc,
      groups: [{ ...required(doc.groups[0]), slides: [...required(doc.groups[0]).slides].reverse() }],
    };
    expect(
      renderEditedSlide(reversed, required(required(reversed.groups[0]).slides[0])).elements.at(-1),
    ).toMatchObject({ text: '1' });
  });
});
