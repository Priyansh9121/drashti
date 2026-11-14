import {
  accentOf,
  type Css,
  cssNumber,
  DEFAULT_ACCENT,
  hexAlpha,
  type MotionDef,
  type PiecePose,
  rotateBy,
  scaleBy,
  swell,
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
 * over, shapes drifting, stripes, a glow, a line running, sparkles; and since alpha.18 light rising, lamps, mist,
 * rays, petals, ripples, stars, colours changing, confetti, streaks, waves and lights chasing, and more from
 * lower-third-motions-more.ts). Pure data: the CSS each draws, and each
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

/** Where a piece is `turn` of the way round its own loop, started `phase` of the way in and going `speed` times. */
const loop = (turn: number, speed = 1, phase = 0): number => (((turn * speed + phase) % 1) + 1) % 1;
/**
 * Seen fully in the middle of a loop, faded in over its first `fadeIn` and out over its last `fadeOut`, and hidden
 * for the loop's first and last 2% (so a piece that starts again elsewhere never leaps while it shows).
 */
const fadeEnds = (q: number, fadeIn: number, fadeOut: number): number =>
  Math.max(0, Math.min(1, (q - 0.02) / fadeIn, (0.98 - q) / fadeOut));

const LAMPS: readonly { left: number; phase: number }[] = [
  { left: 10, phase: 0 },
  { left: 30, phase: 0.43 },
  { left: 50, phase: 0.17 },
  { left: 70, phase: 0.61 },
  { left: 90, phase: 0.29 },
];

const MIST: readonly { top: number; height: number; width: number; phase: number }[] = [
  { top: -25, height: 100, width: 55, phase: 0 },
  { top: 35, height: 90, width: 65, phase: 0.36 },
  { top: -5, height: 120, width: 45, phase: 0.7 },
];

const RAYS: readonly { left: number; angle: number; phase: number }[] = [
  { left: 14, angle: 26, phase: 0 },
  { left: 42, angle: 17, phase: 0.33 },
  { left: 70, angle: 9, phase: 0.66 },
];

const PETALS: readonly { left: number; phase: number; light: boolean }[] = [
  { left: 7, phase: 0, light: false },
  { left: 23, phase: 0.52, light: true },
  { left: 38, phase: 0.18, light: false },
  { left: 55, phase: 0.71, light: true },
  { left: 71, phase: 0.36, light: false },
  { left: 88, phase: 0.86, light: true },
];

const STARS: readonly { left: number; top: number; size: number; speed: number; phase: number }[] = [
  { left: 5, top: 22, size: 0.14, speed: 1, phase: 0 },
  { left: 14, top: 70, size: 0.11, speed: 2, phase: 0.4 },
  { left: 24, top: 35, size: 0.17, speed: 1, phase: 0.7 },
  { left: 33, top: 80, size: 0.11, speed: 1, phase: 0.2 },
  { left: 45, top: 18, size: 0.14, speed: 2, phase: 0.55 },
  { left: 56, top: 62, size: 0.11, speed: 1, phase: 0.85 },
  { left: 64, top: 28, size: 0.17, speed: 2, phase: 0.1 },
  { left: 75, top: 75, size: 0.14, speed: 1, phase: 0.45 },
  { left: 85, top: 40, size: 0.11, speed: 2, phase: 0.75 },
  { left: 94, top: 15, size: 0.14, speed: 1, phase: 0.3 },
];

const CONFETTI: readonly { left: number; speed: number; phase: number; colour: number; spin: number }[] = [
  { left: 4, speed: 1, phase: 0, colour: 0, spin: 2 },
  { left: 13, speed: 2, phase: 0.3, colour: 1, spin: 1 },
  { left: 22, speed: 1, phase: 0.65, colour: 2, spin: 3 },
  { left: 31, speed: 2, phase: 0.15, colour: 0, spin: 1 },
  { left: 41, speed: 1, phase: 0.45, colour: 1, spin: 2 },
  { left: 50, speed: 2, phase: 0.8, colour: 2, spin: 1 },
  { left: 60, speed: 1, phase: 0.25, colour: 0, spin: 3 },
  { left: 69, speed: 2, phase: 0.55, colour: 1, spin: 2 },
  { left: 79, speed: 1, phase: 0.9, colour: 2, spin: 1 },
  { left: 90, speed: 2, phase: 0.4, colour: 0, spin: 2 },
];

