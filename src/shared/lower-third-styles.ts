import {
  accentOf,
  type Css,
  DEFAULT_ACCENT,
  hexAlpha,
  type MotionDef,
  type PiecePose,
  transformOf,
  translate,
} from './lower-third-motion-kit';
import type { LowerThirdLook } from './lower-thirds';

export { DEFAULT_ACCENT, hexAlpha };
export type { Css, MotionDef, PiecePose };

/*
 * How a lower third looks in the Lower Thirds studio (Session 55, Part 16): the style its words sit in (a box, as
 * before; a band across the picture, a pill, a ribbon, an outline, glass, two colours, an accent bar, an underline,
 * a slant, lines on their own, or words alone) and a moving background behind them (colours sweeping, light passing
 * over, shapes drifting, stripes, a glow, a line running, sparkles). Pure data: the CSS each draws, and each
 * background's pieces at a moment, a pure function of the time since the lower third went up, so every screen, key
 * and fill and the stream draw the same frame (render/LowerThirdView.tsx draws them).
 *
 * Cheap to draw on a computer without a graphics chip: plain fills, a gradient or two, crisp borders and a static
 * clip-path, never a backdrop filter or a blurred shadow; the backgrounds move a few pieces by transform and opacity
 * only. Each is measured by the Performance run's lower-thirds scenario all the same (lower-third-studio.ts, OFFERED).
 */

