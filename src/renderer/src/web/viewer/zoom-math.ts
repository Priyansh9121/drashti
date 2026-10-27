/*
 * A phone's own zoom (Session 54, D1): two fingers zoom and pan what the phone looks at, on the phone only. The
 * view is how far it is zoomed (1: the whole of it, fitted in) and which point of it is in the middle (fractions
 * of its width and height), kept so the picture never leaves an empty edge where it is bigger than the screen.
 * Pure arithmetic, tested on its own (zoom-math.test.ts); ZoomSurface.tsx moves it with the fingers.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface View {
  /** 1: the whole of it fitted into the screen; 2: twice as big. */
  zoom: number;
  /** The point of it in the middle of the screen, as fractions of its width and height (0.5: the middle). */
  cx: number;
  cy: number;
}

export const WHOLE: View = { zoom: 1, cx: 0.5, cy: 0.5 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** How big it is drawn at zoom 1: fitted whole into the screen. */
export function fitScale(content: Size, screen: Size): number {
  if (content.width <= 0 || content.height <= 0 || screen.width <= 0 || screen.height <= 0) return 0;
  return Math.min(screen.width / content.width, screen.height / content.height);
}

/**
 * The view kept to what makes sense: its zoom from 1 to `maxZoom`, and moved no further than its edges reach the
 * screen's (in the middle, along a side where it is smaller than the screen).
 */
export function clampView(v: View, content: Size, screen: Size, maxZoom: number): View {
  const zoom = clamp(Number.isFinite(v.zoom) ? v.zoom : 1, 1, Math.max(1, maxZoom));
  const s = fitScale(content, screen) * zoom;
  if (s <= 0) return { zoom, cx: 0.5, cy: 0.5 };
  const halfX = screen.width / (2 * s * content.width);
  const halfY = screen.height / (2 * s * content.height);
  const along = (c: number, half: number) =>
    half >= 0.5 ? 0.5 : clamp(Number.isFinite(c) ? c : 0.5, half, 1 - half);
  return { zoom, cx: along(v.cx, halfX), cy: along(v.cy, halfY) };
}

/** The CSS transform (from its top left corner) that draws it so on the screen. */
export function viewTransform(v: View, content: Size, screen: Size): string {
  const s = fitScale(content, screen) * v.zoom;
  const tx = screen.width / 2 - v.cx * content.width * s;
  const ty = screen.height / 2 - v.cy * content.height * s;
  return `translate(${String(tx)}px, ${String(ty)}px) scale(${String(s)})`;
}

/** The point of it (fractions) under a point of the screen (CSS pixels from the screen's top left corner). */
export function pointAt(v: View, content: Size, screen: Size, at: Point): Point {
  const s = fitScale(content, screen) * v.zoom;
  if (s <= 0) return { x: 0.5, y: 0.5 };
  return {
    x: v.cx + (at.x - screen.width / 2) / (s * content.width),
    y: v.cy + (at.y - screen.height / 2) / (s * content.height),
  };
}

/** The view at `zoom` with the point `p` of it under the screen's point `at`. */
function holding(p: Point, at: Point, zoom: number, content: Size, screen: Size, maxZoom: number): View {
  const z = clamp(zoom, 1, Math.max(1, maxZoom));
  const s = fitScale(content, screen) * z;
  if (s <= 0) return WHOLE;
  return clampView(
    {
      zoom: z,
      cx: p.x - (at.x - screen.width / 2) / (s * content.width),
      cy: p.y - (at.y - screen.height / 2) / (s * content.height),
    },
    content,
    screen,
    maxZoom,
  );
}

/** Zoomed by `factor` about a point of the screen, which stays where it is (a double tap, the wheel, a button). */
export function zoomedAt(
  v: View,
  factor: number,
  at: Point,
  content: Size,
  screen: Size,
  maxZoom: number,
): View {
  return holding(pointAt(v, content, screen, at), at, v.zoom * factor, content, screen, maxZoom);
}

/**
 * Two fingers: the view they started on (`from`), where they were then (`a0`, `b0`) and are now (`a1`, `b1`). It
 * zooms as they spread or close, and the point between them stays between them as they move.
 */
export function pinched(
  from: View,
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  content: Size,
  screen: Size,
  maxZoom: number,
): View {
  const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
  const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const factor = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  return holding(pointAt(from, content, screen, m0), m1, from.zoom * factor, content, screen, maxZoom);
}

/** One finger, zoomed in: what is under it goes with it. */
export function panned(from: View, p0: Point, p1: Point, content: Size, screen: Size, maxZoom: number): View {
  return holding(pointAt(from, content, screen, p0), p1, from.zoom, content, screen, maxZoom);
}

/** Moved by a share of the screen (the arrow keys): (1, 0) moves it a whole screen's width to the left. */
export function nudged(v: View, by: Point, content: Size, screen: Size, maxZoom: number): View {
  const middle = { x: screen.width / 2, y: screen.height / 2 };
  const to = { x: middle.x + by.x * screen.width, y: middle.y + by.y * screen.height };
  return holding(pointAt(v, content, screen, to), middle, v.zoom, content, screen, maxZoom);
}

/** Two views the same, near enough for a person (a thousandth of the zoom, of the place). */
export const sameView = (a: View, b: View): boolean =>
  Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(a.cx - b.cx) < 1e-3 && Math.abs(a.cy - b.cy) < 1e-3;
