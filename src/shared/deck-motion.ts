import type { DeckEffect, DeckEffectDirection, DeckMotion } from './deck';
import type { Rect, RenderSlide, SlideElement, TextElement, TextRun } from './model';
import { fitElements } from './slide-size';

type Size = Pick<RenderSlide, 'width' | 'height'>;

/** PowerPoint can animate the drawn shape behind a text box separately from its paragraphs. */
export function deckBackgroundTarget(shapeId: string): string {
  return `background:${shapeId}`;
}

export function deckElementTargets(element: SlideElement): readonly string[] {
  const groups = element.sourceGroupIds ?? [];
  if (!element.sourceShapeId) return groups;
  const targets = [...groups, element.sourceShapeId];
  if (element.kind === 'shape') targets.push(deckBackgroundTarget(element.sourceShapeId));
  return targets;
}

/** One source shape may have several rendered parts. A group's effects apply to their combined bounds. */
export function deckTargetBounds(
  elements: readonly SlideElement[],
  effects: ReadonlyMap<string, readonly DeckEffect[]>,
): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const element of elements) {
    const frame = element.frame;
    for (const id of deckElementTargets(element)) {
      if (!effects.has(id)) continue;
      const previous = bounds.get(id);
      if (!previous) {
        bounds.set(id, frame);
        continue;
      }
      const x = Math.min(previous.x, frame.x);
      const y = Math.min(previous.y, frame.y);
      const right = Math.max(previous.x + previous.width, frame.x + frame.width);
      const bottom = Math.max(previous.y + previous.height, frame.y + frame.height);
      bounds.set(id, { x, y, width: right - x, height: bottom - y });
    }
  }
  return bounds;
}

const byClock = (a: DeckEffect, b: DeckEffect) => a.step - b.step || a.delayMs - b.delayMs;

/** The effects on whole shapes and groups, by target. A paragraph build's effects belong to its paragraphs. */
export function deckEffectsByTarget(effects: readonly DeckEffect[]): Map<string, DeckEffect[]> {
  const byTarget = new Map<string, DeckEffect[]>();
  for (const effect of effects) {
    if (effect.paragraphs) continue;
    const group = byTarget.get(effect.shapeId);
    if (group) group.push(effect);
    else byTarget.set(effect.shapeId, [effect]);
  }
  for (const group of byTarget.values()) group.sort(byClock);
  return byTarget;
}

/** A paragraph build's effects, by the text box's shape, in the order they play. */
export function deckParagraphEffects(effects: readonly DeckEffect[]): Map<string, DeckEffect[]> {
  const byShape = new Map<string, DeckEffect[]>();
  for (const effect of effects) {
    if (!effect.paragraphs) continue;
    const own = byShape.get(effect.shapeId);
    if (own) own.push(effect);
    else byShape.set(effect.shapeId, [effect]);
  }
  for (const own of byShape.values()) own.sort(byClock);
  return byShape;
}

/** The effects of one paragraph (from 0) among its box's, in the order they play. */
export function paragraphEffects(effects: readonly DeckEffect[], paragraph: number): DeckEffect[] {
  return effects.filter(
    ({ paragraphs }) => paragraphs !== undefined && paragraphs[0] <= paragraph && paragraph <= paragraphs[1],
  );
}

/**
 * The effects that build one paragraph (from 0) of a box built paragraph by paragraph: its own; or, for one with none
 * (typed past the last built paragraph after an edit, or made by Enter inside a point), those of the nearest built
 * paragraph before it, so it comes in with that click and never before. One before the first built paragraph has none
 * and shows from the start, as in PowerPoint.
 */
export function builtParagraphEffects(effects: readonly DeckEffect[], paragraph: number): DeckEffect[] {
  const own = paragraphEffects(effects, paragraph);
  if (own.length > 0) return own;
  let nearest = -1;
  for (const { paragraphs } of effects)
    if (paragraphs && paragraphs[1] < paragraph) nearest = Math.max(nearest, paragraphs[1]);
  return nearest < 0 ? [] : paragraphEffects(effects, nearest);
}

/** A line break inside a paragraph (W5's reader marks one); every other line break ends a paragraph. */
const softBreak = (run: TextRun): boolean => (run as TextRun & { softBreak?: boolean }).softBreak === true;

