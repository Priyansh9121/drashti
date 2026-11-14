import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copyZipReplacing } from '../deck/zip-copy';
import {
  attrOf,
  childOf,
  elementsOf,
  findAll,
  parseTree,
  setAttr,
  type TreeElement,
  writeTree,
} from '../deck/xml-tree';
import { readZipEntries } from '../zip';
import { DECK_HEIGHT, DECK_WIDTH, makeTestDeck, placeholderDeckMedia } from './make-deck';

/*
 * Tests only (Session 57): the deck PowerPoint's own movie is compared against, frame by frame (C3's comparison
 * harness, fixture.mjs, in C3's Codex work folder; brought here by h-p3fx so that a new export takes it from the repo).
 * Coloured boxes only, no words: one slide per effect and variant.
 * - Run 1 (12 Nov 2026; its movie measured 13 Nov), first and as it was: Float in and out, Split in and out both ways,
 *   Grow & Turn and Shrink & Turn, Grow/Shrink, a Fly with a smooth start and end, and Basic Zoom's In, Out, In
 *   Slightly, In From Screen Center and Out From Screen Bottom; then Push, Wipe, Cover and Uncover in each direction,
 *   each after a reference slide.
 * - Run 2 (h-p3run2, 13 Nov), what run 1 left unmeasured: Float in and out and Grow/Shrink with a smooth start and
 *   end, Basic Zoom leaving to another size or place, and Shape (circle, box, diamond, plus; In and Out) coming in and
 *   leaving.
 * - Run 3 (h-pptx3, Session 58, 14 Nov 2026): the lengths the others never tried, each after run 2's slides: the
 *   Basic Zoom exit Out To Screen Bottom at 750 ms (its end between two of the movie's frames) and 1 s, Shape at 2 s,
 *   and Push, Wipe, Cover and Uncover in each direction at 1 s and at 2 s (run 1's are 700 ms); and a 4:3 deck of
 *   its own (COMPARISON_STANDARD): the effects whose drawing depends on the slide's shape (Shape, Basic Zoom to and
 *   from the screen's centre and bottom, the four transitions), with Float and Grow/Shrink as controls.
 * Each slide carries a gray marker in its top left corner, 4 levels lighter than the slide before (run 1's from 20,
 * run 2's from 22, run 3's from 24 and 26, so every marker stays a gray), so a probe finds it in the movie. Each effect
 * runs 700 ms from its click (unless its name gives another length) on a red 64 × 38 box at (94, 51) of a 320 × 180
 * slide (at (54, 51) of a 240 × 180 one in the 4:3 deck: 38,100 EMU a pixel in both).
 */

export const COMPARISON_WIDTH = 320;
export const COMPARISON_HEIGHT = 180;
export const COMPARISON_BOX = { x: 94, y: 51, width: 64, height: 38 };
const DURATION = 700;
/** EMU a pixel of the probe's grid: the wide deck's 12,192,000 × 6,858,000 at 320 × 180, as the 4:3 deck's at 240 × 180. */
const EMU = DECK_HEIGHT / COMPARISON_HEIGHT;
/** PowerPoint's own 4:3 slide (On-screen Show), 10 × 7.5 in. */
const STANDARD_EMU = { cx: 9_144_000, cy: 6_858_000 };
const RED = 'D02B25';
const BLUE = '2345CB';
const gray = (value: number) => value.toString(16).padStart(2, '0').repeat(3);

type Rect = typeof COMPARISON_BOX;

function shape(id: number, fill: string, rect: Rect) {
  return {
    id,
    type: 'shape' as const,
    name: `Placeholder ${String(id)}`,
    fill,
    x: Math.round(rect.x * EMU),
    y: Math.round(rect.y * EMU),
    w: Math.round(rect.width * EMU),
    h: Math.round(rect.height * EMU),
  };
}

/** One linear track of a property, from one value to another: a number, or a formula as PowerPoint writes one. */
export interface ComparisonTrack {
  name: string;
  from: number | string;
  to: number | string;
}

export interface ComparisonMotion {
  name: string;
  phase: 'in' | 'out' | 'emphasis';
  preset: number;
  tracks: ComparisonTrack[];
  filter?: string;
  subtype?: number;
  accel?: number;
  decel?: number;
  /** Grow/Shrink's size, in thousandths of a percent. */
  relativeScale?: number;
}

