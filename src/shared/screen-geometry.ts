import type { Placement, Size } from './scaling';
import { placeContent } from './scaling';
import type { ScalingMode } from './screens';

/*
 * A screen's geometry (x27, 19 Nov 2026; PLAN §2's "Edge blend, corner-pin, output scaling"), kept with the screen and
 * drawn on its output window's whole picture (renderer/src/output/main.tsx), never on the stream or anywhere else:
 * - output scaling: a zoom about the display's centre and a move, on top of Fit, Fill or Stretch, for a display that
 *   cuts the picture's edges (a television's overscan);
 * - corner-pin (keystone): each corner of the picture moved, so a projector that is not square to the wall shows a
 *   true rectangle. One homography for the whole picture, written as a CSS matrix3d;
 * - edge blend: the part of a wide canvas a screen shows (two to four projectors overlapping into one picture), and a
 *   soft, gamma-correct ramp over each overlap: the two projectors' light adds up to the picture's own across it.
 * Null, or every field as NO_GEOMETRY has it, is nothing set: the screen draws exactly as it did before.
 */

export interface Point {
  x: number;
  y: number;
}

/** Top left, top right, bottom right, bottom left. */
export type Corners = readonly [Point, Point, Point, Point];

/** The slice of the canvas a screen shows, in canvas pixels: its left edge and its width (the canvas's height). */
export interface ScreenPart {
  x: number;
  width: number;
}

/** The overlaps at each side of a screen's part, in canvas pixels, and how their ramps fall. */
export interface ScreenBlend {
  left: number;
  right: number;
  /** The projector's gamma: a pixel value v gives light v^gamma. */
  gamma: number;
  /** The ramp's shape: 1 a straight line, 2 a soft S (the usual), more for a steeper middle. */
  curve: number;
}

export interface ScreenGeometry {
  /** The picture's size about the display's centre: 1 as Fit, Fill or Stretch places it. */
  zoom: number;
  /** The picture's move, as shares of the display's width and height. */
  offsetX: number;
  offsetY: number;
  /** Where each corner of the picture goes: a move from the display's own corner, as shares of its width and height. */
  corners: Corners;
  /** The part of the canvas this screen shows (edge blend); null: all of it. */
  part: ScreenPart | null;
  /** The ramps over its overlaps; null: none. */
  blend: ScreenBlend | null;
}

/** The bounds of each setting (shared/screens-schema.ts checks them in Main). */
export const GEOMETRY_LIMITS = {
  zoom: { min: 0.5, max: 2 },
  /** A move, and a corner's, at most half the display. */
  move: 0.5,
  gamma: { min: 1, max: 3 },
  curve: { min: 1, max: 4 },
  /** Each side of the pinned picture at least this share of the display. */
  side: 1 / 8,
  /** One wide picture: from two screens to this many. */
  wide: 4,
} as const;

export const DEFAULT_GAMMA = 2.2;
export const DEFAULT_CURVE = 2;

const ZERO: Point = { x: 0, y: 0 };

/** Nothing set: the screen draws as it did before x27. */
export const NO_GEOMETRY: ScreenGeometry = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  corners: [ZERO, ZERO, ZERO, ZERO],
  part: null,
  blend: null,
};

/** The corners of the unit square, in the order of Corners. */
const SQUARE: Corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** No zoom, no move and no corner moved: the picture is not warped. */
export function warpsNothing(g: ScreenGeometry): boolean {
  return g.zoom === 1 && g.offsetX === 0 && g.offsetY === 0 && g.corners.every((c) => c.x === 0 && c.y === 0);
}

/** A blend with an overlap to draw. */
export const blends = (b: ScreenBlend | null): b is ScreenBlend => b !== null && (b.left > 0 || b.right > 0);

/** Nothing set at all: the screen draws exactly as before. */
export function nothingSet(g: ScreenGeometry | null | undefined): boolean {
  return g === null || g === undefined || (warpsNothing(g) && g.part === null && !blends(g.blend));
}

