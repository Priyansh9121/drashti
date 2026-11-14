import { isLowerThirdAnimation } from '../../../shared/lower-third-animations';
import type { LowerThird, LowerThirdInput, LowerThirdLook } from '../../../shared/lower-thirds';
import { lowerThirdLookSchema, lowerThirdSecondsSchema } from '../../../shared/testing/alpha17-lower-third';

/*
 * Test fixture from v1.0.0-alpha.17 (9befbc8a): lookOf/lookColumn from main/db/lower-thirds.ts.
 * The shared fixture supplies the schemas and enumerations from the same tag.
 */

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
