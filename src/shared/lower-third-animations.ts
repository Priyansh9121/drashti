/*
 * The lower thirds' animations (Session 44): a library made from a few moves (fade, slide, wipe, reveal,
 * scale, flip and rotate, and line by line, word by word or letter by letter), each with its directions,
 * speeds and easings, as an "in" and a matching "out". Each has a plain name that says what it does, and the
 * search finds them by those words. Ideas only: the licensed motion skills, motion.csv, and 21st.dev's free
 * search of Remotion blocks (names and descriptions, never their code).
 *
 * What moves is only an element's opacity, transform and clip-path: no blur, no filter and no layer of its
 * own, so a screen with no graphics chip draws them as it draws a slide. Every frame is a pure function of the
 * time since the lower third went up (or was taken off), as render/lower-third-motion.ts's are, so every hall
 * screen, a key and fill pair and the stream draw the same frame. The out is the in played backwards, a
 * little quicker, so it always leaves the way it came.
 */

/** Where a move is applied: the whole lower third (its band and words), or its lines, words or letters. */
export type AnimationUnit = 'box' | 'line' | 'word' | 'letter';

/** How fast. */
export type AnimationSpeed = 'quick' | 'steady' | 'slow';
const SPEED: Record<AnimationSpeed, { factor: number; name: string }> = {
  quick: { factor: 0.6, name: ', quick' },
  steady: { factor: 1, name: '' },
  slow: { factor: 1.6, name: ', slow' },
};
export const ANIMATION_SPEEDS: readonly AnimationSpeed[] = ['quick', 'steady', 'slow'];

/** One element's look at a moment: what the page sets (an empty string is "as it is"). */
export interface Pose {
  opacity: number;
  transform: string;
  clip: string;
  origin: string;
}

/** At rest: where every in ends. */
export const REST: Pose = { opacity: 1, transform: '', clip: '', origin: '' };

/** A lower third part-way: its box, and each of its units (lines, words or letters). */
export interface AnimationFrame {
  box: Pose;
  unit(i: number): Pose;
}

/** An entry in the library. */
export interface LowerThirdAnimation {
  /** Kept with a lower third: never changes once made. */
  id: string;
  /** What it does, in plain words ("Slide in from left", "Type letter by letter, quick"). */
  name: string;
  unit: AnimationUnit;
  speed: AnimationSpeed;
  /** More words the search finds it by (its move's other names). */
  keywords: readonly string[];
  /** Its pose `p` of the way in (0 to 1, by time; easing is its own), for the box or one unit. */
  pose(p: number): Pose;
  /** For a box move, how long its in takes (ms); for a unit move, its own timing. */
  timing: Timing;
}

interface Timing {
  /** The box's own move (ms; for a unit move, the band coming first). */
  box: number;
  /** A unit move: when the first unit starts, the time between units and each one's own length (ms). */
  lead?: number;
  stagger?: number;
  each?: number;
  /** The band's move for a unit animation. */
  band?: (p: number) => Pose;
}

// ---- easings (pure; ends exactly at 0 and 1) -------------------------------------------------------------------

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** Settling into place (an ease out). */
const smooth = (p: number) => 1 - (1 - p) ** 3;
/** Both ends gentle. */
const gentle = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
/** Past its place and back (an overshoot), once. */
const bounce = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return p >= 1 ? 1 : 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};
/** A spring: past its place and back, two or three times, settling. */
const spring = (p: number) => (p >= 1 ? 1 : 1 - Math.cos(p * Math.PI * 4.5) * Math.exp(-6 * p));

/** A number for CSS: rounded, and no "-0". */
const n = (x: number, places = 3) => {
  const r = Math.round(x * 10 ** places) / 10 ** places;
  return Object.is(r, -0) ? '0' : String(r);
};