/** A 3 × 3 matrix, row by row: (x, y, 1) goes to (m0 x + m1 y + m2, m3 x + m4 y + m5) / (m6 x + m7 y + m8). */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

/** Where a matrix takes a point. */
export function applyMatrix(m: Matrix3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

/** a × b: b first, then a. */
export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const at = (m: Matrix3, r: number, c: number) => m[r * 3 + c] ?? 0;
  const cell = (r: number, c: number) => at(a, r, 0) * at(b, 0, c) + at(a, r, 1) * at(b, 1, c) + at(a, r, 2) * at(b, 2, c);
  return [
    cell(0, 0),
    cell(0, 1),
    cell(0, 2),
    cell(1, 0),
    cell(1, 1),
    cell(1, 2),
    cell(2, 0),
    cell(2, 1),
    cell(2, 2),
  ];
}

/**
 * The homography taking the unit square's corners, (0, 0), (1, 0), (1, 1) and (0, 1), to q's in turn (Heckbert's
 * square-to-quadrilateral, 1989). Null when three of q's corners are on one line.
 */
export function squareToQuad(q: Corners): Matrix3 | null {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const det = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
    if (Math.abs(det) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  const m: Matrix3 = [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
  // Three corners on one line: the map flattens the square, and there is no picture there.
  const [a, b, c, d, e, f] = m;
  const det3 = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(d), Math.abs(e));
  return Math.abs(det3) < 1e-9 * scale * scale ? null : m;
}

/** Where the four corners of a box go: each its own corner moved by its share of the box. */
export function pinnedCorners(g: Pick<ScreenGeometry, 'corners'>, box: Size): Corners {
  const at = (i: 0 | 1 | 2 | 3): Point => {
    const base = SQUARE[i];
    const move = g.corners[i];
    return { x: base.x * box.width + move.x * box.width, y: base.y * box.height + move.y * box.height };
  };
  return [at(0), at(1), at(2), at(3)];
}

/**
 * A box's picture warped, box pixels to box pixels: zoomed about the box's centre and moved first, then the whole box
 * pinned by its corners. Null when it is not warped, or the box has no size yet.
 */
export function warpMatrix(g: ScreenGeometry, box: Size): Matrix3 | null {
  if (warpsNothing(g) || !(box.width > 0) || !(box.height > 0)) return null;
  const cx = box.width / 2;
  const cy = box.height / 2;
  const zoom: Matrix3 = [
    g.zoom,
    0,
    cx - g.zoom * cx + g.offsetX * box.width,
    0,
    g.zoom,
    cy - g.zoom * cy + g.offsetY * box.height,
    0,
    0,
    1,
  ];
  const toSquare: Matrix3 = [1 / box.width, 0, 0, 0, 1 / box.height, 0, 0, 0, 1];
  const pin = squareToQuad(pinnedCorners(g, box));
  if (!pin) return null;
  return multiply(multiply(pin, toSquare), zoom);
}

/** A number as CSS takes it: never -0, at most 12 decimals. */
const css = (v: number) => {
  const n = Number(v.toFixed(12));
  return String(n === 0 ? 0 : n);
};

/**
 * The CSS transform of a box's warp (with transform-origin 0 0), or null when it is not warped: the same 3 × 3
 * homography as a 4 × 4 matrix3d (column by column, z left as it is).
 */
export function warpTransform(g: ScreenGeometry | null | undefined, box: Size): string | null {
  if (!g) return null;
  const m = warpMatrix(g, box);
  if (!m) return null;
  const [a, b, c, d, e, f, gg, h, i] = m;
  return `matrix3d(${[a, d, 0, gg, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].map(css).join(', ')})`;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * Why corners cannot be pinned, in words, or null when they can: each move at most half the display, and the picture
 * kept a convex four-sided shape the same way round, each side at least an eighth of the display. So a picture can
 * never fold over, turn inside out or vanish. Worked in shares of the display: stretching it keeps all of that.
 */
export function cornersProblem(corners: Corners): string | null {
  if (
    corners.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y)) ||
    corners.some((c) => Math.abs(c.x) > GEOMETRY_LIMITS.move || Math.abs(c.y) > GEOMETRY_LIMITS.move)
  )
    return 'A corner moves at most half the display.';
  const q = pinnedCorners({ corners }, { width: 1, height: 1 });
  for (let i = 0; i < 4; i++) {
    const a = q[i] ?? ZERO;
    const b = q[(i + 1) % 4] ?? ZERO;
    if (Math.hypot(b.x - a.x, b.y - a.y) < GEOMETRY_LIMITS.side)
      return 'Each side of the picture must stay at least an eighth of the display.';
  }
  for (let i = 0; i < 4; i++)
    if (cross(q[i] ?? ZERO, q[(i + 1) % 4] ?? ZERO, q[(i + 2) % 4] ?? ZERO) <= 1e-9)
      return 'The corners must keep the picture a four-sided shape, the same way round.';
  return null;
}