/**
 * A text box's runs cut where its paragraphs end, each with its paragraph (from 0, as PowerPoint counts them):
 * drawn as they were, so a paragraph can be shown or hidden on its own without anything moving.
 */
export function deckParagraphRuns(element: TextElement): { runs: TextRun[]; paragraphs: number[] } {
  const source = element.runs && element.runs.length > 0 ? element.runs : [{ text: element.text }];
  const runs: TextRun[] = [];
  const paragraphs: number[] = [];
  let paragraph = 0;
  for (const run of source) {
    const ends = !softBreak(run);
    const parts = ends ? run.text.split(/(?<=\n)/u) : [run.text];
    for (const part of parts) {
      runs.push(parts.length === 1 ? run : { ...run, text: part });
      paragraphs.push(paragraph);
      if (ends && part.endsWith('\n')) paragraph++;
    }
  }
  return { runs, paragraphs };
}

/** A run kept in its place but not drawn: no letters, no line, glow or shadow around them. */
function undrawn(run: TextRun): TextRun {
  return {
    ...run,
    color: 'transparent',
    shadow: false,
    outline: null,
    glow: null,
    underline: false,
    strike: false,
  };
}

/** A Split at one moment (deckSplitShows says how much of its shape shows where). */
interface DeckSplit {
  axis: 'x' | 'y';
  /** PowerPoint's "In": both moving edges travel from the box's own edges to its middle; else from the middle out. */
  inward: boolean;
  /** It hides what its edges pass (an exit), rather than showing it (an entrance). */
  leaving: boolean;
  /** How far through the effect, its smooth start and end applied: 0 to 1. */
  progress: number;
}

type DeckWipe =
  | { edge: DeckEffectDirection; fraction: number }
  | DeckSplit
  | { shape: NonNullable<DeckEffect['shape']>; inward: boolean; amount: number }
  | { spokes: number; amount: number }
  | { bars: NonNullable<DeckEffect['bars']>; amount: number };

export interface DeckMotionFrame {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  wipe: DeckWipe | null;
  moving: boolean;
  /** Relative to the current step, as its effects' delays are. */
  nextAt: number | null;
}

const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;
const travel = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

function outsideSlide(edge: DeckEffectDirection, bounds: Rect, slide: Size): [number, number] {
  switch (edge) {
    case 'left':
      return [-Math.max(0, bounds.x + bounds.width), 0];
    case 'right':
      return [Math.max(0, slide.width - bounds.x), 0];
    case 'up':
      return [0, -Math.max(0, bounds.y + bounds.height)];
    case 'down':
      return [0, Math.max(0, slide.height - bounds.y)];
  }
}

/**
 * PowerPoint's smooth start and smooth end (its accelerate and decelerate, shares of the effect's length), as its own
 * movie shows them (13 Nov 2026, within half a pixel): the effect's speed rises from nothing along half a cosine over
 * its first share, runs evenly, and falls back to nothing along half a cosine over its last share, ending on time.
 * SMIL's ramps are straight; PowerPoint's are not. Only a deck's own PowerPoint effects are eased so.
 */
export function smoothedProgress(progress: number, accel = 0, decel = 0): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const total = accel + decel;
  const a = total > 1 ? accel / total : accel;
  const d = total > 1 ? decel / total : decel;
  if (a <= 0 && d <= 0) return progress;
  // The even pace that makes up for the time spent speeding up and slowing down.
  const rate = 1 / (1 - a / 2 - d / 2);
  if (progress < a) return (rate / 2) * (progress - (a / Math.PI) * Math.sin((Math.PI * progress) / a));
  if (progress <= 1 - d) return rate * (progress - a / 2);
  const into = progress - (1 - d);
  return rate * (1 - d - a / 2) + (rate / 2) * (into + (d / Math.PI) * Math.sin((Math.PI * into) / d));
}

/** A ball's fall and its three smaller bounces, landing at 1 (the common "bounce out" curve). */
function bounced(progress: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (progress < 1 / d) return n * progress * progress;
  if (progress < 2 / d) return n * (progress - 1.5 / d) ** 2 + 0.75;
  if (progress < 2.5 / d) return n * (progress - 2.25 / d) ** 2 + 0.9375;
  return n * (progress - 2.625 / d) ** 2 + 0.984375;
}

