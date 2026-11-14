import { z } from 'zod';
import { isLowerThirdAnimation } from '../../../shared/lower-third-animations';
import type { LowerThird, LowerThirdInput, LowerThirdLook } from '../../../shared/lower-thirds';

/*
 * Test fixture from v1.0.0-alpha.17 (9befbc8a): the schema and lookOf/lookColumn from
 * shared/lower-thirds.ts and main/db/lower-thirds.ts, with the tagged fonts, styles and motions.
 * Animation IDs are unchanged from that tag. Do not update these fields with the current schema.
 */

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

const LOWER_THIRD_MOTIONS = [
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

const DEFAULT_LOWER_THIRD_LOOK: LowerThirdLook = {
  text: '#ffffff',
  band: '#101828',
  bandOpacity: 0.85,
  font: 'Noto Sans',
  weight: 700,
  size: 5,
  align: 'left',
  bottom: 8,
};

const hex = z.string().regex(/^#[0-9a-f]{6}$/iu, 'a colour as #rrggbb');

const lowerThirdLookSchema = z
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
    motion: z.enum(LOWER_THIRD_MOTIONS).optional(),
  })
  .strict();

/** How long one that hides itself stays up: 5 to 60 whole seconds. */
const lowerThirdSecondsSchema = z.number().int().min(LOWER_THIRD_SECONDS.min).max(LOWER_THIRD_SECONDS.max);

/** The look column: the look itself, and the studio's out and seconds kept beside it. */
function lookOf(json: string): Pick<LowerThird, 'look' | 'outAnimation' | 'seconds'> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { look: DEFAULT_LOWER_THIRD_LOOK };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { look: DEFAULT_LOWER_THIRD_LOOK };
  const { outAnimation, seconds, ...rest } = raw as Record<string, unknown>;
  const look = lowerThirdLookSchema.safeParse(rest);
  const kept = lowerThirdSecondsSchema.safeParse(seconds);
  return {
    look: look.success ? look.data : DEFAULT_LOWER_THIRD_LOOK,
    ...(typeof outAnimation === 'string' && isLowerThirdAnimation(outAnimation) ? { outAnimation } : {}),
    ...(kept.success ? { seconds: kept.data } : {}),
  };
}

/** What the look column keeps: the look, with the studio's out and seconds when it has them. */
const lookColumn = (input: LowerThirdInput): string =>
  JSON.stringify({
    ...input.look,
    ...(input.outAnimation === undefined ? {} : { outAnimation: input.outAnimation }),
    ...(input.seconds === undefined ? {} : { seconds: input.seconds }),
  });

export { lookColumn as alpha17LookColumn, lookOf as alpha17LookOf };
