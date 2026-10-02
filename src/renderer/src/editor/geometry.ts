import type { Rect } from '../../../shared/model';

/*
 * The slide editor's geometry, in slide pixels: turned frames, what is under
 * the pointer, resizing from a handle (a turned frame keeps its opposite
 * corner or edge where it is), turning, snapping to the slide and to other
 * elements, and lining up and spacing out.
 */

export interface Point {
  x: number;
  y: number;
}

/** A frame and how far it is turned (degrees clockwise about its centre). */
export interface Placed {
  frame: Rect;
  rotation?: number | undefined;
}

export const centerOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const rad = (deg: number) => (deg * Math.PI) / 180;

/** `p` turned `deg` degrees clockwise about `c` (y grows downwards). */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const cos = Math.cos(rad(deg));
  const sin = Math.sin(rad(deg));
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** The corners of a turned frame: top left, top right, bottom right, bottom left. */
export function cornersOf({ frame: f, rotation = 0 }: Placed): Point[] {
  const c = centerOf(f);
  return [
    { x: f.x, y: f.y },
    { x: f.x + f.width, y: f.y },
    { x: f.x + f.width, y: f.y + f.height },
    { x: f.x, y: f.y + f.height },
  ].map((p) => rotatePoint(p, c, rotation));
}

/** The upright box round a turned frame. */
export function boundsOf(p: Placed): Rect {
  if (!p.rotation) return p.frame;
  const pts = cornersOf(p);
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The upright box round several frames. */
export function unionOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Whether a point is on a turned frame, give or take `slack` (so a thin line
 * or a small box can still be picked).
 */
export function contains(p: Placed, point: Point, slack = 0): boolean {
  const f = p.frame;
  const local = rotatePoint(point, centerOf(f), -(p.rotation ?? 0));
  return (
    local.x >= f.x - slack &&
    local.x <= f.x + f.width + slack &&
    local.y >= f.y - slack &&
    local.y <= f.y + f.height + slack
  );
}

/** The topmost element under the point (the list is bottom to top), or null. */
export function hitTest(
  elements: readonly (Placed & { id: string })[],
  point: Point,
  slack = 0,
): string | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el && contains(el, point, slack)) return el.id;
  }
  return null;
}

/** Whether two upright boxes overlap. */
export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A box from two corners, in any order. */
export const boxBetween = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

// ---- resizing and turning -------------------------------------------------------------

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where a handle sits on the frame, as shares of its width and height (0, 0.5 or 1). */
export const HANDLE_AT: Record<Handle, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

/**
 * The frame after dragging a handle to `pointer`. The opposite corner (or
 * edge) stays where it is on the slide, also when the frame is turned. With
 * `keepRatio` a corner keeps the frame's proportions. Never smaller than `min`.
 */
