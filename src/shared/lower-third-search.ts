import { animationById } from './lower-third-animations';
import { familyOf, OFFERED_LIST, outName } from './lower-third-studio';
import { MOTION_NAMES, STYLE_NAMES } from './lower-third-styles';
import { LOWER_THIRD_TEMPLATES, type LowerThirdTemplate } from './lower-third-templates';

/*
 * Finding a lower third's animation or template by plain words (Session 58, the owner: "make finding an animation
 * simple, in the place you pick it"): one search box where it is chosen, the Animation tab's for the ways in and out
 * together and the templates' own. Each word typed must be the start of one of the words a choice is found by: its
 * name (and, going out, its name going out), its other names, the heading it is listed under, and what it is in
 * everyday words: its kind, the way it comes, its feel and its speed ("slide up slow", "from below", "fast", "soft").
 * A template is found by its name, its look (style, moving background, font), its move's own words and its four
 * tags (the filters the gallery had). What is found keeps the list's own order. A few quick words under each box put
 * a word in it with one press.
 */

/** Little words a search leaves out: "from the left" is "left". */
const LITTLE = new Set([
  'a',
  'an',
  'and',
  'the',
  'in',
  'out',
  'from',
  'to',
  'by',
  'of',
  'on',
  'with',
  'then',
]);

/** The words a search reads: lower case, letters and digits only, without marks or the little words. */
export function searchWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '' && !LITTLE.has(w));
}

type Words = Readonly<Record<string, readonly string[]>>;

/** Where it comes from, in everyday words (a template's "up" rises from below). */
const DIRECTION_WORDS: Words = {
  left: ['left'],
  right: ['right'],
  up: ['up', 'upwards', 'below', 'bottom', 'rise', 'rising'],
  down: ['down', 'downwards', 'above', 'top', 'drop', 'dropping', 'falling'],
  centre: ['centre', 'center', 'middle'],
};
const SPEED_WORDS: Words = {
  quick: ['quick', 'fast', 'snappy', 'brisk'],
  steady: ['steady', 'medium', 'normal'],
  slow: ['slow', 'slowly', 'leisurely'],
};
const FEEL_WORDS: Words = {
  calm: ['calm', 'gentle', 'soft', 'quiet', 'subtle', 'simple'],
  elegant: ['elegant', 'graceful', 'classic', 'refined'],
  bold: ['bold', 'strong', 'lively', 'striking', 'punchy'],
  quick: SPEED_WORDS['quick'] ?? [],
};
const KIND_WORDS: Words = {
  slide: ['slide', 'move', 'glide'],
  wipe: ['wipe'],
  reveal: ['reveal', 'uncover'],
  pop: ['pop', 'scale'],
  letters: ['letters', 'letter', 'type', 'typing'],
};
/** A tag's words (a tag these do not know yet is its own word). */
const wordsOf = (table: Words, tag: string): readonly string[] => table[tag] ?? [tag];

/** Every direction word: a template's own direction says where it comes from, not its move's name. */
const DIRECTION_SET = new Set(Object.values(DIRECTION_WORDS).flat());

/**
 * Each family's feel, for the feel words (the templates have theirs by design): calm for the gentle ones (fades,
 * drifts, blurs, soft wipes, a small grow), elegant for the reveals and rises, bold for the lively ones (pops,
 * bounces, zooms, flips, spins). A family not here has no feel of its own (slides, wipes: a speed makes them one).
 */
const FAMILY_FEELS: Readonly<Record<string, string>> = {
  fade: 'calm',
  drift: 'calm',
  softwipe: 'calm',
  blur: 'calm',
  grow: 'calm',
  reveal: 'elegant',
  open: 'elegant',
  iris: 'elegant',
  pop: 'bold',
  bounce: 'bold',
  spring: 'bold',
  swoosh: 'bold',
  zoom: 'bold',
  'zoom-far': 'bold',
  flip: 'bold',
  spin: 'bold',
  swing: 'bold',
};
/** Line by line, word by word and letter by letter: by their move. */
const UNIT_FEELS: Readonly<Record<string, string>> = {
  fade: 'calm',
  blur: 'calm',
  rise: 'elegant',
  reveal: 'elegant',
  gather: 'elegant',
  pop: 'bold',
  bounce: 'bold',
  zoom: 'bold',
  flip: 'bold',
};
const feelOf = (family: string): string | undefined =>
  FAMILY_FEELS[family] ?? UNIT_FEELS[/^(?:line|word|letter)-(.+)$/u.exec(family)?.[1] ?? ''];

