import type { AnimationSpeed, LowerThirdAnimation } from './lower-third-animations';
import {
  animationById,
  isAnimation,
  LOWER_THIRD_ANIMATIONS,
  searchAnimations,
} from './lower-third-animations';
import type { LowerThirdMotion, LowerThirdStyle } from './lower-third-styles';
import { MOTION_FEEL } from './lower-third-styles';
import { LOWER_THIRD_SECONDS } from './lower-thirds';

/*
 * The Lower Thirds studio (Session 55, Part 16): what it offers, and how it names and finds it.
 *
 * OFFERED is the one table of what is offered: every family of animation (with its directions and speeds, and, for
 * a move by lines, words or letters, how its band comes in), every way a band comes in, every style and every moving
 * background. The Performance run's lower-thirds scenario (main/lower-thirds/perf-lower-thirds.ts) plays each row on
 * a two-core computer without a graphics chip and says how many of its frames each screen drew; a row that is not
 * smooth there is left out by deleting it, and nothing else need change: the studio, the messages and the templates
 * offer only what is in the table, and a lower third or a message that already has something left out still draws
 * it (the library keeps every animation, lower-third-animations.ts).
 */

export type FamilyUnit = LowerThirdAnimation['unit'];
export type BandIntro = 'fade' | 'slide' | 'wipe';

/** A family of animation: one move, in each of its directions (or ways), at each speed. */
export interface AnimationFamily {
  /** Its key in OFFERED. */
  family: string;
  /** The heading it is listed under. */
  group: string;
  name: string;
  unit: FamilyUnit;
  /** Its directions (or ways), when it has more than one. */
  directions?: readonly string[];
  /** Each direction's move (the library's key); '' for one with a single way. */
  moves: Readonly<Record<string, string>>;
}

type Row =
  | { kind: 'animation'; family: string }
  | { kind: 'band'; key: BandIntro }
  | { kind: 'style'; key: LowerThirdStyle }
  | { kind: 'background'; key: LowerThirdMotion };

/**
 * THE OFFERED SET (Part 16). One row each; the Performance run's lower-thirds scenario plays them all. Delete a row
 * that is not smooth on a two-core computer without a graphics chip, and it is not offered anywhere.
 */
