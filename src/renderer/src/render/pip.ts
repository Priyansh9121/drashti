import type { PipLayer, PipMotion, PipPlace, PipSize, PipSource } from '../../../shared/engine/state';
import { PIP_CORNERS } from '../../../shared/engine/state';
import type { LiveGroupLook, Movement } from '../../../shared/looks';
import { LOOK_LAYERS } from '../../../shared/looks';
import { PIP_OUT_MS } from '../../../shared/pip';
import type { Size } from '../../../shared/scaling';
import { cubicBezier, EASE, lerp, seg } from './easing';
import { dissolveCurve } from './transition-frame';

/*
 * The picture-in-picture box on the audience screens (Session 50), worked out as pure functions so every screen
 * draws the same: where it sits on a screen's canvas, what each frame of its in, out, swap and move looks like
 * from the engine's time (its shownAt, its last change and the pipOff it leaves by), and which pictures go where.
 * The box holds a video input, a picture or video from Media, a window, or the slides (the main picture then
 * shows the background without the slide). Swap puts the box's picture in the background's place and the
 * background in the box; the main picture's own change dissolves in the box's time, never a cut (Session 51 moved
 * it with the box; Session 52: every picture only dissolves). Only opacity and transform move, as the lower thirds
 * do (no blur, no filter, no layer): the box's both, the main picture's opacity alone.
 */

/** The box's width as a share of the screen's: Small a quarter, Medium a third, Large two fifths. 16:9 always. */
export const PIP_WIDTH: Record<PipSize, number> = { small: 1 / 4, medium: 1 / 3, large: 2 / 5 };

/** A box in a corner keeps this far in from the screen's edges, each side the same: a share of its height. */
export const PIP_MARGIN = 0.04;

/** Let go this near a corner's own place (a share of the screen's height), a dragged box goes into the corner. */
const SNAP = 0.03;

