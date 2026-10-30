/*
 * The slide editor's zoom (Session 55, Part 17a). The slide opens fitted to its area, as it always did; zoomed, it is
 * drawn at a size of its own (a scale of the slide's own pixels) and scrolls in its area. Zoom in and Zoom out step
 * through the sizes a presentation program offers, from wherever it is (fit included); a pinch on the trackpad (the
 * wheel with Ctrl) goes as far as it goes, within the same ends. The point under the pointer stays under it.
 */

/** Fitted to the area, or a scale of the slide's own pixels. */
export type Zoom = 'fit' | number;

/** The sizes Zoom in and Zoom out step through. */
export const ZOOM_STEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 4;

const clamp = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/** The scale the slide is drawn at. */
export function scaleFor(zoom: Zoom, fit: number): number {
  return zoom === 'fit' ? fit : zoom;
}

/** The next size up from where it is. */
export function zoomIn(zoom: Zoom, fit: number): number {
  const now = scaleFor(zoom, fit);
  return ZOOM_STEPS.find((s) => s > now + 1e-6) ?? MAX_ZOOM;
}

/** The next size down from where it is. */
export function zoomOut(zoom: Zoom, fit: number): number {
  const now = scaleFor(zoom, fit);
  return [...ZOOM_STEPS].reverse().find((s) => s < now - 1e-6) ?? MIN_ZOOM;
}

/** A pinch: the size it is, by this much, within the ends. */
export function zoomBy(zoom: Zoom, fit: number, factor: number): number {
  return clamp(scaleFor(zoom, fit) * factor);
}

/** Its size as a share of the slide's own: "27%". */
export function zoomLabel(zoom: Zoom, fit: number): string {
  return `${String(Math.round(scaleFor(zoom, fit) * 100))}%`;
}

/**
 * Where the area scrolls to (along one axis) so the point of the slide under the pointer stays under it, the size
 * going from `from` to `to`: `pointer` is where the pointer is in the area, `scroll` how far the area is scrolled,
 * `offset` where the slide starts in the area's content, and `offsetAfter` where it starts at the new size (the slide
 * sits in the middle while it is smaller than its area); left out, where it was.
 */
export function zoomScroll(o: {
  pointer: number;
  scroll: number;
  offset: number;
  offsetAfter?: number;
  from: number;
  to: number;
}): number {
  const point = (o.pointer + o.scroll - o.offset) / o.from;
  return Math.max(0, Math.round((o.offsetAfter ?? o.offset) + point * o.to - o.pointer));
}