/** Every word one of the list's animations is found by, going in or (with its name going out) out. */
function animationWords(item: (typeof OFFERED_LIST)[number], side: 'in' | 'out'): readonly string[] {
  const a = item.animation;
  const own = [
    ...searchWords(a.name),
    ...(side === 'out' ? searchWords(outName(a.id)) : []),
    ...a.keywords.flatMap((k) => searchWords(k)),
    ...searchWords(item.group),
  ];
  const feel = feelOf(familyOf(a));
  return [
    ...own,
    ...Object.entries(DIRECTION_WORDS).flatMap(([key, words]) => (own.includes(key) ? words : [])),
    ...wordsOf(SPEED_WORDS, a.speed),
    ...(feel ? wordsOf(FEEL_WORDS, feel) : []),
  ];
}

/** Every word asked for is the start of one of these (nothing asked for: yes). */
const hasEvery = (asked: readonly string[], words: readonly string[]): boolean =>
  asked.every((w) => words.some((has) => has.startsWith(w)));

const animationIndex: Record<'in' | 'out', (readonly string[])[] | null> = { in: null, out: null };

/** The list's animations a search finds, going in or out, in the list's own order (nothing asked for: all). */
export function findAnimations(query: string, side: 'in' | 'out'): typeof OFFERED_LIST {
  const asked = searchWords(query);
  if (asked.length === 0) return OFFERED_LIST;
  const index = (animationIndex[side] ??= OFFERED_LIST.map((item) => animationWords(item, side)));
  return OFFERED_LIST.filter((_, i) => hasEvery(asked, index[i] ?? []));
}

/** Every word a template is found by. */
function templateWords(t: LowerThirdTemplate): readonly string[] {
  const { style, motion, font } = t.input.look;
  return [
    ...searchWords(t.name),
    ...searchWords(animationById(t.input.animation).name).filter((w) => !DIRECTION_SET.has(w)),
    ...(style ? [style, ...searchWords(STYLE_NAMES[style])] : []),
    ...(motion && motion !== 'none' ? [motion, ...searchWords(MOTION_NAMES[motion])] : []),
    ...searchWords(font),
    ...wordsOf(DIRECTION_WORDS, t.direction),
    ...wordsOf(KIND_WORDS, t.kind),
    ...wordsOf(FEEL_WORDS, t.feel),
    ...wordsOf(SPEED_WORDS, t.speed),
  ];
}

const templateIndex = new WeakMap<LowerThirdTemplate, readonly string[]>();

/** The templates a search finds, in their own order (nothing asked for: all). */
export function findTemplates<T extends LowerThirdTemplate>(templates: readonly T[], query: string): T[] {
  const asked = searchWords(query);
  if (asked.length === 0) return [...templates];
  return templates.filter((t) => {
    let words = templateIndex.get(t);
    if (!words) {
      words = templateWords(t);
      templateIndex.set(t, words);
    }
    return hasEvery(asked, words);
  });
}

// ---- quick words --------------------------------------------------------------------------------------------

/** A word one press puts in a search box. Another of its group takes the place of the one there. */
export interface QuickWord {
  word: string;
  /** What its button says. */
  name: string;
  group: 'kind' | 'unit' | 'feel' | 'speed';
}

const quick = (group: QuickWord['group'], ...names: string[]): QuickWord[] =>
  names.map((name) => ({ word: name.toLowerCase(), name, group }));

/** Under the Animation tab's box: each only if it finds a way in. */
export const ANIMATION_QUICK_WORDS: readonly QuickWord[] = [
  ...quick('kind', 'Fade', 'Slide', 'Wipe', 'Reveal', 'Zoom'),
  ...quick('unit', 'Letters'),
  ...quick('speed', 'Quick', 'Slow'),
].filter((q) => findAnimations(q.word, 'in').length > 0);

/** Under the templates' box, where its four filters were: each only if it finds a template. */
export const TEMPLATE_QUICK_WORDS: readonly QuickWord[] = [
  ...quick('kind', 'Slide', 'Wipe', 'Reveal', 'Pop', 'Letters'),
  ...quick('feel', 'Calm', 'Elegant', 'Bold'),
  ...quick('speed', 'Quick', 'Slow'),
].filter((q) => findTemplates(LOWER_THIRD_TEMPLATES, q.word).length > 0);

const typed = (query: string): string[] => query.split(/\s+/u).filter((w) => w !== '');

/** Whether the box has this quick word (as a word of its own, in any case). */
export const hasQuickWord = (query: string, q: QuickWord): boolean =>
  typed(query).some((w) => w.toLowerCase() === q.word);

/**
 * The box's words with a quick word pressed: put in at the end (taking the place of another of its group, as
 * "Slow" does "Quick"), or, there already, taken out.
 */
export function toggleQuickWord(query: string, q: QuickWord, all: readonly QuickWord[]): string {
  const words = typed(query);
  if (hasQuickWord(query, q)) return words.filter((w) => w.toLowerCase() !== q.word).join(' ');
  const others = new Set(all.filter((o) => o.group === q.group && o.word !== q.word).map((o) => o.word));
  return [...words.filter((w) => !others.has(w.toLowerCase())), q.word].join(' ');
}
