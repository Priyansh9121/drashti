import type { SlideElement, TextElement } from './model';
import { mergeRuns } from './text-runs';

/** Only adjacent, upright lines with the same look and a regular baseline can share a paragraph. */
function sameLook(a: TextElement, b: TextElement): boolean {
  return (
    !a.rotation &&
    !b.rotation &&
    a.lang === b.lang &&
    a.opacity === b.opacity &&
    JSON.stringify(a.style) === JSON.stringify(b.style) &&
    JSON.stringify((a.runs ?? [{ text: a.text }]).map(({ text: _text, ...look }) => look)) ===
      JSON.stringify((b.runs ?? [{ text: b.text }]).map(({ text: _text, ...look }) => look))
  );
}

/** Keep paint order and separate columns; a short last line ends a paragraph. No source words are discarded. */
export function pdfParagraphs(elements: SlideElement[]): SlideElement[] {
  const result: SlideElement[] = [];
  for (let i = 0; i < elements.length; i++) {
    const first = elements[i];
    if (first?.kind !== 'text') {
      if (first) result.push(first);
      continue;
    }
    let box = first;
    let previous = first;
    let leading: number | undefined;
    while (i + 1 < elements.length) {
      const next = elements[i + 1];
      if (next?.kind !== 'text' || !sameLook(first, next)) break;
      const gap = next.frame.y - previous.frame.y;
      const size = first.style.fontSize;
      if (
        Math.abs(next.frame.x - first.frame.x) > size * 0.2 ||
        gap < size ||
        gap > size * 1.6 ||
        (leading !== undefined && Math.abs(gap - leading) > size * 0.1) ||
        previous.frame.width < box.frame.width * 0.75 ||
        (previous.text + next.text).includes('\n')
      )
        break;
      leading ??= gap;
      const separator = /\s$/u.test(box.text) || /^\s/u.test(next.text) ? '' : ' ';
      const runs = mergeRuns([
        ...(box.runs ?? [{ text: box.text }]),
        ...(separator ? [{ ...(box.runs?.at(-1) ?? {}), text: separator }] : []),
        ...(next.runs ?? [{ text: next.text }]),
      ]);
      box = {
        ...box,
        text: box.text + separator + next.text,
        frame: {
          ...box.frame,
          width: Math.max(box.frame.width, next.frame.width),
          height: Math.round((next.frame.y - first.frame.y + next.frame.height) * 10000) / 10000,
        },
        style: { ...first.style, lineHeight: leading / size },
        ...(box.runs || next.runs ? { runs } : {}),
      };
      previous = next;
      i++;
    }
    result.push(box);
  }
  return result;
}
