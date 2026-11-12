import type { DeckEffect } from '../../../shared/deck';
import { deckBackgroundTarget } from '../../../shared/deck-motion';
import type { XmlNode } from '../xml';
import { type NativePptxTransition, nativePptxTransition } from './pptx-native-transition';

/*
 * What a PowerPoint slide does, read from its own XML (Session 54, C2, from C1's trial: assister/session-54-deck-
 * trial.md, "How to take the videos and sounds out of a .pptx"): its transition and the transition's sound, the
 * main sequence's click groups and how long each runs as PowerPoint plays it, and its videos and sounds with their
 * place, poster, trims, fades, volume, loop and when they start. ECMA-376 Part 1 §19.5 (timing) and [MS-PPTX]'s
 * p14 media. A deck's slides are shown as it was from this: the timed copy (./timed-copy.ts) chains the groups,
 * the cut (./cut.ts) finds them in the movie, and the deck's media become real media.
 *
 * Where a file holds both a newer form and its fallback (mc:AlternateContent), the newer one is read (p14's
 * transitions and their lengths), as PowerPoint 2010 and later read it.
 */

/** The deck's own transition into a slide. */
export interface PptxTransition {
  /** Its effect's name in the file (`p:fade`, `p:push`, `p14:vortex`, `p159:morph`), or '' for none (a cut). */
  name: string;
  durationMs: number;
  /** Its sound: a part of the deck (ppt/media/audio1.wav), and whether it loops until the next sound. */
  sound: { part: string; loop: boolean } | null;
  /** The deck's own "after N s" (advTm), or null. */
  advanceMs: number | null;
  /** Whole-slide motion to play without a baked clip, and whether it approximates the source. */
  native?: NativePptxTransition;
}

/** One group of the main sequence: what one click does (or what runs by itself as the slide comes in). */
export interface PptxGroup {
  /** It waits for a click; false for the first group when it starts with the slide. */
  byClick: boolean;
  /** How long it runs as PowerPoint plays it, its videos and sounds starting aside (ms). */
  lengthMs: number;
  /** It only starts videos or sounds: nothing in it moves. */
  mediaOnly: boolean;
  /** One turn of an effect in it that repeats until the slide ends (a spin), in ms; null for none. */
  repeatsMs: number | null;
  /** One turn of an effect in it that repeats until the next click (Session 54, C review), in ms; null for none. */
  untilClickMs: number | null;
}

/** When one of the slide's videos or sounds starts. */
export type PptxMediaStart =
  /** With a group of the main sequence (its index), this long after the group starts. */
  | { group: number; offsetMs: number }
  /** When its shape is clicked (a trigger), or by its own play button: never by Next. */
  | { clicked: true };

/** One of the slide's videos or sounds. */
export interface PptxMedia {
  kind: 'video' | 'audio';
  /** Its shape's id and name on the slide. */
  shapeId: string;
  name: string;
  /** Its file inside the deck (ppt/media/media1.mp4), or null when it is linked from outside it. */
  part: string | null;
  /** A linked file outside the deck: the path or file URL the deck names, or null. */
  link: string | null;
  /** Where it sits, as fractions of the slide's width and height. */
  box: { x: number; y: number; w: number; h: number };
  /** The picture shown before it plays (a part of the deck), or null. */
  poster: string | null;
  /** PowerPoint's trims: ms cut from its start, and ms cut from its END (p14:trim's `end`). */
  trim: { startMs: number; endMs: number } | null;
  fadeInMs: number;
  fadeOutMs: number;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  loop: boolean;
  start: PptxMediaStart;
  /** It plays on across this many slides (numSld), or null for its own. */
  acrossSlides: number | null;
  /** Hidden while it is not playing (showWhenStopped="0"). */
  hideWhenStopped: boolean;
  /** The group of its first entrance animation, before which it is not there (C review); null for none. */
  enterGroup: number | null;
  /** The group of its first exit animation, from which it is gone; null for none. */
  exitGroup: number | null;
}

export interface PptxDeckSlide {
  transition: PptxTransition | null;
  groups: PptxGroup[];
  media: PptxMedia[];
  /** Effects that run when a shape is clicked (a trigger's own sequence), videos' and sounds' starts aside. */
  triggers: number;
  /** Effects Drashti can play on editable shapes, and whether the original needs a movie when available. */
  motion?: { effects: DeckEffect[]; approximate: boolean };
}

/** A relationship of the slide's: its type and target (a part's path, or a link's own text when External). */
export interface SlideRel {
  type: string;
  target: string;
  external: boolean;
}

/** The slide's size in EMU (presentation.xml's p:sldSz). */
export interface SlideSize {
  cx: number;
  cy: number;
}

// ---- walking the tree ------------------------------------------------------------------------------

/** Children, with mc:AlternateContent read as its first choice (its fallback left out). */
function kids(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  for (const c of node.children) {
    if (c.name === 'mc:AlternateContent') {
      const choice =
        c.children.find((x) => x.name === 'mc:Choice') ?? c.children.find((x) => x.name === 'mc:Fallback');
      if (choice) out.push(...kids(choice));
    } else out.push(c);
  }
  return out;
}

const kid = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node ? kids(node).find((c) => c.name === name) : undefined;

/** No node: for a list that is not there. */
const NONE: XmlNode = { name: '', attrs: {}, children: [], text: '' };

function all(node: XmlNode, test: (n: XmlNode) => boolean, out: XmlNode[] = []): XmlNode[] {
  for (const c of kids(node)) {
    if (test(c)) out.push(c);
    all(c, test, out);
  }
  return out;
}

const num = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** A timing node's start delay (its first numeric `p:stCondLst/p:cond@delay`), 0 when none or "indefinite". */
function delayOf(cTn: XmlNode | undefined): number {
  for (const cond of kids(kid(cTn, 'p:stCondLst') ?? NONE))
    if (cond.name === 'p:cond') {
      const d = num(cond.attrs['delay']);
      if (d !== null) return Math.max(0, d);
    }
  return 0;
}