/** A frame of one shape or group. Earlier steps are settled even when Next interrupted their motion. */
export function deckMotionFrame(
  effects: readonly DeckEffect[],
  step: number,
  elapsedMs: number,
  bounds: Rect,
  slide: Size,
): DeckMotionFrame {
  const firstVisibility = effects.find((effect) => effect.phase !== 'emphasis');
  const frame: DeckMotionFrame = {
    opacity: firstVisibility?.phase === 'in' ? 0 : 1,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    wipe: null,
    moving: false,
    nextAt: null,
  };

  let opacity = 1;
  for (const effect of effects) {
    if (effect.step > step) break;
    const local = effect.step < step ? Infinity : elapsedMs - effect.delayMs;
    if (local < 0) {
      frame.nextAt = Math.min(frame.nextAt ?? Infinity, effect.delayMs);
      continue;
    }
    const run = effect.durationMs === 0 ? 1 : Math.min(1, local / effect.durationMs);
    const progress = smoothedProgress(run, effect.accel, effect.decel);
    frame.moving ||= run < 1;
    if (effect.phase === 'emphasis') {
      if (effect.kind === 'spin') frame.rotation += (effect.degrees ?? 360) * progress;
      if (effect.kind === 'pulse' && progress < 1) frame.scale *= 1 + 0.12 * Math.sin(Math.PI * progress);
      if (effect.kind === 'grow-shrink') frame.scale *= 1 + ((effect.scale ?? 1) - 1) * progress;
      continue;
    }

    const entering = effect.phase === 'in';
    const amount = entering ? progress : 1 - progress;
    frame.opacity = entering || progress < 1 ? 1 : 0;
    if (progress >= 1) continue;
    if (effect.kind === 'fade' || effect.kind === 'float' || effect.fade) opacity *= amount;
    const direction = effect.direction ?? 'left';
    if (effect.kind === 'fly') {
      const edge = entering ? opposite[direction] : direction;
      const [x, y] = outsideSlide(edge, bounds, slide);
      frame.x += x * (1 - amount);
      frame.y += y * (1 - amount);
      if (effect.verticalDirection) {
        const verticalEdge = entering ? opposite[effect.verticalDirection] : effect.verticalDirection;
        frame.y += outsideSlide(verticalEdge, bounds, slide)[1] * (1 - amount);
      }
    }
    if (effect.kind === 'float') {
      const [x, y] = travel[direction];
      const shift = (effect.distance ?? 0) * (entering ? -1 : 1) * (1 - amount);
      frame.x += slide.width * x * shift;
      frame.y += slide.height * y * shift;
    }
    if (effect.kind === 'bounce') frame.y += outsideSlide('up', bounds, slide)[1] * (1 - bounced(amount));
    if (effect.kind === 'wipe') frame.wipe = { edge: direction, fraction: 1 - amount };
    if (effect.kind === 'split')
      frame.wipe = {
        axis: effect.splitAxis ?? 'x',
        inward: effect.inward === true,
        leaving: !entering,
        progress,
      };
    if (effect.kind === 'shape')
      frame.wipe = { shape: effect.shape ?? 'circle', inward: effect.inward === true, amount };
    if (effect.kind === 'wheel') frame.wipe = { spokes: effect.spokes ?? 1, amount };
    if (effect.kind === 'bars') frame.wipe = { bars: effect.bars ?? 'horizontal', amount };
    if (effect.kind === 'zoom') {
      frame.scale *= amount + (effect.scale ?? 0) * (1 - amount);
      if (effect.degrees) frame.rotation += effect.degrees * (1 - amount);
    }
  }
  frame.opacity *= opacity;
  return frame;
}

const percentage = (part: number, total: number): number =>
  total > 0 ? 100 * Math.min(1, Math.max(0, part / total)) : 0;

type Point = [number, number];

/** A polygon in slide pixels as a clip of a part drawn at `frame` (its points may lie outside it). */
function polygon(points: readonly Point[], frame: Rect, evenodd = false): string {
  const at = (value: number, origin: number, size: number) =>
    size > 0 ? `${String(Math.round(((value - origin) / size) * 100_000) / 1000)}%` : '0%';
  const list = points.map(([x, y]) => `${at(x, frame.x, frame.width)} ${at(y, frame.y, frame.height)}`);
  return `polygon(${evenodd ? 'evenodd, ' : ''}${list.join(', ')})`;
}

