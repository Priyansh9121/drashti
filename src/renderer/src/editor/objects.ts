import type { SlideElement } from '../../../shared/model';
import { SHAPE_NAMES } from '../../../shared/model';
import { cutText } from '../../../shared/text';

/** The original name, or a description for a box made without one. */
export function elementName(el: SlideElement): string {
  const name = el.name?.trim();
  if (name) return name;
  return elementDescription(el);
}

/** What the selected object is and the words it shows. */
export function elementDescription(el: SlideElement): string {
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