/** The cTn of a timing element: its own (p:par, p:seq) or its behaviour's (p:set, p:anim..., p:cmd). */
function cTnOf(node: XmlNode): XmlNode | undefined {
  return kid(node, 'p:cTn') ?? kid(kid(node, 'p:cBhvr'), 'p:cTn') ?? kid(kid(node, 'p:cMediaNode'), 'p:cTn');
}

/** An effect that starts a video or sound (its preset class is "mediacall"). */
const isMediaCall = (par: XmlNode) => kid(par, 'p:cTn')?.attrs['presetClass'] === 'mediacall';

/**
 * How long a timing node runs once started, its own delay aside (ms): its own `dur`, or its children's longest
 * (one after another in a p:seq), times its repeats and twice over when it plays back (`autoRev`). An endless
 * repeat counts one turn. Videos' and sounds' starts count nothing when `skipMedia` (the timed copy has none).
 */
function runLength(node: XmlNode, skipMedia: boolean): number {
  const cTn = cTnOf(node);
  if (!cTn) return 0;
  const repeat = cTn.attrs['repeatCount'];
  const times = repeat === undefined || repeat === 'indefinite' ? 1 : (num(repeat) ?? 1000) / 1000;
  const back = cTn.attrs['autoRev'] === '1' || cTn.attrs['autoRev'] === 'true' ? 2 : 1;
  const own = num(cTn.attrs['dur']);
  let base = 0;
  if (own !== null) base = own;
  else {
    const list = kid(cTn, 'p:childTnLst');
    const children = list
      ? kids(list).filter((c) => !(skipMedia && c.name === 'p:par' && isMediaCall(c)))
      : [];
    for (const c of children) {
      const span = delayOf(cTnOf(c)) + runLength(c, skipMedia);
      base = node.name === 'p:seq' ? base + span : Math.max(base, span);
    }
  }
  return Math.max(0, base * times * back);
}

/** Every effect (a p:par with a preset class) in a group, with when it starts within the group (ms). */
function effectsOf(group: XmlNode): { par: XmlNode; atMs: number }[] {
  const out: { par: XmlNode; atMs: number }[] = [];
  const visit = (par: XmlNode, at: number) => {
    const cTn = kid(par, 'p:cTn');
    if (!cTn) return;
    const start = at + delayOf(cTn);
    if (cTn.attrs['presetClass'] !== undefined) {
      out.push({ par, atMs: start });
      return;
    }
    for (const c of kids(kid(cTn, 'p:childTnLst') ?? NONE)) if (c.name === 'p:par') visit(c, start);
  };
  // The group's own delay is its click ("indefinite"): its sub-groups' delays count from the click.
  for (const c of kids(kid(kid(group, 'p:cTn'), 'p:childTnLst') ?? NONE)) if (c.name === 'p:par') visit(c, 0);
  return out;
}

/** The shape an effect works on (its behaviours' first target). */
function targetOf(par: XmlNode): string | null {
  const tgt = all(par, (n) => n.name === 'p:spTgt')[0];
  return tgt?.attrs['spid'] ?? null;
}

/** Whether a group waits for a click: every group does but a first one that begins with the slide. */
function waitsForClick(group: XmlNode): boolean {
  const conds = kids(kid(kid(group, 'p:cTn'), 'p:stCondLst') ?? NONE);
  if (conds.some((c) => c.attrs['evt'] === 'onBegin')) return false;
  return conds.some((c) => c.attrs['delay'] === 'indefinite');
}

/** The main sequence's groups (each a p:par of its cTn's childTnLst), in order. */
export function mainGroups(timing: XmlNode | undefined): XmlNode[] {
  if (!timing) return [];
  const main = all(timing, (n) => n.name === 'p:cTn' && n.attrs['nodeType'] === 'mainSeq')[0];
  const list = kid(main, 'p:childTnLst');
  return list ? kids(list).filter((c) => c.name === 'p:par') : [];
}

// ---- the transition ---------------------------------------------------------------------------------

/** PowerPoint's own lengths for a transition's speed (ECMA-376 §19.7.66: fast is the default). */
const SPEED_MS: Record<string, number> = { fast: 500, med: 750, slow: 1000 };

function readTransition(sld: XmlNode, rels: ReadonlyMap<string, SlideRel>): PptxTransition | null {
  const t = kid(sld, 'p:transition');
  if (!t) return null;
  const effect = kids(t).find((c) => c.name !== 'p:sndAc' && c.name !== 'p:extLst');
  const p14 = num(t.attrs['p14:dur']) ?? num(t.attrs['dur']);
  const durationMs = effect ? Math.round(p14 ?? SPEED_MS[t.attrs['spd'] ?? 'fast'] ?? 500) : 0;
  const native = nativePptxTransition(effect, durationMs);
  const stSnd = kid(kid(t, 'p:sndAc'), 'p:stSnd');
  const snd = kid(stSnd, 'p:snd');
  const rel = snd ? rels.get(snd.attrs['r:embed'] ?? '') : undefined;
  return {
    name: effect?.name ?? '',
    durationMs,
    sound: rel && !rel.external ? { part: rel.target, loop: stSnd?.attrs['loop'] === '1' } : null,
    advanceMs: num(t.attrs['advTm']),
    ...(native ? { native } : {}),
  };
}

// ---- the groups -------------------------------------------------------------------------------------

