import {
  accentOf,
  cssNumber,
  hexAlpha,
  type MotionDef,
  type PiecePose,
  rotateBy,
  scaleBy,
  swell,
  transformOf,
  translate,
} from './lower-third-motion-kit';

/*
 * The Lower Thirds studio's moving backgrounds, part 2 (Session 58, alpha.18): eleven more, the 20th to the 30th,
 * original designs. Calm ones for a mandir hall first (a flower opening, a spotlight swaying, fireflies, rings
 * turning, lanterns floating up, kites, a garland swaying), then a few livelier (bars dancing, fireworks, hexagons
 * pulsing, tiles flipping). They join the studio's registry (lower-third-styles.ts, MOTIONS) at its one marked line.
 *
 * Drawn as the first seven are (render/LowerThirdView.tsx draws them): at most 12 pieces, each drawn once (a fill, a
 * gradient, a rounded or cut shape, a ring; never a filter, a blur, a shadow or a backdrop), then moved only by
 * transform and opacity, a pure function of how far round its loop it is, so every screen, key and fill and the
 * stream draw the same frame, light on a computer without a graphics chip. Round and round without a jump: a piece
 * that shows only ever moves a little from one frame to the next, from the end of its loop to its start too (one
 * that starts again elsewhere does so unseen). In the lower third's own colours (its second colour, and the words'
 * for one) and white light. The Performance run's lower-thirds scenario measures each (lower-third-studio.ts,
 * OFFERED), and only those smooth on a two-core computer without a graphics chip while streaming are offered.
 */

const TAU = 2 * Math.PI;
/** The part of the way round past whole loops (0 up to 1). */
const frac = (x: number): number => x - Math.floor(x);
/** How strongly it shows (0 to 1), to three places. */
const shows = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;
/** Shown fully but near the start and end of its way (`edge` of it at each end): it starts again elsewhere unseen. */
const edges = (q: number, edge: number): number => Math.min(1, q / edge, (1 - q) / edge);
/** White light, `alpha` solid. */
const white = (alpha: number): string => `rgba(255, 255, 255, ${cssNumber(alpha, 2)})`;
/** A scale across and up apart (never below 0); '' for none. */
const stretch = (x: number, y: number): string => {
  const [a, b] = [cssNumber(Math.max(0, x)), cssNumber(Math.max(0, y))];
  return a === '1' && b === '1' ? '' : `scale(${a}, ${b})`;
};
const each = (count: number, pose: (i: number) => PiecePose): PiecePose[] =>
  Array.from({ length: count }, (_, i) => pose(i));
const at = { position: 'absolute' } as const;
/** A place across or down the shape, as CSS. */
const pc = (x: number): string => `${cssNumber(x)}%`;
const em = (x: number): string => `${cssNumber(x)}em`;

// ---- where their pieces are ---------------------------------------------------------------------------------

/** Fireflies: where each wanders about (percent), its two sways and its blinks in each loop (whole numbers). */
const FIREFLIES: readonly { left: number; top: number; across: number; down: number; blinks: number }[] = [
  { left: 8, top: 30, across: 1, down: 2, blinks: 3 },
  { left: 22, top: 66, across: 2, down: 1, blinks: 4 },
  { left: 37, top: 40, across: 1, down: 3, blinks: 5 },
  { left: 50, top: 72, across: 3, down: 2, blinks: 3 },
  { left: 63, top: 28, across: 2, down: 3, blinks: 4 },
  { left: 78, top: 60, across: 1, down: 2, blinks: 6 },
  { left: 92, top: 45, across: 2, down: 1, blinks: 5 },
];

/** Rings: how wide (em) and how many times round each loop (minus: the other way). */
const RINGS: readonly { size: number; turns: number }[] = [
  { size: 1.5, turns: 1 },
  { size: 2.4, turns: -1 },
  { size: 3.3, turns: 2 },
];

/** Lanterns: where each rises (percent across), and when it starts (part of the way round). */
const LANTERNS: readonly { left: number; start: number }[] = [
  { left: 12, start: 0 },
  { left: 31, start: 0.6 },
  { left: 50, start: 0.2 },
  { left: 69, start: 0.8 },
  { left: 88, start: 0.4 },
];

/** Kites: where each flies (percent across and down). */
const KITES: readonly { left: number; top: number }[] = [
  { left: 18, top: 32 },
  { left: 42, top: 58 },
  { left: 66, top: 30 },
  { left: 86, top: 62 },
];

/** The garland's flowers: across (percent) and how low each hangs (0 at its ends, 1 at its middle). */
const GARLAND: readonly { left: number; sag: number }[] = Array.from({ length: 9 }, (_, i) => {
  const left = 6 + 11 * i;
  return { left, sag: 1 - ((left - 50) / 44) ** 2 };
});