const STREAKS: readonly { top: number; speed: number; phase: number }[] = [
  { top: 16, speed: 1, phase: 0 },
  { top: 34, speed: 2, phase: 0.4 },
  { top: 55, speed: 1, phase: 0.7 },
  { top: 72, speed: 2, phase: 0.15 },
  { top: 88, speed: 1, phase: 0.55 },
];

/** How many lights chase along the bottom. */
const CHASERS = 12;

/**
 * Twelve more (Session 58, alpha.18): calm ones first, for a mandir hall (slow light, soft colours, gentle shapes),
 * then a few livelier. Each is the studio's own design, drawn from the lower third's two colours and white.
 */
const TWELVE = {
  dawn: {
    name: 'Light rising',
    periodMs: 9000,
    feel: 'calm',
    // A soft band of the second colour rises slowly through the band, from below it to above it, fading in and out.
    pieces: (look) => [
      {
        ...at,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: `linear-gradient(0deg, ${hexAlpha(accentOf(look), 0)} 0%, ${hexAlpha(accentOf(look), 0.4)} 50%, ${hexAlpha(accentOf(look), 0)} 100%)`,
      },
    ],
    at: (turn, count) =>
      each(count, () => ({
        transform: translate(0, 100 - 200 * turn, '%'),
        opacity: Math.sin(Math.PI * turn),
      })),
  },
  lamps: {
    name: 'Lamps glowing',
    periodMs: 6000,
    feel: 'calm',
    // Five soft lights rising from the band's lower edge, each glowing brighter and softer in its own time.
    pieces: (look) =>
      LAMPS.map((l) => ({
        ...at,
        left: `${String(l.left)}%`,
        bottom: '-0.3em',
        width: '1.4em',
        height: '1.4em',
        marginLeft: '-0.7em',
        borderRadius: '50%',
        background: `radial-gradient(circle, ${hexAlpha(accentOf(look), 0.6)} 0%, ${hexAlpha(accentOf(look), 0.22)} 35%, ${hexAlpha(accentOf(look), 0)} 70%)`,
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const s = swell(turn + (LAMPS[i % LAMPS.length]?.phase ?? 0));
        return { transform: scaleBy(0.85 + 0.25 * s), opacity: 0.35 + 0.6 * s };
      }),
  },
  mist: {
    name: 'Mist drifting',
    periodMs: 20_000,
    feel: 'calm',
    // Three soft clouds of light drift slowly from right to left, each across the band and on round again.
    pieces: () =>
      MIST.map((m) => ({
        ...at,
        left: 0,
        top: `${String(m.top)}%`,
        height: `${String(m.height)}%`,
        width: `${String(m.width)}%`,
        background: 'radial-gradient(closest-side, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0))',
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const m = MIST[i % MIST.length] ?? { width: 50, phase: 0 };
        const q = loop(turn, 1, m.phase);
        // From just past the band's right edge to just past its left (percent of its own width).
        const from = (100 * 100) / m.width;
        return { transform: translate(from - (from + 100) * q, 0, '%'), opacity: fadeEnds(q, 0.1, 0.1) };
      }),
  },
  rays: {
    name: 'Rays of light',
    periodMs: 12_000,
    feel: 'calm',
    // Three soft beams from above, each leaning a little this way and that and brightening in its own time.
    pieces: () =>
      RAYS.map((r) => ({
        ...at,
        left: `${String(r.left)}%`,
        top: '-40%',
        width: '16%',
        height: '260%',
        transformOrigin: '50% 0',
        background:
          'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.14) 50%, rgba(255, 255, 255, 0) 100%)',
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const r = RAYS[i % RAYS.length] ?? { angle: 15, phase: 0 };
        const lean = r.angle + 7 * Math.sin(2 * Math.PI * (turn + r.phase));
        return { transform: rotateBy(-lean), opacity: 0.5 + 0.5 * swell(turn + r.phase) };
      }),
  },
  petals: {
    name: 'Petals falling',
    periodMs: 10_000,
    feel: 'calm',
    // Six petals in the second colour and white float down, swaying and turning slowly.
    pieces: (look) =>
      PETALS.map((p) => ({
        ...at,
        left: `${String(p.left)}%`,
        top: '-0.3em',
        width: '0.3em',
        height: '0.17em',
        borderRadius: '0.17em 0',
        background: p.light ? 'rgba(255, 255, 255, 0.8)' : hexAlpha(accentOf(look), 0.85),
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const p = PETALS[i % PETALS.length] ?? { phase: 0 };
        const q = loop(turn, 1, p.phase);
        const sway = 0.3 * Math.sin(2 * Math.PI * (2 * q + p.phase));
        return {
          transform: transformOf(translate(sway, 3.6 * q, 'em'), rotateBy(360 * loop(q, 1, p.phase))),
          opacity: fadeEnds(q, 0.12, 0.18),
        };
      }),
  },
  ripples: {
    name: 'Ripples spreading',
    periodMs: 8000,
    feel: 'calm',
    // Three thin rings in the second colour spread from the middle of the band, one after another, fading as they go.
    pieces: (look) =>
      [0, 1, 2].map(() => ({
        ...at,
        left: '50%',
        top: '50%',
        width: '3em',
        height: '3em',
        marginLeft: '-1.5em',
        marginTop: '-1.5em',
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: `0.06em solid ${hexAlpha(accentOf(look), 0.55)}`,
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const q = loop(turn, 1, i / 3);
        return { transform: scaleBy(0.15 + 2.25 * q), opacity: (1 - q) * Math.min(1, q * 6) };
      }),
  },
  stars: {
    name: 'Stars twinkling',
    periodMs: 6000,
    feel: 'calm',
    // Ten small stars, still, each brightening and dimming in its own time.
    pieces: () =>
      STARS.map((s) => ({
        ...at,
        left: `${String(s.left)}%`,
        top: `${String(s.top)}%`,
        width: `${String(s.size)}em`,
        height: `${String(s.size)}em`,
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.95)',
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const star = STARS[i % STARS.length] ?? { speed: 1, phase: 0 };
        const s = swell(turn * star.speed + star.phase);
        return { transform: scaleBy(0.6 + 0.6 * s), opacity: 0.1 + 0.9 * s * s };
      }),
  },
  tint: {
    name: 'Colours changing gently',
    periodMs: 10_000,
    feel: 'calm',
    // The second colour comes over the band from its start, slowly, at most halfway, and goes again.
    pieces: (look) => [
      {
        ...at,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: `linear-gradient(90deg, ${hexAlpha(accentOf(look), look.bandOpacity)} 0%, ${hexAlpha(accentOf(look), look.bandOpacity * 0.3)} 100%)`,
      },
    ],
    at: (turn, count) => each(count, () => ({ transform: '', opacity: 0.5 * swell(turn) })),
  },
  confetti: {
    name: 'Confetti falling',
    periodMs: 3600,
    feel: 'lively',
    // Ten small pieces in the second colour and white fall, swaying, turning and tumbling.
    pieces: (look) =>
      CONFETTI.map((c) => ({
        ...at,
        left: `${String(c.left)}%`,
        top: '-0.2em',
        width: '0.16em',
        height: '0.08em',
        background:
          [accentOf(look), 'rgba(255, 255, 255, 0.92)', hexAlpha(accentOf(look), 0.6)][c.colour] ?? '',
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const c = CONFETTI[i % CONFETTI.length] ?? { speed: 1, phase: 0, spin: 1 };
        const q = loop(turn, c.speed, c.phase);
        const sway = 0.15 * Math.sin(2 * Math.PI * (2 * q + c.phase));
        // One and a half flips a fall (a half flip looks the same, so it comes round without a jump).
        const tumble = Math.abs(Math.cos(Math.PI * (3 * q + 2 * c.phase)));
        return {
          transform: transformOf(
            translate(sway, 3.6 * q, 'em'),
            rotateBy(360 * loop(q, c.spin)),
            `scale(${cssNumber(Math.max(0.05, tumble))}, 1)`,
          ),
          opacity: fadeEnds(q, 0.12, 0.14),
        };
      }),
  },
  streaks: {
    name: 'Streaks of light',
    periodMs: 2400,
    feel: 'lively',
    // Five thin streaks of light run across the band at different heights and speeds.
    pieces: () =>
      STREAKS.map((s) => ({
        ...at,
        left: 0,
        top: `${String(s.top)}%`,
        width: '24%',
        height: '0.035em',
        borderRadius: '0.035em',
        background: 'linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.6))',
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const s = STREAKS[i % STREAKS.length] ?? { speed: 1, phase: 0 };
        const q = loop(turn, s.speed, s.phase);
        // From just past the band's left edge to just past its right (percent of its own width, 24% of the band).
        return {
          transform: translate(-100 + (100 + 100 / 0.24) * q, 0, '%'),
          opacity: fadeEnds(q, 0.18, 0.18),
        };
      }),
  },
  waves: {
    name: 'Waves rolling',
    periodMs: 2000,
    feel: 'lively',
    // A row of small rounded waves in the second colour along the band's foot, rolling on by two waves each loop.
    pieces: (look) => [
      {
        ...at,
        left: 0,
        bottom: 0,
        width: 'calc(100% + 1em)',
        height: '0.3em',
        background: `radial-gradient(circle at 50% 100%, ${hexAlpha(accentOf(look), 0.45)} 0.22em, ${hexAlpha(accentOf(look), 0)} 0.235em) 0 0 / 0.5em 0.3em repeat-x, linear-gradient(${hexAlpha(accentOf(look), 0.45)}, ${hexAlpha(accentOf(look), 0.45)}) 0 100% / 100% 0.08em no-repeat`,
      },
    ],
    // Two waves' width (1em) along each loop: it never jumps.
    at: (turn, count) => each(count, () => ({ transform: translate(-turn, 0, 'em'), opacity: 1 })),
  },
  chase: {
    name: 'Lights chasing',
    periodMs: 1800,
    feel: 'lively',
    // Twelve small lights in the second colour along the band's foot, lighting one after another.
    pieces: (look) =>
      Array.from({ length: CHASERS }, (_, i) => ({
        ...at,
        left: `${cssNumber(4 + (92 * i) / (CHASERS - 1))}%`,
        bottom: '0.14em',
        width: '0.14em',
        height: '0.14em',
        borderRadius: '50%',
        background: accentOf(look),
      })),
    at: (turn, count) =>
      each(count, (i) => {
        const p = ((1 + Math.cos(2 * Math.PI * (turn - (i % CHASERS) / CHASERS))) / 2) ** 4;
        return { transform: scaleBy(0.8 + 0.4 * p), opacity: 0.18 + 0.82 * p };
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
  ...TWELVE,
  // C12 JOINS HERE: ...MORE_MOTIONS,
} satisfies Record<string, MotionDef>;

/** A moving background's key; 'none' for none. */
export type LowerThirdMotion = 'none' | keyof typeof MOTIONS;

/** Every moving background a lower third may have (None first). */
export const LOWER_THIRD_MOTIONS = ['none', ...(Object.keys(MOTIONS) as (keyof typeof MOTIONS)[])] as const;

/**
 * The studio's first seven (alpha.15 to alpha.17), in their order: the Performance check's lower-thirds scenario
 * measures them, and the lower-thirds-more scenario every background since.
 */
export const FIRST_MOTIONS = Object.keys(FIRST_SEVEN) as readonly LowerThirdMotion[];

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

/** How each background feels: calm (slow light, soft colours, gentle shapes) or lively; None is calm. */
export const MOTION_FEEL = Object.fromEntries(
  LOWER_THIRD_MOTIONS.map((m) => [m, definition(m)?.feel ?? 'calm']),
) as Record<LowerThirdMotion, MotionDef['feel']>;

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
