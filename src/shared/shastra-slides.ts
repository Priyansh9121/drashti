import type { Lang, RenderSlide, TextElement, TextRun } from './model';
import { LANGS } from './model';
import type { LiveLook } from './looks';
import { groupLookIn, shows } from './looks';
import type { ThemeFields, ThemeLangStyle } from './themes';

/*
 * A Shastra passage as slides (Session 12). Each item starts a slide, with
 * its reference line ("Satsang Diksha 14") above or below its words, drawn
 * with the text's theme: a style per language, the reference's style and
 * the box. An item too long for one slide goes on over several, cut at its
 * line breaks, else at the ends of sentences, else between words.
 *
 * Every language is cut in the same proportion, so each slide holds the
 * same part of the item in every language (a meaning stays beside its
 * Sanskrit). Every screen steps through the same slides, so the cutting
 * makes each slide fit wherever it shows: in the theme's box, in the
 * languages the live Look shows there, and in a lower third where a group
 * (or the stream's Camera layout) draws one, which takes fewer lines.
 *
 * Words are measured here, in the main process, which has no fonts to
 * measure with: from each script's typical letter widths, generously, and
 * wrapped word by word as a screen would. Shrink-to-fit on the boxes takes
 * care of what the estimate misses, so words never run out of their box.
 */

/** One item of a passage, as its slides need it. */
export interface PassageItemWords {
  /** Its reference line: "Satsang Diksha 14". */
  reference: string;
  texts: Partial<Record<Lang, string>>;
}

/** Where the passage must fit, from the live Look. */
export interface FitTargets {
  /** The languages groups showing slides as designed show; null for every language; 'none' when no group does. */
  designed: readonly Lang[] | null | 'none';
  /** Each lower third that shows it: its languages (null for every language). */
  lowerThirds: readonly (readonly Lang[] | null)[];
}

/** Every screen shows slides as designed, in every language (no Look says otherwise). */
export const FIT_EVERYWHERE: FitTargets = { designed: null, lowerThirds: [] };

/**
 * Where a passage must fit, from the live Look: each audience and key and
 * fill group that shows slides, as designed or as a lower third, in its
 * languages; and the stream's lower third when its Camera layout is on.
 * Stage screens fit words to their boxes themselves.
 */
export function fitTargets(
  look: LiveLook,
  groups: readonly { id: string; role: string }[],
  streamLowerThird: { languages: readonly Lang[] | null } | null,
): FitTargets {
  const designed: (readonly Lang[] | null)[] = [];
  const lowerThirds: (readonly Lang[] | null)[] = [];
  for (const g of groups) {
    if (g.role !== 'audience' && g.role !== 'keyfill') continue;
    const gl = groupLookIn(look, g.id);
    if (!shows(gl, 'slide')) continue;
    if (gl.slides === 'lowerThird') lowerThirds.push(gl.languages);
    else designed.push(gl.languages);
  }
  if (streamLowerThird) lowerThirds.push(streamLowerThird.languages);
  if (designed.length === 0) return { designed: lowerThirds.length > 0 ? 'none' : null, lowerThirds };
  if (designed.some((d) => d === null)) return { designed: null, lowerThirds };
  const union = LANGS.filter((l) => designed.some((d) => d?.includes(l)));
  return { designed: union, lowerThirds };
}

export interface PassageSlide {
  slide: RenderSlide;
  /** Which item of the passage it shows (its slides are a group in the slide grid). */
  item: number;
  /** The slide within its item (1 to `of`). */
  part: number;
  of: number;
}

// ---- measuring words without a screen ----------------------------------------------------

const SPACE = 0.27;

/** A letter's width, in ems, by script: generous typical widths of the bundled Noto fonts. */
function letterWidth(cp: number): number {
  if (cp === 0x20) return SPACE;
  if (cp >= 0x61 && cp <= 0x7a) return 0.56;
  if (cp >= 0x41 && cp <= 0x5a) return 0.68;
  if (cp >= 0x30 && cp <= 0x39) return 0.58;
  if (cp >= 0xc0 && cp <= 0x24f) return 0.58;
  if (cp >= 0x1e00 && cp <= 0x1eff) return 0.58;
  // Combining accents (transliteration's ā written as a + macron) take no room of their own.
  if (cp >= 0x300 && cp <= 0x36f) return 0;
  if (cp >= 0x900 && cp <= 0x97f) return indicWidth(cp - 0x900, 0.66);
  if (cp >= 0xa80 && cp <= 0xaff) return indicWidth(cp - 0xa80, 0.6);
  if (cp >= 0x2000 && cp <= 0x206f) return 0.35;
  return 0.55;
}