/** Bars: their two beats in each loop (whole numbers, so the loop meets itself). */
const BARS: readonly { slow: number; quick: number }[] = [
  { slow: 2, quick: 5 },
  { slow: 3, quick: 7 },
  { slow: 4, quick: 6 },
  { slow: 3, quick: 5 },
  { slow: 2, quick: 7 },
  { slow: 4, quick: 6 },
  { slow: 3, quick: 5 },
  { slow: 2, quick: 6 },
  { slow: 4, quick: 7 },
  { slow: 2, quick: 6 },
  { slow: 3, quick: 5 },
  { slow: 4, quick: 7 },
];

/** Fireworks: the two places they burst (percent across and down), one in each half of the loop. */
const BURSTS: readonly { left: number; top: number }[] = [
  { left: 28, top: 42 },
  { left: 72, top: 58 },
];
const SPARKS_PER_BURST = 6;

const HEXAGON = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';

// ---- the eleven ---------------------------------------------------------------------------------------------

/** C12's eleven, by key (the key a lower third keeps, so never renamed): calm ones first. */
export const MORE_MOTIONS = {
  // Eight petals round a point near the band's end, opening and closing slowly as the flower turns.
  bloom: {
    name: 'Flower opening',
    feel: 'calm',
    periodMs: 96_000,
    pieces: (look) => {
      const a = accentOf(look);
      return Array.from({ length: 8 }, (_, j) => ({
        ...at,
        left: '86%',
        top: '50%',
        width: '0.3em',
        height: '0.95em',
        marginLeft: '-0.15em',
        marginTop: '-0.95em',
        borderRadius: '50%',
        transformOrigin: '50% 100%',
        background:
          j % 2 === 0
            ? `linear-gradient(0deg, ${hexAlpha(a, 0.65)}, ${hexAlpha(a, 0.1)})`
            : `linear-gradient(0deg, ${white(0.4)}, ${white(0.05)})`,
      }));
    },
    // Once round each loop (under 4 degrees a second), opening and closing eight times (12 s each).
    at: (turn, count) =>
      each(count, (j) => ({
        transform: transformOf(rotateBy(45 * j + 360 * turn), scaleBy(0.62 + 0.38 * swell(frac(8 * turn)))),
        opacity: 1,
      })),
  },

  // A soft round light of white and the second colour, swaying slowly from side to side behind the words.
  spotlight: {
    name: 'Spotlight swaying',
    feel: 'calm',
    periodMs: 10_000,
    pieces: (look) => {
      const a = accentOf(look);
      return [
        {
          ...at,
          left: 0,
          top: '50%',
          width: '40%',
          aspectRatio: '1',
          // Margins are a share of the shape's width: half the light's own height, so its middle is the band's.
          marginTop: '-20%',
          background: `radial-gradient(closest-side, ${white(0.22)} 0%, ${hexAlpha(a, 0.16)} 50%, ${hexAlpha(a, 0)} 100%)`,
        },
      ];
    },
    // Its middle from a fifth of the way across to four fifths, and back.
    at: (turn, count) =>
      each(count, () => ({ transform: translate(75 + 75 * Math.sin(TAU * turn), 0, '%'), opacity: 1 })),
  },

  // Small soft lights wandering on looping paths, each blinking slowly at its own pace.
  fireflies: {
    name: 'Fireflies wandering',
    feel: 'calm',
    periodMs: 20_000,
    pieces: (look) => {
      const a = accentOf(look);
      const glow = `radial-gradient(circle, ${white(0.95)} 0%, ${hexAlpha(a, 0.75)} 35%, ${hexAlpha(a, 0)} 70%)`;
      return FIREFLIES.map((f) => ({
        ...at,
        left: pc(f.left),
        top: pc(f.top),
        width: '0.22em',
        height: '0.22em',
        marginLeft: '-0.11em',
        marginTop: '-0.11em',
        borderRadius: '50%',
        background: glow,
      }));
    },
    at: (turn, count) =>
      each(count, (i) => {
        const f = FIREFLIES[i % FIREFLIES.length] ?? { across: 1, down: 1, blinks: 3 };
        const p = 0.37 * i;
        return {
          transform: translate(
            0.7 * Math.sin(TAU * (f.across * turn + p)),
            0.3 * Math.sin(TAU * (f.down * turn + 1.3 * p)),
            'em',
          ),
          opacity: shows(0.2 + 0.8 * swell(frac(f.blinks * turn + 0.21 * i)) ** 2),
        };
      }),
  },

  // Three rings near the band's end, each two arcs, turning slowly, the middle one the other way.
  rings: {
    name: 'Rings turning slowly',
    feel: 'calm',
    periodMs: 60_000,
    pieces: (look) => {
      const a = accentOf(look);
      return RINGS.map((r, i) => {
        const [solid, clear] = i === 1 ? [hexAlpha(a, 0.7), hexAlpha(a, 0)] : [white(0.45), white(0)];
        return {
          ...at,
          left: '84%',
          top: '50%',
          width: em(r.size),
          height: em(r.size),
          marginLeft: em(-r.size / 2),
          marginTop: em(-r.size / 2),
          borderRadius: '50%',
          borderWidth: '0.06em',
          borderStyle: 'solid',
          borderColor: `${solid} ${clear} ${solid} ${clear}`,
        };
      });
    },
    at: (turn, count) =>
      each(count, (i) => ({
        transform: rotateBy(360 * (RINGS[i % RINGS.length]?.turns ?? 1) * turn),
        opacity: 1,
      })),
  },

  // Glowing lanterns rising slowly from below the band, swaying and tilting a little, and fading as they leave.
  lanterns: {
    name: 'Lanterns floating up',
    feel: 'calm',
    periodMs: 16_000,
    pieces: (look) => {
      const a = accentOf(look);
      const glow = `linear-gradient(180deg, ${white(0.8)} 0%, ${hexAlpha(a, 0.85)} 40%, ${hexAlpha(a, 0.45)} 100%)`;
      return LANTERNS.map((l) => ({
        ...at,
        left: pc(l.left),
        bottom: '-0.55em',
        width: '0.3em',
        height: '0.4em',
        marginLeft: '-0.15em',
        borderRadius: '0.1em 0.1em 0.15em 0.15em',
        background: glow,
      }));
    },
    at: (turn, count) =>
      each(count, (i) => {
        const q = frac(turn + (LANTERNS[i % LANTERNS.length]?.start ?? 0));
        const sway = TAU * 2 * q + i;
        return {
          transform: transformOf(
            translate(0.18 * Math.sin(sway), -4.4 * q, 'em'),
            rotateBy(6 * Math.sin(sway + 0.8)),
          ),
          opacity: shows(0.95 * edges(q, 0.12)),
        };
      }),
  },

  // Kites in the second colour and white, bobbing and swaying where they fly.
  kites: {
    name: 'Kites flying',
    feel: 'calm',
    periodMs: 8000,
    pieces: (look) => {
      const a = accentOf(look);
      return KITES.map((k) => ({
        ...at,
        left: pc(k.left),
        top: pc(k.top),
        width: '0.36em',
        height: '0.36em',
        marginLeft: '-0.18em',
        marginTop: '-0.18em',
        borderRadius: '0.04em',
        // Turned a quarter of the way round below, the two halves meet on its long diagonal.
        background: `linear-gradient(90deg, ${hexAlpha(a, 0.6)} 50%, ${white(0.4)} 50%)`,
      }));
    },
    at: (turn, count) =>
      each(count, (i) => {
        const p = 0.29 * i;
        return {
          transform: transformOf(
            translate(0.22 * Math.sin(TAU * (turn + p)), 0.14 * Math.sin(TAU * (2 * turn + 1.7 * p)), 'em'),
            rotateBy(45 + 9 * Math.sin(TAU * (turn + 0.5 * p) + 1)),
          ),
          opacity: 1,
        };
      }),
  },

  // A garland of flowers in the second colour hanging along the top of the band, swaying gently.
  garland: {
    name: 'Garland swaying',
    feel: 'calm',
    periodMs: 7000,
    pieces: (look) => {
      const a = accentOf(look);
      const flower = `radial-gradient(circle at 40% 35%, ${white(0.5)} 0%, ${hexAlpha(a, 0.7)} 45%, ${hexAlpha(a, 0.5)} 100%)`;
      return GARLAND.map((g) => ({
        ...at,
        left: pc(g.left),
        top: em(0.04 + 0.42 * g.sag),
        width: '0.26em',
        height: '0.26em',
        marginLeft: '-0.13em',
        borderRadius: '50%',
        background: flower,
      }));
    },
    // The middle swings most, and each a moment after the one before.
    at: (turn, count) =>
      each(count, (i) => {
        const reach = 0.3 + 0.7 * (GARLAND[i % GARLAND.length]?.sag ?? 0);
        const w = Math.sin(TAU * (turn - 0.04 * i));
        return { transform: translate(0.16 * reach * w, -0.05 * reach * w * w, 'em'), opacity: 1 };
      }),
  },

  // Thin bars in the second colour along the foot of the band, rising and falling to their own beats, as music.
  bars: {
    name: 'Bars dancing',
    feel: 'lively',
    periodMs: 3000,
    pieces: (look) => {
      const a = accentOf(look);
      return BARS.map((_, i) => ({
        ...at,
        left: pc(3 + 8.5 * i),
        bottom: 0,
        width: '0.16em',
        height: '62%',
        transformOrigin: '50% 100%',
        borderRadius: '0.08em 0.08em 0 0',
        background: `linear-gradient(0deg, ${hexAlpha(a, 0.6)}, ${hexAlpha(a, 0.12)})`,
      }));
    },
    at: (turn, count) =>
      each(count, (i) => {
        const b = BARS[i % BARS.length] ?? { slow: 2, quick: 5 };
        const p = 0.137 * i;
        const beat =
          0.6 * Math.abs(Math.sin(Math.PI * (b.slow * turn + p))) +
          0.4 * Math.abs(Math.sin(Math.PI * (b.quick * turn + 1.7 * p)));
        return { transform: stretch(1, 0.12 + 0.88 * beat), opacity: 1 };
      }),
  },

  // Two bursts, one after the other: short streaks flying out from a point and fading, white, then the second
  // colour.
  fireworks: {
    name: 'Fireworks bursting',
    feel: 'lively',
    periodMs: 2800,
    pieces: (look) => {
      const a = accentOf(look);
      return BURSTS.flatMap((b, n) =>
        Array.from({ length: SPARKS_PER_BURST }, () => ({
          ...at,
          left: pc(b.left),
          top: pc(b.top),
          width: '0.32em',
          height: '0.07em',
          marginLeft: '-0.16em',
          marginTop: '-0.035em',
          borderRadius: '0.035em',
          background:
            n === 0
              ? `linear-gradient(90deg, ${white(0)}, ${white(0.95)})`
              : `linear-gradient(90deg, ${hexAlpha(a, 0)}, ${hexAlpha(a, 0.95)})`,
        })),
      );
    },
    at: (turn, count) =>
      each(count, (i) => {
        const n = Math.floor(i / SPARKS_PER_BURST) % BURSTS.length;
        const angle = (360 / SPARKS_PER_BURST) * (i % SPARKS_PER_BURST) + 30 * n + 15;
        // Each burst in its own half of the loop, out of sight in the other.
        const p = 2 * turn - n;
        if (p < 0 || p >= 1) return { transform: rotateBy(angle), opacity: 0 };
        return {
          transform: transformOf(
            rotateBy(angle),
            translate(1.1 * (1 - (1 - p) ** 3), 0, 'em'),
            scaleBy(1 - 0.5 * p),
          ),
          opacity: shows(Math.min(1, p / 0.08) * (1 - p) ** 1.2),
        };
      }),
  },

  // A row of hexagons across the middle of the band, a pulse running out from the middle one to the ends.
  hexagons: {
    name: 'Hexagons pulsing',
    feel: 'lively',
    periodMs: 2400,
    pieces: (look) => {
      const a = accentOf(look);
      return Array.from({ length: 7 }, (_, i) => ({
        ...at,
        left: pc(8 + 14 * i),
        top: '50%',
        width: '0.5em',
        height: '0.44em',
        marginLeft: '-0.25em',
        marginTop: '-0.22em',
        clipPath: HEXAGON,
        background:
          i % 2 === 0
            ? `linear-gradient(180deg, ${hexAlpha(a, 0.45)}, ${hexAlpha(a, 0.18)})`
            : `linear-gradient(180deg, ${white(0.28)}, ${white(0.1)})`,
      }));
    },
    at: (turn, count) =>
      each(count, (i) => {
        const pulse = swell(frac(turn - Math.abs(i - 3) / 7)) ** 3;
        return { transform: scaleBy(0.55 + 0.45 * pulse), opacity: shows(0.35 + 0.65 * pulse) };
      }),
  },

  // A row of tiles in the second colour and white, each turning over in turn, twice each loop.
  tiles: {
    name: 'Tiles flipping',
    feel: 'lively',
    periodMs: 3200,
    pieces: (look) => {
      const a = accentOf(look);
      return Array.from({ length: 8 }, (_, i) => ({
        ...at,
        left: pc(7 + 12.3 * i),
        top: '50%',
        width: '0.34em',
        height: '0.34em',
        marginLeft: '-0.17em',
        marginTop: '-0.17em',
        borderRadius: '0.06em',
        background: i % 2 === 0 ? hexAlpha(a, 0.5) : white(0.32),
      }));
    },
    at: (turn, count) =>
      each(count, (i) => {
        const face = Math.abs(Math.cos(Math.PI * (2 * turn - i / 8)));
        return { transform: stretch(face, 1), opacity: shows(0.4 + 0.6 * face) };
      }),
  },
} satisfies Record<string, MotionDef>;

/** C12's eleven backgrounds' keys, in the studio's order (calm first). */
export type MoreMotion = keyof typeof MORE_MOTIONS;