const track = (name: string, from: number | string, to: number | string): ComparisonTrack => ({
  name,
  from,
  to,
});
/** A width or height `times` the shape's own, as PowerPoint writes it: the number 0, its own (#ppt_w), or a multiple. */
const size = (name: string, times: number): number | string =>
  times === 0 ? 0 : times === 1 ? `#${name}` : `#${name}*${String(times)}`;
const scale = (from: number, to: number) =>
  ['ppt_w', 'ppt_h'].map((name) => track(name, size(name, from), size(name, to)));
const position = (axis: 'x' | 'y', from: number | string, to: number | string) =>
  track(`ppt_${axis}`, from, to);
const effect = (
  name: string,
  phase: ComparisonMotion['phase'],
  preset: number,
  tracks: ComparisonTrack[] = [],
  more: Partial<ComparisonMotion> = {},
): ComparisonMotion => ({ name, phase, preset, tracks, ...more });

const MOTIONS: ComparisonMotion[] = [
  effect('Float In Up', 'in', 42, [position('y', '#ppt_y+0.08', '#ppt_y')], { filter: 'fade', subtype: 4 }),
  effect('Float In Down', 'in', 42, [position('y', '#ppt_y-0.08', '#ppt_y')], { filter: 'fade', subtype: 1 }),
  effect('Float Out Up', 'out', 47, [position('y', '#ppt_y', '#ppt_y-0.08')], { filter: 'fade', subtype: 4 }),
  effect('Float Out Down', 'out', 47, [position('y', '#ppt_y', '#ppt_y+0.08')], {
    filter: 'fade',
    subtype: 1,
  }),
  ...(['in', 'out'] as const).flatMap((phase) =>
    ['in', 'out'].flatMap((edge) =>
      ['Vertical', 'Horizontal'].map((axis) =>
        effect(`Split ${phase} · ${edge}${axis}`, phase, 16, [], { filter: `barn(${edge}${axis})` }),
      ),
    ),
  ),
  effect('Grow & Turn', 'in', 31, [...scale(0, 1), track('style.rotation', 90, 0)], { filter: 'fade' }),
  effect('Shrink & Turn', 'out', 31, [...scale(1, 0), track('style.rotation', 0, 90)], { filter: 'fade' }),
  effect('Grow/Shrink 150%', 'emphasis', 6, [], { relativeScale: 150_000 }),
  effect('Grow/Shrink 50%', 'emphasis', 6, [], { relativeScale: 50_000 }),
  effect(
    'Fly with smooth start and end',
    'in',
    2,
    [position('x', '#ppt_x', '#ppt_x'), position('y', '1+#ppt_h/2', '#ppt_y')],
    { subtype: 4, accel: 25_000, decel: 50_000 },
  ),
  effect('Basic Zoom · In', 'in', 23, scale(0, 1)),
  effect('Basic Zoom · Out', 'in', 23, scale(4, 1)),
  effect('Basic Zoom · In Slightly', 'in', 23, scale(2 / 3, 1)),
  effect('Basic Zoom · In From Screen Center', 'in', 23, [
    ...scale(0, 1),
    position('x', 0.5, '#ppt_x'),
    position('y', 0.5, '#ppt_y'),
  ]),
  effect('Basic Zoom · Out From Screen Bottom', 'in', 23, [
    ...scale(4, 1),
    position('x', 0.5, '#ppt_x'),
    position('y', '1+#ppt_h/2', '#ppt_y'),
  ]),
];

/** A smooth start of 25 % and a smooth end of 50 %, on the effect itself, as run 1's eased Fly had them. */
const EASED = { accel: 25_000, decel: 50_000 };
/** PowerPoint's own size for Basic Zoom's Out: 8 times a shape under 0.3 of the slide, twice one the slide's size. */
const LARGE = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
/** Shape's outlines, each PowerPoint's own effect (its preset) under the one name. */
const OUTLINES = [
  ['Circle', 6],
  ['Box', 4],
  ['Diamond', 8],
  ['Plus', 13],
] as const;

/**
 * Run 2's effects (h-p3run2, 13 Nov 2026), each as PowerPoint writes it. Basic Zoom leaving: each the entrance of that
 * name played backwards, from where the shape rests to where that entrance starts, in PowerPoint's own formulas.
 * Shape: PowerPoint's filter for each outline, In and Out, with its preset's subtype (16 for In, 32 for Out).
 * (PowerPoint plays an effect's behaviours as written, whatever its subtype: run 1's zooms had none.)
 */
