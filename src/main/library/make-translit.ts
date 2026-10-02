import type { TrackEdit } from '../../shared/kirtans';
import type { SlideElement } from '../../shared/model';
import { capitalize, transliterate, type TranslitStyle } from '../../shared/translit';
import { slideLines } from '../../shared/tracks';
import type { AutoLineRow, ContentRows, ElementRow } from '../db/content';
import { elementFromRow } from '../db/presentations';

/*
 * "Make transliteration": a kirtan's transliteration track made from its
 * Gujarati lines (or, on a slide without them, its Hindi ones). Lines
 * Drashti makes are remembered as made (kirtan_auto_lines). A line counts
 * as made by Drashti while the slide still says exactly that, whoever
 * edited what (Edit words, the slide editor): once changed it is the
 * operator's own, and making the track again keeps it unless the operator
 * agrees to replace it. A line that already says what would be made is
 * left as it is, and counts as made.
 */

/** A line the operator changed, which making the track again would replace. */
export interface ManualLine {
  slideId: string;
  number: number;
  now: string;
  made: string;
}

export interface TranslitPlan {
  edits: TrackEdit[];
  /** The presentation's lines made by Drashti, after the change. */
  autoLines: AutoLineRow[];
  /** Filled in where a slide had none. */
  added: number;
  /** Made by Drashti before, made again (the Gujarati changed, or the style). */
  renewed: number;
  /** Already what would be made. */
  same: number;
  /** The operator's own lines that differ from what would be made. */
  manual: ManualLine[];
  /** Slides with no Gujarati or Hindi words to make it from (a legacy font counts as none). */
  noSource: number;
}

const byPosition = <T extends { position: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.position - b.position);

/** What making the transliteration would change; `replaceManual` replaces the operator's own lines too. */
export function planTransliteration(
  rows: ContentRows,
  style: TranslitStyle,
  replaceManual: boolean,
): TranslitPlan {
  const elements = new Map<string, ElementRow[]>();
  for (const e of byPosition(rows.elements))
    elements.set(e.slide_id, [...(elements.get(e.slide_id) ?? []), e]);
  const played = byPosition(rows.groups).flatMap((g) =>
    byPosition(rows.slides.filter((s) => s.group_id === g.id && s.enabled === 1)),
  );
  const playedIds = new Set(played.map((s) => s.id));
  const madeBefore = new Map(
    rows.autoLines.filter((a) => a.lang === 'translit').map((a) => [a.slide_id, a.text]),
  );
  const plan: TranslitPlan = {
    edits: [],
    // Records for slides that do not play stay; those that play are decided below.
    autoLines: rows.autoLines.filter((a) => a.lang !== 'translit' || !playedIds.has(a.slide_id)),
    added: 0,
    renewed: 0,
    same: 0,
    manual: [],
    noSource: 0,
  };
  played.forEach((slide, i) => {
    const els = (elements.get(slide.id) ?? []).flatMap((row): SlideElement[] => {
      const el = elementFromRow(row);
      return el ? [el] : [];
    });
    const { lines } = slideLines(els);
    const source = lines.gu ?? lines.hi;
    if (!source) {
      plan.noSource++;
      return;
    }
    const made = source.map((line) => capitalize(transliterate(line, style)));
    const text = made.join('\n');
    const record = () => plan.autoLines.push({ slide_id: slide.id, lang: 'translit', text });
    const now = lines.translit?.join('\n');
    if (now === undefined) {
      plan.edits.push({ slideId: slide.id, lang: 'translit', lines: made });
      plan.added++;
      record();
    } else if (now === text) {
      plan.same++;
      record();
    } else if (madeBefore.get(slide.id) === now) {
      plan.edits.push({ slideId: slide.id, lang: 'translit', lines: made });
      plan.renewed++;
      record();
    } else {
      plan.manual.push({ slideId: slide.id, number: i + 1, now, made: text });
      if (replaceManual) {
        plan.edits.push({ slideId: slide.id, lang: 'translit', lines: made });
        record();
      }
    }
  });
  return plan;
}