/**
 * The share of the light a screen gives across an overlap, t from 0 at its outer edge to 1 where the overlap ends:
 * ½(2t)^curve, then 1 - ½(2(1 - t))^curve. So f(t) + f(1 - t) = 1: two screens' light adds up to the picture's own.
 */
export function blendLight(t: number, curve: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 0.5 * (2 * u) ** curve : 1 - 0.5 * (2 * (1 - u)) ** curve;
}

/**
 * What a pixel there is multiplied by, so its light is blendLight's on a projector of this gamma: a value v gives
 * light v^gamma, so (v·m)^gamma = f·v^gamma when m = f^(1/gamma).
 */
export function blendFactor(t: number, curve: number, gamma: number): number {
  return blendLight(t, curve) ** (1 / gamma);
}

/**
 * A ramp as drawn: black over the picture, one alpha (0-255) a column, the outer edge's first; black with alpha
 * 1 - m multiplies the picture's values by m (Chromium blends the encoded values). Each column at its centre.
 */
export function rampAlphas(columns: number, curve: number, gamma: number): Uint8ClampedArray {
  const n = Math.max(0, Math.floor(columns));
  const out = new Uint8ClampedArray(n);
  for (let j = 0; j < n; j++) out[j] = Math.round((1 - blendFactor((j + 0.5) / n, curve, gamma)) * 255);
  return out;
}

/**
 * Where a canvas goes in a box when the screen shows only its part (null: all of it, as placeContent places it): the
 * part placed by the screen's scaling, the canvas moved left by the part's own left edge.
 */
export function placePart(canvas: Size, part: ScreenPart | null, box: Size, mode: ScalingMode): Placement {
  if (part === null) return placeContent(canvas, box, mode);
  const p = placeContent({ width: part.width, height: canvas.height }, box, mode);
  return { ...p, x: p.x - part.x * p.scaleX };
}

/** The canvas clipped to its part (a CSS clip-path in canvas pixels), so nothing beside it shows; none without one. */
export function partClip(canvas: Size, part: ScreenPart | null): string | undefined {
  if (part === null) return undefined;
  const right = Math.max(0, canvas.width - part.x - part.width);
  return `inset(0px ${css(right)}px 0px ${css(part.x)}px)`;
}

/**
 * One wide picture from `count` screens of one size side by side, each overlapping the next by `overlap` canvas
 * pixels: the wide canvas, and each screen's part and ramps, left to right (the ramps on the inner edges only).
 */
export function widePicture(
  count: number,
  screen: Size,
  overlap: number,
  gamma = DEFAULT_GAMMA,
  curve = DEFAULT_CURVE,
): { canvas: Size; screens: { part: ScreenPart; blend: ScreenBlend }[] } {
  const n = Math.max(1, Math.floor(count));
  return {
    canvas: { width: n * screen.width - (n - 1) * overlap, height: screen.height },
    screens: Array.from({ length: n }, (_, i) => ({
      part: { x: i * (screen.width - overlap), width: screen.width },
      blend: { left: i > 0 ? overlap : 0, right: i < n - 1 ? overlap : 0, gamma, curve },
    })),
  };
}