/** Devanagari and Gujarati share a layout: vowel signs below or above take no room, those beside a little. */
function indicWidth(at: number, consonant: number): number {
  // The dandas.
  if (at === 0x64 || at === 0x65) return 0.32;
  // Candrabindu, anusvara, nukta, the vowel signs under and over, and the virama (it joins, measured below).
  if (at <= 0x02 || at === 0x3c || (at >= 0x41 && at <= 0x48) || at === 0x4d || at === 0x62 || at === 0x63)
    return 0;
  // Visarga, and the vowel signs beside the letter (ा ि ी ो ौ and their kin).
  if (at === 0x03 || at === 0x3e || at === 0x3f || at === 0x40 || (at >= 0x49 && at <= 0x4c)) return 0.26;
  // Independent vowels are wider than consonants.
  if (at >= 0x04 && at <= 0x14) return consonant * 1.15;
  return consonant;
}

/** How wide a word is, in ems: a consonant before a virama is drawn half (or under the next). */
function wordEms(word: string): number {
  let ems = 0;
  let previous = 0;
  for (const ch of word) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x94d || cp === 0xacd) ems -= previous * 0.45;
    const w = letterWidth(cp);
    ems += w;
    previous = w;
  }
  return Math.max(0, ems);
}

/** Generosity: the estimate errs wide, so a slide is never fuller than a screen can hold. */
const SLACK = 1.08;

/** How many lines a paragraph takes in a box this wide, at this size, wrapped word by word. */
export function wrappedLines(paragraph: string, sizePx: number, widthPx: number, weight = 500): number {
  const words = paragraph.split(/\s+/u).filter((w) => w !== '');
  if (words.length === 0) return 1;
  const bold = weight >= 600 ? 1.05 : 1;
  const em = sizePx * SLACK * bold;
  let lines = 1;
  let x = 0;
  for (const word of words) {
    const w = wordEms(word) * em;
    if (x === 0) {
      // A word wider than the box takes as many lines as it needs.
      if (w > widthPx) {
        lines += Math.ceil(w / widthPx) - 1;
        x = w % widthPx;
      } else x = w;
      continue;
    }
    const next = x + SPACE * em + w;
    if (next <= widthPx) x = next;
    else {
      lines++;
      x = Math.min(w, widthPx);
    }
  }
  return lines;
}

// ---- cutting an item --------------------------------------------------------------------

/** Lines of words; a line too long to fit anywhere is cut at sentence ends, then between words. */
function units(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() !== '');
}

