import { z } from 'zod';

/*
 * A picture's look (Session 26e; PLAN §7): how it is framed (zoomed 100 to
 * 400 %, moved) and enhanced (brightness, contrast, colour, sharpness), kept
 * with the media item so it is the same wherever it shows: every screen, a
 * node, the stream's picture, key and fill's fill, a phone's picture and the
 * thumbnails. The file is never changed. Videos: not now.
 *
 * The enhancements are the screens' own filters (CSS brightness, contrast
 * and saturate, and a sharpening convolution), so a picture costs the same
 * to show however it is enhanced.
 */

export interface PictureLook {
  /** 1 (100 %, the picture as it fits) to 4 (400 %). */
  zoom: number;
  /** Where it is moved to, as a fraction of its frame's width and height (0: centred). */
  x: number;
  y: number;
  /** -0.5 to 0.5: brightness, contrast and colour (saturation) less or more; 0 as it is. */
  brightness: number;
  contrast: number;
  /** -1 (grey) to 1 (twice as colourful). */
  colour: number;
  /** 0 to 1: sharper. */
  sharpness: number;
}

export const PLAIN: PictureLook = {
  zoom: 1,
  x: 0,
  y: 0,
  brightness: 0,
  contrast: 0,
  colour: 0,
  sharpness: 0,
};

export const ZOOM = { min: 1, max: 4 } as const;

const within = (min: number, max: number) => z.number().min(min).max(max);

export const pictureLookSchema: z.ZodType<PictureLook> = z.object({
  zoom: within(ZOOM.min, ZOOM.max),
  x: within(-1.5, 1.5),
  y: within(-1.5, 1.5),
  brightness: within(-0.5, 0.5),
  contrast: within(-0.5, 0.5),
  colour: within(-1, 1),
  sharpness: within(0, 1),
});

/** Whether a look changes nothing (a picture shown as it is). */
export const isPlain = (look: PictureLook | null | undefined): boolean =>
  !look ||
  (look.zoom === 1 &&
    look.x === 0 &&
    look.y === 0 &&
    look.brightness === 0 &&
    look.contrast === 0 &&
    look.colour === 0 &&
    look.sharpness === 0);

/** A stored look as Drashti reads it: what is valid, else none. */
export function lookOf(json: string | null): PictureLook | null {
  if (!json) return null;
  try {
    const parsed = pictureLookSchema.safeParse(JSON.parse(json));
    return parsed.success && !isPlain(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * How far a picture can move at a zoom before an edge of it comes inside its frame: half of what the zoom
 * adds, each way (none at 100 %).
 */
export const moveRoom = (zoom: number): number => Math.max(0, (zoom - 1) / 2);

/** A look with its zoom and place kept inside what makes sense: the picture always covers what it covered. */
export function framed(look: PictureLook): PictureLook {
  const zoom = clamp(look.zoom, ZOOM.min, ZOOM.max);
  const room = moveRoom(zoom);
  return { ...look, zoom, x: clamp(look.x, -room, room), y: clamp(look.y, -room, room) };
}

/**
 * Fill: the zoom at which a picture of `picture`'s shape, fitted in a frame of `frame`'s shape, covers the
 * whole frame (1 when its shape is the frame's).
 */
export function fillZoom(
  picture: { width: number; height: number },
  frame: { width: number; height: number },
): number {
  if (picture.width <= 0 || picture.height <= 0 || frame.width <= 0 || frame.height <= 0) return 1;
  const p = picture.width / picture.height;
  const f = frame.width / frame.height;
  return clamp(Math.max(p / f, f / p), ZOOM.min, ZOOM.max);
}

/**
 * Auto: brightness and contrast from the picture itself, stretching its levels so its darkest (1 %) and
 * brightest (99 %) become black and white, as far as the sliders go. `histogram`: 256 counts of luminance.
 * The screens draw brightness first, then contrast: v' = (v·B − ½)·C + ½, so B = 1/(lo + hi) and
 * C = (hi + lo)/(hi − lo).
 */
export function autoLevels(histogram: readonly number[]): { brightness: number; contrast: number } {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return { brightness: 0, contrast: 0 };
  const level = (share: number) => {
    let seen = 0;
    for (let i = 0; i < histogram.length; i++) {
      seen += histogram[i] ?? 0;
      if (seen >= total * share) return i / 255;
    }
    return 1;
  };
  const lo = level(0.01);
  const hi = Math.max(lo + 1 / 255, level(0.99));
  const b = 1 / (lo + hi);
  const c = (hi + lo) / (hi - lo);
  const round = (v: number) => Math.round(v * 100) / 100;
  return { brightness: round(clamp(b - 1, -0.5, 0.5)), contrast: round(clamp(c - 1, -0.5, 0.5)) };
}

/** The screens' CSS filter for a look's enhancements, without its sharpening (none when there are none). */
export function cssFilter(look: PictureLook | null | undefined): string {
  if (!look) return '';
  const parts: string[] = [];
  if (look.brightness !== 0) parts.push(`brightness(${String(round3(1 + look.brightness))})`);
  if (look.contrast !== 0) parts.push(`contrast(${String(round3(1 + look.contrast))})`);
  if (look.colour !== 0) parts.push(`saturate(${String(round3(1 + look.colour))})`);
  return parts.join(' ');
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Sharpening in steps of 5 %: one filter each, made once per page. */
export const sharpenStep = (sharpness: number): number => Math.round(clamp(sharpness, 0, 1) * 20) * 5;

/** The 3 × 3 kernel of a sharpening of `percent` (0 to 100): the centre lifted, its four sides lowered. */
export function sharpenKernel(percent: number): number[] {
  const a = clamp(percent, 0, 100) / 100;
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
}

/**
 * The live zoom (Session 26e): the picture on the screens zoomed and moved for this showing only, from
 * the LIVE preview, Pro Mode's. The screens go from where it was (`from`) to it over ZOOM_GLIDE_MS from
 * `at` (the engine's clock), so they follow smoothly and in step.
 */
export interface LiveZoom {
  mediaId: string;
  /** Which showing it belongs to: it ends when another slide or background comes up. */
  showing: string;
  zoom: number;
  x: number;
  y: number;
  /** Where it was going from, and when it set off. */
  from: { zoom: number; x: number; y: number };
  at: number;
}

export const ZOOM_GLIDE_MS = 250;

/** A slide's showing, for a live zoom: by when it came on. */
export const slideShowing = (shownAt: number): string => `slide:${String(shownAt)}`;
/** A background picture's showing: by when it came up. */
export const backgroundShowing = (startedAt: number): string => `bg:${String(startedAt)}`;

/** Where a live zoom is at `now`: on its way from `from` (eased), or there. */
export function liveZoomAt(z: LiveZoom, now: number): { zoom: number; x: number; y: number } {
  const p = clamp((now - z.at) / ZOOM_GLIDE_MS, 0, 1);
  const e = 1 - (1 - p) ** 3;
  const mix = (a: number, b: number) => a + (b - a) * e;
  return { zoom: mix(z.from.zoom, z.zoom), x: mix(z.from.x, z.x), y: mix(z.from.y, z.y) };
}
