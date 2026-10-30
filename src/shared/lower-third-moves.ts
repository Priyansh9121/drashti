import type { Pose } from './lower-third-animations';

/*
 * The Lower Thirds studio's animations (Session 55, Part 16), added to the library (lower-third-animations.ts takes
 * them in, each in three speeds, and a move by lines, words or letters with each way its band comes in): blurs,
 * reveals from behind an edge, a circle opening, blinds, a diagonal wipe, a swoosh, stretching down and zooming
 * from far away for the whole lower third; and blurring, revealing, splitting (every other one from the other side),
 * zooming, flipping, typing, gathering and bouncing for its lines, words or letters.
 *
 * Like the library's own, every frame is a pure function of the time, and only opacity, transform and clip-path
 * move, except the blurs (a filter): a computer without a graphics chip draws a blur slowly, so the Performance
 * run's lower-thirds scenario measures each, and one that is not smooth there is not offered (lower-third-studio.ts,
 * OFFERED). Lengths in em are the words' own size, so a blur or a gather looks the same on a phone and on a 4K screen.
 */

/** A move of the whole lower third (its band and words together). */
export interface StudioBoxMove {
  key: string;
  name: string;
  keywords: string[];
  /** Its own length at a steady speed (ms). */
  ms: number;
  pose: (p: number) => Pose;
}

/** A move of each line, word or letter, one after another; `i` is the unit's place in reading order. */
export interface StudioUnitMove {
  key: string;
  /** "Blur in", to make "Blur in word by word". */
  verb: string;
  keywords: string[];
  pose: (p: number, i?: number) => Pose;
}

// ---- easings and pieces of a pose (pure; ends exactly at 0 and 1) -----------------------------------------------

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** Settling into place. */
const smooth = (p: number) => 1 - (1 - p) ** 3;
/** Both ends gentle. */
const gentle = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
/** Past its place and back, once. */
const overshoot = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return p >= 1 ? 1 : 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};
const fadeIn = (p: number, over: number) => clamp01(p / over);

/** A number for CSS: rounded, and no "-0". */
const n = (x: number, places = 3) => {
  const r = Math.round(x * 10 ** places) / 10 ** places;
  return Object.is(r, -0) ? '0' : String(r);
};

/** A pose from its parts, at rest where each is at rest (no filter at all unless it blurs). */
function pose(
  opacity: number,
  parts: { transform?: string[]; clip?: string; origin?: string; blur?: number },
): Pose {
  const transform = (parts.transform ?? []).filter((t) => t !== '').join(' ');
  const blur = parts.blur ?? 0;
  const out: Pose = {
    opacity: opacity >= 0.9995 ? 1 : clamp01(opacity),
    transform,
    clip: parts.clip ?? '',
    origin: transform === '' ? '' : (parts.origin ?? ''),
  };
  if (blur > 0.0005) out.filter = `blur(${n(blur)}em)`;
  return out;
}

const translate = (x: number, y: number, unit: '%' | 'em') =>
  Math.abs(x) < 0.0005 && Math.abs(y) < 0.0005 ? '' : `translate(${n(x)}${unit}, ${n(y)}${unit})`;
const scale = (sx: number, sy = sx) =>
  Math.abs(sx - 1) < 0.0005 && Math.abs(sy - 1) < 0.0005
    ? ''
    : sx === sy
      ? `scale(${n(sx)})`
      : `scale(${n(sx)}, ${n(sy)})`;
const skew = (deg: number) => (Math.abs(deg) < 0.0005 ? '' : `skewX(${n(deg, 2)}deg)`);
const flipX = (deg: number) => (Math.abs(deg) < 0.0005 ? '' : `perspective(900px) rotateX(${n(deg, 2)}deg)`);
/** A rectangle's clip, by how far in from each side (percent): none once nothing is cut. */
const inset = (top: number, right: number, bottom: number, left: number) =>
  [top, right, bottom, left].some((v) => v > 0.0005)
    ? `inset(${[top, right, bottom, left].map((v) => `${n(v, 2)}%`).join(' ')})`
    : '';
const polygon = (points: readonly [number, number][]) =>
  `polygon(${points.map(([x, y]) => `${n(x, 2)}% ${n(y, 2)}%`).join(', ')})`;

type Side = 'up' | 'down' | 'left' | 'right';

