import type { EngineState, MediaFit } from '../../../../shared/engine/state';
import { backgroundShowing, framed, PLAIN, slideShowing, ZOOM } from '../../../../shared/picture-look';
import { placeContent, type Size } from '../../../../shared/scaling';
import type { View } from './zoom-math';

/*
 * Show it on the screens (Session 54, D2): what a phone looks at, zoomed with two fingers, put on the screens as
 * the engine's live zoom (Session 26e) of the picture there: the slide's own picture, else the background
 * picture, as the engine chooses it. The phone draws that picture with its kept look and without the live zoom,
 * so its own zoom is the whole difference; the screens are then given the zoom and place that show what the phone
 * shows in the middle of its screen, as big. Pure arithmetic, tested on its own (live-zoom.test.ts).
 */

/** A picture's zoom and place in its frame: as kept (its look) or zoomed live; the screens' own terms. */
export interface Framing {
  zoom: number;
  x: number;
  y: number;
}

/** The frame of the picture the live zoom zooms, in what the phone draws, as fractions of it (past its edges too). */
export interface ZoomFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_FRAME: ZoomFrame = { x: 0, y: 0, width: 1, height: 1 };

/**
 * The picture the engine's live zoom zooms on the screens now (show-engine.ts zoomTarget): the slide's own first
 * picture, else the background picture; null when neither is up.
 */
export function zoomTargetOf(state: EngineState | null): { mediaId: string; showing: string } | null {
  const slide = state?.layers.slide;
  const picture = slide?.slide.elements.find((e) => e.kind === 'image');
  if (slide && picture?.kind === 'image')
    return { mediaId: picture.mediaId, showing: slideShowing(slide.shownAt) };
  const bg = state?.layers.background;
  if (bg?.kind === 'media' && bg.media === 'image')
    return { mediaId: bg.mediaId, showing: backgroundShowing(bg.startedAt) };
  return null;
}

/** How the picture on the screens is kept (its look's zoom and place): what the phone draws, unzoomed. */
export function keptFraming(state: EngineState | null, mediaId: string): Framing {
  const look = state?.pictures[mediaId] ?? PLAIN;
  return { zoom: look.zoom, x: look.x, y: look.y };
}

const near = (a: Framing, b: Framing) =>
  Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;

/** Where the screens' picture is zoomed to now, live; null while it is as kept (no live zoom, or back to whole). */
export function liveFramingOf(state: EngineState | null): Framing | null {
  const target = zoomTargetOf(state);
  const z = state?.liveZoom;
  if (!target || z?.mediaId !== target.mediaId || z.showing !== target.showing) return null;
  const at = { zoom: z.zoom, x: z.x, y: z.y };
  return near(at, keptFraming(state, target.mediaId)) ? null : at;
}

/**
 * The live zoom that shows on the screens what `view` shows: the point of the phone's picture in the middle of its
 * screen in the middle of the frame, as big as the phone shows it (its own zoom over the kept look), kept within
 * what the screens allow (framed: the picture always covers its frame).
 */
export function liveZoomFor(view: View, frame: ZoomFrame, kept: Framing): Framing {
  const fw = frame.width > 0 ? frame.width : 1;
  const fh = frame.height > 0 ? frame.height : 1;
  // The middle of the phone's view, from the frame's middle, in the frame's widths and heights.
  const dx = (view.cx - (frame.x + fw / 2)) / fw;
  const dy = (view.cy - (frame.y + fh / 2)) / fh;
  const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom * kept.zoom));
  // That point of the picture, as the kept look draws it, brought to the frame's middle at the new zoom.
  const at = framed({
    ...PLAIN,
    zoom,
    x: (-zoom * (dx - kept.x)) / kept.zoom,
    y: (-zoom * (dy - kept.y)) / kept.zoom,
  });
  // No "-0": in the middle is 0, however it was worked out.
  const plain = (v: number) => (v === 0 ? 0 : v);
  return { zoom: at.zoom, x: plain(at.x), y: plain(at.y) };
}

/** The phone's view that shows what a live zoom shows (opening on a picture already zoomed on the screens). */
export function viewForLive(z: Framing, frame: ZoomFrame, kept: Framing): View {
  const zoom = z.zoom / (kept.zoom > 0 ? kept.zoom : 1);
  const dx = kept.x - (z.x * kept.zoom) / z.zoom;
  const dy = kept.y - (z.y * kept.zoom) / z.zoom;
  return {
    zoom,
    cx: frame.x + frame.width / 2 + dx * frame.width,
    cy: frame.y + frame.height / 2 + dy * frame.height,
  };
}

/** The most a phone zooms a picture it can show on the screens: so far that the screens can follow it (400 %). */
export const maxZoomOver = (kept: Framing): number => Math.max(1, ZOOM.max / (kept.zoom > 0 ? kept.zoom : 1));

/**
 * The live zoom's picture's frame in the hall's picture as a phone draws it (the canvas, the slide fitted into it,
 * as the remote's live picture does): the slide's picture's own box, or the whole canvas for the background.
 */
export function frameInCanvas(state: EngineState | null, canvas: Size): ZoomFrame | null {
  const target = zoomTargetOf(state);
  const slide = state?.layers.slide;
  if (!target || !slide || target.showing !== slideShowing(slide.shownAt)) return target ? FULL_FRAME : null;
  const element = slide.slide.elements.find((e) => e.kind === 'image');
  if (!element || canvas.width <= 0 || canvas.height <= 0) return null;
  const p = placeContent({ width: slide.slide.width, height: slide.slide.height }, canvas, 'fit');
  return {
    x: (p.x + element.frame.x * p.scaleX) / canvas.width,
    y: (p.y + element.frame.y * p.scaleY) / canvas.height,
    width: (element.frame.width * p.scaleX) / canvas.width,
    height: (element.frame.height * p.scaleY) / canvas.height,
  };
}

/**
 * The same in a slide a phone draws on its own (looked through, Session 54): the slide's picture's own box, or the
 * whole slide for the background behind it.
 */
export function frameInSlide(state: EngineState | null): ZoomFrame | null {
  const target = zoomTargetOf(state);
  const slide = state?.layers.slide;
  if (!target || !slide || target.showing !== slideShowing(slide.shownAt)) return target ? FULL_FRAME : null;
  const element = slide.slide.elements.find((e) => e.kind === 'image');
  const { width, height } = slide.slide;
  if (!element || width <= 0 || height <= 0) return null;
  return {
    x: element.frame.x / width,
    y: element.frame.y / height,
    width: element.frame.width / width,
    height: element.frame.height / height,
  };
}

/**
 * A picture a phone shows on its own, in its own shape, while it is the background on the screens: where the
 * screens' frame (the canvas, the picture drawn in it by its fit) is, in the picture's fractions.
 */
export function frameOfBackground(fit: MediaFit, picture: Size, canvas: Size): ZoomFrame {
  if (
    fit === 'stretch' ||
    picture.width <= 0 ||
    picture.height <= 0 ||
    canvas.width <= 0 ||
    canvas.height <= 0
  )
    return FULL_FRAME;
  const p = picture.width / picture.height;
  const c = canvas.width / canvas.height;
  // Fitted whole: the canvas reaches past the picture's narrower sides; filling: the picture past the canvas's.
  const across = fit === 'fit' ? p >= c : p < c;
  if (across) return { x: 0, y: (1 - p / c) / 2, width: 1, height: p / c };
  return { x: (1 - c / p) / 2, y: 0, width: c / p, height: 1 };
}
