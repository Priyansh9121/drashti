import type { Lang, RenderSlide, SlideElement, TextElement } from './model';
import type { BoxLine } from './tracks';
import { boxLines, lineText, withLines } from './tracks';

/*
 * Which languages a screen shows (PLAN.md 3: Audience shows Gujarati and
 * transliteration, the stage Gujarati only, the stream transliteration and
 * the meaning). A screen group lists its languages in the order it wants
 * them; null shows every language in the slide's own order.
 *
 * Only a kirtan's slides change. In each text box, the lines in languages
 * the screen leaves out go, and those it shows come in its order; the rest
 * closes up, with no blank line where a language was. Text with no language
 * (a line without letters, words in a legacy font) and boxes marked to show
 * on every screen always stay. When a slide's text boxes stand in one
 * column, a box left empty is taken out and the others close up around the
 * column's middle, in the screen's order. Shrink-to-fit then fits what is
 * left, as it would any words.
 */

/** A run of lines in one language, or of lines in none (which always stay where they are). */
interface Block {
  lang: Lang | null;
  lines: BoxLine[];
}

const isBlank = (l: BoxLine) => !l.legacy && lineText(l).trim() === '';

/** A box's lines as blocks, without the blank lines between them; and whether there were any. */
function blocksOf(lines: readonly BoxLine[]): { blocks: Block[]; spaced: boolean } {
  const blocks: Block[] = [];
  let spaced = false;
  for (const line of lines) {
    if (isBlank(line)) {
      if (blocks.length > 0) spaced = true;
      continue;
    }
    const last = blocks.at(-1);
    if (last?.lang === line.lang) last.lines.push(line);
    else blocks.push({ lang: line.lang, lines: [line] });
  }
  return { blocks, spaced };
}

/**
 * A text box in a screen's languages: null when nothing in it is left to
 * show, the same object when nothing changes.
 */
function boxIn(el: TextElement, langs: readonly Lang[]): TextElement | null {
  const lines = boxLines(el);
  const { blocks, spaced } = blocksOf(lines);
  if (!blocks.some((b) => b.lang !== null)) return el;
  // Language blocks fill the places language blocks had, in the screen's order; the others stay put.
  const rank = (b: Block) => (b.lang === null ? -1 : langs.indexOf(b.lang));
  const kept = blocks.filter((b) => rank(b) >= 0).sort((a, b) => rank(a) - rank(b));
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.lang === null) out.push(b);
    else {
      const pick = kept.shift();
      if (pick) out.push(pick);
    }
  }
  if (out.length === 0) return null;
  const same = out.length === blocks.length && out.every((b, i) => b === blocks[i]);
  if (same) return el;
  const blank: BoxLine = { lang: null, legacy: false, runs: [] };
  const rebuilt = out.flatMap((b, i) => (spaced && i > 0 ? [blank, ...b.lines] : b.lines));
  return withLines(el, rebuilt);
}

/** The language of a box with words in just one (null for several, or none). */
function onlyLang(el: TextElement): Lang | null {
  const langs = new Set(boxLines(el).flatMap((l) => (l.lang ? [l.lang] : [])));
  return langs.size === 1 ? ([...langs][0] ?? null) : null;
}

/** Text boxes standing one above another, each across most of the others' width. */
function oneColumn(boxes: readonly TextElement[]): boolean {
  if (boxes.length < 2) return false;
  const byTop = [...boxes].sort((a, b) => a.frame.y - b.frame.y);
  return byTop.every((a, i) => {
    const b = byTop[i + 1];
    if (!b) return true;
    const across =
      Math.min(a.frame.x + a.frame.width, b.frame.x + b.frame.width) - Math.max(a.frame.x, b.frame.x);
    const below = b.frame.y >= a.frame.y + a.frame.height - 1;
    return below && across >= 0.5 * Math.min(a.frame.width, b.frame.width) && !a.rotation && !b.rotation;
  });
}

function view(slide: RenderSlide, langs: readonly Lang[]): RenderSlide {
  const boxes = slide.elements.filter((e): e is TextElement => e.kind === 'text' && !e.rotation);
  const shown = new Map<SlideElement, SlideElement | null>();
  for (const el of slide.elements)
    if (el.kind === 'text') shown.set(el, el.everyScreen ? el : boxIn(el, langs));
  let elements = slide.elements.flatMap((el) => {
    const s = shown.has(el) ? shown.get(el) : el;
    return s ? [s] : [];
  });
  // A column of boxes closes up when one is left empty, or when the screen puts their languages in another order.
  if (oneColumn(boxes)) {
    const byTop = [...boxes].sort((a, b) => a.frame.y - b.frame.y);
    const kept = byTop.filter((b) => shown.get(b) !== null);
    const rank = (b: TextElement) => {
      if (b.everyScreen) return -1;
      const lang = onlyLang(b);
      return lang && langs.includes(lang) ? langs.indexOf(lang) : -1;
    };
    // Single-language boxes take the places such boxes had, in the screen's order; other boxes stay put.
    const ranked = kept.filter((b) => rank(b) >= 0).sort((a, b) => rank(a) - rank(b));
    const order = kept.map((b) => (rank(b) >= 0 ? (ranked.shift() ?? b) : b));
    const moved = order.length !== byTop.length || order.some((b, i) => b !== byTop[i]);
    if (moved && order.length > 0) {
      const top = Math.min(...byTop.map((b) => b.frame.y));
      const bottom = Math.max(...byTop.map((b) => b.frame.y + b.frame.height));
      const gaps = byTop.flatMap((a, i) => {
        const b = byTop[i + 1];
        return b ? [b.frame.y - (a.frame.y + a.frame.height)] : [];
      });
      const gap = Math.max(0, Math.min(...gaps));
      const height = order.reduce((n, b) => n + b.frame.height, 0) + gap * (order.length - 1);
      let y = (top + bottom) / 2 - height / 2;
      const placed = new Map<SlideElement, number>();
      for (const b of order) {
        placed.set(b, y);
        y += b.frame.height + gap;
      }
      elements = slide.elements.flatMap((el) => {
        const s = shown.has(el) ? shown.get(el) : el;
        if (!s) return [];
        const at = placed.get(el);
        return at === undefined || at === el.frame.y ? [s] : [{ ...s, frame: { ...s.frame, y: at } }];
      });
    }
  }
  const same = elements.length === slide.elements.length && elements.every((e, i) => e === slide.elements[i]);
  return same ? slide : { ...slide, elements };
}

const cache = new WeakMap<RenderSlide, Map<string, RenderSlide>>();

/**
 * The slide as a screen showing these languages (in this order) draws it;
 * the same object for a slide that is not a kirtan's, or when the screen
 * shows every language (null). Kept per slide, so a screen draws the same
 * object again until the slide changes.
 */
export function languageView(slide: RenderSlide, langs: readonly Lang[] | null): RenderSlide {
  if (!slide.kirtan || !langs) return slide;
  const key = langs.join(',');
  let mine = cache.get(slide);
  if (!mine) {
    mine = new Map();
    cache.set(slide, mine);
  }
  let shown = mine.get(key);
  if (!shown) {
    shown = view(slide, langs);
    mine.set(key, shown);
  }
  return shown;
}