function readGroups(timing: XmlNode | undefined): PptxGroup[] {
  return mainGroups(timing).map((group) => {
    const effects = effectsOf(group);
    const seen = effects.filter((e) => !isMediaCall(e.par));
    // Its length as the timed copy plays it: each sub-group's start and its effects, videos and sounds aside.
    const lengthMs = Math.round(
      seen.reduce((longest, e) => Math.max(longest, e.atMs + runLength(e.par, true)), 0),
    );
    const endless = seen.filter((e) => kid(e.par, 'p:cTn')?.attrs['repeatCount'] === 'indefinite');
    // "Until Next Click": an endless repeat that ends at the next click (its end condition), not with the slide.
    const untilClick = (e: { par: XmlNode }) =>
      kids(kid(kid(e.par, 'p:cTn'), 'p:endCondLst') ?? NONE).some((c) => c.attrs['evt'] === 'onNext');
    const turnOf = (list: { par: XmlNode }[]) =>
      list.reduce((longest, e) => Math.max(longest, runLength(e.par, true)), 0);
    const toEnd = endless.filter((e) => !untilClick(e));
    const toClick = endless.filter(untilClick);
    return {
      byClick: waitsForClick(group),
      lengthMs,
      mediaOnly: seen.length === 0,
      repeatsMs: toEnd.length > 0 && turnOf(toEnd) > 0 ? Math.round(turnOf(toEnd)) : null,
      untilClickMs: toClick.length > 0 && turnOf(toClick) > 0 ? Math.round(turnOf(toClick)) : null,
    };
  });
}

// ---- shape animations -------------------------------------------------------------------------------

interface TimeWindow {
  start: number;
  end: number | null;
}

interface NativeSchedule {
  step: number;
  windows: Map<string, TimeWindow>;
  byNode: Map<XmlNode, TimeWindow>;
  effects: DeckEffect[];
  approximate: boolean;
}

const VISUAL_BEHAVIOURS = new Set([
  'p:set',
  'p:anim',
  'p:animEffect',
  'p:animMotion',
  'p:animScale',
  'p:animRot',
  'p:animClr',
]);
const EFFECT_NODE_TYPES = new Set(['clickEffect', 'withEffect', 'afterEffect']);

function nativeStart(tn: XmlNode, at: number, schedule: NativeSchedule): number {
  const conditions = kids(kid(tn, 'p:stCondLst') ?? NONE);
  if (conditions.length === 0) return at;

  // A par's children share its clock. PowerPoint encodes After Previous in a new delayed par.
  let first = Infinity;
  for (const cond of conditions) {
    const delay = num(cond.attrs['delay']);
    if (delay === null) continue;
    const evt = cond.attrs['evt'];
    const id = kid(cond, 'p:tn')?.attrs['val'];
    const window = id === undefined ? undefined : schedule.windows.get(id);
    const base =
      evt === undefined ? at : evt === 'onBegin' ? window?.start : evt === 'onEnd' ? window?.end : null;
    if (base == null) schedule.approximate = true;
    else first = Math.min(first, base + Math.max(0, delay));
  }
  if (first !== Infinity) return first;
  schedule.approximate = true;
  return at;
}

/**
 * An effect as Drashti draws it. `partial`: drawn by Drashti but not yet compared with PowerPoint's own movie, so a
 * slide using it keeps PowerPoint's video wherever one can be made, and Drashti plays it where none can.
 */
type NativeLook = Pick<
  DeckEffect,
  | 'kind'
  | 'direction'
  | 'verticalDirection'
  | 'degrees'
  | 'fade'
  | 'distance'
  | 'splitAxis'
  | 'scale'
  | 'shape'
  | 'inward'
  | 'spokes'
  | 'bars'
> & { partial?: true };
type Direction = NonNullable<DeckEffect['direction']>;

const FLY_FROM = new Map<string, Direction>([
  ['1', 'down'],
  ['2', 'left'],
  ['4', 'up'],
  ['8', 'right'],
]);
const DIAGONAL_FLY = new Set(['3', '6', '9', '12']);
const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  left: 'right',
  up: 'down',
  right: 'left',
};
const WIPE = new Map<string, Direction>([
  ['wipe(down)', 'down'],
  ['wipe(left)', 'left'],
  ['wipe(up)', 'up'],
  ['wipe(right)', 'right'],
]);

/** A pair of linear coordinates at the start and end of one animation behaviour. */
function animationValues(behaviour: XmlNode): [string, string] | null {
  const mode = behaviour.attrs['calcmode'];
  if (mode !== undefined && mode !== 'lin') return null;
  const values = kids(kid(behaviour, 'p:tavLst') ?? NONE);
  const [first, last] = values;
  if (
    values.length !== 2 ||
    first?.attrs['tm'] !== '0' ||
    last?.attrs['tm'] !== '100000' ||
    first.attrs['fmla'] ||
    last.attrs['fmla']
  )
    return null;
  const value = (n: XmlNode) => {
    const held = kid(n, 'p:val');
    const written = kid(held, 'p:strVal') ?? kid(held, 'p:fltVal') ?? kid(held, 'p:intVal');
    return written?.attrs['val']?.replace(/\s+/gu, '');
  };
  const from = value(first);
  const to = value(last);
  return from !== undefined && to !== undefined ? [from, to] : null;
}

function animationProperty(behaviour: XmlNode): string | undefined {
  return kid(kid(kid(behaviour, 'p:cBhvr'), 'p:attrNameLst'), 'p:attrName')?.text.trim();
}

/** A diagonal Fly has one linear track per axis, with the object's far edge outside the slide. */
function diagonalFly(behaviours: readonly XmlNode[], entering: boolean): NativeLook | null {
  const tracks = behaviours.filter((node) => node.name === 'p:anim');
  if (tracks.length !== 2) return null;
  const fromEdge = (axis: 'x' | 'y', extent: 'w' | 'h') => {
    const track = tracks.find((node) => animationProperty(node) === `ppt_${axis}`);
    const points = track ? animationValues(track) : null;
    if (!points) return null;
    const [away, rest] = entering ? points : [points[1], points[0]];
    if (rest !== `#ppt_${axis}`) return null;
    const half = `#ppt_${extent}/2`;
    if (away === `-${half}` || away === `0-${half}`) return 'min';
    if (away === `1+${half}`) return 'max';
    return null;
  };
  const horizontal = fromEdge('x', 'w');
  const vertical = fromEdge('y', 'h');
  if (!horizontal || !vertical) return null;
  return {
    kind: 'fly',
    direction: (horizontal === 'min') === entering ? 'right' : 'left',
    verticalDirection: (vertical === 'min') === entering ? 'down' : 'up',
  };
}