/** A pose from its parts, at rest where each is at rest. */
function pose(
  opacity: number,
  parts: { transform?: string[]; clip?: [number, number, number, number]; origin?: string },
): Pose {
  const transform = (parts.transform ?? []).filter((t) => t !== '').join(' ');
  const c = parts.clip;
  const clip = c?.some((v) => v > 0.0005) ? `inset(${c.map((v) => `${n(v, 2)}%`).join(' ')})` : '';
  return {
    opacity: opacity >= 0.9995 ? 1 : clamp01(opacity),
    transform,
    clip,
    origin: transform === '' ? '' : (parts.origin ?? ''),
  };
}

const translate = (x: number, y: number, unit: '%' | 'em') =>
  Math.abs(x) < 0.0005 && Math.abs(y) < 0.0005 ? '' : `translate(${n(x)}${unit}, ${n(y)}${unit})`;
const scale = (sx: number, sy = sx) =>
  Math.abs(sx - 1) < 0.0005 && Math.abs(sy - 1) < 0.0005
    ? ''
    : sx === sy
      ? `scale(${n(sx)})`
      : `scale(${n(sx)}, ${n(sy)})`;
const rotate = (deg: number) => (Math.abs(deg) < 0.0005 ? '' : `rotate(${n(deg, 2)}deg)`);
const flip = (axis: 'X' | 'Y', deg: number) =>
  Math.abs(deg) < 0.0005 ? '' : `perspective(900px) rotate${axis}(${n(deg, 2)}deg)`;

type Direction = 'left' | 'right' | 'up' | 'down';
/** Where it comes from, as a step of x and y (it comes from the left: from x -1). */
const FROM: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
const fadeIn = (p: number, over: number) => clamp01(p / over);

// ---- the box's moves --------------------------------------------------------------------------------------------

interface Move {
  key: string;
  name: string;
  keywords: string[];
  pose: (p: number) => Pose;
  /** Its own length at a steady speed (ms). */
  ms: number;
}

const slideNames: Record<Direction, string> = {
  left: 'in from left',
  right: 'in from right',
  up: 'up',
  down: 'down',
};
const DIRECTIONS: Direction[] = ['left', 'right', 'up', 'down'];
const directionWords: Record<Direction, string[]> = {
  left: ['left'],
  right: ['right'],
  up: ['up', 'below', 'bottom', 'rise'],
  down: ['down', 'above', 'top', 'drop'],
};

