import { z } from 'zod';
import { isLowerThirdAnimation } from '../lower-third-animations';

// The strict lowerThirdSchema and its values from v1.0.0-alpha.17. The animation registry is unchanged.
const LOWER_THIRD_FONTS = [
  'Noto Sans',
  'Noto Sans Gujarati',
  'Noto Sans Devanagari',
  'Mukta',
  'Hind',
  'Baloo',
  'Noto Serif',
  'Montserrat',
  'Libre Baskerville',
  'Oswald',
  'Shrikhand',
  'Yatra One',
] as const;

const LOWER_THIRD_STYLES = [
  'box',
  'band',
  'pill',
  'ribbon',
  'outline',
  'glass',
  'split',
  'accent',
  'underline',
  'slant',
  'stacked',
  'words',
] as const;

export const ALPHA17_MOTIONS = [
  'none',
  'sweep',
  'shine',
  'shapes',
  'stripes',
  'glow',
  'line',
  'sparkles',
] as const;

const LOWER_THIRD_SIZE = { min: 2, max: 12 } as const;
/** How long one that hides itself stays up (seconds, whole). */
const LOWER_THIRD_SECONDS = { min: 5, max: 60 } as const;
const LOWER_THIRD_BOTTOM = { min: 0, max: 40 } as const;
/** The most lines, and the most letters in one. */
const LOWER_THIRD_LINES = 3;
const LOWER_THIRD_LINE_MAX = 120;

const idSchema = z.string().min(1).max(512);
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
    style: z.enum(LOWER_THIRD_STYLES).optional(),
    accent: hex.optional(),
    motion: z.enum(ALPHA17_MOTIONS).optional(),
  })
  .strict();

/** How long one that hides itself stays up: 5 to 60 whole seconds. */
export const lowerThirdSecondsSchema = z
  .number()
  .int()
  .min(LOWER_THIRD_SECONDS.min)
  .max(LOWER_THIRD_SECONDS.max);

const fields = {
  lines: z.array(z.string().max(LOWER_THIRD_LINE_MAX)).min(1).max(LOWER_THIRD_LINES),
  look: lowerThirdLookSchema,
  where: z.enum(['hall', 'stream', 'both']),
  animation: z.string().refine(isLowerThirdAnimation, 'an animation from the library'),
  outAnimation: z.string().refine(isLowerThirdAnimation, 'an animation from the library').optional(),
  seconds: lowerThirdSecondsSchema.optional(),
};
const hasWords = (v: { lines: readonly string[] }) => v.lines.some((l) => l.trim() !== '');
const NO_WORDS = 'a lower third needs words on one line at least';

/** One as the engine is asked to show it (engine/commands.ts). */
export const alpha17LowerThirdSchema = z
  .object({ id: idSchema, ...fields })
  .strict()
  .refine(hasWords, NO_WORDS);
