import type { SlideElement, TextRun } from './model';
import type { EditDoc } from './slide-edit';

/*
 * Text in one Unicode form, NFC (Sessions 31–36, I18N-6), where it enters Drashti: an import, the slide
 * editor, Edit words, a kirtan's tracks, a phone's message or announcement, a quote, a Shastra text or a
 * calendar. Never in the database layer, which theme apply and Undo also use. क़ typed as U+0958 and as
 * U+0915 U+093C is stored alike. Words typed in a legacy font are left as typed: their letters are codes for
 * that font, and composing them would change what it draws. Comparisons normalise both sides (sameText).
 */

export const nfc = (text: string): string => text.normalize('NFC');

/** Whether two texts say the same, whatever form each is in. */
export const sameText = (a: string, b: string): boolean => a === b || nfc(a) === nfc(b);

const nfcRun = (run: TextRun): TextRun => (run.legacy === true ? run : { ...run, text: nfc(run.text) });

/** A slide element with its words in NFC (a box's text, and its runs'); any other element as it is. */
export function nfcElement<T extends SlideElement>(el: T): T {
  if (el.kind !== 'text') return el;
  if (!el.runs || el.runs.length === 0) return { ...el, text: nfc(el.text) };
  const runs = el.runs.map(nfcRun);
  return { ...el, runs, text: runs.map((r) => r.text).join('') };
}

/**
 * Every string in plain data (a Shastra text, a calendar, a quote) in NFC: for content alone, never for
 * anything holding a file's path, which must stay exactly as the computer wrote it.
 */
export function nfcDeep<T>(value: T): T {
  if (typeof value === 'string') return nfc(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => nfcDeep(v)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nfcDeep(v as unknown)])) as T;
  return value;
}

/** A slide editor's document with its words in NFC: its name, its groups' names, its slides' labels, notes and words. */
export function nfcEditDoc(doc: EditDoc): EditDoc {
  return {
    ...doc,
    name: nfc(doc.name),
    groups: doc.groups.map((g) => ({
      ...g,
      name: nfc(g.name),
      slides: g.slides.map((s) => ({
        ...s,
        label: nfc(s.label),
        notes: nfc(s.notes),
        elements: s.elements.map(nfcElement),
      })),
    })),
  };
}
