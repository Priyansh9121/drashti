import { randomUUID } from 'node:crypto';
import type { KirtanDetails, TrackEdit, TrackSlide } from '../../shared/kirtans';
import { occasionsFrom } from '../../shared/kirtans';
import type { Lang, SlideElement, TextElement } from '../../shared/model';
import { LANGS } from '../../shared/model';
import type { SlideLook } from '../../shared/slide-edit';
import { firstLook, type LineContext, setLangLines, slideLines, trackOrder } from '../../shared/tracks';
import type { ContentRows, ElementRow } from '../db/content';
import { elementFromRow } from '../db/presentations';
import { rowOf } from './slides';

/*
 * A kirtan's words by language, for the words editor's "By language" view,
 * and edits from it put back into the slides (src/shared/tracks.ts says
 * why the slides' runs are the only copy). Only the lines that changed are
 * rewritten; everything else on a slide keeps its stored row exactly.
 */

const byPosition = <T extends { position: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.position - b.position);

function elementsBySlide(rows: ContentRows): Map<string, ElementRow[]> {
  const map = new Map<string, ElementRow[]>();
  for (const e of byPosition(rows.elements)) map.set(e.slide_id, [...(map.get(e.slide_id) ?? []), e]);
  return map;
}

/** The slides that play (hidden ones are left out), in order, with their group. */
function playedSlides(rows: ContentRows) {
  return byPosition(rows.groups).flatMap((g) =>
    byPosition(rows.slides.filter((s) => s.group_id === g.id && s.enabled === 1)).map((s) => ({ s, g })),
  );
}

const readable = (list: readonly ElementRow[] | undefined): SlideElement[] =>
  (list ?? []).flatMap((row) => {
    const el = elementFromRow(row);
    return el ? [el] : [];
  });

/** Every slide that plays with its words by language, and the order the slides put the languages in. */
export function trackSlidesOf(rows: ContentRows): { slides: TrackSlide[]; order: Lang[] } {
  const elements = elementsBySlide(rows);
  const read = playedSlides(rows).map(({ s, g }, i) => {
    const words = slideLines(readable(elements.get(s.id)));
    return {
      slide: {
        slideId: s.id,
        number: i + 1,
        groupName: g.name,
        groupColor: g.color,
        label: s.label,
        lines: words.lines,
        legacy: words.legacy,
      },
      order: words.order,
    };
  });
  const order = trackOrder(read.map((r) => r.order));
  return { slides: read.map((r) => r.slide), order: [...order, ...LANGS.filter((l) => !order.includes(l))] };
}

/** The kirtan details as stored, for the library and the details dialog. */
export function detailsOf(rows: ContentRows): KirtanDetails | null {
  const k = rows.kirtan?.row;
  if (!k) return null;
  return {
    category: k.category,
    kavi: k.kavi,
    raag: k.raag,
    occasions: occasionsFrom(k.occasions),
    audioMediaId: k.audio_media_id,
  };
}

/** The rows with these kirtan details, or as not a kirtan (null). The words never change. */
export function withDetails(rows: ContentRows, details: KirtanDetails | null): ContentRows {
  return {
    ...rows,
    kirtan: details
      ? {
          row: {
            category: details.category,
            kavi: details.kavi,
            raag: details.raag,
            occasions: JSON.stringify(details.occasions),
            audio_media_id: details.audioMediaId,
          },
        }
      : null,
  };
}

/**
 * The rows with each edit's lines put into its slide (see setLangLines).
 * A language new to a slide takes the look its lines have elsewhere in the
 * presentation, else the theme's. Returns how many slides changed.
 */
export function applyTrackEdits(
  rows: ContentRows,
  edits: readonly TrackEdit[],
  look: SlideLook,
  newId: () => string = randomUUID,
): { rows: ContentRows; changed: number } {
  const elements = elementsBySlide(rows);
  const played = playedSlides(rows);
  const allSlides = played.map(({ s }) => readable(elements.get(s.id)));
  const order = trackOrder(allSlides.map((els) => slideLines(els).order));
  const looks = new Map<Lang, LineContext['look']>();
  const lookFor = (lang: Lang) => {
    let found = looks.get(lang);
    if (!found) {
      found = firstLook(allSlides, lang) ?? look.langs[lang] ?? {};
      looks.set(lang, found);
    }
    return found;
  };
  const known = new Set(played.map(({ s }) => s.id));
  const bySlide = new Map<string, TrackEdit[]>();
  for (const e of edits)
    if (known.has(e.slideId)) bySlide.set(e.slideId, [...(bySlide.get(e.slideId) ?? []), e]);

  const out: ElementRow[] = [];
  let changed = 0;
  for (const slide of rows.slides) {
    const stored = elements.get(slide.id) ?? [];
    const mine = bySlide.get(slide.id);
    if (!mine) {
      out.push(...stored);
      continue;
    }
    const before = readable(stored);
    let after: SlideElement[] = before;
    for (const edit of mine)
      after = setLangLines(after, edit.lang, edit.lines, {
        order,
        look: lookFor(edit.lang),
        newBox: (): TextElement => ({
          id: newId(),
          kind: 'text',
          frame: look.frame,
          text: '',
          lang: null,
          style: look.style,
        }),
      });
    if (after.every((el, i) => el === before[i]) && after.length === before.length) {
      out.push(...stored);
      continue;
    }
    changed++;
    // Changed boxes get new data; the rest (and anything unreadable) keep their rows, in place.
    const storedById = new Map(stored.map((r) => [r.id, r]));
    const unchanged = new Set(before);
    const placed = new Set<string>();
    for (const row of stored) {
      const el = after.find((e) => e.id === row.id);
      if (!el) {
        if (!elementFromRow(row)) out.push(row);
        continue;
      }
      placed.add(el.id);
      out.push(unchanged.has(el) ? row : rowOf(el, el.id, slide.id, storedById.get(el.id)));
    }
    let position = Math.max(-1, ...stored.map((r) => r.position));
    for (const el of after)
      if (!placed.has(el.id)) out.push({ ...rowOf(el, el.id, slide.id, undefined), position: ++position });
  }
  // rowOf leaves positions at 0: changed rows keep the place they had.
  const positionOf = new Map(rows.elements.map((r) => [r.id, r.position]));
  return {
    rows: {
      ...rows,
      elements: out.map((r) => (positionOf.has(r.id) ? { ...r, position: positionOf.get(r.id) ?? 0 } : r)),
    },
    changed,
  };
}