/** From behind its own edge: it moves out from behind a line where that edge is, and only what is past it shows. */
function revealFrom(side: Side, k: number): { transform: string[]; clip: string } {
  const d = 100 * k;
  switch (side) {
    case 'up':
      return { transform: [translate(0, d, '%')], clip: inset(0, 0, d, 0) };
    case 'down':
      return { transform: [translate(0, -d, '%')], clip: inset(d, 0, 0, 0) };
    case 'left':
      return { transform: [translate(-d, 0, '%')], clip: inset(0, 0, 0, d) };
    case 'right':
      return { transform: [translate(d, 0, '%')], clip: inset(0, d, 0, 0) };
  }
}

/** How many slats the blinds have. */
const SLATS = 6;

/** The blinds `e` of the way open: each slat showing that much of itself from its top. */
function blinds(e: number): string {
  if (e >= 0.9995) return '';
  const h = 100 / SLATS;
  const points: [number, number][] = [];
  for (let s = 0; s < SLATS; s++) {
    const top = s * h;
    const bottom = top + h * e;
    points.push([0, top], [100, top], [100, bottom], [0, bottom]);
  }
  return polygon(points);
}

/** A diagonal wipe `e` of the way across, from the left (or the right): its edge leaning by a fifth of the width. */
function diagonal(e: number, from: 'left' | 'right'): string {
  if (e >= 0.9995) return '';
  const lean = 20;
  const x = (100 + lean) * e;
  return from === 'left'
    ? polygon([
        [0, 0],
        [x, 0],
        [x - lean, 100],
        [0, 100],
      ])
    : polygon([
        [100, 0],
        [100, 100],
        [100 - x, 100],
        [100 - x + lean, 0],
      ]);
}

/** A few whole numbers' worth of scatter for unit `i`: the same each time, different for each. */
function scatter(i: number): [number, number] {
  const a = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const b = Math.sin((i + 1) * 78.233) * 12345.6789;
  return [(a - Math.floor(a)) * 4 - 2, (b - Math.floor(b)) * 3 - 1.5];
}

// ---- the whole lower third ------------------------------------------------------------------------------------

export const STUDIO_BOX_MOVES: readonly StudioBoxMove[] = [
  {
    key: 'blur',
    name: 'Blur in',
    keywords: ['blur', 'focus', 'soft'],
    ms: 700,
    pose: (p) => pose(fadeIn(p, 0.5), { blur: 0.35 * (1 - smooth(p)) }),
  },
  ...(['left', 'right'] as const).map((side): StudioBoxMove => ({
    key: `blur-${side}`,
    name: `Blur in from ${side}`,
    keywords: ['blur', 'focus', 'slide', 'motion', side],
    ms: 700,
    pose: (p) => {
      const k = 1 - smooth(p);
      return pose(fadeIn(p, 0.45), {
        transform: [translate((side === 'left' ? -18 : 18) * k, 0, '%')],
        blur: 0.3 * k,
      });
    },
  })),
  ...(
    [
      ['up', 'Reveal up'],
      ['down', 'Reveal down'],
      ['left', 'Reveal from the left'],
      ['right', 'Reveal from the right'],
    ] as const
  ).map(([side, name]): StudioBoxMove => ({
    key: `reveal-${side}`,
    name,
    keywords: ['reveal', 'mask', 'rise', 'behind', side],
    ms: 650,
    pose: (p) => pose(1, revealFrom(side, 1 - smooth(p))),
  })),
  {
    key: 'iris',
    name: 'Open as a circle',
    keywords: ['circle', 'iris', 'open', 'round', 'reveal'],
    ms: 700,
    pose: (p) => {
      const e = gentle(p);
      return pose(p > 0 ? 1 : 0, { clip: e >= 0.9995 ? '' : `circle(${n(75 * e, 2)}% at 50% 50%)` });
    },
  },
  ...(['left', 'right'] as const).map((from): StudioBoxMove => ({
    key: `diagonal-${from}`,
    name: `Wipe diagonally from the ${from}`,
    keywords: ['wipe', 'diagonal', 'slant', 'reveal', from],
    ms: 650,
    pose: (p) => pose(p > 0 ? 1 : 0, { clip: diagonal(gentle(p), from) }),
  })),
  {
    key: 'blinds',
    name: 'Blinds',
    keywords: ['blinds', 'slats', 'stripes', 'venetian', 'reveal'],
    ms: 700,
    pose: (p) => pose(p > 0 ? 1 : 0, { clip: blinds(gentle(p)) }),
  },
  ...(['left', 'right'] as const).map((side): StudioBoxMove => ({
    key: `swoosh-${side}`,
    name: `Swoosh in from ${side}`,
    keywords: ['swoosh', 'skew', 'slide', 'fast', side],
    ms: 600,
    pose: (p) => {
      const k = 1 - smooth(p);
      const sign = side === 'left' ? -1 : 1;
      return pose(fadeIn(p, 0.35), {
        transform: [translate(sign * 40 * k, 0, '%'), skew(-sign * 25 * k)],
      });
    },
  })),
  {
    key: 'stretch-down',
    name: 'Stretch down',
    keywords: ['stretch', 'scale', 'grow', 'down', 'unfold'],
    ms: 600,
    pose: (p) => pose(fadeIn(p, 0.2), { transform: [scale(1, smooth(p))], origin: 'center top' }),
  },
  {
    key: 'zoom-far',
    name: 'Zoom from far away',
    keywords: ['zoom', 'scale', 'far', 'grow', 'fly'],
    ms: 700,
    pose: (p) => pose(fadeIn(p, 0.35), { transform: [scale(0.1 + 0.9 * smooth(p))] }),
  },
];