function uniformScale(point: XmlNode | undefined): number | null {
  const x = num(point?.attrs['x']);
  const y = num(point?.attrs['y']);
  return x !== null && x === y && x >= 0 && x <= 1_000_000 ? x / 100_000 : null;
}

function zoomLimit(behaviours: readonly XmlNode[], entering: boolean): number | null {
  const scales = behaviours.filter((node) => node.name === 'p:animScale' || node.name === 'p:anim');
  const [first] = scales;
  if (scales.length === 1 && first?.name === 'p:animScale') {
    const from = uniformScale(kid(first, 'p:from'));
    const to = uniformScale(kid(first, 'p:to'));
    return (entering ? to : from) === 1 ? (entering ? from : to) : null;
  }
  const dimensions = new Map<string, number>();
  for (const node of scales) {
    const property = animationProperty(node);
    const points = animationValues(node);
    if (!points || (property !== 'ppt_w' && property !== 'ppt_h')) return null;
    const base = `#${property}`;
    const [small, full] = entering ? points : [points[1], points[0]];
    if (full !== base || dimensions.has(property)) return null;
    const factor =
      small === '0'
        ? 0
        : small.startsWith(`${base}*`)
          ? num(small.slice(base.length + 1))
          : small.endsWith(`*${base}`)
            ? num(small.replace(`*${base}`, ''))
            : null;
    if (factor === null || factor < 0 || factor > 10) return null;
    dimensions.set(property, factor);
  }
  const width = dimensions.get('ppt_w');
  return width !== undefined && dimensions.get('ppt_h') === width ? width : null;
}

function floatLook(behaviours: readonly XmlNode[], entering: boolean): NativeLook | null {
  const movement = behaviours.filter((node) => node.name === 'p:anim');
  let look: NativeLook | null = null;
  for (const node of movement) {
    const property = animationProperty(node);
    const points = animationValues(node);
    if (!points || (property !== 'ppt_x' && property !== 'ppt_y')) return null;
    const [away, rest] = entering ? points : [points[1], points[0]];
    const origin = `#${property}`;
    if (rest !== origin || !away.startsWith(origin)) return null;
    if (away === origin) continue;
    const offset = away.slice(origin.length);
    if (!/^[+-](?:\d+\.?\d*|\.\d+)$/u.test(offset)) return null;
    const displacement = Number(offset) * (entering ? -1 : 1);
    const distance = Math.abs(displacement);
    if (distance === 0) continue;
    if (distance > 1 || look) return null;
    const direction =
      property === 'ppt_x' ? (displacement < 0 ? 'left' : 'right') : displacement < 0 ? 'up' : 'down';
    // As PowerPoint's own movie shows it (13 Nov 2026): its straight move and even fade, within half a pixel.
    look = { kind: 'float', direction, distance };
  }
  return look;
}

/** A turn's degrees from where it starts to where the shape rests (an entrance), or the other way (an exit). */
function turnOf(track: XmlNode | undefined, entering: boolean): number | null {
  const points = track ? animationValues(track) : null;
  if (!points) return null;
  const [away, rest] = entering ? points : [points[1], points[0]];
  const from = num(away);
  const to = num(rest);
  return from !== null && to !== null && Math.abs(from - to) <= 3600 ? from - to : null;
}

/**
 * Grow & Turn (Shrink & Turn as it leaves): the gallery Zoom's scale and fade, turning as it grows. As PowerPoint writes
 * it, it plays as PowerPoint's own movie shows it (13 Nov 2026: within half a pixel and a degree); a size or turn Drashti
 * cannot read is drawn the closest way.
 */
function growAndTurn(behaviours: readonly XmlNode[], entering: boolean): NativeLook {
  const turns = behaviours.filter(
    (node) => node.name === 'p:anim' && animationProperty(node) === 'style.rotation',
  );
  const scale = zoomLimit(
    behaviours.filter((node) => !turns.includes(node)),
    entering,
  );
  const degrees = turns.length === 1 ? turnOf(turns[0], entering) : null;
  return scale === null || degrees === null
    ? { kind: 'zoom', fade: true, partial: true }
    : { kind: 'zoom', fade: true, scale, ...(degrees === 0 ? {} : { degrees }) };
}

const OUTLINES = ['circle', 'box', 'diamond', 'plus'] as const;
const RANDOM_BARS = new Map<string, NonNullable<DeckEffect['bars']>>([
  ['randombar(horizontal)', 'horizontal'],
  ['randombar(vertical)', 'vertical'],
]);
/** Split out from the middle and in from both edges. Not yet compared with PowerPoint's own movie. */
const SPLITS = new Map<string, NativeLook>([
  ['barn(outvertical)', { kind: 'split', splitAxis: 'x', partial: true }],
  ['barn(outhorizontal)', { kind: 'split', splitAxis: 'y', partial: true }],
  ['barn(invertical)', { kind: 'split', splitAxis: 'x', inward: true, partial: true }],
  ['barn(inhorizontal)', { kind: 'split', splitAxis: 'y', inward: true, partial: true }],
]);

/**
 * Office's own reveal filters (ECMA-376 §19.5.3) that Drashti draws as clips: Shape's circle, box, diamond and plus,
 * Wheel's spokes and Random Bars. Not yet compared with PowerPoint's own movie, so a slide using one keeps PowerPoint's
 * video wherever one can be made, and plays these where none can.
 */
function filterLook(filter: string | undefined): NativeLook | null {
  if (!filter) return null;
  const outline = OUTLINES.find((shape) => filter === `${shape}(in)` || filter === `${shape}(out)`);
  if (outline)
    return {
      kind: 'shape',
      shape: outline,
      ...(filter.endsWith('(in)') ? { inward: true } : {}),
      partial: true,
    };
  const wheel = /^wheel\(([12348])\)$/u.exec(filter);
  if (wheel) return { kind: 'wheel', spokes: Number(wheel[1]), partial: true };
  const bars = RANDOM_BARS.get(filter);
  return bars ? { kind: 'bars', bars, partial: true } : null;
}