const RUN2_MOTIONS: ComparisonMotion[] = [
  effect('Float In Up · smooth start and end', 'in', 42, [position('y', '#ppt_y+0.08', '#ppt_y')], {
    filter: 'fade',
    subtype: 4,
    ...EASED,
  }),
  effect('Float Out Down · smooth start and end', 'out', 47, [position('y', '#ppt_y', '#ppt_y+0.08')], {
    filter: 'fade',
    subtype: 1,
    ...EASED,
  }),
  effect('Grow/Shrink 150% · smooth start and end', 'emphasis', 6, [], { relativeScale: 150_000, ...EASED }),
  effect('Grow/Shrink 50% · smooth start and end', 'emphasis', 6, [], { relativeScale: 50_000, ...EASED }),
  effect('Basic Zoom exit · Out', 'out', 23, [
    track('ppt_w', '#ppt_w', `${LARGE}#ppt_w`),
    track('ppt_h', '#ppt_h', `${LARGE}#ppt_h`),
  ]),
  effect('Basic Zoom exit · In Slightly', 'out', 23, [
    track('ppt_w', '#ppt_w', '2/3*#ppt_w'),
    track('ppt_h', '#ppt_h', '2/3*#ppt_h'),
  ]),
  effect('Basic Zoom exit · In To Screen Center', 'out', 23, [
    ...scale(1, 0),
    position('x', '#ppt_x', 0.5),
    position('y', '#ppt_y', 0.5),
  ]),
  effect('Basic Zoom exit · Out To Screen Bottom', 'out', 23, [
    track('ppt_w', '#ppt_w', `${LARGE}#ppt_w`),
    track('ppt_h', '#ppt_h', `${LARGE}#ppt_h`),
    position('x', '#ppt_x', 0.5),
    position('y', '#ppt_y', `1+${LARGE}#ppt_h/2`),
  ]),
  ...(['in', 'out'] as const).flatMap((phase) =>
    OUTLINES.flatMap(([outline, preset]) =>
      (['In', 'Out'] as const).map((way) =>
        effect(`Shape ${phase} · ${outline} ${way}`, phase, preset, [], {
          filter: `${outline.toLowerCase()}(${way.toLowerCase()})`,
          subtype: way === 'In' ? 16 : 32,
        }),
      ),
    ),
  ),
];

export type ComparisonDirection = 'left' | 'right' | 'up' | 'down';

export interface ComparisonSlide {
  name: string;
  bg: string;
  motion?: ComparisonMotion;
  transition?: { kind: 'push' | 'wipe' | 'cover' | 'uncover'; dir: string; direction: ComparisonDirection };
  /** The gray of its marker: 4 lighter than the slide before it in its run (run 1's from 20, run 2's from 22). */
  marker: number;
  /** Its effect's or transition's length (ms), or 0. */
  duration: number;
}

const DIRECTIONS: [string, ComparisonDirection][] = [
  ['l', 'left'],
  ['r', 'right'],
  ['u', 'up'],
  ['d', 'down'],
];

/** A slide before its marker and length: `length` (ms) for an effect or transition of another length than 700 ms. */
type Scene = Omit<ComparisonSlide, 'marker' | 'duration'> & { length?: number };
const timed = (scenes: readonly Scene[], firstMarker: number): ComparisonSlide[] =>
  scenes.map(({ length, ...scene }, index) => ({
    ...scene,
    marker: firstMarker + 4 * index,
    duration: scene.motion || scene.transition ? (length ?? DURATION) : 0,
  }));

const KINDS = ['push', 'wipe', 'cover', 'uncover'] as const;
/** Each transition in each direction, each after a red reference slide that comes in by a cut; `ms` long. */
const transitionScenes = (named: (name: string) => string, length?: number): Scene[] =>
  KINDS.flatMap((kind) =>
    DIRECTIONS.flatMap(([dir, direction]): Scene[] => [
      { name: named(`Reference for ${kind} ${direction}`), bg: RED, ...(length ? { length } : {}) },
      {
        name: named(`${kind} ${direction}`),
        transition: { kind, dir, direction },
        bg: BLUE,
        ...(length ? { length } : {}),
      },
    ]),
  );
