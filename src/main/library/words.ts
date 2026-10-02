import { randomUUID } from 'node:crypto';
import type { LyricsGroup } from '../../shared/lyrics';
import { groupKey, lyricsText, parseLyrics } from '../../shared/lyrics';
import type { Lang, TextElement, TextRun, TextStyle } from '../../shared/model';
import type { RunLook, SlideLook } from '../../shared/slide-edit';
import { detectLang, langOfLine, mainLang, mergeRuns, withDetectedLangs } from '../../shared/text-runs';
import type { ArrangementEntryRow, ContentRows, CueRow, ElementRow, GroupRow, SlideRow } from '../db/content';
import type { NewPresentation } from '../db/presentations';
import { groupColor } from '../import/formats/text';

/*
 * A presentation's words as plain text (the lyrics format of
 * src/shared/lyrics.ts), and edited words put back. Groups are matched by
 * name (a repeated name by its occurrence), and within a group slides are
 * matched by their words: unchanged slides anchor the match and changed ones
 * pair up in order, so fixing a word keeps a slide's styling, background and
 * cues. New slides look like their group's first slide, or like the theme.
 * Slides without words (pictures, blank slides) and disabled slides are not
 * in the text; they stay where they are.
 */

interface TextProps {
  text: string;
  lang: Lang | null;
  style: TextStyle;
  runs?: TextRun[];
}

export type { RunLook } from '../../shared/slide-edit';

/** How a slide looks in a group that has none yet: the theme's text box. */
export type NewSlideLook = SlideLook;

function textProps(row: ElementRow): TextProps | null {
  if (row.kind !== 'text') return null;
  try {
    const p = JSON.parse(row.props) as Partial<TextProps>;
    if (typeof p.text !== 'string' || typeof p.style !== 'object') return null;
    return p as TextProps;
  } catch {
    return null;
  }
}

/** A text box's words as lines: trimmed, empty lines left out (a blank line would split the slide). */
function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.replace(/\t/gu, ' ').trim())
    .filter((l) => l !== '');
}

const boxText = (p: TextProps) => (p.runs && p.runs.length > 0 ? p.runs.map((r) => r.text).join('') : p.text);

interface Box {
  row: ElementRow;
  props: TextProps;
  lines: string[];
}

interface SlideWords {
  slide: SlideRow;
  boxes: Box[];
  lines: string[];
}

function slideWords(slide: SlideRow, elements: readonly ElementRow[]): SlideWords {
  const boxes: Box[] = [];
  for (const row of elements) {
    const props = textProps(row);
    if (props) boxes.push({ row, props, lines: linesOf(boxText(props)) });
  }
  return { slide, boxes, lines: boxes.flatMap((b) => b.lines) };
}

function bySlide(rows: ContentRows): Map<string, ElementRow[]> {
  const map = new Map<string, ElementRow[]>();
  for (const e of [...rows.elements].sort((a, b) => a.position - b.position)) {
    const list = map.get(e.slide_id) ?? [];
    list.push(e);
    map.set(e.slide_id, list);
  }
  return map;
}

const inOrder = <T extends { position: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.position - b.position);

/** A text box in the theme's look for these lines: each line in its language's look. */
export function lookText(lines: readonly string[], look: NewSlideLook): TextProps {
  const runs = mergeRuns(
    withDetectedLangs(lines.map((line, i) => ({ text: i < lines.length - 1 ? `${line}\n` : line }))).map(
      (r) => ({
        ...(r.lang ? (look.langs[r.lang] ?? {}) : {}),
        ...r,
      }),
    ),
  );
  const props: TextProps = { text: lines.join('\n'), lang: mainLang(runs), style: look.style };
  if (runs.length > 1 || runs.some((r) => Object.keys(r).length > 2)) props.runs = runs;
  return props;
}

