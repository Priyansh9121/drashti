import { z } from 'zod';

/*
 * A picture's look (Session 26e; PLAN §7): how it is framed (zoomed 100 to
 * 400 %, moved) and enhanced (brightness, contrast, colour, sharpness), kept
 * with the media item so it is the same wherever it shows: every screen, a
 * node, the stream's picture, key and fill's fill, a phone's picture and the
 * thumbnails. The file is never changed. Videos: not now.
 *
 * The enhancements are the screens' own filters (CSS brightness, contrast
 * and saturate), so a picture costs the same to show however it is
 * enhanced. Sharpening is made once per picture instead (Session 26f): a
 * sharpened copy, with the kernel below, that the screens draw in its place;
 * a convolution filter took up to a second a change without a graphics chip.
 *
 * Session 55 (Part 5): a picture is also turned in quarter turns, flipped
 * across or up and down, and cropped (free, 16:9, 4:3 or 1:1), all kept
 * with it and drawn by placing the picture, never by changing the file; and
 * a photo that does not fill its screen has a blurred, darker copy of itself
 * behind it (its `fill`), made once (src/main/media/blurred.ts).
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
  /**
   * Given to the screens and thumbnails only, never kept (Session 26f): the step of the picture's sharpened
   * copy that is ready, drawn in place of the picture (absent while it is being made: drawn unsharpened).
   */
  copy?: number;
  /** Turned clockwise in quarter turns (Session 55); absent: as it was taken. */
  turn?: Turn;
  /** Flipped across, left for right, and up and down (Session 55), after its turn. */
  flipX?: boolean;
  flipY?: boolean;
  /** The part kept (Session 55), as fractions of the picture turned and flipped; absent: all of it. */
  crop?: CropRect;
  /** The crop's shape as chosen in the Picture editor (Session 55): free, or kept to a shape. */
  cropShape?: CropShape;
  /**
   * The picture's own size in pixels, as the Picture editor read it (Session 55): a turned or cropped picture is
   * drawn in its place from the first frame, before its file is read.
   */
  size?: PixelSize;
  /**
   * A blurred, darker copy of itself behind it where it does not fill its screen (Session 55, D); absent: as its
   * kind is (on for a photo, off for a deck's slide).
   */
  fill?: boolean;
  /** Given to the screens only, never kept (Session 55): its blurred copy is ready, and it is drawn behind it. */
  blurred?: true;
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

/** A picture's quarter turns, clockwise (Session 55). */
export const TURNS = [0, 90, 180, 270] as const;
export type Turn = (typeof TURNS)[number];

/** The crop's shapes the Picture editor offers (Session 55): free, or kept to a shape. */
export const CROP_SHAPES = ['free', '16:9', '4:3', '1:1'] as const;
export type CropShape = (typeof CROP_SHAPES)[number];

/** A part of a picture: its left, top, width and height as fractions of the picture (turned and flipped). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The whole picture. */
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
/** A crop is never smaller than this, each way, as a fraction of the picture. */
export const MIN_CROP = 0.05;

const cropSchema = z
  .object({ x: within(0, 1), y: within(0, 1), w: within(MIN_CROP, 1), h: within(MIN_CROP, 1) })
  .refine((c) => c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001);

export const pictureLookSchema: z.ZodType<PictureLook> = z.object({
  zoom: within(ZOOM.min, ZOOM.max),
  x: within(-1.5, 1.5),
  y: within(-1.5, 1.5),
  brightness: within(-0.5, 0.5),
  contrast: within(-0.5, 0.5),
  colour: within(-1, 1),
  sharpness: within(0, 1),
  // Session 55: optional, so a look kept before reads as it was.
  turn: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  crop: cropSchema.optional(),
  cropShape: z.enum(CROP_SHAPES).optional(),
  size: z
    .object({ width: z.number().int().min(1).max(100_000), height: z.number().int().min(1).max(100_000) })
    .optional(),
  fill: z.boolean().optional(),
});