// ---- lines, words and letters ---------------------------------------------------------------------------------

const blurUnit: StudioUnitMove = {
  key: 'blur',
  verb: 'Blur in',
  keywords: ['blur', 'focus', 'soft'],
  pose: (p) => pose(fadeIn(p, 0.6), { blur: 0.3 * (1 - smooth(p)) }),
};

const revealUnit: StudioUnitMove = {
  key: 'reveal',
  verb: 'Reveal',
  keywords: ['reveal', 'mask', 'rise', 'behind'],
  pose: (p) => pose(1, revealFrom('up', 1 - smooth(p))),
};

const zoomUnit: StudioUnitMove = {
  key: 'zoom',
  verb: 'Zoom in',
  keywords: ['zoom', 'scale', 'shrink'],
  pose: (p) => pose(fadeIn(p, 0.5), { transform: [scale(1.8 - 0.8 * smooth(p))] }),
};

const flipUnit: StudioUnitMove = {
  key: 'flip',
  verb: 'Flip in',
  keywords: ['flip', 'turn', 'rotate', '3d'],
  pose: (p) => pose(fadeIn(p, 0.3), { transform: [flipX(90 * (1 - smooth(p)))], origin: 'center bottom' }),
};

/** Every other line from the other side; every other word or letter from below rather than above. */
const splitUnit = (sideways: boolean): StudioUnitMove => ({
  key: 'split',
  verb: 'Split in',
  keywords: ['split', 'both', 'sides', 'alternate', 'slide'],
  pose: (p, i = 0) => {
    const k = 1 - smooth(p);
    const sign = i % 2 === 0 ? -1 : 1;
    return pose(fadeIn(p, 0.5), {
      transform: [sideways ? translate(sign * 1.5 * k, 0, 'em') : translate(0, sign * 0.8 * k, 'em')],
    });
  },
});

/** The library's own move ids that a unit already has (lower-third-animations.ts unitMoves): never added twice. */
export function studioUnitMoves(unit: 'line' | 'word' | 'letter'): StudioUnitMove[] {
  if (unit === 'line') return [blurUnit, revealUnit, splitUnit(true), zoomUnit, flipUnit];
  const moves = [blurUnit, revealUnit, splitUnit(false), zoomUnit, flipUnit];
  if (unit === 'word')
    moves.push({
      key: 'type',
      verb: 'Type',
      keywords: ['type', 'typewriter', 'typing', 'write'],
      pose: (p) => pose(p > 0 ? 1 : 0, {}),
    });
  else
    moves.push(
      {
        key: 'gather',
        verb: 'Gather',
        keywords: ['gather', 'scatter', 'fly', 'assemble', 'together'],
        pose: (p, i = 0) => {
          const k = 1 - smooth(p);
          const [x, y] = scatter(i);
          return pose(fadeIn(p, 0.4), { transform: [translate(x * k, y * k, 'em')] });
        },
      },
      {
        key: 'bounce',
        verb: 'Bounce in',
        keywords: ['bounce', 'jump', 'wave', 'overshoot'],
        pose: (p) => pose(fadeIn(p, 0.3), { transform: [translate(0, 0.8 * (1 - overshoot(p)), 'em')] }),
      },
    );
  return moves;
}
