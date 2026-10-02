import type { Lang, SlideElement, TextElement, TextRun } from './model';
import { LANGS } from './model';
import { langOfLine, mainLang, mergeRuns } from './text-runs';

/*
 * A kirtan's language tracks (PLAN.md 3): its Gujarati, Hindi, English and
 * transliteration lines, slide by slide. They are not kept apart from the
 * slides: the language of each run on a slide is the only copy of the
 * words, and a track is read from the runs when it is needed. So Edit
 * words, the slide editor, search, the importers and the screens all read
 * and write the same thing, and the tracks can never drift from the slides.
 *
 * A line's language comes from its script (Gujarati or Devanagari), and for
 * Latin letters from what its run is marked as: English (the meaning) or
 * transliteration. Text typed in a legacy font, and lines without letters,
 * are in no track.
 */

/** How a line in a language looks: a run's style without its words. */
export type LineLook = Omit<TextRun, 'text' | 'lang' | 'legacy'>;

/** One line of a text box, with its language. */
export interface BoxLine {
  /** Null for a line without letters, or one typed in a legacy font. */
  lang: Lang | null;
  /** Typed (at least partly) in a legacy font: never changed here. */
  legacy: boolean;
  /** Its runs, without line breaks; a blank line has none. */
  runs: TextRun[];
}

const LETTER = /\p{L}/gu;
const letters = (text: string) => text.match(LETTER)?.length ?? 0;

/** What a text box's words are: enough to read them by language. */
export type BoxWords = Pick<TextElement, 'text' | 'lang' | 'runs'>;

/** A run's language as marked: its own, else its box's. */
const marked = (run: TextRun, el: BoxWords): Lang | null | undefined =>
  run.lang !== undefined ? run.lang : el.lang;

/** The words of a line, as they read. */
export const lineText = (line: BoxLine): string => line.runs.map((r) => r.text).join('');

/** A text box's words, line by line, each with its language. */
export function boxLines(el: BoxWords): BoxLine[] {
  const source: TextRun[] = el.runs && el.runs.length > 0 ? el.runs : [{ text: el.text, lang: el.lang }];
  const lines: TextRun[][] = [[]];
  for (const run of source) {
    run.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1]?.push({ ...run, text: part });
    });
  }
  return lines.map((runs) => {
    const legacy = runs.some((r) => r.legacy === true);
    if (legacy) return { lang: null, legacy, runs };
    // What the line was marked as: the language of the run with the most letters in it.
    let mark: Lang | null | undefined;
    let most = 0;
    for (const r of runs) {
      const n = letters(r.text);
      if (n > most) [most, mark] = [n, marked(r, el)];
    }
    return { lang: langOfLine(mark, runs.map((r) => r.text).join('')), legacy, runs };
  });
}

/**
 * The text box with these lines instead of its own. Each line break goes at
 * the end of the line before it (as typed). A box that had no runs stays
 * plain text while it holds words in one language with no look of their own.
 */
export function withLines(el: TextElement, lines: readonly BoxLine[]): TextElement {
  const runs: TextRun[] = [];
  lines.forEach((line, i) => {
    if (i > 0) {
      const last = runs.at(-1);
      if (last) runs[runs.length - 1] = { ...last, text: `${last.text}\n` };
      else runs.push({ text: '\n' });
    }
    for (const r of line.runs) runs.push({ ...r });
  });
  const merged = mergeRuns(runs);
  const text = merged.map((r) => r.text).join('');
  const { runs: _old, ...rest } = el;
  const plainBefore = !el.runs || el.runs.length === 0;
  const langs = new Set(merged.map((r) => (r.lang !== undefined ? r.lang : el.lang)));
  const plain =
    plainBefore &&
    langs.size <= 1 &&
    merged.every((r) => Object.keys(r).every((k) => k === 'text' || k === 'lang'));
  // An emptied box keeps its language, so words in it come back where they were.
  const lang = mainLang(merged) ?? el.lang;
  return plain ? { ...rest, text, lang } : { ...rest, text, lang, runs: merged };
}