function nativeLook(
  tn: XmlNode,
  phase: DeckEffect['phase'],
  behaviours: readonly XmlNode[],
): NativeLook | null {
  const preset = tn.attrs['presetID'];
  if (phase === 'emphasis') {
    const rot = behaviours.find((n) => n.name === 'p:animRot');
    const degrees = num(rot?.attrs['by']);
    if (tn.attrs['presetClass'] !== 'emph') return null;
    if (preset === '8' && degrees !== null) return { kind: 'spin', degrees: degrees / 60_000 };
    if (preset === '6') {
      const scale = behaviours.find((node) => node.name === 'p:animScale');
      const amount = uniformScale(kid(scale, 'p:by'));
      if (
        amount !== null &&
        amount > 0 &&
        kid(scale, 'p:from') === undefined &&
        kid(scale, 'p:to') === undefined &&
        cTnOf(scale ?? NONE)?.attrs['fill'] !== 'remove'
      )
        // As PowerPoint's own movie shows it (13 Nov 2026): an even scale about its centre, within half a pixel.
        return { kind: 'grow-shrink', scale: amount };
    }
    return null;
  }
  if (tn.attrs['presetClass'] !== 'entr' && tn.attrs['presetClass'] !== 'exit') return null;
  const filter = behaviours
    .find((n) => n.name === 'p:animEffect')
    ?.attrs['filter']?.trim()
    .toLowerCase();
  if (preset === '1' && behaviours.some((n) => n.name === 'p:set')) return { kind: 'appear' };
  if (preset === '10' && filter === 'fade') return { kind: 'fade' };
  if (preset === '2') {
    const subtype = tn.attrs['presetSubtype'] ?? '';
    if (DIAGONAL_FLY.has(subtype)) return diagonalFly(behaviours, phase === 'in');
    const direction = FLY_FROM.get(subtype);
    return direction ? { kind: 'fly', direction: phase === 'out' ? OPPOSITE[direction] : direction } : null;
  }
  if (preset === '22') {
    const direction = WIPE.get(filter ?? '');
    return direction ? { kind: 'wipe', direction } : null;
  }
  if (preset === '23' && behaviours.some((n) => n.name === 'p:anim' || n.name === 'p:animScale'))
    // Basic Zoom: drawn as a zoom from nothing where the shape stands (back to nothing as it leaves), exact only
    // when that is all its behaviours say. Out, In Slightly, From Screen Center and Out From Screen Bottom start
    // from another size or move: not yet compared with PowerPoint's own movie.
    return zoomLimit(behaviours, phase === 'in') === 0 ? { kind: 'zoom' } : { kind: 'zoom', partial: true };
  if (preset === '53' && filter === 'fade') {
    const scale = zoomLimit(behaviours, phase === 'in');
    return scale === null ? { kind: 'zoom', fade: true, partial: true } : { kind: 'zoom', fade: true, scale };
  }
  if ((preset === '42' || preset === '47') && filter === 'fade') return floatLook(behaviours, phase === 'in');
  if (preset === '16') return SPLITS.get(filter ?? '') ?? null;
  if (preset === '31' && filter === 'fade') return growAndTurn(behaviours, phase === 'in');
  // Bounce's own path (its falls and squashes) is not read: Drashti drops the shape in with a bounce of its own.
  if (preset === '26') return { kind: 'bounce', partial: true };
  return filterLook(filter);
}

const PLAYED_BEHAVIOURS: Record<DeckEffect['kind'], readonly string[]> = {
  appear: ['p:set'],
  fade: ['p:animEffect'],
  fly: ['p:anim'],
  wipe: ['p:animEffect'],
  zoom: ['p:anim', 'p:animScale'],
  spin: ['p:animRot'],
  pulse: [],
  float: ['p:anim', 'p:animEffect'],
  split: ['p:animEffect'],
  'grow-shrink': ['p:animScale'],
  shape: ['p:animEffect'],
  wheel: ['p:animEffect'],
  bars: ['p:animEffect'],
  bounce: ['p:anim', 'p:animEffect', 'p:animScale', 'p:animMotion', 'p:animRot'],
};

/** Repeats, playing back, an early end, or text built word by word or letter by letter (p:iterate). */
function unsupportedTiming(tn: XmlNode): boolean {
  const { repeatCount, repeatDur, autoRev } = tn.attrs;
  return (
    (repeatCount !== undefined && repeatCount !== '1000') ||
    repeatDur !== undefined ||
    autoRev === '1' ||
    autoRev === 'true' ||
    kid(tn, 'p:endCondLst') !== undefined ||
    kid(tn, 'p:iterate') !== undefined
  );
}

/** A timing node's smooth start and smooth end (accel, decel), as shares of its duration. */
function easeOf(tn: XmlNode): [number, number] {
  const share = (value: string | undefined) => Math.min(1, Math.max(0, num(value) ?? 0) / 100_000);
  return [share(tn.attrs['accel']), share(tn.attrs['decel'])];
}

/** An effect's smooth start and end: its own, or the one all its behaviours share; null when they differ. */
function smoothing(tn: XmlNode, behaviours: readonly XmlNode[]): [number, number] | null {
  const own = easeOf(tn);
  const inner = behaviours.flatMap((behaviour) => {
    const clock = cTnOf(behaviour);
    return clock && clock !== tn ? [easeOf(clock)] : [];
  });
  const [first] = inner;
  if (!first || inner.every(([a, d]) => a === 0 && d === 0)) return own[0] + own[1] <= 1 ? own : null;
  if (own[0] > 0 || own[1] > 0) return null;
  return first[0] + first[1] <= 1 && inner.every(([a, d]) => a === first[0] && d === first[1]) ? first : null;
}

