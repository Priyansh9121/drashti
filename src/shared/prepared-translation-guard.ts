import type { EditDoc } from './slide-edit';
import { slidesOf } from './slide-edit';

/** Simple Mode can edit original words, but cannot author or approve translations. */
export function translationsUnchanged(before: EditDoc, after: EditDoc): boolean {
  const attachments = new Map<string, string>();
  for (const slide of [...slidesOf(before), ...(before.master ? [before.master] : [])])
    for (const el of slide.elements)
      if (el.kind === 'text')
        attachments.set(
          JSON.stringify([slide.id, el.id]),
          JSON.stringify([el.translations ?? [], el.translationDisplay ?? null]),
        );
  for (const slide of [...slidesOf(after), ...(after.master ? [after.master] : [])])
    for (const el of slide.elements) {
      if (el.kind !== 'text') continue;
      const was = attachments.get(JSON.stringify([slide.id, el.id])) ?? '[[],null]';
      if (JSON.stringify([el.translations ?? [], el.translationDisplay ?? null]) !== was) return false;
    }
  return true;
}