function boxMoves(): Move[] {
  const moves: Move[] = [
    {
      key: 'fade',
      name: 'Fade in',
      keywords: ['fade', 'dissolve', 'appear'],
      ms: 500,
      pose: (p) => pose(smooth(p), {}),
    },
  ];
  const along = (
    kind: string,
    title: string,
    ease: (p: number) => number,
    distance: number,
    fadeOver: number,
    words: string[],
    ms: number,
  ) => {
    for (const d of DIRECTIONS) {
      const [x, y] = FROM[d];
      moves.push({
        key: `${kind}-${d}`,
        name: `${title} ${slideNames[d]}`,
        keywords: [...words, ...directionWords[d]],
        ms,
        pose: (p) => {
          const e = ease(p);
          return pose(fadeIn(p, fadeOver), {
            transform: [translate(x * distance * (1 - e), y * distance * (1 - e), '%')],
          });
        },
      });
    }
  };
  along('slide', 'Slide', smooth, 60, 0.4, ['slide', 'move'], 600);
  along('bounce', 'Bounce', bounce, 60, 0.3, ['bounce', 'slide', 'overshoot'], 700);
  along('spring', 'Spring', spring, 45, 0.25, ['spring', 'elastic', 'wobble', 'slide'], 900);
  along('drift', 'Drift', smooth, 12, 1, ['drift', 'float', 'gentle', 'slide'], 700);
  // A wipe shows it from one side across (its clip opening that way), hard or with a fade.
  const wipeFrom: Record<Direction, (c: number) => [number, number, number, number]> = {
    right: (c) => [0, c, 0, 0],
    left: (c) => [0, 0, 0, c],
    up: (c) => [c, 0, 0, 0],
    down: (c) => [0, 0, c, 0],
  };
  for (const soft of [false, true])
    for (const d of ['right', 'left', 'up', 'down'] as Direction[])
      moves.push({
        key: `${soft ? 'softwipe' : 'wipe'}-${d}`,
        name: soft ? `Fade and wipe ${d}` : `Wipe ${d}`,
        keywords: ['wipe', 'reveal', d, ...(soft ? ['fade', 'soft'] : [])],
        ms: 600,
        pose: (p) => pose(soft ? smooth(p) : 1, { clip: wipeFrom[d](100 * (1 - gentle(p))) }),
      });
  // Opening from the middle: the clip from the middle out, side to side, up and down, or both.
  const open: [string, string, (c: number) => [number, number, number, number]][] = [
    ['middle', 'Open from the middle', (c) => [0, c, 0, c]],
    ['middle-vertical', 'Open from the middle, up and down', (c) => [c, 0, c, 0]],
    ['centre', 'Open from the centre', (c) => [c, c, c, c]],
  ];
  for (const [key, name, clip] of open)
    moves.push({
      key: `open-${key}`,
      name,
      keywords: ['open', 'reveal', 'middle', 'centre', 'center', 'unfold'],
      ms: 650,
      pose: (p) => pose(1, { clip: clip(50 * (1 - gentle(p))) }),
    });
  // Scale.
  moves.push(
    {
      key: 'pop',
      name: 'Pop in',
      keywords: ['pop', 'scale', 'bounce', 'grow'],
      ms: 500,
      pose: (p) => pose(fadeIn(p, 0.3), { transform: [scale(0.5 + 0.5 * bounce(p))] }),
    },
    {
      key: 'zoom',
      name: 'Zoom in',
      keywords: ['zoom', 'scale', 'shrink'],
      ms: 600,
      pose: (p) => pose(smooth(p), { transform: [scale(1.35 - 0.35 * smooth(p))] }),
    },
    {
      key: 'grow',
      name: 'Grow in',
      keywords: ['grow', 'scale'],
      ms: 600,
      pose: (p) => pose(smooth(p), { transform: [scale(0.85 + 0.15 * smooth(p))] }),
    },
    {
      key: 'grow-left',
      name: 'Grow from the left',
      keywords: ['grow', 'scale', 'stretch', 'left'],
      ms: 650,
      pose: (p) => pose(fadeIn(p, 0.2), { transform: [scale(smooth(p), 1)], origin: 'left center' }),
    },
    {
      key: 'grow-right',
      name: 'Grow from the right',
      keywords: ['grow', 'scale', 'stretch', 'right'],
      ms: 650,
      pose: (p) => pose(fadeIn(p, 0.2), { transform: [scale(smooth(p), 1)], origin: 'right center' }),
    },
    {
      key: 'stretch-up',
      name: 'Stretch up',
      keywords: ['stretch', 'scale', 'grow', 'up'],
      ms: 600,
      pose: (p) => pose(fadeIn(p, 0.2), { transform: [scale(1, smooth(p))], origin: 'center bottom' }),
    },
  );
  // Flip, turning in on an edge (perspective, a transform).
  const flips: [string, string, 'X' | 'Y', number, string, string[]][] = [
    ['up', 'Flip up', 'X', -90, 'center bottom', ['up']],
    ['down', 'Flip down', 'X', 90, 'center top', ['down']],
    ['left', 'Flip in from left', 'Y', 90, 'left center', ['left']],
    ['right', 'Flip in from right', 'Y', -90, 'right center', ['right']],
  ];
  for (const [key, name, axis, from, origin, words] of flips)
    moves.push({
      key: `flip-${key}`,
      name,
      keywords: ['flip', 'turn', 'rotate', '3d', ...words],
      ms: 650,
      pose: (p) => pose(fadeIn(p, 0.15), { transform: [flip(axis, from * (1 - smooth(p)))], origin }),
    });
  // Rotate.
  moves.push(
    {
      key: 'turn-left',
      name: 'Turn in from left',
      keywords: ['turn', 'rotate', 'tilt', 'left'],
      ms: 650,
      pose: (p) =>
        pose(fadeIn(p, 0.4), {
          transform: [translate(-25 * (1 - smooth(p)), 0, '%'), rotate(-10 * (1 - smooth(p)))],
        }),
    },
    {
      key: 'turn-right',
      name: 'Turn in from right',
      keywords: ['turn', 'rotate', 'tilt', 'right'],
      ms: 650,
      pose: (p) =>
        pose(fadeIn(p, 0.4), {
          transform: [translate(25 * (1 - smooth(p)), 0, '%'), rotate(10 * (1 - smooth(p)))],
        }),
    },
    {
      key: 'spin',
      name: 'Spin in',
      keywords: ['spin', 'rotate', 'turn', 'twirl'],
      ms: 800,
      pose: (p) =>
        pose(fadeIn(p, 0.3), { transform: [rotate(-180 * (1 - smooth(p))), scale(0.3 + 0.7 * smooth(p))] }),
    },
    {
      key: 'swing',
      name: 'Swing in',
      keywords: ['swing', 'rotate', 'bounce', 'hinge'],
      ms: 750,
      pose: (p) => pose(fadeIn(p, 0.3), { transform: [rotate(-14 * (1 - bounce(p)))], origin: 'left top' }),
    },
  );
  return moves;
}

