import type { EngineState, MediaFit } from '../../../../shared/engine/state';
import type { SlideElement } from '../../../../shared/model';
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

/**
 * The frame of the picture the live zoom zooms, in what the phone draws, as fractions of it (past its edges too): its
 * box as its slide places it, before any turn. The screens zoom and move a picture in that box, unturned; a picture
 * turned or flipped in its slide (Turn page right turns a PDF page's picture so) has the box flipped and turned
 * about its middle after that (render/SlideView.tsx frameStyle): `turn` says how, so the phone's view is turned
 * back into the box (a22-zoomturn).
 */
export interface ZoomFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Where the screens show their middle, in the same fractions, where that is not the frame's own middle: a page
   * cropped with Crop page… keeps its picture's box on the whole page, and the screens show only the crop, so the
   * middle shown is the crop's (the slide's, and in the canvas the canvas's, which centres it). Left out otherwise.
   */
  middle?: { x: number; y: number };
  turn?: FrameTurn;
}

/** How a picture's box is turned and flipped in what the phone draws; left out for neither. */
export interface FrameTurn {
  /** Degrees clockwise about the box's middle, as its slide turns it (model.ts ElementBase.rotation). */
  rotation: number;
  /** Flipped in its box, before its turn. */
  flipX?: boolean;
  flipY?: boolean;
  /** What the phone draws, its width over its height: a turn keeps the picture's shape, not its fractions. */
  aspect: number;
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

/**
 * The picture a phone may zoom on the screens (Session 54, D2 review): the slide's own picture, or the background
 * picture while no slide is up. Never the background behind a slide of words: the engine would zoom it, but neither
 * the slide's page nor the hall's picture on the phone shows it as the picture zoomed, so the side button would
 * change what the phone does not show.
 */
export function phoneZoomTarget(state: EngineState | null): { mediaId: string; showing: string } | null {
  const target = zoomTargetOf(state);
  const slide = state?.layers.slide;
  if (!target || (slide && target.showing !== slideShowing(slide.shownAt))) return null;
  return target;
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
  // The middle of the phone's view, from the frame's middle, in the frame's own widths and heights (turned back).
  const { x: dx, y: dy } = intoFrame(
    view.cx - (frame.x + fw / 2),
    view.cy - (frame.y + fh / 2),
    frame,
    fw,
    fh,
  );
  const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom * kept.zoom));
  // That point of the picture, as the kept look draws it, brought to the frame's middle at the new zoom, or to the
  // middle the screens show where that is not the frame's (a cropped page's crop).
  const to = middleIn(frame, fw, fh);
  const x = (-zoom * (dx - kept.x)) / kept.zoom;
  const y = (-zoom * (dy - kept.y)) / kept.zoom;
  const at = framed({ ...PLAIN, zoom, x: to ? to.x + x : x, y: to ? to.y + y : y });
  // No "-0": in the middle is 0, however it was worked out.
  const plain = (v: number) => (v === 0 ? 0 : v);
  return { zoom: at.zoom, x: plain(at.x), y: plain(at.y) };
}

/** The phone's view that shows what a live zoom shows (opening on a picture already zoomed on the screens). */
export function viewForLive(z: Framing, frame: ZoomFrame, kept: Framing): View {
  const zoom = z.zoom / (kept.zoom > 0 ? kept.zoom : 1);
  const to = middleIn(frame, frame.width > 0 ? frame.width : 1, frame.height > 0 ? frame.height : 1);
  const at = outOfFrame(
    kept.x - ((to ? z.x - to.x : z.x) * kept.zoom) / z.zoom,
    kept.y - ((to ? z.y - to.y : z.y) * kept.zoom) / z.zoom,
    frame,
  );
  return {
    zoom,
    cx: frame.x + frame.width / 2 + at.x,
    cy: frame.y + frame.height / 2 + at.y,
  };
}

/**
 * Where the screens show their middle, from the frame's middle in its own widths and heights (turned back, as the
 * phone's view is); null for the frame's own.
 */
function middleIn(frame: ZoomFrame, fw: number, fh: number): { x: number; y: number } | null {
  const m = frame.middle;
  return m ? intoFrame(m.x - (frame.x + fw / 2), m.y - (frame.y + fh / 2), frame, fw, fh) : null;
}

/** A turn's cosine and sine: exact for the quarter turns (Turn page right's). */
function turning(degrees: number): { cos: number; sin: number } {
  if (degrees === 90) return { cos: 0, sin: 1 };
  if (degrees === 180) return { cos: -1, sin: 0 };
  if (degrees === 270) return { cos: 0, sin: -1 };
  const r = (degrees * Math.PI) / 180;
  return { cos: Math.cos(r), sin: Math.sin(r) };
}

/**
 * A point of what the phone draws, from the frame's middle in its fractions, in the frame's own widths and heights:
 * turned back and flipped back as its box is turned and flipped (as is, when it is neither).
 */