/** A new presentation from pasted words, in the theme's look. Null when there are no words. */
export function presentationFromWords(
  libraryId: string,
  name: string,
  text: string,
  look: NewSlideLook,
  size = { width: 1920, height: 1080 },
): NewPresentation | null {
  const parsed = parseLyrics(text);
  if (parsed.groups.length === 0) return null;
  return {
    libraryId,
    name,
    width: size.width,
    height: size.height,
    groups: parsed.groups.map((g) => ({
      name: g.name,
      color: groupColor(g.name),
      slides: g.slides.map((lines) => {
        const props = lookText(lines, look);
        const element: TextElement = { id: 'text', kind: 'text', frame: look.frame, ...props };
        return { elements: [element], background: look.background };
      }),
    })),
    arrangements: parsed.repeats ? [{ name: 'As written', groups: parsed.order }] : [],
    selectedArrangement: parsed.repeats ? 0 : null,
    source: { kind: 'drashti', path: null, ref: null, importedAt: null },
  };
}

/** Fonts of text typed in legacy fonts: such words cannot be edited as plain text yet. */
export function legacyFonts(rows: ContentRows): string[] {
  const fonts = new Set<string>();
  for (const e of rows.elements) {
    const p = textProps(e);
    for (const run of p?.runs ?? []) if (run.legacy) fonts.add(run.font ?? 'a legacy font');
  }
  return [...fonts];
}

/** The words, group by group, as the editor shows them. */
export function wordsOf(rows: ContentRows): string {
  const elements = bySlide(rows);
  const groups: LyricsGroup[] = [];
  for (const g of inOrder(rows.groups)) {
    const slides = inOrder(rows.slides.filter((s) => s.group_id === g.id && s.enabled === 1))
      .map((s) => slideWords(s, elements.get(s.id) ?? []).lines)
      .filter((lines) => lines.length > 0);
    if (slides.length > 0) groups.push({ name: g.name, slides });
  }
  return groups.length > 0 ? lyricsText(groups) : '';
}

/** Each line's look in a text box: the run it starts in. */
function lineLooks(p: TextProps): { look: RunLook; lang: Lang | null }[] {
  const looks: { look: RunLook; lang: Lang | null }[] = [];
  const runs = p.runs && p.runs.length > 0 ? p.runs : [{ text: p.text, lang: p.lang }];
  let atLineStart = true;
  for (const run of runs) {
    const { text, lang, legacy: _legacy, ...look } = run;
    for (const piece of text.split('\n').map((t, i) => ({ t, newLine: i > 0 }))) {
      if (piece.newLine) atLineStart = true;
      if (atLineStart && piece.t.trim() !== '') {
        looks.push({ look, lang: lang ?? detectLang(piece.t) });
        atLineStart = false;
      }
    }
  }
  return looks;
}

/**
 * New words for a text box, each line looking like the box's line in the
 * same language (else the line in the same place, else the last one).
 */
function withWords(p: TextProps, lines: readonly string[]): TextProps {
  const looks = lineLooks(p);
  const latin = (l: Lang | null | undefined) => l === 'en' || l === 'translit';
  const runs: TextRun[] = lines.map((line, i) => {
    // Latin letters stay what the line in their place was (plain transliteration looks like English).
    const here = looks[i]?.lang;
    const mark = latin(here) ? here : looks.find((l) => latin(l.lang))?.lang;
    const lang = langOfLine(mark, line) ?? detectLang(line);
    const found = looks.find((l) => l.lang === lang) ?? looks[i] ?? looks.at(-1);
    return { ...(found?.look ?? {}), lang, text: i < lines.length - 1 ? `${line}\n` : line };
  });
  const merged = mergeRuns(runs);
  const text = lines.join('\n');
  const { runs: _old, ...rest } = p;
  const styled = merged.some((r) => Object.keys(r).some((k) => k !== 'text' && k !== 'lang'));
  return merged.length > 1 || styled
    ? { ...rest, text, lang: mainLang(merged), runs: merged }
    : { ...rest, text, lang: detectLang(text) };
}

/** Share a slide's lines among its text boxes as they were shared before; the last box takes any extra. */
function shareLines(boxes: readonly Box[], lines: readonly string[]): string[][] {
  let at = 0;
  return boxes.map((b, i) => {
    if (i === boxes.length - 1) return lines.slice(at);
    const mine = lines.slice(at, at + b.lines.length);
    at += b.lines.length;
    return mine;
  });
}