// ---- moves of lines, words and letters --------------------------------------------------------------------------

interface UnitMove {
  key: string;
  /** "Rise", to make "Rise word by word". */
  verb: string;
  keywords: string[];
  pose: (p: number) => Pose;
}

const unitMoves = (unit: 'line' | 'word' | 'letter'): UnitMove[] => {
  const all: UnitMove[] = [
    { key: 'fade', verb: 'Fade in', keywords: ['fade', 'appear'], pose: (p) => pose(smooth(p), {}) },
    {
      key: 'rise',
      verb: 'Rise',
      keywords: ['rise', 'up', 'slide'],
      pose: (p) => pose(fadeIn(p, 0.5), { transform: [translate(0, 0.6 * (1 - smooth(p)), 'em')] }),
    },
    {
      key: 'drop',
      verb: 'Drop',
      keywords: ['drop', 'down', 'fall'],
      pose: (p) => pose(fadeIn(p, 0.5), { transform: [translate(0, -0.6 * (1 - smooth(p)), 'em')] }),
    },
    {
      key: 'pop',
      verb: 'Pop in',
      keywords: ['pop', 'scale', 'bounce'],
      pose: (p) => pose(fadeIn(p, 0.3), { transform: [scale(0.3 + 0.7 * bounce(p))] }),
    },
  ];
  if (unit === 'line')
    all.push(
      {
        key: 'slide-left',
        verb: 'Slide in',
        keywords: ['slide', 'left'],
        pose: (p) => pose(fadeIn(p, 0.5), { transform: [translate(-1.2 * (1 - smooth(p)), 0, 'em')] }),
      },
      {
        key: 'slide-right',
        verb: 'Slide in',
        keywords: ['slide', 'right'],
        pose: (p) => pose(fadeIn(p, 0.5), { transform: [translate(1.2 * (1 - smooth(p)), 0, 'em')] }),
      },
      {
        key: 'wipe',
        verb: 'Wipe in',
        keywords: ['wipe', 'reveal'],
        pose: (p) => pose(1, { clip: [0, 100 * (1 - gentle(p)), 0, 0] }),
      },
    );
  if (unit === 'word')
    all.push({
      key: 'slide',
      verb: 'Slide in',
      keywords: ['slide', 'left'],
      pose: (p) => pose(fadeIn(p, 0.5), { transform: [translate(-0.8 * (1 - smooth(p)), 0, 'em')] }),
    });
  if (unit === 'letter')
    all.unshift({
      key: 'type',
      verb: 'Type',
      keywords: ['type', 'typewriter', 'typing', 'write'],
      pose: (p) => pose(p > 0 ? 1 : 0, {}),
    });
  return all;
};

