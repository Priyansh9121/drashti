import { describe, expect, it } from 'vitest';
import type { EditDoc, SlideLook } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import type { TextElement } from '../../../shared/model';
import { resizePresentation, sizeLook } from '../../../shared/slide-size';
import { applyLayout, ensureMaster } from './design-ops';
import { newSlide } from './ops';

const text: TextElement = {
  id: 'placeholder-text', kind: 'text', text: 'Placeholder preserved words', lang: null,
  frame: { x: 100, y: 200, width: 800, height: 300 },
  style: { fontFamily: null, fontSize: 80, fontWeight: 400, color: '#ffffff', align: 'center', verticalAlign: 'middle', lineHeight: 1.35, shadow: { color: '#000000', blur: 8, x: 4, y: 8 } },
  runs: [{ text: 'Placeholder preserved words', size: 72, outline: { color: '#ffffff', width: 2 } }],
};
const look: SlideLook = { frame: text.frame, style: text.style, background: null, langs: { gu: { size: 72 } } };
function fixture(): EditDoc {
  return { presentationId: 'placeholder-presentation', name: 'Placeholder design', width: 1920, height: 1080, transition: null, loop: false,
    groups: [{ id: 'placeholder-group', name: 'Placeholder group', color: null, slides: [{ ...newSlide(null), id: 'placeholder-slide', elements: [text], guides: { x: [960], y: [540] } }] }],
  };
}

describe('slide size and layouts', () => {
  it('fits all content uniformly and centres it, including text effects, guides and the master', () => {
    const original = fixture();
    original.master = { ...newSlide(null), id: 'placeholder-master', elements: [{ ...text, id: 'placeholder-master-text' }] };
    const changed = resizePresentation(original, { width: 1440, height: 1080 });
    const first = slidesOf(changed)[0]?.elements[0];
    expect(first).toMatchObject({ id: text.id, text: text.text, frame: { x: 75, y: 285, width: 600, height: 225 }, style: { fontSize: 60, shadow: { blur: 6, x: 3, y: 6 } }, runs: [{ size: 54, outline: { width: 1.5 } }] });
    expect(slidesOf(changed)[0]?.guides).toEqual({ x: [720], y: [540] });
    expect(changed.master?.elements[0]?.frame).toEqual(first?.frame);
    expect(slidesOf(original)[0]?.elements[0]).toBe(text);
    expect(text.style.fontSize).toBe(80);
  });
  it('can keep the content’s pixel size, and ignores invalid dimensions', () => {
    const original = fixture();
    const changed = resizePresentation(original, { width: 1440, height: 1080 }, false);
    expect(changed.width).toBe(1440);
    expect(slidesOf(changed)[0]?.elements[0]).toBe(text);
    expect(resizePresentation(original, { width: 0, height: 1080 })).toBe(original);
    expect(resizePresentation(original, { width: NaN, height: 1080 })).toBe(original);
  });
  it('keeps new text and language sizes in step with the resized canvas', () => {
    expect(sizeLook(look, { width: 1920, height: 1080 }, { width: 1440, height: 1080 })).toMatchObject({ frame: { x: 75, y: 285, width: 600, height: 225 }, style: { fontSize: 60 }, langs: { gu: { size: 54 } } });
    expect(look.style.fontSize).toBe(80);
  });
  it('places two columns without losing words or changing a grouped table or a picture', () => {
    const original = fixture();
    const slide = slidesOf(original)[0];
    if (!slide) throw new Error('no slide');
    const cell = { ...text, id: 'placeholder-cell', groupId: 'placeholder-table' };
    const picture = { id: 'placeholder-picture', kind: 'image' as const, mediaId: 'placeholder-media', fit: 'fill' as const, frame: { x: 10, y: 10, width: 100, height: 100 } };
    slide.elements.push(cell, picture);
    const changed = applyLayout(original, slide.id, 'two-columns', look);
    const elements = slidesOf(changed)[0]?.elements ?? [];
    const boxes = elements.filter(e => e.kind === 'text' && !e.groupId);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ id: text.id, text: text.text, style: text.style });
    expect(boxes[1]).toMatchObject({ text: '' });
    expect(boxes[0]?.frame.x).toBeLessThan(boxes[1]?.frame.x ?? 0);
    expect(elements.find(e => e.id === cell.id)).toBe(cell);
    expect(elements.find(e => e.id === picture.id)).toBe(picture);
    expect(slidesOf(changed)[0]?.design?.layout).toBe('two-columns');
  });
  it('creates only one master and keeps it outside the playable groups', () => {
    const original = fixture();
    const changed = ensureMaster(original);
    expect(changed.master).toMatchObject({ label: 'Master', elements: [], background: null });
    expect(changed.groups).toBe(original.groups);
    expect(slidesOf(changed)).toHaveLength(1);
    expect(ensureMaster(changed)).toBe(changed);
  });
});
