import type { LowerThirdLook } from './lower-thirds';

/*
 * What every moving background of the Lower Thirds studio is made of (Session 58, alpha.18): one shape for each
 * (MotionDef), so the studio's first seven and alpha.18's new ones (lower-third-styles.ts, and C12's
 * lower-third-motions-more.ts) join one registry (lower-third-styles.ts, MOTIONS), and the small helpers they draw
 * with. It imports nothing but types, so the files that define backgrounds and the registry that joins them never
 * import each other in a circle.
 *
 * Cheap to draw on a computer without a graphics chip, every one of them: at most 12 pieces, each drawn once (a fill,
 * a gradient or two, a rounded or clipped shape, never a filter, a blur, a shadow or a backdrop), then moved only by
 * transform and opacity, a pure function of the time since the lower third went up, so every screen, key and fill and
 * the stream draw the same frame (render/LowerThirdView.tsx draws them; the Performance run's lower-thirds scenario
 * measures each, lower-third-studio.ts OFFERED).
 */

/** CSS as plain data (React's style object takes it as it is). */
export type Css = Record<string, string | number>;

/** The second colour a style or background uses when a lower third has none (one made before the studio). */
export const DEFAULT_ACCENT = '#f59e0b';

/** A colour with how solid it is, "#rrggbbaa". */
export const hexAlpha = (hex: string, alpha: number): string =>
  `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** A lower third's second colour (the default one for one made before the studio). */
export const accentOf = (look: LowerThirdLook): string => look.accent ?? DEFAULT_ACCENT;

/** One piece of a background at a moment. */
export interface PiecePose {
  transform: string;
  opacity: number;
}

/** One moving background. */
export interface MotionDef {
  /** Its name in the studio's list, in plain words ("Colours sweeping"). */
  name: string;
  /** How long it takes to come round to where it began (ms), more than 500. */
  periodMs: number;
  /** Calm (slow light, soft colours, gentle shapes: for a hall) or lively: the studio lists the calm ones first. */
  feel: 'calm' | 'lively';
  /** The colour itself (as the sweep): the shape it moves in has no colour of its own under it. */
  fill?: true;
  /** Its pieces (1 to 12), as each is drawn whatever the time: where it is, its size and its colour. */
  pieces: (look: LowerThirdLook) => Css[];
  /**
   * Each of its `count` pieces `turn` of the way round (0 up to 1): where it is (transform: translate, scale,
   * rotate or skewX) and how strongly it shows (opacity, 0 to 1). The same at 1 as at 0, so it never jumps.
   */
  at: (turn: number, count: number) => PiecePose[];
}

/** A number for CSS: rounded, and no "-0". */
export const cssNumber = (x: number, places = 3): string => {
  const r = Math.round(x * 10 ** places) / 10 ** places;
  return Object.is(r, -0) ? '0' : String(r);
};

/** A move by `x` and `y` (percent of the piece, or em); '' for none. */
export const translate = (x: number, y: number, unit: '%' | 'em'): string =>
  Math.abs(x) < 0.0005 && Math.abs(y) < 0.0005
    ? ''
    : `translate(${cssNumber(x)}${unit}, ${cssNumber(y)}${unit})`;

/** Several parts of a transform, the empty ones left out ("translate(…) scale(…)"). */
export const transformOf = (...parts: string[]): string => parts.filter((p) => p !== '').join(' ');

/** A scale (never below 0); '' for 1. */
export const scaleBy = (s: number): string => {
  const v = cssNumber(Math.max(0, s));
  return v === '1' ? '' : `scale(${v})`;
};

/** A turn by `deg` degrees; '' for none. */
export const rotateBy = (deg: number): string => {
  const v = cssNumber(deg);
  return v === '0' ? '' : `rotate(${v}deg)`;
};

/** Smoothly from 0 to 1 and back over one turn (0 at 0 and at 1, 1 halfway). */
export const swell = (turn: number): number => 0.5 - 0.5 * Math.cos(2 * Math.PI * turn);
