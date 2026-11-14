import type { DeckEffect, DeckEffectDirection, DeckMotion } from './deck';
import type { Rect, RenderSlide, SlideElement, TextElement, TextRun } from './model';
import { pptxFormula } from './pptx-formula';
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
  if (element.kind === 'shape' || element.kind === 'image')
    targets.push(deckBackgroundTarget(element.sourceShapeId));
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

/** A Shape at one moment: its outline's edges travel as a Split's do (DeckSplit), from the middle out or the edges in. */
interface DeckShape extends Omit<DeckSplit, 'axis'> {
  shape: NonNullable<DeckEffect['shape']>;
}

type DeckWipe =
  | { edge: DeckEffectDirection; fraction: number }
  | DeckSplit
  | DeckShape
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

/**
 * Basic Zoom away from rest (DeckEffect.zoomAway) for a shape at `bounds`: its PowerPoint formulas worked out for the
 * shape as it is drawn, as its scale there and how far its centre is from where it rests (px). Null when they cannot
 * be (a shape with no size, a formula Drashti does not read): then it zooms from nothing, as Basic Zoom In does.
 */
function zoomedAway(
  away: NonNullable<DeckEffect['zoomAway']>,
  bounds: Rect,
  slide: Size,
): { scale: number; x: number; y: number } | null {
  if (!(slide.width > 0) || !(slide.height > 0)) return null;
  const place = {
    x: (bounds.x + bounds.width / 2) / slide.width,
    y: (bounds.y + bounds.height / 2) / slide.height,
    w: bounds.width / slide.width,
    h: bounds.height / slide.height,
  };
  // Its width and height grow alike (the reader checks): the larger is the surer.
  const wide = place.w >= place.h;
  const size = pptxFormula(wide ? away.w : away.h);
  const own = wide ? place.w : place.h;
  const scale = size && own > 0 ? size(place) / own : Number.NaN;
  const at = (formula: string | undefined, rest: number) =>
    formula === undefined ? rest : (pptxFormula(formula)?.(place) ?? Number.NaN);
  const x = at(away.x, place.x);
  const y = at(away.y, place.y);
  if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const within = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
  return {
    scale: within(scale, 100),
    x: within(x - place.x, 10) * slide.width,
    y: within(y - place.y, 10) * slide.height,
  };
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
      frame.wipe = {
        shape: effect.shape ?? 'circle',
        inward: effect.inward === true,
        leaving: !entering,
        progress,
      };
    if (effect.kind === 'wheel') frame.wipe = { spokes: effect.spokes ?? 1, amount };
    if (effect.kind === 'bars') frame.wipe = { bars: effect.bars ?? 'horizontal', amount };
    if (effect.kind === 'zoom') {
      const away = effect.zoomAway ? zoomedAway(effect.zoomAway, bounds, slide) : null;
      frame.scale *= amount + Math.max(0, away?.scale ?? effect.scale ?? 0) * (1 - amount);
      if (away) {
        frame.x += away.x * (1 - amount);
        frame.y += away.y * (1 - amount);
      }
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
 * How wide PowerPoint draws Shape's soft edge, as a share of the way it travels (from the shape's middle to its
 * corners, in its outline's own measure: shapeSize): its own movie of all sixteen at 1920 x 1080 (run 2, measured again
 * 14 Nov 2026) fits one straight band 0.142 wide, its middle running evenly from half that width before the middle to
 * half past the corners over the effect, as a Split's, with no shift in time.
 */
const SHAPE_SOFTNESS = 0.142;

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

/**
 * How far a point of a shape's box is from its middle (0) towards its corners (1) in the measure of Shape's outline, u
 * and v each from −1 to 1 across the box, in its own proportions: as PowerPoint draws each (its own movie, 13 and
 * 14 Nov 2026), the circle an ellipse through the box's corners, the box itself, the diamond through the corners, and
 * the plus two bars across the whole box.
 */
function shapeSize(shape: NonNullable<DeckEffect['shape']>, u: number, v: number): number {
  switch (shape) {
    case 'circle':
      return Math.hypot(u, v) / Math.SQRT2;
    case 'box':
      return Math.max(Math.abs(u), Math.abs(v));
    case 'diamond':
      return (Math.abs(u) + Math.abs(v)) / 2;
    case 'plus':
      return Math.min(Math.abs(u), Math.abs(v));
  }
}

/** How much of a Shape shows where its outline's measure is `size` (shapeSize). */
function shapeShowsAt(wipe: DeckShape, size: number): number {
  // How far its edge travels before it reaches here.
  const way = wipe.inward ? 1 - size : size;
  const passed = Math.min(1, Math.max(0, ((1 + SHAPE_SOFTNESS) * wipe.progress - way) / SHAPE_SOFTNESS));
  return wipe.leaving ? 1 - passed : passed;
}

/**
 * How much of a Shape's box shows at (u, v), each from −1 to 1 across it (0 its middle): 0 to 1. Any other wipe, or
 * none, shows it whole. As PowerPoint draws it (its own movie at 1920 × 1080, 14 Nov 2026): its outline's edge, soft,
 * travels from the middle out (from the corners in, for its "In") as a Split's edges do, a box's and a plus's corners
 * square; what it passes shows as the shape comes in, and is hidden as it leaves. The masks drawn (deckWipeMask, and
 * deckWipeInnerMask on the part within) let through exactly this.
 */
export function deckShapeShows(wipe: DeckWipe | null, u: number, v: number): number {
  if (!wipe || !('shape' in wipe)) return 1;
  return shapeShowsAt(wipe, shapeSize(wipe.shape, u, v));
}

/** Stops without those in the middle of an even stretch, which add nothing. */
function withoutEven(all: readonly [number, number][]): [number, number][] {
  return all.filter(
    ([, shows], i) =>
      i === 0 || i === all.length - 1 || all[i - 1]?.[1] !== shows || all[i + 1]?.[1] !== shows,
  );
}

/**
 * Where a soft edge's look bends between 0 and 1 of the way from the middle (`shows` there, to 4 decimals): at the
 * middle, at the edge's two sides, and at the end; straight between them.
 */
function edgeStops(
  inward: boolean,
  progress: number,
  softness: number,
  shows: (at: number) => number,
): [number, number][] {
  const reach = (1 + softness) * progress;
  const bends = (inward ? [1 - reach, 1 - reach + softness] : [reach - softness, reach]).filter(
    (d) => d > 0 && d < 1,
  );
  return [0, ...bends, 1].map((d): [number, number] => [d, Math.round(shows(d) * 10_000) / 10_000]);
}

/** A soft edge's stops from the middle out (edgeStops) both ways along a line, from −1 through 0 to 1. */
function bothWays(half: readonly [number, number][]): [number, number][] {
  return withoutEven([
    ...half
      .slice(1)
      .map(([d, shows]): [number, number] => [-d, shows])
      .reverse(),
    ...half,
  ]);
}

/** Where a Split's look bends along its axis (−1 to 1), with how much shows there: straight between them. */
function splitStops(split: DeckSplit): [number, number][] {
  return bothWays(edgeStops(split.inward, split.progress, SPLIT_SOFTNESS, (d) => deckSplitShows(split, d)));
}

const ink = (shows: number) => `rgb(0 0 0 / ${String(shows)})`;
const fixed = (value: number, places = 3) => String(Math.round(value * 10 ** places) / 10 ** places || 0);

/**
 * A straight ramp across a shape's box as a CSS linear gradient on a part drawn at `frame`: `stops` along a measure
 * from −1 to 1 across the box (`target`) that changes by `per` (x right, y down) each px from its middle.
 */
function rampGradient(per: Point, stops: readonly [number, number][], target: Rect, frame: Rect): string {
  const rate = Math.hypot(per[0], per[1]);
  const [ex, ey] = [per[0] / rate, per[1] / rate];
  // The gradient's line runs through the part's centre, as long as the part's extent along it (CSS Images 3).
  const length = Math.abs(frame.width * ex) + Math.abs(frame.height * ey);
  const offset =
    (target.x + target.width / 2 - frame.x - frame.width / 2) * ex +
    (target.y + target.height / 2 - frame.y - frame.height / 2) * ey;
  // CSS's angle: from twelve o'clock, clockwise.
  const angle = (Math.atan2(ex, -ey) * 180) / Math.PI;
  const at = (m: number) => `${fixed(((m / rate + offset) / length + 0.5) * 100)}%`;
  return `linear-gradient(${fixed(angle, 4)}deg, ${stops.map(([m, shows]) => `${ink(shows)} ${at(m)}`).join(', ')})`;
}

/** A step from nothing to everything at a line (rampGradient's measure 0). */
const STEP: readonly [number, number][] = [
  [0, 0],
  [0, 1],
];

/** STEP with its colours swapped: everything before the line, nothing past it. */
const STEP_SWAPPED: readonly [number, number][] = [
  [0, 1],
  [0, 0],
];

/**
 * How the layers of a Box's, a Plus's or a Diamond's masks are laid on one another (CSS mask-composite, the first on
 * top): the ramp over the two half-planes, which `exclude` makes the two wedges beside the other two sides.
 */
const SHAPE_COMPOSITE = 'add, exclude';

/**
 * A Shape's soft edge as CSS masks over one of a group's rendered parts drawn at `frame`, at the same slide position
 * across the whole group (`target`): '' while nothing is hidden. A Circle's is one radial gradient on the part. A Box's,
 * a Plus's and a Diamond's edge is two straight ramps meeting at square corners (PowerPoint's: its movie shows as much
 * on the corners' diagonal as anywhere along the edge), which one element's mask cannot draw (its layers only add or
 * multiply); so each ramp is drawn beside its own sides, on the part (`outer`) and on an element within it (`inner`),
 * two half-planes through the box's middle laid on one another by `exclude` letting everything through beside the
 * other sides, and the two masks multiply to exactly what PowerPoint shows: the half-planes' steps fall where the two
 * ramps are equal, so nothing steps there. Both masks draw each of those two lines with one gradient, the element
 * within one of them with its colours swapped, so a pixel exactly on a line (a square on PowerPoint's grid at 1080p:
 * its diagonal through pixel centres) is on the same side in both. (Their cost on the screens: the shape drawn through
 * one more layer the size of its box, two for a Box, a Plus or a Diamond, while it runs.)
 */
function shapeMasks(wipe: DeckShape, target: Rect, frame: Rect): { outer: string; inner: string } {
  const none = { outer: '', inner: '' };
  const a = target.width / 2;
  const b = target.height / 2;
  if (!(a > 0) || !(b > 0) || !(frame.width > 0) || !(frame.height > 0)) return none;
  const half = edgeStops(wipe.inward, wipe.progress, SHAPE_SOFTNESS, (size) => shapeShowsAt(wipe, size));
  if (half.every(([, shows]) => shows >= 1)) return none;
  const x = target.x + a - frame.x;
  const y = target.y + b - frame.y;
  if (wipe.shape === 'circle') {
    const stops = withoutEven(half).map(([size, shows]) => `${ink(shows)} ${fixed(size * 100)}%`);
    return {
      outer: `radial-gradient(${fixed(Math.SQRT2 * a)}px ${fixed(Math.SQRT2 * b)}px at ${fixed(x)}px ${fixed(y)}px, ${stops.join(', ')})`,
      inner: '',
    };
  }
  const ramp = bothWays(half);
  // One side of a line through the box's middle (everything where the measure along `per` is past 0): a step, crisp
  // as Chromium draws a linear gradient's (it smooths a conic gradient's over a fraction of a degree, which left a faint
  // line along the seam between the ramps where nothing should show: CI's Mac, 14 Nov 2026).
  const side = (per: Point) => rampGradient(per, STEP, target, frame);
  // The other side of the same line, drawn by the same gradient with its colours swapped: a renderer gives a pixel
  // exactly on the line the same colour stop of one gradient on the shape and within it, so it falls on one side in
  // both. (A step pointing the other way could get its second colour too: everything showed there, a white line across
  // what is hidden, along a square's falling diagonal and a Diamond's middle column: C1's review, 14 Nov 2026.)
  const otherSide = (per: Point) => rampGradient(per, STEP_SWAPPED, target, frame);
  // Kept beside two opposite sides: the ramp, over two half-planes laid on one another by `exclude` (SHAPE_COMPOSITE),
  // which let everything through over the other two.
  const beside = (per: Point, first: string, second: string) =>
    `${rampGradient(per, ramp, target, frame)}, ${first}, ${second}`;
  // The box's diagonals (v = u and v = −u, u and v from −1 to 1 across it) and its middle lines, as px measures.
  const belowFalling: Point = [-1 / a, 1 / b];
  const aboveFalling: Point = [1 / a, -1 / b];
  const belowRising: Point = [1 / a, 1 / b];
  const right: Point = [1, 0];
  const down: Point = [0, 1];
  switch (wipe.shape) {
    case 'box':
      // max(|u|, |v|): |u| beside the left and right sides, |v| above and below.
      return {
        outer: beside([1 / a, 0], side(aboveFalling), side(belowRising)),
        inner: beside([0, 1 / b], otherSide(aboveFalling), side(belowRising)),
      };
    case 'plus':
      // min(|u|, |v|): |u| above and below, |v| beside the left and right sides.
      return {
        outer: beside([1 / a, 0], side(belowFalling), side(belowRising)),
        inner: beside([0, 1 / b], otherSide(belowFalling), side(belowRising)),
      };
    case 'diamond':
      // (|u| + |v|) / 2: |u + v| / 2 where u and v have the same sign (bottom right, top left), else |u − v| / 2.
      return {
        outer: beside([1 / (2 * a), 1 / (2 * b)], side(right), side(down)),
        inner: beside([1 / (2 * a), -1 / (2 * b)], otherSide(right), side(down)),
      };
  }
}

/**
 * A Split's or a Shape's soft edges as a CSS mask over one of a group's rendered parts drawn at `frame`, at the same
 * slide position across the whole group (`target`): for a Split, a linear gradient along its axis; for a Shape, as
 * shapeMasks says. '' for any other wipe, none, or while nothing is hidden. (Its cost on the screens: the shape drawn
 * through one more layer, the size of its own box, while it runs.)
 */
export function deckWipeMask(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  if (wipe && 'shape' in wipe) return shapeMasks(wipe, target, frame).outer;
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
  const inkOf = (shows: number) => `rgb(0 0 0 / ${String(Math.round(shows * 10_000) / 10_000)})`;
  return `linear-gradient(${across ? 'to right' : 'to bottom'}, ${stops.map(([d, shows]) => `${inkOf(shows)} ${at(d)}`).join(', ')})`;
}

/**
 * The mask of the element within a part (render/NativeDeckElement.tsx's DeckTarget), multiplying deckWipeMask's: a
 * Box's, a Plus's or a Diamond's other ramp (shapeMasks). '' for anything else.
 */
export function deckWipeInnerMask(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  return wipe && 'shape' in wipe ? shapeMasks(wipe, target, frame).inner : '';
}

/**
 * How the layers of deckWipeMask's and deckWipeInnerMask's masks are laid on one another (CSS mask-composite): a Box's,
 * a Plus's or a Diamond's while it runs (SHAPE_COMPOSITE); '' (each mask one layer) for anything else.
 */
export function deckWipeMaskComposite(wipe: DeckWipe | null): string {
  return wipe && 'shape' in wipe && wipe.shape !== 'circle' && wipe.progress < 1 ? SHAPE_COMPOSITE : '';
}

/**
 * Shape's outline about the centre of `target`, `size` of the way from its middle (0) to its corners (1) in its own
 * measure (shapeSize): in the shape's own proportions, an ellipse through the box's corners, a box, a diamond through
 * them; and for Plus, two bars across the whole shape, each `size` of its half-width (or half-height) either side of
 * its middle line.
 */
function outline(shape: NonNullable<DeckEffect['shape']>, target: Rect, size: number): Point[] {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  // Half the shape's width and height: the box at `size` 1.
  const a = (target.width / 2) * size;
  const b = (target.height / 2) * size;
  switch (shape) {
    case 'circle':
      // Through the box's corners at `size` 1: √2 times its half-width and half-height.
      return Array.from({ length: 72 }, (_, i): Point => {
        const angle = (i / 72) * 2 * Math.PI;
        return [cx + Math.SQRT2 * a * Math.cos(angle), cy + Math.SQRT2 * b * Math.sin(angle)];
      });
    case 'box':
      return [
        [cx - a, cy - b],
        [cx + a, cy - b],
        [cx + a, cy + b],
        [cx - a, cy + b],
      ];
    case 'diamond':
      // Through the box's corners at `size` 1.
      return [
        [cx, cy - 2 * b],
        [cx + 2 * a, cy],
        [cx, cy + 2 * b],
        [cx - 2 * a, cy],
      ];
    case 'plus': {
      // The bars reach the box's edges; past `size` 1 they cover it.
      const w = target.width / 2;
      const h = target.height / 2;
      const x = Math.min(a, w);
      const y = Math.min(b, h);
      return [
        [cx - x, cy - h],
        [cx + x, cy - h],
        [cx + x, cy - y],
        [cx + w, cy - y],
        [cx + w, cy + y],
        [cx + x, cy + y],
        [cx + x, cy + h],
        [cx - x, cy + h],
        [cx - x, cy + y],
        [cx - w, cy + y],
        [cx - w, cy - y],
        [cx - x, cy - y],
      ];
    }
  }
}

/** Everything of `target` outside `inner`: its corners, then the hole, joined through its first corner. */
function around(target: Rect, inner: readonly Point[]): Point[] {
  const outer: Point[] = [
    [target.x, target.y],
    [target.x + target.width, target.y],
    [target.x + target.width, target.y + target.height],
    [target.x, target.y + target.height],
  ];
  const [start] = outer;
  const [first] = inner;
  return start && first ? [...outer, start, ...inner, first] : outer;
}

/**
 * A Shape's hard edge as a clip of one of a group's rendered parts drawn at `frame`, at the same slide position across
 * the whole group (`target`): its outline where PowerPoint's soft edge is half-way (deckShapeShows 0.5), as Session 57
 * drew every Shape. Drawn in place of the soft edge's masks where a page draws without a graphics chip
 * (render/deck-target-paint.ts): there two masks of three gradients each on every moving Box, Plus and Diamond dropped
 * frames on a two-core PC while streaming (C1's review, HIGH-2). '' for any other wipe, or none.
 */
export function deckShapeHardClip(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  if (!wipe || !('shape' in wipe)) return '';
  // Where the soft edge is half-way: SHAPE_SOFTNESS / 2 behind its leading side.
  const reach = (1 + SHAPE_SOFTNESS) * wipe.progress - SHAPE_SOFTNESS / 2;
  const size = Math.max(0, wipe.inward ? 1 - reach : reach);
  // What the edge has passed shows coming in and is hidden leaving: inside the outline for an entrance's Out and an
  // exit's In, outside it (a hole) for an entrance's In and an exit's Out.
  return wipe.inward === wipe.leaving
    ? polygon(outline(wipe.shape, target, size), frame)
    : polygon(around(target, outline(wipe.shape, target, size)), frame, true);
}

/**
 * Clip all of a group's rendered parts at the same slide position. A Split and a Shape are drawn by their masks
 * (deckWipeMask).
 */
export function deckWipeClip(wipe: DeckWipe | null, target: Rect, frame: Rect): string {
  if (!wipe || 'shape' in wipe) return '';
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