const motionScenes = (motions: readonly ComparisonMotion[]): Scene[] =>
  motions.map((motion) => ({ name: motion.name, motion, bg: '292929' }));

/** Run 1's slides: the first of the deck, as they were, so that run 1's results stay comparable. */
const RUN1: readonly ComparisonSlide[] = timed(
  [...motionScenes(MOTIONS), ...transitionScenes((name) => name)],
  20,
);

/** How many of the deck's slides are run 1's (its first). */
export const COMPARISON_RUN1_SLIDES = RUN1.length;

const byName = (motions: readonly ComparisonMotion[], name: string): ComparisonMotion => {
  const found = motions.find((motion) => motion.name === name);
  if (!found) throw new Error(`No comparison effect ${name}`);
  return found;
};
/** Run 1's or run 2's effect `name` again, `length` ms long, its name saying so. */
const lasting = (name: string, length: number): Scene => {
  const motion = { ...byName([...MOTIONS, ...RUN2_MOTIONS], name), name: `${name} · ${String(length)} ms` };
  return { name: motion.name, motion, bg: '292929', length };
};
const atLength = (length: number) => (name: string) => `${name} · ${String(length)} ms`;

/**
 * Run 3's slides in the wide deck (h-pptx3, Session 58), after run 2's: the Zoom exit Out To Screen Bottom at 750 ms
 * (its end between two of the movie's frames, which fall every 33.3 ms from a click) and at 1 s; Shape at 2 s (is its
 * soft edge a share of the way, as at 700 ms, or a time?); every transition at 1 s, PowerPoint's own length for most
 * (markers from 24); then every transition at 2 s (markers from 26). Session 57's Cover and Uncover rest on 700 ms.
 */
/**
 * Basic Zoom as PowerPoint writes it (EF-4, the review of h-p3fx's part 4, L2 and L3): run 1's deck wrote Out and Out
 * From Screen Bottom as 4 times the shape, where PowerPoint writes its own formula (8 times a shape under 0.3 of the
 * slide, twice one its size); and the sixth variants, never measured: Out Slightly coming in (from 4/3), and leaving
 * In (to nothing, in place) and Out Slightly (to 4/3).
 */
const ZOOM_OWN: ComparisonMotion[] = [
  effect('Basic Zoom · Out · as PowerPoint writes it', 'in', 23, [
    track('ppt_w', `${LARGE}#ppt_w`, '#ppt_w'),
    track('ppt_h', `${LARGE}#ppt_h`, '#ppt_h'),
  ]),
  effect('Basic Zoom · Out From Screen Bottom · as PowerPoint writes it', 'in', 23, [
    track('ppt_w', `${LARGE}#ppt_w`, '#ppt_w'),
    track('ppt_h', `${LARGE}#ppt_h`, '#ppt_h'),
    position('x', 0.5, '#ppt_x'),
    position('y', `1+${LARGE}#ppt_h/2`, '#ppt_y'),
  ]),
  effect('Basic Zoom · Out Slightly', 'in', 23, [
    track('ppt_w', '4/3*#ppt_w', '#ppt_w'),
    track('ppt_h', '4/3*#ppt_h', '#ppt_h'),
  ]),
  effect('Basic Zoom exit · In', 'out', 23, scale(1, 0)),
  effect('Basic Zoom exit · Out Slightly', 'out', 23, [
    track('ppt_w', '#ppt_w', '4/3*#ppt_w'),
    track('ppt_h', '#ppt_h', '4/3*#ppt_h'),
  ]),
];

const RUN3: readonly ComparisonSlide[] = [
  ...timed(
    [
      lasting('Basic Zoom exit · Out To Screen Bottom', 750),
      lasting('Basic Zoom exit · Out To Screen Bottom', 1000),
      lasting('Shape in · Circle Out', 2000),
      lasting('Shape out · Box In', 2000),
      ...motionScenes(ZOOM_OWN),
      ...transitionScenes(atLength(1000), 1000),
    ],
    24,
  ),
  ...timed(transitionScenes(atLength(2000), 2000), 26),
];

/** Every slide of the deck, in order: run 1's, then run 2's (their markers from 22, between run 1's), then run 3's. */
export const COMPARISON_SLIDES: readonly ComparisonSlide[] = [
  ...RUN1,
  ...timed(motionScenes(RUN2_MOTIONS), 22),
  ...RUN3,
];