/** The outline Shape opens from the centre of `target`, `amount` of the way to covering it. */
function outline(shape: NonNullable<DeckEffect['shape']>, target: Rect, amount: number): Point[] {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const w = target.width * amount;
  const h = target.height * amount;
  switch (shape) {
    case 'circle': {
      const radius = (Math.hypot(target.width, target.height) / 2) * amount;
      return Array.from({ length: 72 }, (_, i): Point => {
        const angle = (i / 72) * 2 * Math.PI;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
      });
    }
    case 'box':
      return [
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2],
      ];
    case 'diamond':
      return [
        [cx, cy - h],
        [cx + w, cy],
        [cx, cy + h],
        [cx - w, cy],
      ];
    case 'plus':
      return [
        [cx - w / 2, cy - h],
        [cx + w / 2, cy - h],
        [cx + w / 2, cy - h / 2],
        [cx + w, cy - h / 2],
        [cx + w, cy + h / 2],
        [cx + w / 2, cy + h / 2],
        [cx + w / 2, cy + h],
        [cx - w / 2, cy + h],
        [cx - w / 2, cy + h / 2],
        [cx - w, cy + h / 2],
        [cx - w, cy - h / 2],
        [cx - w / 2, cy - h / 2],
      ];
  }
}

const corners = (r: Rect): Point[] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x + r.width, r.y + r.height],
  [r.x, r.y + r.height],
];

/** Everything of `target` outside `inner`: its corners, then the hole, joined through its first corner. */
function around(target: Rect, inner: readonly Point[]): Point[] {
  const outer = corners(target);
  const [start] = outer;
  const [first] = inner;
  return start && first ? [...outer, start, ...inner, first] : outer;
}