/** A slide's text boxes in reading order: top to bottom, then left to right. */
export function readingOrder(elements: readonly SlideElement[]): TextElement[] {
  return elements
    .filter((e): e is TextElement => e.kind === 'text')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.frame.y - b.e.frame.y || a.e.frame.x - b.e.frame.x || a.i - b.i)
    .map(({ e }) => e);
}

/** A slide's words by language. */
export interface SlideLines {
  /** Each language's lines on the slide, in reading order (trimmed; empty lines left out). */
  lines: Partial<Record<Lang, string[]>>;
  /** The languages in the order they first come on the slide. */
  order: Lang[];
  /** Words typed in a legacy font are on the slide: they are in no track until converted. */
  legacy: boolean;
}

export function slideLines(elements: readonly SlideElement[]): SlideLines {
  const out: SlideLines = { lines: {}, order: [], legacy: false };
  for (const el of readingOrder(elements))
    for (const line of boxLines(el)) {
      if (line.legacy) out.legacy = true;
      const text = lineText(line).trim();
      if (!line.lang || text === '') continue;
      (out.lines[line.lang] ??= []).push(text);
      if (!out.order.includes(line.lang)) out.order.push(line.lang);
    }
  return out;
}

/** The languages a slide (or any elements) has words in, in Drashti's order. */
export function langsOf(elements: readonly SlideElement[]): Lang[] {
  return langsOfBoxes(elements.filter((e): e is TextElement => e.kind === 'text'));
}

/** The languages these text boxes have words in, in Drashti's order. */
export function langsOfBoxes(boxes: readonly BoxWords[]): Lang[] {
  const found = new Set<Lang>();
  for (const box of boxes)
    for (const line of boxLines(box)) if (line.lang && lineText(line).trim() !== '') found.add(line.lang);
  return LANGS.filter((l) => found.has(l));
}

/**
 * The languages of a presentation in the order its slides put them, from
 * each slide's own order: a language goes after the one before it on the
 * slide where it first comes.
 */
export function trackOrder(orders: readonly (readonly Lang[])[]): Lang[] {
  const out: Lang[] = [];
  for (const order of orders)
    order.forEach((lang, i) => {
      if (out.includes(lang)) return;
      const before = order.slice(0, i).findLast((l) => out.includes(l));
      const after = order.slice(i + 1).find((l) => out.includes(l));
      if (before !== undefined) out.splice(out.indexOf(before) + 1, 0, lang);
      else if (after !== undefined) out.splice(out.indexOf(after), 0, lang);
      else out.push(lang);
    });
  return out;
}

/** What setLangLines needs to know beyond the slide. */
export interface LineContext {
  /** The presentation's order of languages (trackOrder): where a language new to the slide goes. */
  order: readonly Lang[];
  /** How a line in this language looks when the slide has none to copy. */
  look: LineLook;
  /** A new, empty text box, for a slide with none to put words in. */
  newBox: () => TextElement;
}

/** The look of a line: its first run's, without words or language. */
function lookOf(line: BoxLine): LineLook {
  const first = line.runs[0];
  if (!first) return {};
  const { text: _t, lang: _l, legacy: _g, ...look } = first;
  return look;
}

const newLine = (text: string, lang: Lang, look: LineLook): BoxLine => ({
  lang,
  legacy: false,
  runs: [{ ...look, text, lang }],
});

/**
 * A slide's elements with its lines in one language replaced by `lines`
 * (empty: the slide has none in that language, so it shows as missing).
 *
 * Lines that stay the same are not touched. Changed lines keep the look of
 * the line they replace; extra lines go after the last line in that
 * language, in its look; lines that go leave the rest closed up. A language
 * new to the slide goes into an emptied box of that language if there is
 * one, else into the box with the languages before it (after them), in the
 * presentation's look for it; a slide without a text box gets a new one.
 * Text in a legacy font is never changed. Elements not changed are the same
 * objects as before.
 */
