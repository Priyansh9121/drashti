import { z } from 'zod';
import { DEFAULT_ANIMATION, isAnimation } from './lower-third-animations';
import { idSchema } from './model-schema';

/*
 * Lower Thirds (Session 44; Priyansh: lower thirds in Macros' place): up to three lines across the bottom of
 * the picture (a name, a title and a place, say), on the hall's screens, the stream or both, in a look of its
 * own, coming in and going out with an animation from the library (lower-third-animations.ts). One button
 * shows it and hides it; Clear all takes it off as it takes off the slide, Put it back brings it back, and
 * Black-out covers it. Kept in the library (migration 45); one on the screens is in the engine's state as it
 * was shown (engine/state.ts), so every screen, node and phone draws it without the library.
 */

/** Where it shows: the hall's screens, the stream (and a key and fill pair, which feeds a video switcher), or both. */
export type LowerThirdWhere = 'hall' | 'stream' | 'both';
export const LOWER_THIRD_WHERE: readonly LowerThirdWhere[] = ['hall', 'stream', 'both'];
export const WHERE_NAMES: Record<LowerThirdWhere, string> = {
  hall: 'The hall’s screens',
  stream: 'The stream',
  both: 'Both',
};

export type LowerThirdAlign = 'left' | 'centre' | 'right';
export const LOWER_THIRD_ALIGNS: readonly LowerThirdAlign[] = ['left', 'centre', 'right'];

/** Drashti's own fonts (render/fonts.ts): the words take the others too, for the letters this one lacks. */
export const LOWER_THIRD_FONTS = ['Noto Sans', 'Noto Sans Gujarati', 'Noto Sans Devanagari'] as const;
export type LowerThirdFont = (typeof LOWER_THIRD_FONTS)[number];
export const LOWER_THIRD_WEIGHTS = [400, 500, 700] as const;
export type LowerThirdWeight = (typeof LOWER_THIRD_WEIGHTS)[number];

/** How it looks. */
export interface LowerThirdLook {
  /** The words' colour, "#rrggbb". */
  text: string;
  /** The band behind the words, "#rrggbb", and how solid it is (0, none, to 1). */
  band: string;
  bandOpacity: number;
  font: LowerThirdFont;
  weight: LowerThirdWeight;
  /** The first line's size, as a share of the picture's height (percent); the others are 70% of it. */
  size: number;
  align: LowerThirdAlign;
  /** From the bottom of the picture to the band, as a share of its height (percent). */
  bottom: number;
}

export const LOWER_THIRD_SIZE = { min: 2, max: 12 } as const;
export const LOWER_THIRD_BOTTOM = { min: 0, max: 40 } as const;
/** The most lines, and the most letters in one. */
export const LOWER_THIRD_LINES = 3;
export const LOWER_THIRD_LINE_MAX = 120;

export const DEFAULT_LOWER_THIRD_LOOK: LowerThirdLook = {
  text: '#ffffff',
  band: '#101828',
  bandOpacity: 0.85,
  font: 'Noto Sans',
  weight: 700,
  size: 5,
  align: 'left',
  bottom: 8,
};

/** A lower third as the library keeps it. */
export interface LowerThird {
  id: string;
  /** One to three lines; at least one has words. */
  lines: string[];
  look: LowerThirdLook;
  where: LowerThirdWhere;
  /** Its animation, in and out (an id in lower-third-animations.ts). */
  animation: string;
}

export type LowerThirdInput = Omit<LowerThird, 'id'>;

export const NEW_LOWER_THIRD: LowerThirdInput = {
  lines: ['', '', ''],
  look: DEFAULT_LOWER_THIRD_LOOK,
  where: 'both',
  animation: DEFAULT_ANIMATION,
};

const hex = z.string().regex(/^#[0-9a-f]{6}$/iu, 'a colour as #rrggbb');

export const lowerThirdLookSchema = z
  .object({
    text: hex,
    band: hex,
    bandOpacity: z.number().min(0).max(1),
    font: z.enum(LOWER_THIRD_FONTS),
    weight: z.union([z.literal(400), z.literal(500), z.literal(700)]),
    size: z.number().min(LOWER_THIRD_SIZE.min).max(LOWER_THIRD_SIZE.max),
    align: z.enum(['left', 'centre', 'right']),
    bottom: z.number().min(LOWER_THIRD_BOTTOM.min).max(LOWER_THIRD_BOTTOM.max),
  })
  .strict();

const fields = {
  lines: z.array(z.string().max(LOWER_THIRD_LINE_MAX)).min(1).max(LOWER_THIRD_LINES),
  look: lowerThirdLookSchema,
  where: z.enum(['hall', 'stream', 'both']),
  animation: z.string().refine(isAnimation, 'an animation from the library'),
};
const hasWords = (v: { lines: readonly string[] }) => v.lines.some((l) => l.trim() !== '');
const NO_WORDS = 'a lower third needs words on one line at least';

export const lowerThirdInputSchema = z.object(fields).strict().refine(hasWords, NO_WORDS);
/** One as the engine is asked to show it (engine/commands.ts). */
export const lowerThirdSchema = z
  .object({ id: idSchema, ...fields })
  .strict()
  .refine(hasWords, NO_WORDS);

export type LowerThirdResult = { ok: true; id: string } | { ok: false; message: string };
export type LowerThirdsResult = { ok: true; ids: string[] } | { ok: false; message: string };

/** Its lines with words, trimmed (blank lines take no room). */
export const shownLines = (lines: readonly string[]): string[] =>
  lines.map((l) => l.trim()).filter((l) => l !== '');

/** What a lower third is called in a list: its first line with words. */
export const lowerThirdName = (lines: readonly string[]): string => shownLines(lines)[0] ?? 'Lower third';

/** Whether a lower third shows on a picture of this kind. */
export const showsOn = (where: LowerThirdWhere, place: 'hall' | 'stream'): boolean =>
  where === 'both' || where === place;