/** Where the box is on a screen's canvas, in canvas pixels. */
export interface PipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/** The box's size on a screen: its share of the width at 16:9, as tall as fits on a screen too wide for it. */
function pipSize(size: PipSize, canvas: Size, margin: number): { width: number; height: number } {
  let width = canvas.width * PIP_WIDTH[size];
  let height = (width * 9) / 16;
  const tallest = Math.max(0, canvas.height - 2 * margin);
  if (height > tallest) {
    height = tallest;
    width = (height * 16) / 9;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Where the box sits on a screen: in its corner, or where it was dragged (its top left), wholly inside. */
export function pipRect(place: PipPlace, canvas: Size): PipRect {
  const margin = Math.round(canvas.height * PIP_MARGIN);
  const { width, height } = pipSize(place.size, canvas, margin);
  if (place.corner) {
    const right = place.corner.endsWith('right');
    const bottom = place.corner.startsWith('bottom');
    return {
      x: right ? canvas.width - margin - width : margin,
      y: bottom ? canvas.height - margin - height : margin,
      width,
      height,
    };
  }
  return {
    x: Math.round(clamp(place.x * canvas.width, 0, canvas.width - width)),
    y: Math.round(clamp(place.y * canvas.height, 0, canvas.height - height)),
    width,
    height,
  };
}

const fraction = (n: number) => Math.round(clamp(n, 0, 1) * 10_000) / 10_000;

/**
 * Where a box dragged by (dx, dy) canvas pixels lands: in a corner when it is let go near that corner's own
 * place, else where it was let go, kept wholly inside the screen. Everything else about it is kept.
 */
export function droppedPlace(place: PipPlace, canvas: Size, dx: number, dy: number): PipPlace {
  const from = pipRect(place, canvas);
  const x = clamp(from.x + dx, 0, canvas.width - from.width);
  const y = clamp(from.y + dy, 0, canvas.height - from.height);
  const snap = canvas.height * SNAP;
  for (const corner of PIP_CORNERS) {
    const at = pipRect({ ...place, corner }, canvas);
    if (Math.abs(at.x - x) <= snap && Math.abs(at.y - y) <= snap)
      return { ...place, corner, x: fraction(at.x / canvas.width), y: fraction(at.y / canvas.height) };
  }
  return { ...place, corner: null, x: fraction(x / canvas.width), y: fraction(y / canvas.height) };
}

/** Two places that put the box in the same spot at the same size (a border or its motion may differ). */
const samePlace = (a: PipPlace, b: PipPlace, canvas: Size): boolean => {
  const p = pipRect(a, canvas);
  const q = pipRect(b, canvas);
  return p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;
};

// ---- how it moves ---------------------------------------------------------------------------------------------

/** How long the box takes coming in, by the group's Movement (ms). */
const IN_MS: Record<Movement, number> = { calm: 300, bold: 400 };
/**
 * Going out, and each half of a swap (out with the old pictures, in with the new): shared with the engine, which
 * takes no other Swap while one runs (Session 51, shared/pip.ts pipSwapMs).
 */
const OUT_MS = PIP_OUT_MS;
/** A slide's move from one place to another: it glides there. */
const GLIDE_MS: Record<Movement, number> = { calm: 400, bold: 500 };

/** Bold's way out: slow at first, quick at the end (the box leaves the screen at speed). */
const EASE_IN = cubicBezier(0.55, 0, 1, 0.45);

export type PipChange = 'in' | 'out' | 'swap' | 'move';

/**
 * How long each of the box's moves takes (ms): its in and out by the Look's Movement, a swap out and in again,
 * and a move a glide when it slides, else out at the old place and in at the new.
 */
export function pipLength(change: PipChange, motion: PipMotion, movement: Movement): number {
  switch (change) {
    case 'in':
      return IN_MS[movement];
    case 'out':
      return OUT_MS[movement];
    case 'swap':
      return 2 * OUT_MS[movement];
    case 'move':
      return motion === 'slide' ? GLIDE_MS[movement] : 2 * OUT_MS[movement];
  }
}

export type PipPhase = PipChange | 'still' | 'gone';

/** What the box is doing at a moment, from the engine's state and time. */
export interface PipRun {
  /** The box drawn: the one up, or the one going off during its out; null once gone. */
  layer: PipLayer | null;
  phase: PipPhase;
  /** When the phase began, by the engine's clock (0 when still or gone). */
  start: number;
  /** How long it takes (ms; 0 when still or gone). */
  length: number;
  /** How the box was before a swap or a move. */
  from: { place: PipPlace; swapped: boolean } | null;
  /** The pictures as drawn now: a swap changes them at its middle, out of sight. */
  swapped: boolean;
  /** Where it is drawn now: a fade's or a scale's move changes place at its middle; a slide glides there. */
  place: PipPlace | null;
  /** The group's Movement it moves by: Calm, or Bold. */
  movement: Movement;
}

const goneRun = (movement: Movement): PipRun => ({
  layer: null,
  phase: 'gone',
  start: 0,
  length: 0,
  from: null,
  swapped: false,
  place: null,
  movement,
});

/** The box at `now`: coming in, still, swapping, moving or going out (or gone), on a screen of this size. */
export function pipRunAt(
  layer: PipLayer | null,
  off: { layer: PipLayer; at: number } | null,
  movement: Movement,
  now: number,
  canvas: Size,
): PipRun {
  if (layer) {
    const c = layer.changed;
    if (c && c.at >= layer.shownAt) {
      const change =
        c.swapped !== layer.swapped ? 'swap' : samePlace(c.place, layer.place, canvas) ? null : 'move';
      if (change) {
        const length = pipLength(change, layer.place.motion, movement);
        const t = now - c.at;
        if (t < length) {
          const second = t >= length / 2;
          const glides = change === 'move' && layer.place.motion === 'slide';
          return {
            layer,
            phase: change,
            start: c.at,
            length,
            from: { place: c.place, swapped: c.swapped },
            swapped: change === 'swap' && !second ? c.swapped : layer.swapped,
            place: change === 'move' && !glides && !second ? c.place : layer.place,
            movement,
          };
        }
      }
    }
    const length = pipLength('in', layer.place.motion, movement);
    if (now - layer.shownAt < length)
      return {
        layer,
        phase: 'in',
        start: layer.shownAt,
        length,
        from: null,
        swapped: layer.swapped,
        place: layer.place,
        movement,
      };
    return { ...goneRun(movement), layer, phase: 'still', swapped: layer.swapped, place: layer.place };
  }
  if (off) {
    const length = pipLength('out', off.layer.place.motion, movement);
    if (now - off.at < length)
      return {
        layer: off.layer,
        phase: 'out',
        start: off.at,
        length,
        from: null,
        swapped: off.layer.swapped,
        place: off.layer.place,
        movement,
      };
  }
  return goneRun(movement);
}

/**
 * The same run at `now`, worked out from itself (its own box, or the one going out): where a swap's or a move's
 * middle, or its end, has brought it by the time alone (Session 51), as pipRunAt has it from the engine's state.
 */
export const pipRunLater = (run: PipRun, now: number, canvas: Size): PipRun =>
  run.phase === 'out'
    ? pipRunAt(null, run.layer ? { layer: run.layer, at: run.start } : null, run.movement, now, canvas)
    : pipRunAt(run.layer, null, run.movement, now, canvas);

/**
 * Two runs that draw the same (Session 51): the same box, in the same phase from the same moment, its pictures
 * and its place alike, by the same Movement.
 */
export function samePipRun(a: PipRun, b: PipRun): boolean {
  return (
    a.layer === b.layer &&
    a.phase === b.phase &&
    a.start === b.start &&
    a.length === b.length &&
    a.swapped === b.swapped &&
    a.place === b.place &&
    a.movement === b.movement &&
    (a.from === b.from ||
      (a.from !== null &&
        b.from !== null &&
        a.from.place === b.from.place &&
        a.from.swapped === b.from.swapped))
  );
}

/**
 * The run a screen draws (Session 51): worked out at every drawing, but the one it has kept while it draws the
 * same, so a clock that jumps (a test holding it, the warm-up, a node's offset) draws nothing again for nothing.
 */
export const keptPipRun = (was: PipRun, now: PipRun): PipRun => (samePipRun(was, now) ? was : now);

/**
 * The box part-way: its opacity, how far it is from its place (canvas pixels), and its scale about its middle
 * (or about its top left, for a glide from another place and size).
 */
export interface PipPose {
  opacity: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  origin: 'center' | 'top-left';
}

export const PIP_REST: PipPose = { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, origin: 'center' };

/**
 * The box out of its place, where its in starts and its out ends: faded; scaled down, a little in Calm and
 * far in Bold; or slid towards its corner, a short way fading in Calm and from beyond the screen's edges in
 * Bold. A dragged box slides from the corner nearest it.
 */
function awayPose(motion: PipMotion, movement: Movement, place: PipPlace, canvas: Size): PipPose {
  const bold = movement === 'bold';
  if (motion === 'fade') return { ...PIP_REST, opacity: 0 };
  if (motion === 'scale') {
    const s = bold ? 0.5 : 0.85;
    return { ...PIP_REST, opacity: 0, scaleX: s, scaleY: s };
  }
  const r = pipRect(place, canvas);
  const right = place.corner ? place.corner.endsWith('right') : r.x + r.width / 2 > canvas.width / 2;
  const bottom = place.corner ? place.corner.startsWith('bottom') : r.y + r.height / 2 > canvas.height / 2;
  if (!bold)
    return {
      ...PIP_REST,
      opacity: 0,
      x: (right ? 1 : -1) * 0.12 * r.width,
      y: (bottom ? 1 : -1) * 0.12 * r.height,
    };
  return {
    ...PIP_REST,
    x: right ? canvas.width - r.x : -(r.x + r.width),
    y: bottom ? canvas.height - r.y : -(r.y + r.height),
  };
}

const mix = (a: PipPose, b: PipPose, p: number): PipPose => ({
  opacity: lerp(a.opacity, b.opacity, p),
  x: lerp(a.x, b.x, p),
  y: lerp(a.y, b.y, p),
  scaleX: lerp(a.scaleX, b.scaleX, p),
  scaleY: lerp(a.scaleY, b.scaleY, p),
  origin: b.origin,
});

/** Calm eases on smoothstep; Bold settles into place, leaves at speed and glides on its ease in and out. */
const easeIn = (movement: Movement) => (movement === 'bold' ? EASE.out : EASE.smooth);
const easeOut = (movement: Movement) => (movement === 'bold' ? EASE_IN : EASE.smooth);
const easeGlide = (movement: Movement) => (movement === 'bold' ? EASE.inOut : EASE.smooth);

/** Out at the start of the phase and in again at its middle (a swap, or a fade's or a scale's move). */
function outAndIn(t: number, length: number, away: PipPose, movement: Movement): PipPose {
  const half = length / 2;
  return t < half
    ? mix(PIP_REST, away, seg(t, 0, half, easeOut(movement)))
    : mix(away, PIP_REST, seg(t - half, 0, half, easeIn(movement)));
}

/** The box at `now` as `run` has it (a pure function of the engine's time, so every screen draws the same). */
export function pipPose(run: PipRun, now: number, canvas: Size): PipPose {
  const { layer, place, movement } = run;
  if (!layer || !place || run.length <= 0) return PIP_REST;
  const t = now - run.start;
  const motion = layer.place.motion;
  const off = awayPose(motion, movement, place, canvas);
  switch (run.phase) {
    case 'in':
      return mix(off, PIP_REST, seg(t, 0, run.length, easeIn(movement)));
    case 'out':
      return mix(PIP_REST, off, seg(t, 0, run.length, easeOut(movement)));
    case 'swap':
      return outAndIn(t, run.length, off, movement);
    case 'move': {
      if (motion !== 'slide' || !run.from) return outAndIn(t, run.length, off, movement);
      // A slide glides from the old place and size to the new.
      const was = pipRect(run.from.place, canvas);
      const is = pipRect(layer.place, canvas);
      const p = seg(t, 0, run.length, easeGlide(movement));
      return {
        opacity: 1,
        x: lerp(was.x - is.x, 0, p),
        y: lerp(was.y - is.y, 0, p),
        scaleX: lerp(is.width > 0 ? was.width / is.width : 1, 1, p),
        scaleY: lerp(is.height > 0 ? was.height / is.height : 1, 1, p),
        origin: 'top-left',
      };
    }
    case 'still':
    case 'gone':
      return PIP_REST;
  }
}

/** A pose as CSS: its transform, about its middle or its top left. */
export function poseTransform(pose: PipPose): { transform: string; transformOrigin: string } {
  const moved = pose.x !== 0 || pose.y !== 0;
  const scaled = pose.scaleX !== 1 || pose.scaleY !== 1;
  return {
    transform:
      moved || scaled
        ? `translate(${String(pose.x)}px, ${String(pose.y)}px) scale(${String(pose.scaleX)}, ${String(pose.scaleY)})`
        : '',
    transformOrigin: pose.origin === 'top-left' ? '0 0' : '50% 50%',
  };
}

// ---- what goes where ------------------------------------------------------------------------------------------

/** A picture a screen draws: its background layer, the box's own picture (`source`), or the slide layer. */
export type PipPicture = 'background' | 'source' | 'slide';

/** Bottom to top, in either place. */
const ORDER: readonly PipPicture[] = ['background', 'source', 'slide'];

/**
 * What the main picture and the box show. Without a box: the background and the slide, as always. The slides in
 * the box: the main picture is the background without the slide (a camera full, the words in the corner);
 * swapped, the slide full as usual and the background small. Anything else in the box: it sits in the box over
 * the show; swapped, it fills the background's place, under the slide and everything else, and the background is
 * small in the box. (Props, the lower third, messages and the ticker stay on the main picture throughout.)
 */
export function pipDraw(
  kind: PipSource['kind'] | null,
  swapped: boolean,
): { main: PipPicture[]; box: PipPicture[] } {
  if (kind === null) return { main: ['background', 'slide'], box: [] };
  if (kind === 'slides')
    return swapped ? { main: ['slide'], box: ['background'] } : { main: ['background'], box: ['slide'] };
  return swapped
    ? { main: ['source', 'slide'], box: ['background'] }
    : { main: ['background', 'slide'], box: ['source'] };
}

export interface PipSlot {
  picture: PipPicture;
  /** Drawn now; or (false) ready unseen, for after a swap's middle. */
  shown: boolean;
  /**
   * On the main picture through the half of a swap in which it dissolves (Session 52, pipMainPlaces): this
   * picture coming in or going out (pipMainOpacity).
   */
  dissolve?: 'in' | 'out';
  /** The upper of the two dissolving, added light for light over the other (plus-lighter), so the two add up. */
  adds?: boolean;
}

/**
 * Each place's pictures, bottom to top, as drawn now (`drawn`: swapped as drawn) and, while a swap is going out,
 * those it will show after its middle (`next`), ready unseen: a video, a camera or a window there has its picture
 * by then, so neither the main picture nor the box goes black as they change places.
 */
export function pipPlaces(
  kind: PipSource['kind'] | null,
  drawn: boolean,
  next: boolean,
): { main: PipSlot[]; box: PipSlot[] } {
  const now = pipDraw(kind, drawn);
  const later = pipDraw(kind, next);
  const slots = (shown: PipPicture[], ready: PipPicture[]): PipSlot[] =>
    ORDER.filter((p) => shown.includes(p) || ready.includes(p)).map((picture) => ({
      picture,
      shown: shown.includes(picture),
    }));
  return { main: slots(now.main, later.main), box: slots(now.box, later.box) };
}

// ---- the main picture in a swap (Session 51; a dissolve since Session 52) -------------------------------------

/**
 * What the main picture does in a swap (Session 52): the background and the box's own picture (or, for a box of
 * the slides, the slide) change places there, the one going as the other comes, a dissolve, while the box makes
 * its own move; a slide over both (anything but the slides in the box) stays whole. It dissolves in the half of
 * the swap in which the box moves the same way: the box's own picture (or the slide), which lies over the
 * background, comes in as the box comes in again (the second half) and goes as the box goes out (the first).
 * Only opacity changes, as every picture only dissolves (docs/design.md §40), so a darshan picture stays whole:
 * none on the main picture shrinks, grows or slides, whatever the box's motion. Session 51 gave the box's own
 * picture (or the slide) the box's own move, whole on the screen's black, the background staying whole under it.
 */
export interface PipMainDissolve {
  going: PipPicture;
  coming: PipPicture;
  half: 'first' | 'second';
}

/** The main picture's dissolve in this run of the box: only while it swaps. */
export function pipMainDissolve(run: Pick<PipRun, 'phase' | 'layer' | 'from'>): PipMainDissolve | null {
  const { layer, from } = run;
  if (run.phase !== 'swap' || !layer || !from) return null;
  const was = pipDraw(layer.source.kind, from.swapped).main;
  const will = pipDraw(layer.source.kind, layer.swapped).main;
  const going = was.find((p) => !will.includes(p));
  const coming = will.find((p) => !was.includes(p));
  if (going === undefined || coming === undefined) return null;
  return { going, coming, half: ORDER.indexOf(coming) > ORDER.indexOf(going) ? 'second' : 'first' };
}

/**
 * One of the main picture's two pictures at `now` as it dissolves (pipMainPlaces marks them), coming in or going
 * out over its half of the swap (pipMainDissolve), on the Movement's curve as a slide's dissolve is (Calm on
 * smoothstep, Bold on its ease in and out: transition-frame.ts dissolveCurve), the two adding up to one at every
 * moment; whole when nothing dissolves.
 */
export function pipMainOpacity(run: PipRun, way: 'in' | 'out', now: number): number {
  const dissolve = pipMainDissolve(run);
  if (!dissolve || run.length <= 0) return 1;
  const half = run.length / 2;
  const e = seg(now, run.start + (dissolve.half === 'second' ? half : 0), half, dissolveCurve(run.movement));
  return way === 'in' ? e : 1 - e;
}

/**
 * While a box is up, the main picture keeps the background in its place even where it does not show it (swapped),
 * unseen and playing: a swap back then shows it at once. Put on the page only then, a picture or a video draws
 * nothing until its first frame, and the picture going from over it would dissolve into black meanwhile.
 */
const keptBackground = (kind: PipSource['kind'] | null, slots: PipSlot[]): PipSlot[] =>
  kind === null || slots.some((s) => s.picture === 'background')
    ? slots
    : [{ picture: 'background', shown: false }, ...slots];

/**
 * The main picture's pictures, bottom to top, at a moment of the box's run (`run`: the box up's own, or null when
 * this screen draws none), the box up `swapped` or not: as pipPlaces has them, the background kept unseen while
 * the box is swapped (keptBackground), but through the half of a swap in which the main picture dissolves
 * (pipMainDissolve), what it showed and what it will show alike, the one going and the one coming marked so
 * (`dissolve`), the upper of the two added light for light over the other (`adds`), as a slide's dissolve adds the
 * new slide: the two add up to the whole picture at every moment, so it never dips or goes black, with nothing
 * laid under it, on every screen alike (a key and fill pair's too, where black laid under it would be keyed).
 */
export function pipMainPlaces(
  kind: PipSource['kind'] | null,
  run: Pick<PipRun, 'phase' | 'layer' | 'from' | 'swapped'> | null,
  swapped: boolean,
): PipSlot[] {
  if (!run) return keptBackground(kind, pipPlaces(kind, swapped, swapped).main);
  const dissolve = pipMainDissolve(run);
  // Before the swap's middle it is drawn as it was: a dissolve in the first half runs then, one in the second after.
  const first = run.swapped !== swapped;
  if (!dissolve || !run.from || (dissolve.half === 'first') !== first)
    return keptBackground(kind, pipPlaces(kind, run.swapped, swapped).main);
  const was = pipDraw(kind, run.from.swapped).main;
  const will = pipDraw(kind, swapped).main;
  const { going, coming } = dissolve;
  const upper = ORDER.indexOf(coming) > ORDER.indexOf(going) ? coming : going;
  return ORDER.filter((p) => was.includes(p) || will.includes(p)).map((picture): PipSlot => {
    if (picture !== going && picture !== coming) return { picture, shown: true };
    const way = picture === coming ? 'in' : 'out';
    return picture === upper
      ? { picture, shown: true, dissolve: way, adds: true }
      : { picture, shown: true, dissolve: way };
  });
}

/** A video input and another app's window are this computer's: only its own pages draw them (never a node or a phone). */
export const pipShowsHere = (source: PipSource, live: boolean): boolean =>
  live || source.kind === 'slides' || source.kind === 'media';

/**
 * Session 50: 'pip' joins the layers a Look can leave out of a group (s8-engine, shared/looks.ts). Until the
 * Looks know it, every group shows the box; then a group's Look shows it only when its layers list it.
 */
const LOOKS_KNOW_PIP = (LOOK_LAYERS as readonly string[]).includes('pip');

/** Whether a group's screens draw the box in the live Look. */
export const pipShownFor = (look: Pick<LiveGroupLook, 'layers'>, known = LOOKS_KNOW_PIP): boolean =>
  !known || (look.layers as readonly string[]).includes('pip');

/**
 * What the box holds, in words, for LIVE and a phone ("Picture in picture: a video", "Picture in picture:
 * Input 1"): by its kind, or the input's or window's own name (the state carries no media name).
 */
export function pipName(source: PipSource): string {
  switch (source.kind) {
    case 'slides':
      return 'the slides';
    case 'media':
      return source.media === 'video' ? 'a video' : 'a picture';
    case 'input':
    case 'window':
      return source.name;
  }
}