/** Wheel's spokes, each sweeping clockwise from twelve o'clock (a spoke's own share of the turn). */
function spokes(count: number, target: Rect, amount: number): Point[] {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  // A little past the corners, so the chords of the arc never cut into the shape.
  const radius = Math.hypot(target.width, target.height) * 0.55 + 1;
  const sweep = ((2 * Math.PI) / count) * amount;
  const segments = Math.max(1, Math.ceil((72 * amount) / count));
  const points: Point[] = [];
  for (let s = 0; s < count; s++) {
    const from = -Math.PI / 2 + (s * 2 * Math.PI) / count;
    points.push([cx, cy]);
    for (let i = 0; i <= segments; i++) {
      const angle = from + (sweep * i) / segments;
      points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  }
  return points;
}

/** Random Bars' fixed order: 48 bars, each one's turn a fixed shuffle (29 and 48 share no factor). */
const BARS = 48;
const BAR_TURN = Array.from({ length: BARS }, (_, i) => ((i * 29) % BARS) + 1);

function bars(kind: NonNullable<DeckEffect['bars']>, target: Rect, amount: number): Point[] {
  const points: Point[] = [];
  const across = kind === 'horizontal';
  const length = across ? target.height : target.width;
  for (let i = 0; i < BARS; i++) {
    if ((BAR_TURN[i] ?? BARS) > amount * BARS) continue;
    const from = (length * i) / BARS;
    const to = (length * (i + 1)) / BARS;
    // Each bar is joined to the next along the box's left (or top) edge, which adds nothing to what shows.
    if (across) {
      const top = target.y + from;
      const bottom = target.y + to;
      points.push(
        [target.x, top],
        [target.x + target.width, top],
        [target.x + target.width, bottom],
        [target.x, bottom],
      );
    } else {
      const left = target.x + from;
      const right = target.x + to;
      points.push(
        [left, target.y],
        [left, target.y + target.height],
        [right, target.y + target.height],
        [right, target.y],
      );
    }
  }
  return points;
}

/**
 * How wide PowerPoint draws a Split's soft edge, as a share of the way each edge travels (half the box): its own movie
 * of all eight Splits (13 Nov 2026) fits 13.2-13.8 %.
 */
const SPLIT_SOFTNESS = 0.135;

/**
 * How much of a Split's shape shows at `at` along its axis, from −1 (one edge) through 0 (the middle) to 1 (the other
 * edge): 0 to 1. Any other wipe, or none, shows it whole. As PowerPoint draws it (its own movie, 13 Nov 2026): both
 * edges travel from the middle out (from the box's own edges in, for its "In"), each soft, the middle of its soft edge
 * running evenly from half its width before the start to half its width past the end; what they pass shows as the
 * shape comes in, and is hidden as it leaves (so an exit's "In" closes from both edges to the middle).
 */
export function deckSplitShows(wipe: DeckWipe | null, at: number): number {
  if (!wipe || !('axis' in wipe)) return 1;
  const fromMiddle = Math.min(1, Math.abs(at));
  // How far an edge travels before it reaches here.
  const way = wipe.inward ? 1 - fromMiddle : fromMiddle;
  const passed = Math.min(1, Math.max(0, ((1 + SPLIT_SOFTNESS) * wipe.progress - way) / SPLIT_SOFTNESS));
  return wipe.leaving ? 1 - passed : passed;
}

/** Where a Split's look bends along its axis (−1 to 1), with how much shows there: straight between them. */
function splitStops(split: DeckSplit): [number, number][] {
  const reach = (1 + SPLIT_SOFTNESS) * split.progress;
  // Where the soft edge starts and ends, as distances from the middle.
  const bends = (
    split.inward ? [1 - reach, 1 - reach + SPLIT_SOFTNESS] : [reach - SPLIT_SOFTNESS, reach]
  ).filter((d) => d > 0 && d < 1);
  const half = [0, ...bends, 1].map((d): [number, number] => [d, deckSplitShows(split, d)]);
  const all = [
    ...half
      .slice(1)
      .map(([d, shows]): [number, number] => [-d, shows])
      .reverse(),
    ...half,
  ];
  // A stop in the middle of an even stretch adds nothing.
  return all.filter(
    ([, shows], i) =>
      i === 0 || i === all.length - 1 || all[i - 1]?.[1] !== shows || all[i + 1]?.[1] !== shows,
  );
}

/**
 * A Split's soft edges as a CSS mask over one of a group's rendered parts drawn at `frame`, at the same slide position
 * across the whole group (`target`): a linear gradient along its axis. '' for any other wipe, none, or while nothing is
 * hidden. (Its cost on the screens: the shape drawn through one more layer, the size of its own box, while it runs.)
 */
export function deckWipeMask(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  if (!wipe || !('axis' in wipe)) return '';
  const across = wipe.axis === 'x';
  const length = across ? frame.width : frame.height;
  if (!(length > 0)) return '';
  const stops = splitStops(wipe);
  if (stops.every(([, shows]) => shows >= 1)) return '';
  const middle = across ? target.x + target.width / 2 : target.y + target.height / 2;
  const half = (across ? target.width : target.height) / 2;
  const start = across ? frame.x : frame.y;
  const at = (d: number) => `${String(Math.round(((middle + d * half - start) / length) * 100_000) / 1000)}%`;
  const ink = (shows: number) => `rgb(0 0 0 / ${String(Math.round(shows * 10_000) / 10_000)})`;
  return `linear-gradient(${across ? 'to right' : 'to bottom'}, ${stops.map(([d, shows]) => `${ink(shows)} ${at(d)}`).join(', ')})`;
}

/** Clip all of a group's rendered parts at the same slide position. A Split is drawn by its mask (deckWipeMask). */
export function deckWipeClip(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  if (!wipe) return '';
  if ('shape' in wipe) {
    if (wipe.inward)
      return polygon(around(target, outline(wipe.shape, target, 1 - wipe.amount)), frame, true);
    return polygon(outline(wipe.shape, target, wipe.amount), frame);
  }
  if ('spokes' in wipe) return polygon(spokes(wipe.spokes, target, wipe.amount), frame);
  if ('bars' in wipe) {
    const points = bars(wipe.bars, target, wipe.amount);
    return points.length > 0 ? polygon(points, frame) : 'inset(50% 50% 50% 50%)';
  }
  if ('axis' in wipe) return '';
  const { edge, fraction } = wipe;
  const top = edge === 'up' ? percentage(target.y + target.height * fraction - frame.y, frame.height) : 0;
  const right =
    edge === 'right'
      ? percentage(frame.x + frame.width - target.x - target.width * (1 - fraction), frame.width)
      : 0;
  const bottom =
    edge === 'down'
      ? percentage(frame.y + frame.height - target.y - target.height * (1 - fraction), frame.height)
      : 0;
  const left = edge === 'left' ? percentage(target.x + target.width * fraction - frame.x, frame.width) : 0;
  return `inset(${String(top)}% ${String(right)}% ${String(bottom)}% ${String(left)}%)`;
}

function turnedAbout(element: SlideElement, target: Rect, degrees: number): SlideElement {
  const radians = (degrees * Math.PI) / 180;
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const dx = element.frame.x + element.frame.width / 2 - centerX;
  const dy = element.frame.y + element.frame.height / 2 - centerY;
  return {
    ...element,
    frame: {
      ...element.frame,
      x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians) - element.frame.width / 2,
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians) - element.frame.height / 2,
    },
    rotation: (element.rotation ?? 0) + degrees,
  };
}

