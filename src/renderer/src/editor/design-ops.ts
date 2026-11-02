import type { SlideLayout, TextElement } from '../../../shared/model';
import type { EditDoc, SlideLook } from '../../../shared/slide-edit';
import { findSlide, mapSlide, newSlide, newTextBox } from './ops';

export function ensureMaster(doc: EditDoc): EditDoc {
  return doc.master ? doc : { ...doc, master: { ...newSlide(null), label: 'Master' } };
}

/** Reposition only ordinary text; grouped cells, pictures, cues and every word stay intact. */
export function applyLayout(doc: EditDoc, slideId: string, layout: SlideLayout, look: SlideLook): EditDoc {
  const slide = findSlide(doc, slideId);
  if (!slide || slide.deck) return doc;
  const boxes = slide.elements.filter((el): el is TextElement => el.kind === 'text' && !el.groupId);
  const needed = layout === 'words' ? 1 : 2;
  const added: TextElement[] = [];
  while (boxes.length < needed) {
    const box = newTextBox(look);
    boxes.push(box);
    added.push(box);
  }
  const frames = new Map(
    boxes.map((box, i) => {
      let x = 0.08,
        y = 0.12,
        width = 0.84,
        height = 0.76;
      if (layout === 'two-columns') {
        const rows = Math.ceil(boxes.length / 2);
        x = i % 2 === 0 ? 0.06 : 0.54;
        y = 0.15 + (Math.floor(i / 2) * 0.7) / rows;
        width = 0.4;
        height = 0.7 / rows;
      } else if (layout === 'heading-words') {
        if (i === 0) {
          y = 0.08;
          height = 0.18;
        } else {
          y = 0.32 + ((i - 1) * 0.58) / (boxes.length - 1);
          height = 0.58 / (boxes.length - 1);
        }
      } else {
        y += (i * height) / boxes.length;
        height /= boxes.length;
      }
      return [
        box.id,
        { x: x * doc.width, y: y * doc.height, width: width * doc.width, height: height * doc.height },
      ] as const;
    }),
  );
  return mapSlide(doc, slideId, (s) => ({
    ...s,
    design: { ...s.design, layout },
    elements: [...s.elements, ...added].map((el) => {
      const frame = frames.get(el.id);
      return frame ? { ...el, frame } : el;
    }),
  }));
}