export function setLangLines(
  elements: readonly SlideElement[],
  lang: Lang,
  lines: readonly string[],
  ctx: LineContext,
): SlideElement[] {
  const want = lines.map((l) => l.trim()).filter((l) => l !== '');
  const boxes = readingOrder(elements).map((el) => ({ el, lines: boxLines(el), changed: false }));
  const slots: { box: number; line: number; was: BoxLine }[] = [];
  boxes.forEach((b, bi) => {
    b.lines.forEach((line, li) => {
      if (line.lang === lang && lineText(line).trim() !== '') slots.push({ box: bi, line: li, was: line });
    });
  });
  const current = slots.map((s) => lineText(s.was).trim());
  if (current.length === want.length && current.every((t, i) => t === want[i])) return [...elements];

  if (slots.length > 0) {
    // Line by line, then any extra after the last; lines that go are marked and dropped below.
    const drop = new Set<string>();
    slots.forEach((slot, i) => {
      const box = boxes[slot.box];
      const line = box?.lines[slot.line];
      if (!box || !line) return;
      const text = want[i];
      if (text === undefined) {
        drop.add(`${slot.box}:${slot.line}`);
        box.changed = true;
      } else if (text !== lineText(line).trim()) {
        box.lines[slot.line] = newLine(text, lang, lookOf(line));
        box.changed = true;
      }
    });
    const lastSlot = slots[slots.length - 1];
    const last = lastSlot ? boxes[lastSlot.box] : undefined;
    if (lastSlot && last && want.length > slots.length) {
      const look = lookOf(lastSlot.was);
      last.lines.splice(lastSlot.line + 1, 0, ...want.slice(slots.length).map((t) => newLine(t, lang, look)));
      last.changed = true;
    }
    const blank = (l: BoxLine | undefined) => l !== undefined && !l.legacy && lineText(l).trim() === '';
    boxes.forEach((b, bi) => {
      if (!b.changed) return;
      // Lines that go take a blank line that only kept them apart with them: no doubled or loose blank lines.
      const kept: BoxLine[] = [];
      let gap = false;
      for (const [li, l] of b.lines.entries()) {
        if (drop.has(`${bi}:${li}`)) gap = true;
        else if (!(blank(l) && gap && (kept.length === 0 || blank(kept.at(-1))))) {
          kept.push(l);
          if (!blank(l)) gap = false;
        }
      }
      while (gap && blank(kept.at(-1))) kept.pop();
      b.lines = kept;
    });
  } else if (want.length > 0) {
    const added = want.map((t) => newLine(t, lang, ctx.look));
    const rank = (l: Lang) => {
      const at = ctx.order.indexOf(l);
      return at >= 0 ? at : ctx.order.length + LANGS.indexOf(l);
    };
    const mine = rank(lang);
    const hasWords = (b: (typeof boxes)[number]) => b.lines.some((l) => l.lang !== null);
    const emptied = boxes.find((b) => b.el.lang === lang && !b.lines.some((l) => lineText(l).trim() !== ''));
    const target =
      emptied ??
      boxes.find((b) => b.lines.some((l) => l.lang !== null && rank(l.lang) < mine)) ??
      boxes.find(hasWords) ??
      boxes.find((b) => !b.lines.some((l) => l.legacy));
    if (!target) {
      const box = ctx.newBox();
      return [...elements, withLines(box, added)];
    }
    if (target === emptied) target.lines = added;
    else {
      // After the last line of a language that comes before it, else before the first that comes after.
      const before = target.lines.findLastIndex((l) => l.lang !== null && rank(l.lang) < mine);
      const after = target.lines.findIndex((l) => l.lang !== null && rank(l.lang) > mine);
      const at = before >= 0 ? before + 1 : after >= 0 ? after : target.lines.length;
      // Into a box that only had blank lines: the words take their place.
      if (!hasWords(target) && !target.lines.some((l) => l.legacy)) target.lines = added;
      else target.lines.splice(at, 0, ...added);
    }
    target.changed = true;
  }
  const replaced = new Map(boxes.filter((b) => b.changed).map((b) => [b.el, withLines(b.el, b.lines)]));
  return elements.map((e) => (e.kind === 'text' ? (replaced.get(e) ?? e) : e));
}