function scaledAbout(element: SlideElement, target: Rect, scale: number): SlideElement {
  const span = Math.max(1, target.width, target.height);
  const size = { width: span, height: span };
  const [scaled] = fitElements([element], size, { width: span * scale, height: span * scale });
  if (!scaled) return element;
  return {
    ...scaled,
    frame: {
      ...scaled.frame,
      x: scaled.frame.x + (target.x + target.width / 2) * (1 - scale),
      y: scaled.frame.y + (target.y + target.height / 2) * (1 - scale),
    },
  };
}

/**
 * Whether each paragraph of a paragraph build shows at the end of `step`: the box's runs cut at its paragraphs, with
 * the hidden ones kept in place but not drawn; null when no paragraph shows.
 */
function builtParagraphs(
  element: TextElement,
  own: readonly DeckEffect[],
  step: number,
  slide: Size,
): TextElement | null {
  const { runs, paragraphs } = deckParagraphRuns(element);
  const shown = new Map<number, boolean>();
  const showing = (paragraph: number): boolean => {
    let seen = shown.get(paragraph);
    if (seen === undefined) {
      const effects = builtParagraphEffects(own, paragraph);
      seen =
        effects.length === 0 || deckMotionFrame(effects, step, Infinity, element.frame, slide).opacity > 0;
      shown.set(paragraph, seen);
    }
    return seen;
  };
  if (!runs.some((run, i) => run.text.trim() !== '' && showing(paragraphs[i] ?? 0))) return null;
  if (runs.every((_, i) => showing(paragraphs[i] ?? 0))) return element;
  return { ...element, runs: runs.map((run, i) => (showing(paragraphs[i] ?? 0) ? run : undrawn(run))) };
}

/** A still at the end of a click, for Next on LIVE, a phone or a stage screen. */
export function settledDeckElements(slide: RenderSlide, motion: DeckMotion, step: number): SlideElement[] {
  const effects = deckEffectsByTarget(motion.effects);
  const paragraphs = deckParagraphEffects(motion.effects);
  const bounds = deckTargetBounds(slide.elements, effects);
  const poses = new Map<string, DeckMotionFrame>();
  for (const [id, target] of bounds) {
    const own = effects.get(id);
    if (own) poses.set(id, deckMotionFrame(own, step, Infinity, target, slide));
  }
  return slide.elements.flatMap((element) => {
    let drawn = element;
    const ids = deckElementTargets(element);
    // The innermost target moves first, then the groups that contain it.
    for (const id of [...ids].reverse()) {
      const pose = poses.get(id);
      if (!pose) continue;
      if (pose.opacity === 0) return [];
      const degrees = pose.rotation % 360;
      const target = bounds.get(id);
      if (degrees !== 0 && target) drawn = turnedAbout(drawn, target, degrees);
      if (pose.scale !== 1 && target) drawn = scaledAbout(drawn, target, pose.scale);
    }
    const built =
      drawn.kind === 'text' && drawn.sourceShapeId ? paragraphs.get(drawn.sourceShapeId) : undefined;
    if (built && drawn.kind === 'text') {
      const words = builtParagraphs(drawn, built, step, slide);
      return words ? [words] : [];
    }
    return [drawn];
  });
}