/** How a unit animation's band comes in first: a fade, a slide from the left, or a wipe. */
const BANDS: { key: string; name: string; keywords: string[]; pose: (p: number) => Pose }[] = [
  { key: 'band-fade', name: '', keywords: [], pose: (p) => pose(smooth(p), {}) },
  {
    key: 'band-slide',
    name: ', band slides in',
    keywords: ['band', 'slide'],
    pose: (p) => pose(fadeIn(p, 0.4), { transform: [translate(-40 * (1 - smooth(p)), 0, '%')] }),
  },
  {
    key: 'band-wipe',
    name: ', band wipes in',
    keywords: ['band', 'wipe'],
    pose: (p) => pose(1, { clip: [0, 100 * (1 - gentle(p)), 0, 0] }),
  },
];

/** A unit's timing at a steady speed (ms): when the first starts after the band, between units, and each one's own. */
const UNIT_TIMING: Record<
  'line' | 'word' | 'letter',
  { band: number; lead: number; stagger: number; each: number }
> = {
  line: { band: 350, lead: 200, stagger: 220, each: 420 },
  word: { band: 350, lead: 200, stagger: 110, each: 320 },
  letter: { band: 300, lead: 150, stagger: 45, each: 200 },
};

function lineName(move: UnitMove, unit: 'line' | 'word' | 'letter'): string {
  const by = `${unit} by ${unit}`;
  if (move.key === 'slide-left') return `Slide in ${by} from left`;
  if (move.key === 'slide-right') return `Slide in ${by} from right`;
  return `${move.verb} ${by}`;
}

function build(): LowerThirdAnimation[] {
  const out: LowerThirdAnimation[] = [];
  for (const move of boxMoves())
    for (const speed of ANIMATION_SPEEDS) {
      const f = SPEED[speed].factor;
      out.push({
        id: `${move.key}-${speed}`,
        name: `${move.name}${SPEED[speed].name}`,
        unit: 'box',
        speed,
        keywords: [...move.keywords, speed],
        pose: move.pose,
        timing: { box: Math.round(move.ms * f) },
      });
    }
  for (const unit of ['line', 'word', 'letter'] as const)
    for (const move of unitMoves(unit))
      for (const band of BANDS)
        for (const speed of ANIMATION_SPEEDS) {
          const f = SPEED[speed].factor;
          const t = UNIT_TIMING[unit];
          const typed = move.key === 'type';
          out.push({
            id: `${unit}-${move.key}-${band.key}-${speed}`,
            name: `${lineName(move, unit)}${band.name}${SPEED[speed].name}`,
            unit,
            speed,
            keywords: [...move.keywords, ...band.keywords, unit, `${unit}s`, speed],
            pose: move.pose,
            timing: {
              box: Math.round(t.band * f),
              lead: Math.round(t.lead * f),
              stagger: Math.round((typed ? 55 : t.stagger) * f),
              each: typed ? 1 : Math.round(t.each * f),
              band: band.pose,
            },
          });
        }
  return out;
}

/** Every animation, in the order the search lists them. */
export const LOWER_THIRD_ANIMATIONS: readonly LowerThirdAnimation[] = build();
const BY_ID = new Map(LOWER_THIRD_ANIMATIONS.map((a) => [a.id, a]));

/** The animation a new lower third starts with. */
export const DEFAULT_ANIMATION = 'slide-left-steady';

/** The one a lower third with an animation this Drashti does not know plays. */
const FALLBACK = ((): LowerThirdAnimation => {
  const found = BY_ID.get(DEFAULT_ANIMATION);
  if (!found)
    throw new Error(`The default lower third animation, ${DEFAULT_ANIMATION}, is not in the library.`);
  return found;
})();