/** A crop that keeps all of the picture (or none at all). */
const isWhole = (crop: CropRect | undefined): boolean =>
  !crop || (crop.x <= 1e-4 && crop.y <= 1e-4 && crop.w >= 1 - 1e-4 && crop.h >= 1 - 1e-4);

/** Whether a look turns, flips or crops its picture (Session 55). */
export const hasEdit = (look: PictureLook | null | undefined): boolean =>
  !!look && ((look.turn ?? 0) !== 0 || look.flipX === true || look.flipY === true || !isWhole(look.crop));

/** Whether a look changes nothing (a picture shown as it is). */
export const isPlain = (look: PictureLook | null | undefined): boolean =>
  !look ||
  (look.zoom === 1 &&
    look.x === 0 &&
    look.y === 0 &&
    look.brightness === 0 &&
    look.contrast === 0 &&
    look.colour === 0 &&
    look.sharpness === 0 &&
    !hasEdit(look) &&
    look.fill === undefined);

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

/**
 * A look with its zoom and place kept inside what makes sense: the picture always covers what it covered. Its
 * turn, flips and crop (Session 55) are left out where they change nothing, so it is kept as small as it is.
 */
export function framed(look: PictureLook): PictureLook {
  const zoom = clamp(look.zoom, ZOOM.min, ZOOM.max);
  const room = moveRoom(zoom);
  const { turn, flipX, flipY, crop, cropShape, size, ...rest } = look;
  const edited = hasEdit(look);
  return {
    ...rest,
    zoom,
    x: clamp(look.x, -room, room),
    y: clamp(look.y, -room, room),
    ...(turn ? { turn } : {}),
    ...(flipX ? { flipX } : {}),
    ...(flipY ? { flipY } : {}),
    ...(crop && !isWhole(crop) ? { crop } : {}),
    ...(cropShape && cropShape !== 'free' ? { cropShape } : {}),
    // Its size, for drawing it turned or cropped before its file is read: only while it is.
    ...(size && edited ? { size } : {}),
  };
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

/**
 * The step of a look's sharpened copy that the screens draw in place of the picture (Session 26f), or 0: the
 * picture itself, unsharpened (no sharpening, or its copy at this sharpness not ready yet).
 */
export function copyStep(look: PictureLook | null | undefined): number {
  const step = look ? sharpenStep(look.sharpness) : 0;
  return step > 0 && look?.copy === step ? step : 0;
}

/** The 3 × 3 kernel of a sharpening of `percent` (0 to 100): the centre lifted, its four sides lowered. */
export function sharpenKernel(percent: number): number[] {
  const a = clamp(percent, 0, 100) / 100;
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
}

/**
 * A picture's pixels sharpened as the screens' filter sharpened them (Session 26f): the kernel of
 * `percent`, each colour from its pixel and the four beside it, a pixel past the edge taken as the edge's
 * own, the colours not premultiplied and the alpha kept. `src` is RGBA, as ImageData holds it; it is left as
 * it was. The sharpened copy is made with it once per picture, so no screen draws a filter.
 */
export function sharpenPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  percent: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const a = clamp(percent, 0, 100) / 100;
  if (a === 0) return out;
  const centre = 1 + 4 * a;
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : y) * row;
    const down = (y < height - 1 ? y + 1 : y) * row;
    const here = y * row;
    for (let x = 0; x < width; x++) {
      const at = here + x * 4;
      const left = here + (x > 0 ? x - 1 : x) * 4;
      const right = here + (x < width - 1 ? x + 1 : x) * 4;
      const above = up + x * 4;
      const below = down + x * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          centre * (src[at + c] ?? 0) -
          a * ((src[left + c] ?? 0) + (src[right + c] ?? 0) + (src[above + c] ?? 0) + (src[below + c] ?? 0));
        // Uint8ClampedArray rounds half to even and stops at 0 and 255.
        out[at + c] = v;
      }
    }
  }
  return out;
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