export const LOWER_THIRD_STYLES = [
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
export type LowerThirdStyle = (typeof LOWER_THIRD_STYLES)[number];

export const STYLE_NAMES: Record<LowerThirdStyle, string> = {
  box: 'Box',
  band: 'Band across',
  pill: 'Pill',
  ribbon: 'Ribbon',
  outline: 'Outline',
  glass: 'Glass',
  split: 'Two colours',
  accent: 'Accent bar',
  underline: 'Underline',
  slant: 'Slanted',
  stacked: 'Lines on their own',
  words: 'Words only',
};

export interface StyleDrawing {
  style: LowerThirdStyle;
  /** The band's own CSS: its padding (an edge-to-edge band's sides are the picture's, render/LowerThirdView.tsx). */
  band: Css;
  /** Where the colour goes: behind the whole band (its shape), behind each line on its own, or nowhere. */
  fill: 'band' | 'lines' | 'none';
  /** The shape behind the whole band: its colour, corners, border and cut. */
  shape: Css;
  /** Each line's own CSS: its block of colour (fill 'lines'), or the first line's underline. */
  line: (i: number) => Css;
  /** A bar of the second colour at the band's side, or null. */
  accent: Css | null;
  /** The words' shadow ('' for none). */
  textShadow: string;
  /** Edge to edge across the picture. */
  fullWidth: boolean;
}

/** The shape of a box's corners: just rounded. */
const corner = (size: number) => size * 0.12;

/** A line's block hugging its words, on the side the lower third keeps to. */
function hugging(align: LowerThirdLook['align']): Css {
  return {
    width: 'fit-content',
    maxWidth: '100%',
    marginLeft: align === 'left' ? 0 : 'auto',
    marginRight: align === 'right' ? 0 : 'auto',
  };
}

/** How a lower third's style draws, its first line `size` pixels high. One made before the studio is a box. */
export function styleDrawing(look: LowerThirdLook, size: number): StyleDrawing {
  const style = look.style ?? 'box';
  const accent = look.accent ?? DEFAULT_ACCENT;
  const fill = hexAlpha(look.band, look.bandOpacity);
  const pad = `${String(size * 0.3)}px ${String(size * 0.6)}px`;
  const base: StyleDrawing = {
    style,
    band: { padding: pad },
    fill: 'band',
    shape: { background: fill, borderRadius: corner(size) },
    line: () => ({}),
    accent: null,
    textShadow: '',
    fullWidth: false,
  };
  switch (style) {
    case 'box':
      return base;
    case 'band':
      return { ...base, shape: { background: fill, borderRadius: 0 }, fullWidth: true };
    case 'pill':
      return {
        ...base,
        band: { padding: `${String(size * 0.3)}px ${String(size * 0.9)}px` },
        shape: { background: fill, borderRadius: 9999 },
      };
    case 'ribbon':
      // Its ends cut in like a ribbon's (a swallowtail), as deep as a little under half its words' height.
      return {
        ...base,
        band: { padding: `${String(size * 0.3)}px ${String(size * 1.1)}px` },
        shape: {
          background: fill,
          fontSize: size,
          clipPath: 'polygon(0 0, 100% 0, calc(100% - 0.45em) 50%, 100% 100%, 0 100%, 0.45em 50%)',
        },
      };
    case 'outline':
      return {
        ...base,
        shape: {
          background: fill,
          border: `${String(Math.max(2, Math.round(size * 0.07)))}px solid ${accent}`,
          borderRadius: corner(size),
        },
      };
    case 'glass':
      // A pane of glass without blurring what is behind it: a little light from above, a crisp edge of light.
      return {
        ...base,
        shape: {
          background: `linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.06)), ${hexAlpha(look.band, look.bandOpacity * 0.6)}`,
          border: '1px solid rgba(255, 255, 255, 0.4)',
          borderRadius: size * 0.28,
        },
      };
    case 'split':
      // The first line (a name) on the band's colour, the others (a title, a place) on the second colour.
      return {
        ...base,
        band: { padding: 0 },
        fill: 'lines',
        shape: {},
        line: (i) => ({
          ...hugging(look.align),
          background: i === 0 ? fill : hexAlpha(accent, look.bandOpacity),
          padding: `${String(size * 0.16)}px ${String(size * 0.6)}px`,
          borderRadius: corner(size) * 0.6,
        }),
      };
    case 'accent': {
      const bar = size * 0.16;
      const right = look.align === 'right';
      const r = corner(size);
      return {
        ...base,
        band: {
          padding: right
            ? `${String(size * 0.3)}px ${String(size * 0.6 + bar)}px ${String(size * 0.3)}px ${String(size * 0.6)}px`
            : `${String(size * 0.3)}px ${String(size * 0.6)}px ${String(size * 0.3)}px ${String(size * 0.6 + bar)}px`,
        },
        accent: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          [right ? 'right' : 'left']: 0,
          width: bar,
          background: accent,
          borderRadius: right ? `0 ${String(r)}px ${String(r)}px 0` : `${String(r)}px 0 0 ${String(r)}px`,
        },
      };
    }
    case 'underline':
      return {
        ...base,
        line: (i) =>
          i === 0
            ? {
                ...hugging(look.align),
                borderBottom: `${String(Math.max(2, Math.round(size * 0.06)))}px solid ${accent}`,
                paddingBottom: size * 0.06,
                marginBottom: size * 0.08,
              }
            : {},
      };
    case 'slant':
      return {
        ...base,
        band: { padding: `${String(size * 0.3)}px ${String(size * 1.0)}px` },
        shape: {
          background: fill,
          fontSize: size,
          clipPath: 'polygon(0.5em 0, 100% 0, calc(100% - 0.5em) 100%, 0 100%)',
        },
      };
    case 'stacked':
      return {
        ...base,
        band: { padding: 0 },
        fill: 'lines',
        shape: {},
        line: (i) => ({
          ...hugging(look.align),
          background: fill,
          padding: `${String(size * 0.16)}px ${String(size * 0.6)}px`,
          borderRadius: corner(size) * 0.6,
          marginTop: i === 0 ? 0 : size * 0.12,
        }),
      };
    case 'words':
      return {
        ...base,
        fill: 'none',
        shape: {},
        textShadow: `0 ${String(size * 0.04)}px ${String(size * 0.16)}px rgba(0, 0, 0, 0.85)`,
      };
  }
}

// ---- moving backgrounds --------------------------------------------------------------------------------------

const at = { position: 'absolute' } as const;
/** Each of `count` pieces' pose. */
const each = (count: number, pose: (i: number) => PiecePose): PiecePose[] =>
  Array.from({ length: count }, (_, i) => pose(i));