/** Each paragraph range (first and last, from 0) a text effect's targets name, joined; null for anything else. */
function paragraphRange(targets: readonly XmlNode[]): [number, number] | null {
  let first = Infinity;
  let last = -Infinity;
  for (const target of targets) {
    const range = kid(kid(target, 'p:txEl'), 'p:pRg');
    const from = num(range?.attrs['st']);
    const to = num(range?.attrs['end']);
    if (from === null || to === null || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
    if (from < 0 || to < from || to > 9999) return null;
    first = Math.min(first, from);
    last = Math.max(last, to);
  }
  return Number.isFinite(first) ? [first, last] : null;
}

/** Office writes a visibility set alongside a fade or move, at its first or last frame. */
function matchesVisibilitySet(
  behaviour: XmlNode,
  clock: TimeWindow | undefined,
  phase: DeckEffect['phase'],
  start: number,
  end: number,
): boolean {
  const value = kid(kid(behaviour, 'p:to'), 'p:strVal')?.attrs['val'];
  if (
    animationProperty(behaviour) !== 'style.visibility' ||
    clock?.end == null ||
    clock.end - clock.start !== 1
  )
    return false;
  if (phase === 'in') return value === 'visible' && clock.start === start;
  return phase === 'out' && value === 'hidden' && (clock.start === end || clock.end === end);
}

function addNativeEffect(node: XmlNode, tn: XmlNode, window: TimeWindow, schedule: NativeSchedule): void {
  const behaviours = [
    ...(VISUAL_BEHAVIOURS.has(node.name) ? [node] : []),
    ...all(node, (n) => VISUAL_BEHAVIOURS.has(n.name)),
  ];
  const targets = behaviours.flatMap((behaviour) =>
    kids(kid(kid(behaviour, 'p:cBhvr'), 'p:tgtEl') ?? NONE).filter((target) => target.name === 'p:spTgt'),
  );
  const shapeId = targets[0]?.attrs['spid'];
  if (!shapeId || targets.some((target) => target.attrs['spid'] !== shapeId)) {
    schedule.approximate = true;
    return;
  }
  const subtarget = targets.some((target) => kids(target).length > 0);
  const textRange = targets.some((target) => kid(target, 'p:txEl') !== undefined);
  const background = !textRange && targets.some((target) => kid(target, 'p:bg') !== undefined);
  const cls = tn.attrs['presetClass'];
  const transition = behaviours.find((n) => n.name === 'p:animEffect')?.attrs['transition'];
  const phase =
    subtarget && !textRange && !background
      ? 'emphasis'
      : cls === 'entr'
        ? 'in'
        : cls === 'exit'
          ? 'out'
          : cls === undefined && (transition === 'in' || transition === 'out')
            ? transition
            : 'emphasis';
  const paragraphs = textRange && phase !== 'emphasis' ? paragraphRange(targets) : null;
  const native = subtarget && !paragraphs && !background ? null : nativeLook(tn, phase, behaviours);
  // A paragraph build shows or hides each paragraph by itself: at once for Appear, anything else as a fade.
  const selected: NativeLook = paragraphs
    ? { kind: native?.kind === 'appear' ? 'appear' : 'fade' }
    : (native ?? { kind: phase === 'emphasis' ? 'pulse' : 'fade' });
  const { partial, ...look } = selected;
  const played =
    look.kind === 'zoom' && look.fade
      ? [...PLAYED_BEHAVIOURS.zoom, 'p:animEffect']
      : PLAYED_BEHAVIOURS[look.kind];
  const clocks = behaviours
    .filter((b) => played.includes(b.name))
    .map((b) => schedule.byNode.get(b))
    .filter((clock) => clock !== undefined);
  const start = clocks.length > 0 ? Math.min(...clocks.map((w) => w.start)) : window.start;
  const end = clocks.length > 0 ? Math.max(...clocks.map((w) => w.end ?? w.start)) : (window.end ?? start);
  const delayMs = Math.round(start);
  const durationMs = look.kind === 'appear' ? 0 : Math.round(end - start);
  if (!Number.isSafeInteger(delayMs) || !Number.isSafeInteger(durationMs)) {
    schedule.approximate = true;
    return;
  }
  const ease = smoothing(
    tn,
    behaviours.filter((b) => b.name !== 'p:set' && played.includes(b.name)),
  );
  if (
    !native ||
    partial ||
    background ||
    paragraphs ||
    !ease ||
    // A smooth start or end is played with PowerPoint's own ramps (shared/deck-motion.ts, smoothedProgress), compared
    // with its movie for a Fly (13 Nov 2026); any other effect so eased keeps PowerPoint's video until its own is.
    ((ease[0] > 0 || ease[1] > 0) && look.kind !== 'fly') ||
    durationMs < 0 ||
    (durationMs === 0 && look.kind !== 'appear') ||
    behaviours.some(
      (b) =>
        !played.includes(b.name) &&
        (b.name !== 'p:set' || !matchesVisibilitySet(b, schedule.byNode.get(b), phase, start, end)),
    ) ||
    clocks.some((w) => w.start !== start || w.end !== end)
  )
    schedule.approximate = true;
  const effect: DeckEffect = {
    shapeId: background ? deckBackgroundTarget(shapeId) : shapeId,
    step: schedule.step,
    phase,
    ...look,
    delayMs,
    durationMs: Math.max(0, durationMs),
    ...(ease && ease[0] > 0 ? { accel: ease[0] } : {}),
    ...(ease && ease[1] > 0 ? { decel: ease[1] } : {}),
    ...(paragraphs ? { paragraphs } : {}),
  };
  schedule.effects.push(effect);
}

/** Resolve time-node references and parallel/serial delays relative to this click. */
function scheduleNative(
  node: XmlNode,
  at: number,
  schedule: NativeSchedule,
  insideEffect = false,
  click = false,
): TimeWindow {
  const tn = cTnOf(node);
  if (!tn) return { start: at, end: at };
  const start = click ? at : nativeStart(tn, at, schedule);
  const window: TimeWindow = { start, end: null };
  const id = tn.attrs['id'];
  if (id !== undefined) schedule.windows.set(id, window);
  if (isMediaCall(node)) {
    window.end = start;
    return window;
  }

  schedule.byNode.set(node, window);
  const effect =
    !insideEffect &&
    (tn.attrs['presetClass'] !== undefined ||
      EFFECT_NODE_TYPES.has(tn.attrs['nodeType'] ?? '') ||
      VISUAL_BEHAVIOURS.has(node.name));
  let end = start;
  for (const child of kids(kid(tn, 'p:childTnLst') ?? NONE)) {
    const timed = scheduleNative(
      child,
      node.name === 'p:seq' ? end : start,
      schedule,
      insideEffect || effect,
    );
    end = Math.max(end, timed.end ?? timed.start);
  }

  const duration = num(tn.attrs['dur']);
  window.end = duration === null ? end : start + Math.max(0, duration);
  const [accel, decel] = easeOf(tn);
  // An effect's own smooth start and end, and its behaviours', are played; any other node's are not.
  if ((accel > 0 || decel > 0) && !effect && !(insideEffect && VISUAL_BEHAVIOURS.has(node.name)))
    schedule.approximate = true;
  if (unsupportedTiming(tn)) {
    schedule.approximate = true;
    window.end = start + runLength(node, true);
  }
  if (effect) addNativeEffect(node, tn, window, schedule);
  return window;
}

function readNativeMotion(timing: XmlNode | undefined): PptxDeckSlide['motion'] {
  if (!timing) return undefined;
  const visual = all(timing, (n) => VISUAL_BEHAVIOURS.has(n.name));
  if (visual.length === 0) return undefined;
  const anchors = all(
    timing,
    (n) => n.name === 'p:cTn' && (n.attrs['nodeType'] === 'tmRoot' || n.attrs['nodeType'] === 'mainSeq'),
  ).flatMap((n): [string, TimeWindow][] => (n.attrs['id'] ? [[n.attrs['id'], { start: 0, end: null }]] : []));
  const schedule: NativeSchedule = {
    step: 0,
    windows: new Map(anchors),
    byNode: new Map(),
    effects: [],
    approximate: false,
  };
  for (const group of mainGroups(timing)) {
    const click = waitsForClick(group);
    if (click) {
      schedule.step++;
      schedule.windows = new Map(anchors);
    }
    scheduleNative(group, 0, schedule, false, click);
  }
  return {
    effects: schedule.effects.sort((a, b) => a.step - b.step || a.delayMs - b.delayMs),
    approximate: schedule.approximate || visual.some((n) => !schedule.byNode.has(n)),
  };
}

// ---- the media --------------------------------------------------------------------------------------

/** A shape's place on the slide, in EMU, through the groups it sits in (their child coordinates). */
interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}