/*
 * A sharpened copy's size (Session 26g). The copy is made at the size the screens draw the picture,
 * so the hall sees the sharpening the Picture editor shows: the picture fitted whole into the
 * largest audience screen's picture (its canvas as drawn on its display, in pixels), at the
 * picture's kept zoom, and never bigger than the picture itself. With no audience screen, its own
 * size.
 */

export interface PixelSize {
  width: number;
  height: number;
}

/** A screen's canvas as it is drawn in its window or on its display, in pixels (fit, fill or stretch). */
export function drawnCanvas(
  canvas: PixelSize,
  window: PixelSize,
  scaling: 'fit' | 'fill' | 'stretch',
): PixelSize {
  if (scaling === 'stretch') return { width: Math.round(window.width), height: Math.round(window.height) };
  const sx = window.width / canvas.width;
  const sy = window.height / canvas.height;
  const s = scaling === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy);
  return { width: Math.round(canvas.width * s), height: Math.round(canvas.height * s) };
}

/** The box a picture is drawn in on the largest audience screen, at its kept zoom (null: no screen). */
export function copyBox(screen: PixelSize | null, zoom: number): PixelSize | null {
  if (!screen || screen.width < 1 || screen.height < 1) return null;
  const z = Math.min(4, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  return { width: Math.round(screen.width * z), height: Math.round(screen.height * z) };
}

/** The copy's own size: the picture fitted whole into the box, never bigger than it is. */
export function copySize(picture: PixelSize, box: PixelSize | null): PixelSize {
  if (!box) return { width: picture.width, height: picture.height };
  const s = Math.min(1, box.width / picture.width, box.height / picture.height);
  return {
    width: Math.max(1, Math.round(picture.width * s)),
    height: Math.max(1, Math.round(picture.height * s)),
  };
}

/*
 * Crop, turn and flip (Session 55, Part 5). A picture is drawn turned (clockwise, in quarter turns), then flipped
 * (across, and up and down, as it then shows), then cropped (a part of it as it then shows), and fitted into its box
 * as its fit says: all by placing the picture with percentages of its box, from the first frame, the same on every
 * screen, node, phone and thumbnail. The file is never changed.
 */

/** A picture's size turned: a quarter turn swaps its width and height. */
export function turnedSize(size: PixelSize, turn: Turn | undefined): PixelSize {
  return turn === 90 || turn === 270 ? { width: size.height, height: size.width } : size;
}

/** A picture's size as it shows (turned, then cropped), in its own pixels. */
export function shownSize(look: PictureLook | null | undefined, size: PixelSize): PixelSize {
  const turned = turnedSize(size, look?.turn);
  const crop = look?.crop ?? FULL_CROP;
  return { width: turned.width * crop.w, height: turned.height * crop.h };
}

/**
 * A quarter turn clockwise of the picture as it shows: its turn on by 90°, its flips swapped (a picture flipped
 * across and then turned is the turned picture flipped up and down), and the same part of it kept.
 */
export function turnClockwise(look: PictureLook): PictureLook {
  const turn = (((look.turn ?? 0) + 90) % 360) as Turn;
  const c = look.crop;
  return {
    ...look,
    turn,
    flipX: look.flipY === true,
    flipY: look.flipX === true,
    ...(c ? { crop: { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } } : {}),
  };
}

/** Flipped across (left for right), as it shows: the same part of it kept. */
export function flipAcross(look: PictureLook): PictureLook {
  const c = look.crop;
  return { ...look, flipX: look.flipX !== true, ...(c ? { crop: { ...c, x: 1 - (c.x + c.w) } } : {}) };
}

/** Flipped up and down, as it shows: the same part of it kept. */
export function flipUpDown(look: PictureLook): PictureLook {
  const c = look.crop;
  return { ...look, flipY: look.flipY !== true, ...(c ? { crop: { ...c, y: 1 - (c.y + c.h) } } : {}) };
}

/** A shape's width over its height; null for a free crop. */
export function shapeRatio(shape: CropShape | undefined): number | null {
  switch (shape) {
    case '16:9':
      return 16 / 9;
    case '4:3':
      return 4 / 3;
    case '1:1':
      return 1;
    default:
      return null;
  }
}

/**
 * The largest crop of a shape that fits in the picture (`turned`: its size as it shows before the crop), centred
 * where `around` is centred (the whole picture when left out). A free shape keeps `around` as it is.
 */
export function shapedCrop(shape: CropShape, turned: PixelSize, around: CropRect = FULL_CROP): CropRect {
  const ratio = shapeRatio(shape);
  if (ratio === null || turned.width <= 0 || turned.height <= 0) return around;
  // In fractions of the picture: the shape's width over its height is ratio · H / W.
  const r = (ratio * turned.height) / turned.width;
  const w = r >= 1 ? 1 : r;
  const h = r >= 1 ? 1 / r : 1;
  const cx = around.x + around.w / 2;
  const cy = around.y + around.h / 2;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/**
 * A crop moved or resized by a drag, kept inside the picture, at least MIN_CROP each way, and (a shape's) in its
 * shape: `edge` is what was dragged ('move' for the whole crop), `dx` and `dy` how far, in fractions of the picture.
 */
export function dragCrop(
  from: CropRect,
  edge: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
  dx: number,
  dy: number,
  shape: CropShape,
  turned: PixelSize,
): CropRect {
  if (edge === 'move')
    return { ...from, x: clamp(from.x + dx, 0, 1 - from.w), y: clamp(from.y + dy, 0, 1 - from.h) };
  let left = from.x;
  let top = from.y;
  let right = from.x + from.w;
  let bottom = from.y + from.h;
  if (edge.includes('w')) left = clamp(left + dx, 0, right - MIN_CROP);
  if (edge.includes('e')) right = clamp(right + dx, left + MIN_CROP, 1);
  if (edge.includes('n')) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  const ratio = shapeRatio(shape);
  if (ratio === null || turned.width <= 0 || turned.height <= 0)
    return { x: left, y: top, w: right - left, h: bottom - top };
  // A shape: the height follows the width (a side edge or a corner), or the width the height (top or bottom),
  // anchored at the side not dragged, and both made smaller where it would leave the picture.
  const r = (ratio * turned.height) / turned.width;
  let w = right - left;
  let h = bottom - top;
  if (edge === 'n' || edge === 's') w = h * r;
  else h = w / r;
  const anchorX = edge.includes('w') ? right : edge.includes('e') ? left : from.x + from.w / 2;
  const anchorY = edge.includes('n') ? bottom : edge.includes('s') ? top : from.y + from.h / 2;
  const roomX = edge.includes('w')
    ? anchorX
    : edge.includes('e')
      ? 1 - anchorX
      : 2 * Math.min(anchorX, 1 - anchorX);
  const roomY = edge.includes('n')
    ? anchorY
    : edge.includes('s')
      ? 1 - anchorY
      : 2 * Math.min(anchorY, 1 - anchorY);
  const s = Math.min(1, roomX / w, roomY / h);
  w = Math.max(MIN_CROP, w * s);
  h = Math.max(MIN_CROP, h * s);
  const x = edge.includes('w') ? anchorX - w : edge.includes('e') ? anchorX : anchorX - w / 2;
  const y = edge.includes('n') ? anchorY - h : edge.includes('s') ? anchorY : anchorY - h / 2;
  return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
}

/** A box's part, in percent of it. */
export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where an edited picture goes in its box (Session 55): editLayout. */
export interface EditLayout {
  /** The part of the picture kept, fitted into the box (percent of the box): it clips the picture. */
  frame: PercentBox;
  /** The picture itself, in its own orientation (percent of the frame), before its own transform. */
  picture: PercentBox;
  /** Its turn and flips, about its centre ('' for none). */
  transform: string;
}

const pct = (v: number) => Math.round(v * 1e6) / 1e4;

/**
 * Where a turned, flipped or cropped picture is drawn (Session 55): its kept part fitted into a box of `box`'s
 * shape (contain, cover or fill, as its fit says), and the whole picture placed and turned behind it so that part
 * shows there. `size`: the picture's own size in pixels (its look's).
 */
export function editLayout(
  look: PictureLook,
  size: PixelSize,
  box: PixelSize,
  fit: 'contain' | 'cover' | 'fill',
): EditLayout {
  const turn = look.turn ?? 0;
  const crop = look.crop ?? FULL_CROP;
  const shown = shownSize(look, size);
  const bw = box.width > 0 ? box.width : 1;
  const bh = box.height > 0 ? box.height : 1;
  let fw = bw;
  let fh = bh;
  if (fit !== 'fill' && shown.width > 0 && shown.height > 0) {
    const s =
      fit === 'contain'
        ? Math.min(bw / shown.width, bh / shown.height)
        : Math.max(bw / shown.width, bh / shown.height);
    fw = shown.width * s;
    fh = shown.height * s;
  }
  // The picture as it shows before the crop (turned and flipped), in the frame's pixels.
  const tw = fw / crop.w;
  const th = fh / crop.h;
  const tx = -crop.x * tw;
  const ty = -crop.y * th;
  // The picture in its own orientation: a quarter turn swaps its sides, about the same centre.
  const quarter = turn === 90 || turn === 270;
  const pw = quarter ? th : tw;
  const ph = quarter ? tw : th;
  const px = tx + tw / 2 - pw / 2;
  const py = ty + th / 2 - ph / 2;
  const parts: string[] = [];
  if (look.flipX === true || look.flipY === true)
    parts.push(`scale(${look.flipX === true ? -1 : 1}, ${look.flipY === true ? -1 : 1})`);
  if (turn !== 0) parts.push(`rotate(${String(turn)}deg)`);
  return {
    frame: {
      left: pct((bw - fw) / 2 / bw),
      top: pct((bh - fh) / 2 / bh),
      width: pct(fw / bw),
      height: pct(fh / bh),
    },
    picture: { left: pct(px / fw), top: pct(py / fh), width: pct(pw / fw), height: pct(ph / fh) },
    transform: parts.join(' '),
  };
}

/**
 * The box a picture's sharpened copy is made for (Session 26g; Session 55, P5): the size the largest audience screen
 * draws the whole picture at, in its own orientation. Turned or cropped (its look's size known), the part kept
 * fills the screen as it fits, so the whole picture is drawn that much bigger; else as copyBox has it.
 */
export function copyBoxOf(screen: PixelSize | null, look: PictureLook | null | undefined): PixelSize | null {
  const zoom = look?.zoom ?? 1;
  if (!look?.size || !hasEdit(look)) return copyBox(screen, zoom);
  if (!screen || screen.width < 1 || screen.height < 1) return null;
  const shown = shownSize(look, look.size);
  if (shown.width <= 0 || shown.height <= 0) return copyBox(screen, zoom);
  const z = Math.min(4, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const s = Math.min(screen.width / shown.width, screen.height / shown.height) * z;
  return { width: Math.round(look.size.width * s), height: Math.round(look.size.height * s) };
}

/**
 * Whether a picture of this shape leaves bars in a box of that one when fitted in (Session 55, D): only then is its
 * blurred copy drawn behind it. Not known (a phone's preview, a box not measured), it is.
 */
export function leavesBars(picture: PixelSize | null, box: PixelSize | null): boolean {
  if (!picture || !box || picture.width <= 0 || picture.height <= 0 || box.width <= 0 || box.height <= 0)
    return true;
  const ratio = picture.width / picture.height / (box.width / box.height);
  // A small copy's sides are whole pixels: within 2 % is the box's own shape.
  return Math.abs(ratio - 1) > 0.02;
}
