import type { SlideElement } from '../../../shared/model';
import { SHAPE_NAMES } from '../../../shared/model';
import { cutText } from '../../../shared/text';

/** Object information can be absent in an older document. */
export type SlideObject = SlideElement & { name?: string; hidden?: boolean };

/** The original name, or a description for a box made without one. */
export function elementName(el: SlideObject): string {
  const name = el.name?.trim();
  if (name) return name;
  switch (el.kind) {
    case 'text': {
      const words = el.text.trim().replace(/\s+/gu, ' ');
      return words ? `Text box: ${cutText(words, 40)}` : 'Text box (empty)';
    }
    case 'shape':
      return SHAPE_NAMES[el.shape ?? 'rectangle'];
    case 'image':
      return 'Picture';
    case 'video':
      return 'Video';
    case 'timer':
      return 'Timer';
    default:
      return 'Object';
  }
}