export function resizeFrame(
  p: Placed,
  handle: Handle,
  pointer: Point,
  { keepRatio = false, min = 4 }: { keepRatio?: boolean; min?: number } = {},
): Rect {
  const f = p.frame;
  const rotation = p.rotation ?? 0;
  const at = HANDLE_AT[handle];
  // The fixed point: opposite the handle (its middle on the axis the handle does not move).
  const anchorShare = { x: 1 - at.x, y: 1 - at.y };
  const anchorLocal = { x: f.x + anchorShare.x * f.width, y: f.y + anchorShare.y * f.height };
  const anchor = rotatePoint(anchorLocal, centerOf(f), rotation);
  // The pointer, seen along the frame's own axes, from the fixed point.
  const v = rotatePoint(pointer, anchor, -rotation);
  const dx = v.x - anchor.x;
  const dy = v.y - anchor.y;
  const movesX = at.x !== 0.5;
  const movesY = at.y !== 0.5;
  let width = movesX ? Math.max(min, at.x === 1 ? dx : -dx) : f.width;
  let height = movesY ? Math.max(min, at.y === 1 ? dy : -dy) : f.height;
  if (keepRatio && movesX && movesY && f.width > 0 && f.height > 0) {
    const scale = Math.max(width / f.width, height / f.height);
    width = Math.max(min, f.width * scale);
    height = Math.max(min, f.height * scale);
  }
  // Put the new frame so its fixed point is where it was.
  const newAnchorLocal = { x: anchorShare.x * width, y: anchorShare.y * height };
  const toCenter = { x: width / 2 - newAnchorLocal.x, y: height / 2 - newAnchorLocal.y };
  const turned = rotatePoint({ x: toCenter.x, y: toCenter.y }, { x: 0, y: 0 }, rotation);
  const center = { x: anchor.x + turned.x, y: anchor.y + turned.y };
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Degrees in 0 up to 360. */
export const normalizeAngle = (deg: number): number => {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
};

/**
 * The turn that points the frame's top towards `pointer`. In steps of 15
 * degrees with `step`; otherwise held at a quarter turn within `snapWithin`.
 */
export function rotationToward(
  frame: Rect,
  pointer: Point,
  { step = false, snapWithin = 0 }: { step?: boolean; snapWithin?: number } = {},
): number {
  const c = centerOf(frame);
  // Straight up is no turn.
  let deg = normalizeAngle((Math.atan2(pointer.y - c.y, pointer.x - c.x) * 180) / Math.PI + 90);
  if (step) deg = normalizeAngle(Math.round(deg / 15) * 15);
  else if (snapWithin > 0) {
    const quarter = Math.round(deg / 90) * 90;
    if (Math.abs(deg - quarter) <= snapWithin) deg = normalizeAngle(quarter);
  }
  return Math.round(deg * 100) / 100;
}

// ---- snapping -------------------------------------------------------------------------

/** Lines things snap to: x positions (upright lines) and y positions (level lines). */
export interface SnapLines {
  x: number[];
  y: number[];
}

/** The slide's edges and middle, and each other element's edges and middle. */
export function snapLines(slide: { width: number; height: number }, others: readonly Rect[]): SnapLines {
  const x = [0, slide.width / 2, slide.width];
  const y = [0, slide.height / 2, slide.height];
  for (const r of others) {
    x.push(r.x, r.x + r.width / 2, r.x + r.width);
    y.push(r.y, r.y + r.height / 2, r.y + r.height);
  }
  return { x, y };
}

/** The guides to draw: where something snapped. */
export interface Guides {
  x: number[];
  y: number[];
}

function nearest(values: readonly number[], lines: readonly number[], within: number) {
  let best: { delta: number; at: number } | null = null;
  for (const v of values)
    for (const line of lines) {
      const delta = line - v;
      if (Math.abs(delta) <= within && (!best || Math.abs(delta) < Math.abs(best.delta)))
        best = { delta, at: line };
    }
  return best;
}

/**
 * How far to nudge a box being moved so its edges or middle meet the
 * nearest line (each way, within `within`), and the guides that shows.
 */
export function snapMove(
  box: Rect,
  lines: SnapLines,
  within: number,
): { dx: number; dy: number; guides: Guides } {
  const sx = nearest([box.x, box.x + box.width / 2, box.x + box.width], lines.x, within);
  const sy = nearest([box.y, box.y + box.height / 2, box.y + box.height], lines.y, within);
  const dx = sx?.delta ?? 0;
  const dy = sy?.delta ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  // Every line the moved box now meets is shown (a box can meet two at once).
  const meets = (values: number[], ls: readonly number[]) => [
    ...new Set(ls.filter((l) => values.some((v) => Math.abs(v - l) < 0.01))),
  ];
  return {
    dx,
    dy,
    guides: {
      x: sx ? meets([moved.x, moved.x + moved.width / 2, moved.x + moved.width], lines.x) : [],
      y: sy ? meets([moved.y, moved.y + moved.height / 2, moved.y + moved.height], lines.y) : [],
    },
  };
}

/** A resized upright frame with the edges the handle moves snapped to the nearest lines. */
export function snapResize(
  frame: Rect,
  handle: Handle,
  lines: SnapLines,
  within: number,
): { frame: Rect; guides: Guides } {
  const at = HANDLE_AT[handle];
  let { x, y, width, height } = frame;
  const guides: Guides = { x: [], y: [] };
  if (at.x !== 0.5) {
    const edge = at.x === 1 ? x + width : x;
    const s = nearest([edge], lines.x, within);
    if (s) {
      if (at.x === 1) width += s.delta;
      else {
        x += s.delta;
        width -= s.delta;
      }
      guides.x.push(s.at);
    }
  }
  if (at.y !== 0.5) {
    const edge = at.y === 1 ? y + height : y;
    const s = nearest([edge], lines.y, within);
    if (s) {
      if (at.y === 1) height += s.delta;
      else {
        y += s.delta;
        height -= s.delta;
      }
      guides.y.push(s.at);
    }
  }
  return { frame: { x, y, width: Math.max(1, width), height: Math.max(1, height) }, guides };
}

// ---- lining up and spacing out ----------------------------------------------------------

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * How far to move each box to line them up: with each other when there are
 * several, or with the slide when there is one. Boxes are upright bounds.
 */
export function alignMoves(
  boxes: readonly Rect[],
  how: Alignment,
  slide: { width: number; height: number },
): Point[] {
  const area = boxes.length > 1 ? unionOf(boxes) : { x: 0, y: 0, ...slide };
  if (!area) return [];
  return boxes.map((b) => {
    switch (how) {
      case 'left':
        return { x: area.x - b.x, y: 0 };
      case 'center':
        return { x: area.x + area.width / 2 - (b.x + b.width / 2), y: 0 };
      case 'right':
        return { x: area.x + area.width - (b.x + b.width), y: 0 };
      case 'top':
        return { x: 0, y: area.y - b.y };
      case 'middle':
        return { x: 0, y: area.y + area.height / 2 - (b.y + b.height / 2) };
      case 'bottom':
        return { x: 0, y: area.y + area.height - (b.y + b.height) };
    }
  });
}

/**
 * How far to move each box so the gaps between them are equal across or
 * down (the first and last stay where they are). Needs three or more.
 */
export function distributeMoves(boxes: readonly Rect[], axis: 'x' | 'y'): Point[] {
  const moves = boxes.map(() => ({ x: 0, y: 0 }));
  if (boxes.length < 3) return moves;
  const size = (b: Rect) => (axis === 'x' ? b.width : b.height);
  const start = (b: Rect) => (axis === 'x' ? b.x : b.y);
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => start(p.b) - start(q.b));
  const first = order[0]?.b;
  const last = order.at(-1)?.b;
  if (!first || !last) return moves;
  const span = start(last) + size(last) - start(first);
  const gap = (span - order.reduce((n, o) => n + size(o.b), 0)) / (order.length - 1);
  let at = start(first);
  for (const { b, i } of order) {
    const delta = at - start(b);
    moves[i] = axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta };
    at += size(b) + gap;
  }
  return moves;
}