/** One of the comparison's decks: its file in the run folder, its slide's size, the probe's grid, the box, its slides. */
export interface ComparisonDeck {
  /** Its name in the run folder. */
  file: string;
  /** The slide's size in EMU (presentation.xml's p:sldSz). */
  emu: { cx: number; cy: number };
  /** The probe's grid: 38,100 EMU a pixel (6 pixels of a 1080-line movie). */
  width: number;
  height: number;
  /** The red box every effect moves, on that grid. */
  box: Rect;
  slides: readonly ComparisonSlide[];
}

/** The wide (16:9) deck: runs 1, 2 and 3. */
export const COMPARISON_WIDE: ComparisonDeck = {
  file: 'Placeholder PowerPoint motion.pptx',
  emu: { cx: DECK_WIDTH, cy: DECK_HEIGHT },
  width: COMPARISON_WIDTH,
  height: COMPARISON_HEIGHT,
  box: COMPARISON_BOX,
  slides: COMPARISON_SLIDES,
};

const STANDARD_NAMES = [
  'Float In Up',
  'Grow/Shrink 150%',
  'Basic Zoom · In From Screen Center',
  'Basic Zoom · Out From Screen Bottom',
  'Basic Zoom · Out From Screen Bottom · as PowerPoint writes it',
  'Basic Zoom exit · Out',
  'Basic Zoom exit · In To Screen Center',
  'Basic Zoom exit · Out To Screen Bottom',
];

/**
 * Run 3's 4:3 deck (h-pptx3, Session 58): what may draw differently on a 4:3 slide. Basic Zoom to and from the
 * screen's centre and bottom (places on the slide), Shape's outlines (in the shape's own proportions, or the slide's?),
 * Push, Wipe, Cover and Uncover (PowerPoint's curves across and up or down differ on a 16:9 slide); Float and
 * Grow/Shrink as controls (exact on the wide deck). 700 ms each; markers from 20. The box as far left of the middle as
 * the wide deck's, the same size.
 */
export const COMPARISON_STANDARD: ComparisonDeck = {
  file: 'Placeholder PowerPoint motion 4x3.pptx',
  emu: STANDARD_EMU,
  width: Math.round(STANDARD_EMU.cx / EMU),
  height: COMPARISON_HEIGHT,
  box: {
    ...COMPARISON_BOX,
    x: COMPARISON_BOX.x - (COMPARISON_WIDTH - Math.round(STANDARD_EMU.cx / EMU)) / 2,
  },
  slides: timed(
    [
      ...motionScenes(STANDARD_NAMES.map((name) => byName([...MOTIONS, ...RUN2_MOTIONS, ...ZOOM_OWN], name))),
      ...motionScenes(RUN2_MOTIONS.filter((motion) => motion.name.startsWith('Shape '))),
      ...transitionScenes((name) => name),
    ],
    20,
  ),
};

function partOf(xml: string): TreeElement {
  const [part] = elementsOf(parseTree(xml));
  if (!part) throw new Error('Missing generated part');
  return part;
}

function setMotion(tree: TreeElement, motion: ComparisonMotion, duration: number): void {
  const [tn] = findAll(tree, (node) => node.name === 'p:cTn' && attrOf(node, 'presetClass') !== undefined);
  const list = childOf(tn, 'p:childTnLst');
  const visibility = childOf(list, 'p:set');
  const fade = childOf(list, 'p:animEffect');
  if (!tn || !list || !visibility || !fade) throw new Error(`Missing generated timing for ${motion.name}`);

  setAttr(tn, 'presetID', motion.preset);
  setAttr(tn, 'presetClass', { in: 'entr', out: 'exit', emphasis: 'emph' }[motion.phase]);
  if (motion.subtype !== undefined) setAttr(tn, 'presetSubtype', motion.subtype);
  if (motion.accel !== undefined) setAttr(tn, 'accel', motion.accel);
  if (motion.decel !== undefined) setAttr(tn, 'decel', motion.decel);

  let id = 1000;
  const behavior = (attr: string) =>
    `<p:cBhvr additive="base"><p:cTn id="${String(id++)}" dur="${String(duration)}" fill="hold"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>`;
  const value = (n: number | string) =>
    typeof n === 'number' ? `<p:fltVal val="${String(n)}"/>` : `<p:strVal val="${n}"/>`;
  const parts = motion.tracks.map(({ name, from, to }) =>
    partOf(
      `<p:anim calcmode="lin" valueType="num">${behavior(name)}<p:tavLst><p:tav tm="0"><p:val>${value(from)}</p:val></p:tav><p:tav tm="100000"><p:val>${value(to)}</p:val></p:tav></p:tavLst></p:anim>`,
    ),
  );
  if (motion.relativeScale !== undefined) {
    const amount = String(motion.relativeScale);
    parts.push(
      partOf(
        `<p:animScale zoomContents="1">${behavior('ppt_w')}<p:by x="${amount}" y="${amount}"/></p:animScale>`,
      ),
    );
  }
  if (motion.filter) {
    setAttr(fade, 'filter', motion.filter);
    parts.push(fade);
  }
  if (motion.phase === 'in') parts.unshift(visibility);
  if (motion.phase === 'out') parts.push(visibility);
  list.kids = parts;
}