/** Line up a group's old slides with its new ones: equal words anchor, the rest pair up in order. */
function alignSlides(old: readonly SlideWords[], next: readonly string[][]): (SlideWords | null)[] {
  const a = old.map((s) => s.lines.join('\n'));
  const b = next.map((lines) => lines.join('\n'));
  // Longest common run of equal slides, in a flat table: at(i, j) for a[i..] and b[j..].
  const width = b.length + 1;
  const table = new Array<number>((a.length + 1) * width).fill(0);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  const anchors: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      anchors.push([i, j]);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }
  anchors.push([a.length, b.length]);
  const out: (SlideWords | null)[] = new Array<SlideWords | null>(b.length).fill(null);
  let i0 = 0;
  let j0 = 0;
  for (const [ai, bj] of anchors) {
    // Between anchors, slides pair up in order: a slide with a word changed keeps its place.
    for (let k = 0; k < Math.min(ai - i0, bj - j0); k++) out[j0 + k] = old[i0 + k] ?? null;
    if (ai < a.length) out[bj] = old[ai] ?? null;
    i0 = ai + 1;
    j0 = bj + 1;
  }
  return out;
}

export interface WordsChange {
  rows: ContentRows;
  kept: number;
  changed: number;
  added: number;
  removed: number;
}

/** Put edited words back. Null when the text has no words at all (that would remove every slide). */
export function applyWords(
  rows: ContentRows,
  text: string,
  look: NewSlideLook,
  newId: () => string = randomUUID,
): WordsChange | null {
  const parsed = parseLyrics(text);
  if (parsed.groups.length === 0) return null;
  const elements = bySlide(rows);
  const oldGroups = inOrder(rows.groups).map((g) => {
    const all = inOrder(rows.slides.filter((s) => s.group_id === g.id));
    const words = all.map((s) => slideWords(s, elements.get(s.id) ?? []));
    return { row: g, all, worded: words.filter((w) => w.slide.enabled === 1 && w.lines.length > 0) };
  });
  type OldGroup = (typeof oldGroups)[number];
  const wordedGroups = oldGroups.filter((g) => g.worded.length > 0);

  // Groups by name, the second "Verse" with the second "Verse"...
  const queue = new Map<string, OldGroup[]>();
  for (const g of wordedGroups)
    queue.set(groupKey(g.row.name), [...(queue.get(groupKey(g.row.name)) ?? []), g]);
  const matched: (OldGroup | null)[] = parsed.groups.map((g) => queue.get(groupKey(g.name))?.shift() ?? null);
  // ...then a renamed group: one whose words are mostly still there, in order.
  const left = wordedGroups.filter((g) => !matched.includes(g));
  parsed.groups.forEach((g, i) => {
    if (matched[i]) return;
    const words = new Set(g.slides.map((lines) => lines.join('\n')));
    const found = left.find(
      (o) => o.worded.filter((w) => words.has(w.lines.join('\n'))).length * 2 >= Math.max(1, g.slides.length),
    );
    if (found) {
      matched[i] = found;
      left.splice(left.indexOf(found), 1);
    }
  });

  const out: ContentRows = {
    ...rows,
    groups: [],
    slides: [],
    elements: [],
    cues: [],
    arrangementEntries: [],
  };
  const keptSlides = new Set<string>();
  let kept = 0;
  let changed = 0;
  let added = 0;

  const addElement = (row: ElementRow) => out.elements.push(row);
  /** A new slide like `template` (its boxes, pictures and colour), or like the theme. */
  const newSlide = (groupId: string, lines: string[], template: SlideWords | null): SlideRow => {
    const slide: SlideRow = {
      id: newId(),
      group_id: groupId,
      position: 0,
      label: '',
      notes: '',
      background: template ? template.slide.background : look.background,
      transition: null,
      auto_advance_ms: null,
      enabled: 1,
    };
    if (template) {
      const shared = shareLines(template.boxes, lines);
      let box = 0;
      for (const e of elements.get(template.slide.id) ?? []) {
        const props = textProps(e);
        const words = props ? (shared[box++] ?? []) : null;
        addElement({
          ...e,
          id: newId(),
          slide_id: slide.id,
          props: props && words ? JSON.stringify(withWords(props, words)) : e.props,
        });
      }
    } else {
      const props = lookText(lines, look);
      addElement({
        id: newId(),
        slide_id: slide.id,
        position: 0,
        kind: 'text',
        x: look.frame.x,
        y: look.frame.y,
        width: look.frame.width,
        height: look.frame.height,
        rotation: 0,
        props: JSON.stringify(props),
      });
    }
    return slide;
  };

  const groupIds: string[] = [];
  parsed.groups.forEach((g, gi) => {
    const old = matched[gi] ?? null;
    const groupId = old?.row.id ?? newId();
    groupIds.push(groupId);
    const group: GroupRow = {
      id: groupId,
      name: g.name,
      color: old ? old.row.color : groupColor(g.name),
      position: gi,
    };
    out.groups.push(group);
    const pairs = old ? alignSlides(old.worded, g.slides) : g.slides.map(() => null);
    const template = old?.worded[0] ?? null;
    const slides: SlideRow[] = [];
    g.slides.forEach((lines, j) => {
      const was = pairs[j] ?? null;
      if (!was) {
        slides.push(newSlide(groupId, lines, template));
        added++;
        return;
      }
      keptSlides.add(was.slide.id);
      slides.push({ ...was.slide, group_id: groupId });
      const same = was.lines.join('\n') === lines.join('\n');
      if (same) kept++;
      else changed++;
      const shared = same ? null : shareLines(was.boxes, lines);
      let box = 0;
      for (const e of elements.get(was.slide.id) ?? []) {
        const props = textProps(e);
        if (!shared || !props) addElement(e);
        else addElement({ ...e, props: JSON.stringify(withWords(props, shared[box++] ?? [])) });
      }
    });
    // Slides without words (and disabled ones) stay after the slide they followed.
    if (old) {
      const placed = [...slides];
      let after: string | null = null;
      for (const s of old.all) {
        if (old.worded.some((w) => w.slide.id === s.id)) {
          after = keptSlides.has(s.id) ? s.id : after;
          continue;
        }
        keptSlides.add(s.id);
        for (const e of elements.get(s.id) ?? []) addElement(e);
        const at = after === null ? 0 : placed.findIndex((x) => x.id === after) + 1;
        placed.splice(at, 0, { ...s, group_id: groupId });
        after = s.id;
      }
      slides.splice(0, slides.length, ...placed);
    }
    slides.forEach((s, position) => out.slides.push({ ...s, position }));
  });
  // Groups with no words at all (pictures only) were not in the text: they stay, at the end.
  for (const g of oldGroups) {
    if (g.worded.length > 0) continue;
    out.groups.push({ ...g.row, position: out.groups.length });
    for (const s of g.all) {
      keptSlides.add(s.id);
      out.slides.push(s);
      for (const e of elements.get(s.id) ?? []) addElement(e);
    }
  }
  out.cues = rows.cues.filter((c: CueRow) => keptSlides.has(c.slide_id));

  // Arrangements keep the groups still there; repeated headers set the "As written" order.
  const groupsLeft = new Set(out.groups.map((g) => g.id));
  const entries: ArrangementEntryRow[] = [];
  for (const a of rows.arrangements) {
    const mine = inOrder(rows.arrangementEntries.filter((e) => e.arrangement_id === a.id)).filter((e) =>
      groupsLeft.has(e.group_id),
    );
    mine.forEach((e, position) => entries.push({ ...e, position }));
  }
  out.arrangementEntries = entries;
  if (parsed.repeats) {
    const existing = out.arrangements.find((a) => a.name.trim().toLocaleLowerCase('en') === 'as written');
    const written = existing ?? {
      id: newId(),
      name: 'As written',
      position: Math.max(-1, ...out.arrangements.map((a) => a.position)) + 1,
      source_ref: null,
    };
    if (!existing) {
      out.arrangements = [...out.arrangements, written];
      out.selectedArrangementId ??= written.id;
    }
    const id = written.id;
    out.arrangementEntries = [
      ...out.arrangementEntries.filter((e) => e.arrangement_id !== id),
      ...parsed.order.map((gi, position) => ({ arrangement_id: id, position, group_id: groupIds[gi] ?? '' })),
    ];
  }
  const oldWorded = oldGroups.reduce((n, g) => n + g.worded.length, 0);
  return { rows: out, kept, changed, added, removed: oldWorded - kept - changed };
}