const SHAPES: readonly { left: number; top: number; height: number; light: boolean; turns: number }[] = [
  { left: 4, top: -40, height: 150, light: false, turns: 1 },
  { left: 24, top: 35, height: 90, light: true, turns: 2 },
  { left: 47, top: -15, height: 60, light: false, turns: 1 },
  { left: 68, top: 25, height: 120, light: true, turns: 1 },
  { left: 86, top: -25, height: 80, light: false, turns: 2 },
];

const SPARKS: readonly { left: number; speed: number }[] = [
  { left: 6, speed: 1 },
  { left: 17, speed: 2 },
  { left: 29, speed: 1 },
  { left: 41, speed: 2 },
  { left: 55, speed: 1 },
  { left: 66, speed: 2 },
  { left: 79, speed: 1 },
  { left: 91, speed: 2 },
];

/** The studio's first seven (Session 55, Part 16), drawn as they always were. */
const FIRST_SEVEN = {
  sweep: {
    name: 'Colours sweeping',
    periodMs: 6000,
    feel: 'calm',
    fill: true,
    pieces: (look) => {
      const a = hexAlpha(look.band, look.bandOpacity);
      const b = hexAlpha(accentOf(look), look.bandOpacity);
      return [
        {
          ...at,
          top: 0,
          bottom: 0,
          left: 0,
          width: '200%',
          background: `linear-gradient(90deg, ${a} 0%, ${b} 25%, ${a} 50%, ${b} 75%, ${a} 100%)`,
        },
      ];
    },
    at: (turn, count) => each(count, () => ({ transform: translate(-50 * turn, 0, '%'), opacity: 1 })),
  },
  shine: {
    name: 'Light passing over',
    periodMs: 4000,
    feel: 'calm',
    pieces: () => [
      {
        ...at,
        top: '-30%',
        bottom: '-30%',
        left: 0,
        width: '30%',
        background:
          'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.34) 50%, rgba(255, 255, 255, 0) 100%)',
      },
    ],
    // Across in the first third of each period, then out of sight until the next.
    at: (turn, count) => {
      const across = turn / 0.35;
      const to = (x: number) => transformOf(translate(x, 0, '%'), 'skewX(-20deg)');
      return each(count, () =>
        across >= 1
          ? { transform: to(-130), opacity: 0 }
          : { transform: to(-130 + 495 * across), opacity: 1 },
      );
    },
  },
  shapes: {
    name: 'Shapes drifting',
    periodMs: 12_000,
    feel: 'calm',
    pieces: (look) =>
      SHAPES.map((s) => ({
        ...at,
        left: `${String(s.left)}%`,
        top: `${String(s.top)}%`,
        height: `${String(s.height)}%`,
        aspectRatio: '1',
        borderRadius: '50%',
        background: s.light ? 'rgba(255, 255, 255, 0.16)' : hexAlpha(accentOf(look), 0.3),
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const s = SHAPES[i % SHAPES.length] ?? { turns: 1 };
        const a = 2 * Math.PI * (turn * s.turns + i / SHAPES.length);
        return { transform: translate(40 * Math.cos(a), 25 * Math.sin(a), '%'), opacity: 1 };
      }),
  },
  stripes: {
    name: 'Stripes moving',
    periodMs: 1600,
    feel: 'lively',
    pieces: (look) => [
      {
        ...at,
        top: 0,
        bottom: 0,
        left: 0,
        width: 'calc(100% + 1em)',
        background: `repeating-linear-gradient(-45deg, ${hexAlpha(accentOf(look), 0.28)} 0 0.35em, ${hexAlpha(accentOf(look), 0)} 0.35em 0.7em)`,
      },
    ],
    // One stripe's width along the band each period: it never jumps (0.7em across a 45° stripe).
    at: (turn, count) => each(count, () => ({ transform: translate(-0.99 * turn, 0, 'em'), opacity: 1 })),
  },
  glow: {
    name: 'Glowing',
    periodMs: 3000,
    feel: 'calm',
    pieces: (look) => [
      {
        ...at,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: `radial-gradient(ellipse at 50% 120%, ${hexAlpha(accentOf(look), 0.75)} 0%, ${hexAlpha(accentOf(look), 0)} 70%)`,
      },
    ],
    at: (turn, count) =>
      each(count, () => ({
        transform: '',
        opacity: 0.35 + 0.45 * (0.5 - 0.5 * Math.cos(2 * Math.PI * turn)),
      })),
  },
  line: {
    name: 'A line running',
    periodMs: 2400,
    feel: 'lively',
    pieces: (look) => [
      {
        ...at,
        left: 0,
        bottom: 0,
        height: '0.07em',
        width: '35%',
        background: `linear-gradient(90deg, ${hexAlpha(accentOf(look), 0)}, ${accentOf(look)}, ${hexAlpha(accentOf(look), 0)})`,
      },
    ],
    at: (turn, count) =>
      each(count, () => ({ transform: translate(-100 + 385.7 * turn, 0, '%'), opacity: 1 })),
  },
  sparkles: {
    name: 'Sparkles rising',
    periodMs: 4000,
    feel: 'lively',
    pieces: () =>
      SPARKS.map((s) => ({
        ...at,
        left: `${String(s.left)}%`,
        bottom: 0,
        width: '0.12em',
        height: '0.12em',
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.9)',
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const s = SPARKS[i % SPARKS.length] ?? { speed: 1 };
        const q = (turn * s.speed + i / SPARKS.length) % 1;
        return { transform: translate(0, -1800 * q, '%'), opacity: Math.sin(Math.PI * q) };
      }),
  },
} satisfies Record<string, MotionDef>;

/**
 * THE REGISTRY (Session 58): every moving background but None, by its key (the key a lower third keeps, so never
 * renamed). The studio offers those in OFFERED (lower-third-studio.ts), in OFFERED's order.
 *
 * C12's eleven (lower-third-motions-more.ts, `MORE_MOTIONS`) join at the one marked line below, with their import
 * at the top of this file; nothing else here changes for them.
 */
const MOTIONS = {
  ...FIRST_SEVEN,
  // C12 JOINS HERE: ...MORE_MOTIONS,
} satisfies Record<string, MotionDef>;

/** A moving background's key; 'none' for none. */
export type LowerThirdMotion = 'none' | keyof typeof MOTIONS;

/** Every moving background a lower third may have (None first). */
export const LOWER_THIRD_MOTIONS = ['none', ...(Object.keys(MOTIONS) as (keyof typeof MOTIONS)[])] as const;

const definition = (motion: LowerThirdMotion): MotionDef | null =>
  motion === 'none' ? null : ((MOTIONS[motion] as MotionDef | undefined) ?? null);

/** Each background's name in the studio's list. */
export const MOTION_NAMES = Object.fromEntries(
  LOWER_THIRD_MOTIONS.map((m) => [m, definition(m)?.name ?? 'None']),
) as Record<LowerThirdMotion, string>;

/** How long each background takes to come round to where it began (ms). */
export const MOTION_PERIOD_MS = Object.fromEntries(
  LOWER_THIRD_MOTIONS.map((m) => [m, definition(m)?.periodMs ?? 1000]),
) as Record<LowerThirdMotion, number>;

/** Whether a background is the colour itself (the sweep): its shape has no colour of its own under it. */
export const motionIsFill = (motion: LowerThirdMotion): boolean => definition(motion)?.fill === true;

/** A background's pieces, as each is drawn whatever the time (where it is, its size and its colour). */
export function motionPieces(motion: LowerThirdMotion, look: LowerThirdLook): Css[] {
  return definition(motion)?.pieces(look) ?? [];
}

/**
 * A background's `count` pieces `t` ms after the lower third went up: where each is and how strongly it shows. Round
 * and round: the same again a period later.
 */
export function motionAt(motion: LowerThirdMotion, t: number, count: number): PiecePose[] {
  const d = definition(motion);
  if (!d) return [];
  const period = d.periodMs;
  const turn = Math.round((((t % period) + period) % period) * 1e6) / 1e6 / period;
  return d.at(turn, count);
}