/**
 * Write a deck (the wide one unless another is given) into `work` (its base deck beside it, `base.pptx`, or
 * `base 4x3.pptx` for the 4:3 one); returns its path.
 */
export async function writeComparisonDeck(
  work: string,
  deck: ComparisonDeck = COMPARISON_WIDE,
): Promise<string> {
  const wide = deck.emu.cx === DECK_WIDTH && deck.emu.cy === DECK_HEIGHT;
  const base = join(work, wide ? 'base.pptx' : 'base 4x3.pptx');
  const source = join(work, deck.file);
  await writeFile(
    base,
    makeTestDeck(
      deck.slides.map((scene) => ({
        key: scene.name,
        bg: scene.bg,
        notes: '',
        transition: { kind: scene.transition ? 'wipe' : '', dur: scene.transition ? scene.duration : 0 },
        shapes: [
          shape(90, gray(scene.marker), { x: 4, y: 4, width: 14, height: 14 }),
          ...(scene.motion ? [shape(2, 'F82828', deck.box)] : []),
          ...(scene.bg === RED ? [shape(3, 'FFFF38', deck.box)] : []),
          ...(scene.bg === BLUE ? [shape(4, '38FF38', deck.box)] : []),
        ],
        effects: scene.motion
          ? [
              {
                kind: scene.motion.phase === 'out' ? ('exit-fade' as const) : ('fade' as const),
                target: 2,
                dur: scene.duration,
                start: 'click' as const,
              },
            ]
          : [],
      })),
      placeholderDeckMedia(),
    ),
  );
  const entries = await readZipEntries(
    base,
    (name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name) || name === 'ppt/presentation.xml',
  );
  const replacements = new Map(
    deck.slides.map((scene, index): [string, Buffer] => {
      const name = `ppt/slides/slide${String(index + 1)}.xml`;
      const part = entries.get(name);
      if (!part) throw new Error(`Missing generated part ${name}`);
      const tree = parseTree(part.toString('utf8'));
      if (scene.motion) setMotion(tree, scene.motion, scene.duration);
      if (scene.transition) {
        const { kind, dir } = scene.transition;
        const tag = kind === 'uncover' ? 'pull' : kind;
        for (const node of findAll(tree, (item) => item.name === 'p:transition'))
          node.kids = [partOf(`<p:${tag} dir="${dir}"/>`)];
      }
      return [name, Buffer.from(writeTree(tree))];
    }),
  );
  if (!wide) {
    // Another slide size, as PowerPoint writes its own 4:3 (On-screen Show) deck.
    const presentation = entries.get('ppt/presentation.xml')?.toString('utf8') ?? '';
    const size = `<p:sldSz cx="${String(DECK_WIDTH)}" cy="${String(DECK_HEIGHT)}"/>`;
    if (!presentation.includes(size)) throw new Error('Missing generated slide size');
    const own = `<p:sldSz cx="${String(deck.emu.cx)}" cy="${String(deck.emu.cy)}"${
      deck.emu.cx === STANDARD_EMU.cx && deck.emu.cy === STANDARD_EMU.cy ? ' type="screen4x3"' : ''
    }/>`;
    replacements.set('ppt/presentation.xml', Buffer.from(presentation.replace(size, own)));
  }
  await copyZipReplacing(base, source, replacements);
  return source;
}