/** An animation by its id (the default for one this Drashti does not know). */
export function animationById(id: string): LowerThirdAnimation {
  return BY_ID.get(id) ?? FALLBACK;
}

export const isAnimation = (id: string): boolean => BY_ID.has(id);

/** How long a phase takes (ms), for a lower third with so many units of its kind (lines, words or letters). */
export function animationLength(a: LowerThirdAnimation, phase: 'in' | 'out', units: number): number {
  const t = a.timing;
  const inMs =
    a.unit === 'box'
      ? t.box
      : t.box * 0.5 + (t.lead ?? 0) + Math.max(0, units - 1) * (t.stagger ?? 0) + (t.each ?? 0);
  return Math.max(1, Math.round(phase === 'in' ? inMs : inMs * 0.7));
}

/**
 * A lower third `t` ms into its in or its out. The out is the in played backwards (a little quicker), so it
 * ends where the in began: hidden.
 */
export function animationFrame(
  a: LowerThirdAnimation,
  phase: 'in' | 'out',
  t: number,
  units: number,
): AnimationFrame {
  const inLength = animationLength(a, 'in', units);
  const at =
    phase === 'in'
      ? Math.min(Math.max(t, 0), inLength)
      : inLength *
        (1 - Math.min(Math.max(t, 0), animationLength(a, 'out', units)) / animationLength(a, 'out', units));
  const timing = a.timing;
  if (a.unit === 'box') {
    const box = a.pose(clamp01(at / timing.box));
    return { box, unit: () => REST };
  }
  const band = (timing.band ?? ((p: number) => pose(p, {})))(clamp01(at / timing.box));
  const start = timing.box * 0.5 + (timing.lead ?? 0);
  return {
    box: band,
    unit: (i) => a.pose(clamp01((at - start - i * (timing.stagger ?? 0)) / (timing.each ?? 1))),
  };
}

/** Words for searching, lower case, without marks. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w !== '' && !['in', 'from', 'the', 'by', 'and', 'a'].includes(w));

/**
 * The animations a search finds: every one whose name or other names hold each word asked for (as the start of
 * a word: "bounc" finds "Bounce"), in the library's order. Nothing asked for is everything.
 */
export function searchAnimations(query: string): LowerThirdAnimation[] {
  const asked = words(query);
  if (asked.length === 0) return [...LOWER_THIRD_ANIMATIONS];
  return LOWER_THIRD_ANIMATIONS.filter((a) => {
    const has = [...words(a.name), ...a.keywords];
    return asked.every((w) => has.some((h) => h.startsWith(w)));
  });
}

// ---- cutting a lower third's lines into what moves ---------------------------------------------------------

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(granularity: 'word' | 'grapheme'): Intl.Segmenter {
  let s = segmenters.get(granularity);
  if (!s) {
    s = new Intl.Segmenter(undefined, { granularity });
    segmenters.set(granularity, s);
  }
  return s;
}

/** Part of a line: what moves (a unit, numbered in reading order) or what stays (spaces, marks). */
export interface LinePiece {
  text: string;
  unit: number | null;
}

/**
 * Lines cut into what an animation moves: each whole line, each word (the language's own words, so a Gujarati
 * or Devanagari letter cluster is never split), or each letter (a cluster as one); a box move moves none.
 */
export function cutIntoUnits(
  lines: readonly string[],
  a: LowerThirdAnimation,
): { pieces: LinePiece[][]; units: number } {
  let units = 0;
  const pieces = lines.map((line): LinePiece[] => {
    if (a.unit === 'line') return [{ text: line, unit: units++ }];
    if (a.unit === 'box') return [{ text: line, unit: null }];
    if (a.unit === 'word')
      return [...segmenter('word').segment(line)].map((s) => ({
        text: s.segment,
        unit: s.isWordLike === true ? units++ : null,
      }));
    return [...segmenter('grapheme').segment(line)].map((s) => ({
      text: s.segment,
      unit: s.segment.trim() === '' ? null : units++,
    }));
  });
  return { pieces, units };
}