function xfrmOf(spPr: XmlNode | undefined): Place | null {
  const xfrm = kid(spPr, 'a:xfrm');
  const off = kid(xfrm, 'a:off');
  const ext = kid(xfrm, 'a:ext');
  const x = num(off?.attrs['x']);
  const y = num(off?.attrs['y']);
  const w = num(ext?.attrs['cx']);
  const h = num(ext?.attrs['cy']);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

/** Every p:pic in the shape tree, with its place on the slide (a group's child coordinates mapped out). */
function pictures(tree: XmlNode): { pic: XmlNode; place: Place | null }[] {
  const out: { pic: XmlNode; place: Place | null }[] = [];
  const visit = (node: XmlNode, map: (p: Place) => Place) => {
    for (const c of kids(node)) {
      if (c.name === 'p:pic') {
        const own = xfrmOf(kid(c, 'p:spPr'));
        out.push({ pic: c, place: own ? map(own) : null });
      } else if (c.name === 'p:grpSp') {
        const xfrm = kid(kid(c, 'p:grpSpPr'), 'a:xfrm');
        const outer = xfrmOf(kid(c, 'p:grpSpPr'));
        const chOff = kid(xfrm, 'a:chOff');
        const chExt = kid(xfrm, 'a:chExt');
        const cx = num(chOff?.attrs['x']) ?? 0;
        const cy = num(chOff?.attrs['y']) ?? 0;
        const cw = num(chExt?.attrs['cx']) ?? outer?.w ?? 1;
        const ch = num(chExt?.attrs['cy']) ?? outer?.h ?? 1;
        const sx = outer && cw > 0 ? outer.w / cw : 1;
        const sy = outer && ch > 0 ? outer.h / ch : 1;
        const inner = (p: Place): Place =>
          map({
            x: (outer?.x ?? 0) + (p.x - cx) * sx,
            y: (outer?.y ?? 0) + (p.y - cy) * sy,
            w: p.w * sx,
            h: p.h * sy,
          });
        visit(c, inner);
      }
    }
  };
  visit(tree, (p) => p);
  return out;
}

/** The p:cMediaNode for a shape in the slide's timing (its volume, loop and the rest), if any. */
function mediaNodeFor(timing: XmlNode | undefined, shapeId: string): XmlNode | undefined {
  if (!timing) return undefined;
  return all(timing, (n) => n.name === 'p:cMediaNode').find(
    (node) => all(node, (n) => n.name === 'p:spTgt')[0]?.attrs['spid'] === shapeId,
  );
}

/** The groups of a shape's first entrance and first exit in the main sequence (C review), null where it has none. */
function comesAndGoes(
  groups: readonly XmlNode[],
  shapeId: string,
): { enter: number | null; exit: number | null } {
  let enter: number | null = null;
  let exit: number | null = null;
  for (const [g, group] of groups.entries())
    for (const e of effectsOf(group)) {
      if (targetOf(e.par) !== shapeId) continue;
      const kind = kid(e.par, 'p:cTn')?.attrs['presetClass'];
      if (kind === 'entr') enter ??= g;
      if (kind === 'exit') exit ??= g;
    }
  return { enter, exit };
}

/** When a shape's video or sound starts: at an effect in the main sequence, by a trigger, or by its play button. */
function startOf(groups: readonly XmlNode[], shapeId: string): PptxMediaStart {
  for (const [g, group] of groups.entries()) {
    for (const e of effectsOf(group)) {
      if (!isMediaCall(e.par) || targetOf(e.par) !== shapeId) continue;
      const cmd = all(e.par, (n) => n.name === 'p:cmd')[0];
      const what = cmd?.attrs['cmd'] ?? '';
      // playFrom(…) starts it; a togglePause or stop in the sequence is no start.
      if (!what.startsWith('playFrom') && what !== 'play') continue;
      return { group: g, offsetMs: Math.round(e.atMs) };
    }
  }
  return { clicked: true };
}

function readMedia(
  sld: XmlNode,
  timing: XmlNode | undefined,
  rels: ReadonlyMap<string, SlideRel>,
  size: SlideSize,
): PptxMedia[] {
  const tree = kid(kid(sld, 'p:cSld'), 'p:spTree');
  if (!tree) return [];
  const groups = mainGroups(timing);
  const out: PptxMedia[] = [];
  for (const { pic, place } of pictures(tree)) {
    const nv = kid(pic, 'p:nvPicPr');
    const cNvPr = kid(nv, 'p:cNvPr');
    const nvPr = kid(nv, 'p:nvPr');
    const file = kid(nvPr, 'a:videoFile') ?? kid(nvPr, 'a:audioFile') ?? kid(nvPr, 'a:quickTimeFile');
    const p14 = nvPr ? all(nvPr, (n) => n.name === 'p14:media')[0] : undefined;
    if (!file && !p14) continue;
    const kind: PptxMedia['kind'] = file?.name === 'a:audioFile' ? 'audio' : 'video';
    // The embedded file (p14:media's r:embed) when there is one; else what a:videoFile links to.
    const embedded = p14 ? rels.get(p14.attrs['r:embed'] ?? '') : undefined;
    const linked = file ? rels.get(file.attrs['r:link'] ?? file.attrs['r:embed'] ?? '') : undefined;
    const rel = embedded && !embedded.external ? embedded : linked;
    if (!rel) continue;
    const shapeId = cNvPr?.attrs['id'] ?? '';
    const blip = kid(kid(pic, 'p:blipFill'), 'a:blip');
    const posterRel = blip ? rels.get(blip.attrs['r:embed'] ?? '') : undefined;
    const trim = kid(p14, 'p14:trim');
    const fade = kid(p14, 'p14:fade');
    const node = mediaNodeFor(timing, shapeId);
    const st = num(trim?.attrs['st']) ?? 0;
    const end = num(trim?.attrs['end']) ?? 0;
    const vol = num(node?.attrs['vol']);
    const numSld = num(node?.attrs['numSld']);
    const box = place ?? { x: 0, y: 0, w: size.cx, h: size.cy };
    const comes = comesAndGoes(groups, shapeId);
    out.push({
      kind,
      shapeId,
      name: cNvPr?.attrs['name'] ?? '',
      part: rel.external ? null : rel.target,
      link: rel.external ? rel.target : null,
      box: { x: box.x / size.cx, y: box.y / size.cy, w: box.w / size.cx, h: box.h / size.cy },
      poster: posterRel && !posterRel.external ? posterRel.target : null,
      trim: st > 0 || end > 0 ? { startMs: Math.round(st), endMs: Math.round(end) } : null,
      fadeInMs: Math.round(num(fade?.attrs['in']) ?? 0),
      fadeOutMs: Math.round(num(fade?.attrs['out']) ?? 0),
      // Thousandths of a percent (80000 is 80 %); left out for full.
      volume: vol === null ? 1 : Math.min(1, Math.max(0, vol / 100_000)),
      muted: node?.attrs['mute'] === '1' || node?.attrs['mute'] === 'true',
      loop: kid(node, 'p:cTn')?.attrs['repeatCount'] === 'indefinite',
      start: startOf(groups, shapeId),
      acrossSlides: numSld !== null && numSld > 1 ? Math.round(numSld) : null,
      hideWhenStopped: node?.attrs['showWhenStopped'] === '0' || node?.attrs['showWhenStopped'] === 'false',
      enterGroup: comes.enter,
      exitGroup: comes.exit,
    });
  }
  return out;
}

/**
 * What a slide does, from its XML (`sld`, the p:sld element), its relationships and the deck's slide size. A
 * slide with nothing of the kind has no transition, no groups and no media.
 */
export function readDeckSlide(
  sld: XmlNode,
  rels: ReadonlyMap<string, SlideRel>,
  size: SlideSize,
): PptxDeckSlide {
  const timing = kid(sld, 'p:timing');
  const triggered = timing
    ? all(timing, (n) => n.name === 'p:cTn' && n.attrs['nodeType'] === 'interactiveSeq')
    : [];
  return {
    transition: readTransition(sld, rels),
    groups: readGroups(timing),
    motion: readNativeMotion(timing),
    media: readMedia(sld, timing, rels, size),
    triggers: triggered.reduce(
      (n, seq) =>
        n +
        all(
          seq,
          (e) =>
            e.name === 'p:cTn' &&
            e.attrs['presetClass'] !== undefined &&
            e.attrs['presetClass'] !== 'mediacall',
        ).length,
      0,
    ),
  };
}

/** The step a group's work shows in: step 0 is the slide coming in (with a first group that needs no click). */
export function stepOfGroup(groups: readonly PptxGroup[], group: number): number {
  let step = 0;
  for (let g = 0; g <= group && g < groups.length; g++) if (groups[g]?.byClick) step++;
  return step;
}

/** How many steps a slide has: coming in, then one per click. */
export function stepsOf(groups: readonly PptxGroup[]): number {
  return 1 + groups.filter((g) => g.byClick).length;
}