export const OFFERED: readonly Row[] = [
  // The whole lower third.
  { kind: 'animation', family: 'fade' },
  { kind: 'animation', family: 'slide' },
  { kind: 'animation', family: 'across' },
  { kind: 'animation', family: 'drift' },
  { kind: 'animation', family: 'swoosh' },
  { kind: 'animation', family: 'bounce' },
  { kind: 'animation', family: 'spring' },
  { kind: 'animation', family: 'pop' },
  { kind: 'animation', family: 'wipe' },
  { kind: 'animation', family: 'softwipe' },
  { kind: 'animation', family: 'diagonal' },
  { kind: 'animation', family: 'blinds' },
  { kind: 'animation', family: 'reveal' },
  { kind: 'animation', family: 'open' },
  { kind: 'animation', family: 'iris' },
  { kind: 'animation', family: 'zoom' },
  { kind: 'animation', family: 'zoom-far' },
  { kind: 'animation', family: 'grow' },
  { kind: 'animation', family: 'stretch' },
  { kind: 'animation', family: 'blur' },
  { kind: 'animation', family: 'flip' },
  { kind: 'animation', family: 'turn' },
  { kind: 'animation', family: 'spin' },
  { kind: 'animation', family: 'swing' },
  // Line by line.
  { kind: 'animation', family: 'line-fade' },
  { kind: 'animation', family: 'line-rise' },
  { kind: 'animation', family: 'line-drop' },
  { kind: 'animation', family: 'line-pop' },
  { kind: 'animation', family: 'line-slide' },
  { kind: 'animation', family: 'line-wipe' },
  { kind: 'animation', family: 'line-reveal' },
  { kind: 'animation', family: 'line-split' },
  { kind: 'animation', family: 'line-zoom' },
  { kind: 'animation', family: 'line-flip' },
  { kind: 'animation', family: 'line-blur' },
  // Word by word.
  { kind: 'animation', family: 'word-fade' },
  { kind: 'animation', family: 'word-rise' },
  { kind: 'animation', family: 'word-drop' },
  { kind: 'animation', family: 'word-pop' },
  { kind: 'animation', family: 'word-slide' },
  { kind: 'animation', family: 'word-type' },
  { kind: 'animation', family: 'word-reveal' },
  { kind: 'animation', family: 'word-split' },
  { kind: 'animation', family: 'word-zoom' },
  { kind: 'animation', family: 'word-flip' },
  { kind: 'animation', family: 'word-blur' },
  // Letter by letter.
  { kind: 'animation', family: 'letter-type' },
  { kind: 'animation', family: 'letter-fade' },
  { kind: 'animation', family: 'letter-rise' },
  { kind: 'animation', family: 'letter-drop' },
  { kind: 'animation', family: 'letter-pop' },
  { kind: 'animation', family: 'letter-bounce' },
  { kind: 'animation', family: 'letter-reveal' },
  { kind: 'animation', family: 'letter-split' },
  { kind: 'animation', family: 'letter-gather' },
  { kind: 'animation', family: 'letter-zoom' },
  { kind: 'animation', family: 'letter-flip' },
  { kind: 'animation', family: 'letter-blur' },
  // How the band comes in before its lines, words or letters.
  { kind: 'band', key: 'fade' },
  { kind: 'band', key: 'slide' },
  { kind: 'band', key: 'wipe' },
  // The styles the words sit in.
  { kind: 'style', key: 'box' },
  { kind: 'style', key: 'band' },
  { kind: 'style', key: 'pill' },
  { kind: 'style', key: 'ribbon' },
  { kind: 'style', key: 'outline' },
  { kind: 'style', key: 'glass' },
  { kind: 'style', key: 'split' },
  { kind: 'style', key: 'accent' },
  { kind: 'style', key: 'underline' },
  { kind: 'style', key: 'slant' },
  { kind: 'style', key: 'stacked' },
  { kind: 'style', key: 'words' },
  // Moving backgrounds (and none, always). The studio lists the calm ones first (OFFERED_MOTIONS).
  { kind: 'background', key: 'sweep' },
  { kind: 'background', key: 'shine' },
  { kind: 'background', key: 'shapes' },
  { kind: 'background', key: 'stripes' },
  { kind: 'background', key: 'glow' },
  { kind: 'background', key: 'line' },
  { kind: 'background', key: 'sparkles' },
  // Twelve more (alpha.18, lower-third-styles.ts): the Performance check's lower-thirds-more scenario measures them.
  { kind: 'background', key: 'dawn' },
  { kind: 'background', key: 'lamps' },
  { kind: 'background', key: 'mist' },
  { kind: 'background', key: 'rays' },
  { kind: 'background', key: 'petals' },
  { kind: 'background', key: 'ripples' },
  { kind: 'background', key: 'stars' },
  { kind: 'background', key: 'tint' },
  { kind: 'background', key: 'confetti' },
  { kind: 'background', key: 'streaks' },
  { kind: 'background', key: 'waves' },
  { kind: 'background', key: 'chase' },
  // C12's eleven (alpha.18, lower-third-motions-more.ts): the lower-thirds-more scenario measures them too.
  { kind: 'background', key: 'bloom' },
  { kind: 'background', key: 'spotlight' },
  { kind: 'background', key: 'fireflies' },
  { kind: 'background', key: 'rings' },
  { kind: 'background', key: 'lanterns' },
  { kind: 'background', key: 'kites' },
  { kind: 'background', key: 'garland' },
  { kind: 'background', key: 'bars' },
  { kind: 'background', key: 'fireworks' },
  { kind: 'background', key: 'hexagons' },
  { kind: 'background', key: 'tiles' },
];

// ---- every family the studio knows ----------------------------------------------------------------------------

const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
const sides = (key: string, dirs: readonly string[] = DIRECTIONS): Record<string, string> =>
  Object.fromEntries(dirs.map((d) => [d, `${key}-${d}`]));
const one = (key: string): Record<string, string> => ({ '': key });

function box(family: string, group: string, name: string, moves: Record<string, string>): AnimationFamily {
  const directions = Object.keys(moves).filter((d) => d !== '');
  return { family, group, name, unit: 'box', moves, ...(directions.length > 1 ? { directions } : {}) };
}

const UNIT_GROUPS: Record<Exclude<FamilyUnit, 'box'>, string> = {
  line: 'Line by line',
  word: 'Word by word',
  letter: 'Letter by letter',
};

function byUnit(
  unit: Exclude<FamilyUnit, 'box'>,
  key: string,
  name: string,
  moves: Record<string, string> = one(key),
): AnimationFamily {
  const directions = Object.keys(moves).filter((d) => d !== '');
  return {
    family: `${unit}-${key}`,
    group: UNIT_GROUPS[unit],
    name,
    unit,
    moves,
    ...(directions.length > 1 ? { directions } : {}),
  };
}