function intoFrame(
  dx: number,
  dy: number,
  frame: ZoomFrame,
  fw: number,
  fh: number,
): { x: number; y: number } {
  const turn = frame.turn;
  if (!turn) return { x: dx / fw, y: dy / fh };
  const a = turn.aspect > 0 ? turn.aspect : 1;
  const { cos, sin } = turning(turn.rotation);
  // In heights of what the phone draws, both ways, so that turning keeps lengths.
  const vx = dx * a;
  const x = vx * cos + dy * sin;
  const y = -vx * sin + dy * cos;
  return { x: (turn.flipX ? -x : x) / (fw * a), y: (turn.flipY ? -y : y) / fh };
}

/** The other way: a point in the frame's own widths and heights, from its middle, in fractions of what is drawn. */
function outOfFrame(x: number, y: number, frame: ZoomFrame): { x: number; y: number } {
  const turn = frame.turn;
  if (!turn) return { x: x * frame.width, y: y * frame.height };
  const a = turn.aspect > 0 ? turn.aspect : 1;
  const { cos, sin } = turning(turn.rotation);
  const lx = (turn.flipX ? -x : x) * frame.width * a;
  const ly = (turn.flipY ? -y : y) * frame.height;
  return { x: (lx * cos - ly * sin) / a, y: lx * sin + ly * cos };
}

/**
 * How a slide's picture is turned and flipped (render/SlideView.tsx frameStyle), for its frame in what the phone
 * draws, `aspect` wide for each of its heights; nothing for neither, so its frame is as it was before.
 */
function turnOf(element: SlideElement, aspect: number): { turn?: FrameTurn } {
  const rotation = (((element.rotation ?? 0) % 360) + 360) % 360;
  if (rotation === 0 && !element.flipX && !element.flipY) return {};
  return {
    turn: {
      rotation,
      ...(element.flipX ? { flipX: true } : {}),
      ...(element.flipY ? { flipY: true } : {}),
      aspect,
    },
  };
}

/** How far the screens can follow a phone's zoom of a picture kept zoomed so: to their own 400 % in all. */
export const maxZoomOver = (kept: Framing): number => Math.max(1, ZOOM.max / (kept.zoom > 0 ? kept.zoom : 1));

/**
 * Whether the screens can show this view as it is (D1/D2 review): a phone zooms to 400 % of what it draws whatever
 * the picture's kept look, and the side button is offered only as far as the screens can follow it.
 */
export const screensFollow = (view: View, kept: Framing): boolean => view.zoom <= maxZoomOver(kept) + 1e-6;

/**
 * The live zoom's picture's frame in the hall's picture as a phone draws it (the canvas, the slide fitted into it,
 * as the remote's live picture does): the slide's picture's own box, or the whole canvas for the background up
 * alone; null when the phone may zoom neither (phoneZoomTarget). A cropped PDF page (Crop page…) is drawn moved by
 * where its crop starts (render/SlideView.tsx), its picture's box kept on the whole page: so is its frame, and the
 * screens show the crop in their middle (`middle`). A page turned with Turn page right keeps its picture's box
 * unturned, the box turned about its middle: so is its frame.
 */
export function frameInCanvas(state: EngineState | null, canvas: Size): ZoomFrame | null {
  const target = phoneZoomTarget(state);
  const slide = state?.layers.slide;
  if (!target) return null;
  if (!slide) return FULL_FRAME;
  const element = slide.slide.elements.find((e) => e.kind === 'image');
  if (!element || canvas.width <= 0 || canvas.height <= 0) return null;
  const p = placeContent({ width: slide.slide.width, height: slide.slide.height }, canvas, 'fit');
  const origin = slide.slide.pageCrop ?? { x: 0, y: 0 };
  return {
    x: (p.x + (element.frame.x - origin.x) * p.scaleX) / canvas.width,
    y: (p.y + (element.frame.y - origin.y) * p.scaleY) / canvas.height,
    width: (element.frame.width * p.scaleX) / canvas.width,
    height: (element.frame.height * p.scaleY) / canvas.height,
    // The fit centres the crop in the canvas.
    ...(slide.slide.pageCrop ? { middle: { x: 0.5, y: 0.5 } } : {}),
    ...turnOf(element, canvas.width / canvas.height),
  };
}

/**
 * The same in a slide a phone draws on its own (looked through, Session 54): the slide's picture's own box (with no
 * slide up, the whole of it), moved by a cropped page's crop, its middle the crop's, and turned as in frameInCanvas;
 * null when the phone may zoom neither (phoneZoomTarget).
 */
export function frameInSlide(state: EngineState | null): ZoomFrame | null {
  const target = phoneZoomTarget(state);
  const slide = state?.layers.slide;
  if (!target) return null;
  if (!slide) return FULL_FRAME;
  const element = slide.slide.elements.find((e) => e.kind === 'image');
  const { width, height } = slide.slide;
  if (!element || width <= 0 || height <= 0) return null;
  const origin = slide.slide.pageCrop ?? { x: 0, y: 0 };
  return {
    x: (element.frame.x - origin.x) / width,
    y: (element.frame.y - origin.y) / height,
    width: element.frame.width / width,
    height: element.frame.height / height,
    ...(slide.slide.pageCrop ? { middle: { x: 0.5, y: 0.5 } } : {}),
    ...turnOf(element, width / height),
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