/** The sentences of a line: at . ? ! and the dandas, each keeping its mark. */
function sentences(line: string): string[] {
  const parts = line.match(/[^.?!।॥]+(?:[.?!।॥]+|$)/gu) ?? [line];
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** A line cut into pieces of about `count` words. */
function wordPieces(line: string, count: number): string[] {
  const words = line.split(/\s+/u).filter((w) => w !== '');
  const out: string[] = [];
  for (let i = 0; i < words.length; i += count) out.push(words.slice(i, i + count).join(' '));
  return out;
}

/** The order a passage's languages come in on its slides: the original first (Sanskrit, then its sound). */
function slideOrder(texts: Partial<Record<Lang, string>>): Lang[] {
  const sanskrit = texts.sa !== undefined || texts['sa-gu'] !== undefined;
  const order: Lang[] = sanskrit
    ? ['sa', 'sa-gu', 'translit', 'gu', 'hi', 'en']
    : ['gu', 'hi', 'translit', 'en', 'sa', 'sa-gu'];
  return order.filter((l) => texts[l] !== undefined);
}

/** Units in `k` chunks, each by where its middle falls in the whole (so every language is cut alike). */
function chunk(pieces: readonly string[], k: number, weigh: (s: string) => number): string[][] {
  const weights = pieces.map(weigh);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out: string[][] = Array.from({ length: k }, () => []);
  let before = 0;
  pieces.forEach((p, i) => {
    const w = weights[i] ?? 0;
    const middle = (before + w / 2) / total;
    before += w;
    out[Math.min(k - 1, Math.floor(middle * k))]?.push(p);
  });
  return out;
}

interface Box {
  width: number;
  height: number;
}

/** The height of some languages' lines in a box, with a blank line between languages. */
function blockHeight(
  parts: Partial<Record<Lang, string[]>>,
  langs: readonly Lang[],
  styles: Record<Lang, ThemeLangStyle>,
  lineHeight: number,
  width: number,
): number {
  let height = 0;
  let blocks = 0;
  for (const lang of langs) {
    const lines = parts[lang];
    if (!lines || lines.length === 0) continue;
    const st = styles[lang];
    const count = lines.reduce((n, l) => n + wrappedLines(l, st.size, width, st.weight), 0);
    if (blocks > 0) height += st.size * lineHeight;
    height += count * st.size * lineHeight;
    blocks++;
  }
  return height;
}

/** The lower third's own rules (render/LowerThird.tsx and shared/program.ts): at most 6 lines, smaller as they grow. */
const LOWER_THIRD_LINES = 6;

function lowerThirdFits(parts: Partial<Record<Lang, string[]>>, langs: readonly Lang[], slide: Box): boolean {
  // The reference line, then each language's lines.
  const source = 1 + langs.reduce((n, l) => n + (parts[l]?.length ?? 0), 0);
  if (source > LOWER_THIRD_LINES) return false;
  const size = slide.height * (source <= 2 ? 0.05 : source === 3 ? 0.044 : 0.037);
  const width = slide.width * 0.88 - 2 * 0.9 * size;
  const wrapped =
    1 +
    langs.reduce(
      (n, l) => n + (parts[l] ?? []).reduce((m, line) => m + wrappedLines(line, size, width, 600), 0),
      0,
    );
  return wrapped <= LOWER_THIRD_LINES;
}

/** The languages a target shows of these. */
const shownOf = (langs: readonly Lang[] | null, have: readonly Lang[]) =>
  langs === null ? have : have.filter((l) => langs.includes(l));

/** How many slides (at least) an item needs, and its words cut for each. */
function cutItem(
  texts: Partial<Record<Lang, string>>,
  theme: ThemeFields,
  slide: Box,
  words: Box,
  targets: FitTargets,
): Partial<Record<Lang, string[]>>[] {
  const have = slideOrder(texts);
  const designed = targets.designed === 'none' ? [] : shownOf(targets.designed, have);
  const thirds = targets.lowerThirds.map((t) => shownOf(t, have));
  const { lineHeight } = theme.box;
  const fits = (parts: Partial<Record<Lang, string[]>>) =>
    (designed.length === 0 ||
      blockHeight(parts, designed, theme.langs, lineHeight, words.width) <= words.height) &&
    thirds.every((t) => t.length === 0 || lowerThirdFits(parts, t, slide));

  // The pieces each language is cut from: its lines, and a line that cannot fit on a slide of its own in sentences.
  const alone = (lang: Lang, line: string) => fits({ [lang]: [line] });
  const pieces: Partial<Record<Lang, string[]>> = {};
  for (const lang of have) {
    const out: string[] = [];
    for (const line of units(texts[lang] ?? '')) {
      if (alone(lang, line)) {
        out.push(line);
        continue;
      }
      for (const sentence of sentences(line)) {
        if (alone(lang, sentence)) {
          out.push(sentence);
          continue;
        }
        // A sentence too long for a slide: about as many words as fit.
        let count = Math.max(1, sentence.split(/\s+/u).length);
        while (count > 1 && !wordPieces(sentence, count).every((p) => alone(lang, p)))
          count = Math.ceil(count / 2);
        out.push(...wordPieces(sentence, count));
      }
    }
    pieces[lang] = out;
  }

  const weigh = (lang: Lang) => (s: string) => {
    const st = theme.langs[lang];
    return wrappedLines(s, st.size, words.width, st.weight) * st.size;
  };
  const most = Math.max(1, ...have.map((l) => pieces[l]?.length ?? 0));
  for (let k = 1; k <= most; k++) {
    const per = new Map(have.map((l) => [l, chunk(pieces[l] ?? [], k, weigh(l))]));
    const slides = Array.from(
      { length: k },
      (_, j) =>
        Object.fromEntries(have.map((l) => [l, per.get(l)?.[j] ?? []])) as Partial<Record<Lang, string[]>>,
    );
    if (slides.every(fits)) return slides.filter((s) => have.some((l) => (s[l]?.length ?? 0) > 0));
  }
  // Even one piece a slide does not fit: one piece each (shrink-to-fit makes it fit).
  return Array.from(
    { length: most },
    (_, j) =>
      Object.fromEntries(
        have.map((l) => {
          const piece = pieces[l]?.[j];
          return [l, piece !== undefined ? [piece] : []];
        }),
      ) as Partial<Record<Lang, string[]>>,
  ).filter((s) => have.some((l) => (s[l]?.length ?? 0) > 0));
}

// ---- the slides ------------------------------------------------------------------------

const runOf = (text: string, lang: Lang | null, st: ThemeLangStyle): TextRun => ({
  text,
  lang,
  font: st.font,
  size: st.size,
  weight: st.weight,
  color: st.color,
  shadow: st.shadow,
});

/**
 * A passage's slides: each item's, in order. `idBase` makes their ids (the
 * same passage gives the same ids, so a screen does not redraw what is up).
 */
export function passageSlides(
  items: readonly PassageItemWords[],
  theme: ThemeFields,
  idBase: string,
  targets: FitTargets = FIT_EVERYWHERE,
  size: Box = { width: 1920, height: 1080 },
): PassageSlide[] {
  const scale = size.height / 1080;
  const box = {
    x: theme.box.x * size.width,
    y: theme.box.y * size.height,
    width: theme.box.width * size.width,
    height: theme.box.height * size.height,
  };
  const ref = theme.reference;
  const refHeight = ref.size * scale * 1.35;
  const gap = ref.size * scale * 0.4;
  const words: Box = { width: box.width, height: Math.max(box.height - refHeight - gap, box.height * 0.5) };
  const wordsY = ref.place === 'top' ? box.y + refHeight + gap : box.y;
  const refY = ref.place === 'top' ? box.y : box.y + words.height + gap;
  const scaled = Object.fromEntries(
    LANGS.map((l) => [l, { ...theme.langs[l], size: theme.langs[l].size * scale }]),
  ) as Record<Lang, ThemeLangStyle>;
  const scaledTheme: ThemeFields = { ...theme, langs: scaled };

  const out: PassageSlide[] = [];
  items.forEach((item, index) => {
    const cut = cutItem(item.texts, scaledTheme, size, words, targets);
    const order = slideOrder(item.texts);
    cut.forEach((parts, p) => {
      const id = `${idBase}#${index + 1}.${p + 1}`;
      const reference = cut.length > 1 ? `${item.reference} (${p + 1}/${cut.length})` : item.reference;
      const runs: TextRun[] = [];
      for (const lang of order) {
        const lines = parts[lang];
        if (!lines || lines.length === 0) continue;
        // A blank line between languages.
        const last = runs.at(-1);
        if (last) runs[runs.length - 1] = { ...last, text: `${last.text}\n\n` };
        runs.push(runOf(lines.join('\n'), lang, scaled[lang]));
      }
      const first = order.find((l) => (parts[l]?.length ?? 0) > 0) ?? 'en';
      const wordsBox: TextElement = {
        id: `${id}-words`,
        kind: 'text',
        frame: { x: box.x, y: wordsY, width: box.width, height: words.height },
        text: runs.map((r) => r.text).join(''),
        lang: first,
        style: {
          fontFamily: null,
          fontSize: scaled[first].size,
          fontWeight: scaled[first].weight,
          color: scaled[first].color,
          align: theme.box.align,
          verticalAlign: theme.box.verticalAlign,
          lineHeight: theme.box.lineHeight,
          shadow: scaled[first].shadow,
          shrinkToFit: true,
        },
        runs,
      };
      const referenceBox: TextElement = {
        id: `${id}-reference`,
        kind: 'text',
        frame: { x: box.x, y: refY, width: box.width, height: refHeight },
        text: reference,
        lang: null,
        style: {
          fontFamily: ref.font,
          fontSize: ref.size * scale,
          fontWeight: ref.weight,
          color: ref.color,
          align: theme.box.align,
          verticalAlign: 'middle',
          lineHeight: 1.2,
          shadow: ref.shadow,
          shrinkToFit: true,
        },
        // Every screen shows the reference, whatever its languages.
        everyScreen: true,
      };
      out.push({
        slide: {
          id,
          width: size.width,
          height: size.height,
          background: theme.background.kind === 'color' ? theme.background.color : null,
          elements: ref.place === 'top' ? [referenceBox, wordsBox] : [wordsBox, referenceBox],
          kirtan: true,
        },
        item: index,
        part: p + 1,
        of: cut.length,
      });
    });
  });
  return out;
}