/** Every family the studio knows, in the order it lists them (only OFFERED's are offered). */
export const FAMILIES: readonly AnimationFamily[] = [
  box('fade', 'Fade', 'Fade', one('fade')),
  box('slide', 'Slide', 'Slide', sides('slide')),
  box('across', 'Slide', 'Slide from the picture’s edge', sides('across')),
  box('drift', 'Slide', 'Drift', sides('drift')),
  box('swoosh', 'Slide', 'Swoosh', sides('swoosh', ['left', 'right'])),
  box('bounce', 'Bounce', 'Bounce', sides('bounce')),
  box('spring', 'Bounce', 'Spring', sides('spring')),
  box('pop', 'Bounce', 'Pop', one('pop')),
  box('wipe', 'Wipe', 'Wipe', sides('wipe')),
  box('softwipe', 'Wipe', 'Fade and wipe', sides('softwipe')),
  box('diagonal', 'Wipe', 'Wipe diagonally', sides('diagonal', ['left', 'right'])),
  box('blinds', 'Wipe', 'Blinds', one('blinds')),
  box('reveal', 'Reveal', 'Reveal', sides('reveal')),
  box('open', 'Reveal', 'Open', {
    'from the middle': 'open-middle',
    'up and down': 'open-middle-vertical',
    'from the centre': 'open-centre',
  }),
  box('iris', 'Reveal', 'Open as a circle', one('iris')),
  box('zoom', 'Zoom', 'Zoom', one('zoom')),
  box('zoom-far', 'Zoom', 'Zoom from far away', one('zoom-far')),
  box('grow', 'Zoom', 'Grow', { 'in place': 'grow', left: 'grow-left', right: 'grow-right' }),
  box('stretch', 'Zoom', 'Stretch', { up: 'stretch-up', down: 'stretch-down' }),
  box('blur', 'Blur', 'Blur', { 'in place': 'blur', left: 'blur-left', right: 'blur-right' }),
  box('flip', 'Flip and turn', 'Flip', sides('flip')),
  box('turn', 'Flip and turn', 'Turn', sides('turn', ['left', 'right'])),
  box('spin', 'Flip and turn', 'Spin', one('spin')),
  box('swing', 'Flip and turn', 'Swing', one('swing')),
  ...(['line', 'word', 'letter'] as const).flatMap((unit) => {
    const by = `${unit} by ${unit}`;
    const list: AnimationFamily[] = [];
    if (unit === 'letter') list.push(byUnit(unit, 'type', `Type ${by}`));
    list.push(
      byUnit(unit, 'fade', `Fade in ${by}`),
      byUnit(unit, 'rise', `Rise ${by}`),
      byUnit(unit, 'drop', `Drop ${by}`),
      byUnit(unit, 'pop', `Pop in ${by}`),
    );
    if (unit === 'line')
      list.push(
        byUnit(unit, 'slide', `Slide in ${by}`, { left: 'slide-left', right: 'slide-right' }),
        byUnit(unit, 'wipe', `Wipe in ${by}`),
      );
    if (unit === 'word')
      list.push(byUnit(unit, 'slide', `Slide in ${by}`), byUnit(unit, 'type', `Type ${by}`));
    if (unit === 'letter') list.push(byUnit(unit, 'bounce', `Bounce in ${by}`));
    list.push(byUnit(unit, 'reveal', `Reveal ${by}`), byUnit(unit, 'split', `Split in ${by}`));
    if (unit === 'letter') list.push(byUnit(unit, 'gather', `Gather ${by}`));
    list.push(
      byUnit(unit, 'zoom', `Zoom in ${by}`),
      byUnit(unit, 'flip', `Flip in ${by}`),
      byUnit(unit, 'blur', `Blur in ${by}`),
    );
    return list;
  }),
];

export const SPEEDS: readonly AnimationSpeed[] = ['quick', 'steady', 'slow'];
export const BAND_INTROS: readonly BandIntro[] = ['fade', 'slide', 'wipe'];

/** A family's animation for these choices (the first direction when none is given). */
export function idFor(
  family: AnimationFamily,
  choice: { direction: string | null; speed: AnimationSpeed; band: BandIntro | null },
): string {
  const direction = choice.direction ?? family.directions?.[0] ?? '';
  const move = family.moves[direction] ?? Object.values(family.moves)[0] ?? '';
  return family.unit === 'box'
    ? `${move}-${choice.speed}`
    : `${family.unit}-${move}-band-${choice.band ?? 'fade'}-${choice.speed}`;
}

/** Each animation's family and band, from every choice of every family. */
const KNOWN = new Map<string, { family: string; band: BandIntro | null }>();
for (const family of FAMILIES)
  for (const direction of family.directions ?? [null])
    for (const speed of SPEEDS)
      for (const band of family.unit === 'box' ? [null] : BAND_INTROS)
        KNOWN.set(idFor(family, { direction, speed, band }), { family: family.family, band });

/** An animation's family (its own id for one the studio does not know: never offered). */
export const familyOf = (a: Pick<LowerThirdAnimation, 'id'>): string => KNOWN.get(a.id)?.family ?? a.id;

const offeredFamilies = new Set(OFFERED.flatMap((r) => (r.kind === 'animation' ? [r.family] : [])));
const offeredBands = new Set(OFFERED.flatMap((r) => (r.kind === 'band' ? [r.key] : [])));

