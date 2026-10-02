import type { ImportIssue } from '../../shared/import';
import type { KirtanDetails } from '../../shared/kirtans';
import { type Lang, LANGS } from '../../shared/model';
import { LANG_NAMES } from '../../shared/themes';
import { slideLines } from '../../shared/tracks';
import type { ParsedPresentation } from './model';

/*
 * Whether an imported presentation is a kirtan, and what the report says
 * about it. Its tracks are its own lines: each line's language comes from
 * its script (Latin lines: English, or transliteration when they have its
 * accent marks), and text typed in a legacy font is in no track until it
 * can be converted. It is a kirtan when the file names an author or artist
 * (the kavi), or when most of its slides with words have Gujarati or Hindi
 * lines together with lines in another language.
 */

export interface ImportedKirtan {
  details: Partial<KirtanDetails>;
  issue: ImportIssue;
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

export function importedKirtan(parsed: ParsedPresentation): ImportedKirtan | null {
  const slides = parsed.groups.flatMap((g) => g.slides).filter((s) => s.enabled);
  const per = new Map<Lang, number>();
  let worded = 0;
  let mixed = 0;
  let legacy = false;
  for (const s of slides) {
    const read = slideLines(s.elements);
    legacy ||= read.legacy;
    if (read.order.length === 0) continue;
    worded++;
    for (const lang of read.order) per.set(lang, (per.get(lang) ?? 0) + 1);
    if (read.order.length >= 2 && read.order.some((l) => l === 'gu' || l === 'hi')) mixed++;
  }
  const kavi = parsed.kavi ?? null;
  if (!kavi && (mixed === 0 || mixed * 2 < worded)) return null;
  const tracks = LANGS.filter((l) => per.has(l)).map((l) => {
    const n = per.get(l) ?? 0;
    return `${LANG_NAMES[l]} (${n === worded ? 'every slide' : `${n} of ${worded} slides`})`;
  });
  const parts = [
    tracks.length > 0
      ? `A kirtan: its lines are ${list(tracks)}, each line’s language going by its script.`
      : 'A kirtan, with no lines in a language yet.',
  ];
  if (kavi)
    parts.push(`Kavi “${kavi.name}”, from the ${kavi.from === 'author' ? 'author' : 'artist'} field.`);
  if (legacy) parts.push('Text in a legacy font is in no language until it can be converted.');
  return {
    details: { kavi: kavi?.name ?? null },
    issue: { severity: 'info', code: 'kirtan', message: parts.join(' '), fix: null },
  };
}
