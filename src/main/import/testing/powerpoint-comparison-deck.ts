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
 * Coloured boxes only, no words: one slide per effect and variant (Float in and out, Split in and out both ways, Grow &
 * Turn and Shrink & Turn, Grow/Shrink, a Fly with a smooth start and end, and Basic Zoom's In, Out, In Slightly, In From
 * Screen Center and Out From Screen Bottom), then Push, Wipe, Cover and Uncover in each direction, each after a
 * reference slide. Each slide carries a gray marker in its top left corner, 4 levels lighter than the slide before, so
 * a probe finds it in the movie. Each effect runs 700 ms from its click on a red 64 × 38 box at (94, 51) of a 320 ×
 * 180 slide.
 */

export const COMPARISON_WIDTH = 320;
export const COMPARISON_HEIGHT = 180;
export const COMPARISON_BOX = { x: 94, y: 51, width: 64, height: 38 };
const DURATION = 700;
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
    x: Math.round((rect.x * DECK_WIDTH) / COMPARISON_WIDTH),
    y: Math.round((rect.y * DECK_HEIGHT) / COMPARISON_HEIGHT),
    w: Math.round((rect.width * DECK_WIDTH) / COMPARISON_WIDTH),
    h: Math.round((rect.height * DECK_HEIGHT) / COMPARISON_HEIGHT),
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

const track = (name: string, from: number | string, to: number | string): ComparisonTrack => ({ name, from, to });
const scale = (from: number, to: number) =>
  ['ppt_w', 'ppt_h'].map((name) =>
    track(name, from === 0 ? 0 : `#${name}*${String(from)}`, to === 0 ? 0 : `#${name}*${String(to)}`),
  );
const position = (axis: 'x' | 'y', from: number | string, to: number | string) => track(`ppt_${axis}`, from, to);
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
  effect('Float Out Down', 'out', 47, [position('y', '#ppt_y', '#ppt_y+0.08')], { filter: 'fade', subtype: 1 }),
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

export type ComparisonDirection = 'left' | 'right' | 'up' | 'down';

export interface ComparisonSlide {
  name: string;
  bg: string;
  motion?: ComparisonMotion;
  transition?: { kind: 'push' | 'wipe' | 'cover' | 'uncover'; dir: string; direction: ComparisonDirection };
  /** The gray of its marker (each slide 4 lighter than the one before). */
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

/** Every slide of the deck, in order. */
export const COMPARISON_SLIDES: readonly ComparisonSlide[] = [
  ...MOTIONS.map((motion) => ({ name: motion.name, motion, bg: '292929' })),
  ...(['push', 'wipe', 'cover', 'uncover'] as const).flatMap((kind) =>
    DIRECTIONS.flatMap(([dir, direction]) => [
      { name: `Reference for ${kind} ${direction}`, bg: RED },
      { name: `${kind} ${direction}`, transition: { kind, dir, direction }, bg: BLUE },
    ]),
  ),
].map((scene, index) => ({
  ...scene,
  marker: 20 + 4 * index,
  duration: 'motion' in scene || 'transition' in scene ? DURATION : 0,
}));

function partOf(xml: string): TreeElement {
  const [part] = elementsOf(parseTree(xml));
  if (!part) throw new Error('Missing generated part');
  return part;
}

function setMotion(tree: TreeElement, motion: ComparisonMotion): void {
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
    `<p:cBhvr additive="base"><p:cTn id="${String(id++)}" dur="${String(DURATION)}" fill="hold"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>`;
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

/** Write the deck into `work` (its base deck beside it); returns its path. */
export async function writeComparisonDeck(work: string): Promise<string> {
  const base = join(work, 'base.pptx');
  const source = join(work, 'Placeholder PowerPoint motion.pptx');
  await writeFile(
    base,
    makeTestDeck(
      COMPARISON_SLIDES.map((scene) => ({
        key: scene.name,
        bg: scene.bg,
        notes: '',
        transition: { kind: scene.transition ? 'wipe' : '', dur: scene.transition ? DURATION : 0 },
        shapes: [
          shape(90, gray(scene.marker), { x: 4, y: 4, width: 14, height: 14 }),
          ...(scene.motion ? [shape(2, 'F82828', COMPARISON_BOX)] : []),
          ...(scene.bg === RED ? [shape(3, 'FFFF38', COMPARISON_BOX)] : []),
          ...(scene.bg === BLUE ? [shape(4, '38FF38', COMPARISON_BOX)] : []),
        ],
        effects: scene.motion
          ? [
              {
                kind: scene.motion.phase === 'out' ? ('exit-fade' as const) : ('fade' as const),
                target: 2,
                dur: DURATION,
                start: 'click' as const,
              },
            ]
          : [],
      })),
      placeholderDeckMedia(),
    ),
  );
  const entries = await readZipEntries(base, (name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
  const replacements = new Map(
    COMPARISON_SLIDES.map((scene, index): [string, Buffer] => {
      const name = `ppt/slides/slide${String(index + 1)}.xml`;
      const part = entries.get(name);
      if (!part) throw new Error(`Missing generated part ${name}`);
      const tree = parseTree(part.toString('utf8'));
      if (scene.motion) setMotion(tree, scene.motion);
      if (scene.transition) {
        const { kind, dir } = scene.transition;
        const tag = kind === 'uncover' ? 'pull' : kind;
        for (const node of findAll(tree, (item) => item.name === 'p:transition'))
          node.kids = [partOf(`<p:${tag} dir="${dir}"/>`)];
      }
      return [name, Buffer.from(writeTree(tree))];
    }),
  );
  await copyZipReplacing(base, source, replacements);
  return source;
}