/** Whether the studio offers this animation (its family, and its band's way in). */
export function isOffered(id: string): boolean {
  const known = KNOWN.get(id);
  return (
    known !== undefined &&
    isAnimation(id) &&
    offeredFamilies.has(known.family) &&
    (known.band === null || offeredBands.has(known.band))
  );
}

/** The families offered, by their headings, in the studio's order. */
export const CATALOGUE: readonly { group: string; families: readonly AnimationFamily[] }[] = (() => {
  const groups: { group: string; families: AnimationFamily[] }[] = [];
  for (const family of FAMILIES) {
    if (!offeredFamilies.has(family.family)) continue;
    const last = groups[groups.length - 1];
    if (last?.group === family.group) last.families.push(family);
    else groups.push({ group: family.group, families: [family] });
  }
  return groups;
})();

/** Every animation offered, with its heading, in the studio's order. */
export const OFFERED_LIST: readonly { group: string; animation: LowerThirdAnimation }[] = CATALOGUE.flatMap(
  ({ group, families }) =>
    families.flatMap((family) =>
      (family.directions ?? [null]).flatMap((direction) =>
        (family.unit === 'box' ? [null] : BAND_INTROS).flatMap((band) =>
          SPEEDS.map((speed) => idFor(family, { direction, speed, band }))
            .filter(isOffered)
            .map((id) => ({ group, animation: animationById(id) })),
        ),
      ),
    ),
);

/** Every animation offered (the studio's and the messages'), in the studio's order. */
export const OFFERED_ANIMATIONS: readonly LowerThirdAnimation[] = OFFERED_LIST.map((o) => o.animation);

/** The offered ones a search finds (the library's own search, lower-third-animations.ts), in the studio's order. */
export function searchOffered(query: string): typeof OFFERED_LIST {
  const found = new Set(searchAnimations(query).map((a) => a.id));
  return OFFERED_LIST.filter((o) => found.has(o.animation.id));
}

export const OFFERED_STYLES: readonly LowerThirdStyle[] = OFFERED.flatMap((r) =>
  r.kind === 'style' ? [r.key] : [],
);
const offeredBackgrounds = OFFERED.flatMap((r) => (r.kind === 'background' ? [r.key] : []));
/** The backgrounds offered, as the studio lists them: None, then the calm ones, then the lively ones. */
export const OFFERED_MOTIONS: readonly LowerThirdMotion[] = [
  'none',
  ...offeredBackgrounds.filter((m) => MOTION_FEEL[m] === 'calm'),
  ...offeredBackgrounds.filter((m) => MOTION_FEEL[m] === 'lively'),
];

// ---- names ----------------------------------------------------------------------------------------------------

/** An animation's name as it comes in ("Slide in from left"). */
export const animationName = (id: string): string => animationById(id).name;

/**
 * An animation's name as it goes out, its in played backwards: "Slide in from left" goes out "Slide out to the
 * left", "Fade in" "Fade out"; one with no plain word for it says it plays backwards ("Blinds, backwards").
 */
export function outName(id: string): string {
  const name = animationName(id);
  // The speed stays at the end.
  const speed = /(, (quick|slow))$/u.exec(name)?.[1] ?? '';
  const base = name.replace(/, (quick|slow)$/u, '');
  const [head = base, ...rest] = base.split(', ');
  // Its band goes the way it came: ", band slides in" goes out ", band slides out".
  const tail = rest.length > 0 ? `, ${rest.join(', ').replace(/ in$/u, ' out')}` : '';
  const sided = /^(.*) in from (the )?(left|right)$/u.exec(head);
  if (sided) return `${sided[1] ?? ''} out to the ${sided[3] ?? ''}${tail}${speed}`;
  const unitSided = /^(.*) in ((line|word|letter) by \3) from (left|right)$/u.exec(head);
  if (unitSided)
    return `${unitSided[1] ?? ''} out ${unitSided[2] ?? ''} to the ${unitSided[4] ?? ''}${tail}${speed}`;
  const inWord = /^(.*) in( (line|word|letter) by \3)?$/u.exec(head);
  if (inWord) return `${inWord[1] ?? ''} out${inWord[2] ?? ''}${tail}${speed}`;
  return `${head}${tail}, backwards${speed}`;
}

// ---- templates ------------------------------------------------------------------------------------------------

/** How long one that hides itself may stay up (seconds). */
export const HIDE_AFTER = LOWER_THIRD_SECONDS;

/** Every animation the library has that the studio does not offer (left out of OFFERED, or never in it). */
export const NOT_OFFERED: readonly LowerThirdAnimation[] = LOWER_THIRD_ANIMATIONS.filter(
  (a) => !isOffered(a.id),
);
