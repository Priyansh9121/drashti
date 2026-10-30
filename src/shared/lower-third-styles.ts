import type { LowerThirdLook } from './lower-thirds';

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

export const LOWER_THIRD_MOTIONS = [
  'none',
  'sweep',
  'shine',
  'shapes',
  'stripes',
  'glow',
  'line',
  'sparkles',
] as const;
export type LowerThirdMotion = (typeof LOWER_THIRD_MOTIONS)[number];

export const MOTION_NAMES: Record<LowerThirdMotion, string> = {
  none: 'None',
  sweep: 'Colours sweeping',
  shine: 'Light passing over',
  shapes: 'Shapes drifting',
  stripes: 'Stripes moving',
  glow: 'Glowing',
  line: 'A line running',
  sparkles: 'Sparkles rising',
};

/** How long each background takes to come round to where it began (ms). */
export const MOTION_PERIOD_MS: Record<LowerThirdMotion, number> = {
  none: 1000,
  sweep: 6000,
  shine: 4000,
  shapes: 12_000,
  stripes: 1600,
  glow: 3000,
  line: 2400,
  sparkles: 4000,
};

/** The second colour a style or background uses when a lower third has none (one made before the studio). */
export const DEFAULT_ACCENT = '#f59e0b';

/** CSS as plain data (React's style object takes it as it is). */
export type Css = Record<string, string | number>;

/** A colour with how solid it is, "#rrggbbaa". */
export const hexAlpha = (hex: string, alpha: number): string =>
  `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

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

/** Whether a background is the colour itself (the sweep): its shape has no colour of its own under it. */
export const motionIsFill = (motion: LowerThirdMotion): boolean => motion === 'sweep';

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

/** A background's pieces, as each is drawn whatever the time (where it is, its size and its colour). */
export function motionPieces(motion: LowerThirdMotion, look: LowerThirdLook): Css[] {
  const accent = look.accent ?? DEFAULT_ACCENT;
  const at = { position: 'absolute' } as const;
  switch (motion) {
    case 'none':
      return [];
    case 'sweep': {
      const a = hexAlpha(look.band, look.bandOpacity);
      const b = hexAlpha(accent, look.bandOpacity);
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
    }
    case 'shine':
      return [
        {
          ...at,
          top: '-30%',
          bottom: '-30%',
          left: 0,
          width: '30%',
          background:
            'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.34) 50%, rgba(255, 255, 255, 0) 100%)',
        },
      ];
    case 'shapes':
      return SHAPES.map((s) => ({
        ...at,
        left: `${String(s.left)}%`,
        top: `${String(s.top)}%`,
        height: `${String(s.height)}%`,
        aspectRatio: '1',
        borderRadius: '50%',
        background: s.light ? 'rgba(255, 255, 255, 0.16)' : hexAlpha(accent, 0.3),
      }));
    case 'stripes':
      return [
        {
          ...at,
          top: 0,
          bottom: 0,
          left: 0,
          width: 'calc(100% + 1em)',
          background: `repeating-linear-gradient(-45deg, ${hexAlpha(accent, 0.28)} 0 0.35em, ${hexAlpha(accent, 0)} 0.35em 0.7em)`,
        },
      ];
    case 'glow':
      return [
        {
          ...at,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: `radial-gradient(ellipse at 50% 120%, ${hexAlpha(accent, 0.75)} 0%, ${hexAlpha(accent, 0)} 70%)`,
        },
      ];
    case 'line':
      return [
        {
          ...at,
          left: 0,
          bottom: 0,
          height: '0.07em',
          width: '35%',
          background: `linear-gradient(90deg, ${hexAlpha(accent, 0)}, ${accent}, ${hexAlpha(accent, 0)})`,
        },
      ];
    case 'sparkles':
      return SPARKS.map((s) => ({
        ...at,
        left: `${String(s.left)}%`,
        bottom: 0,
        width: '0.12em',
        height: '0.12em',
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.9)',
      }));
  }
}

/** A number for CSS: rounded, and no "-0". */
const n = (x: number, places = 3) => {
  const r = Math.round(x * 10 ** places) / 10 ** places;
  return Object.is(r, -0) ? '0' : String(r);
};
const translate = (x: number, y: number, unit: '%' | 'em') =>
  Math.abs(x) < 0.0005 && Math.abs(y) < 0.0005 ? '' : `translate(${n(x)}${unit}, ${n(y)}${unit})`;

/** One piece of a background at a moment. */
export interface PiecePose {
  transform: string;
  opacity: number;
}

/**
 * A background's `count` pieces `t` ms after the lower third went up: where each is and how strongly it shows. Round
 * and round: the same again a period later.
 */
export function motionAt(motion: LowerThirdMotion, t: number, count: number): PiecePose[] {
  const period = MOTION_PERIOD_MS[motion];
  const turn = Math.round((((t % period) + period) % period) * 1e6) / 1e6 / period;
  const pieces = Array.from({ length: count }, (_, i) => i);
  switch (motion) {
    case 'none':
      return [];
    case 'sweep':
      return pieces.map(() => ({ transform: translate(-50 * turn, 0, '%'), opacity: 1 }));
    case 'shine': {
      // Across in the first third of each period, then out of sight until the next.
      const across = turn / 0.35;
      const at = (x: number) => [translate(x, 0, '%'), 'skewX(-20deg)'].filter((p) => p !== '').join(' ');
      return pieces.map(() =>
        across >= 1
          ? { transform: at(-130), opacity: 0 }
          : { transform: at(-130 + 495 * across), opacity: 1 },
      );
    }
    case 'shapes':
      return pieces.map((i) => {
        const s = SHAPES[i % SHAPES.length] ?? { turns: 1 };
        const a = 2 * Math.PI * (turn * s.turns + i / SHAPES.length);
        return { transform: translate(40 * Math.cos(a), 25 * Math.sin(a), '%'), opacity: 1 };
      });
    case 'stripes':
      // One stripe's width along the band each period: it never jumps (0.7em across a 45° stripe).
      return pieces.map(() => ({ transform: translate(-0.99 * turn, 0, 'em'), opacity: 1 }));
    case 'glow':
      return pieces.map(() => ({
        transform: '',
        opacity: 0.35 + 0.45 * (0.5 - 0.5 * Math.cos(2 * Math.PI * turn)),
      }));
    case 'line':
      return pieces.map(() => ({ transform: translate(-100 + 385.7 * turn, 0, '%'), opacity: 1 }));
    case 'sparkles':
      return pieces.map((i) => {
        const s = SPARKS[i % SPARKS.length] ?? { speed: 1 };
        const q = (turn * s.speed + i / SPARKS.length) % 1;
        return { transform: translate(0, -1800 * q, '%'), opacity: Math.sin(Math.PI * q) };
      });
  }
}
