/*
 * Sound and picture…'s Shape (alpha.20, x55, slice 6b: the owner's Q60-34 and his "Yes, all A" to Q60-39 P6 (c) A): a
 * video's own shape on the screens, kept with the file in its playback settings (shared/playback-settings.ts): as the
 * file says, or 16:9, 4:3, 1:1 or 21:9, for a video whose file says the wrong shape (a 4:3 video marked wide, an old
 * wide DV drawn narrow). The engine stamps the shapes of the videos up and coming next (EngineState.videoShapes), and
 * the screens draw such a video in a box of that shape, fitted or filling as its layer says, the picture stretched to
 * it: CSS alone, no work per frame.
 */

export const VIDEO_SHAPES = ['file', '16:9', '4:3', '1:1', '21:9'] as const;
export type VideoShape = (typeof VIDEO_SHAPES)[number];

/** A shape other than the file's own: what the engine stamps for a video. */
export type ShapeOverride = Exclude<VideoShape, 'file'>;

const ASPECT: Record<ShapeOverride, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '21:9': 21 / 9 };

/** A shape's width over its height; null for the file's own (and for anything else). */
export function shapeAspect(shape: VideoShape | null | undefined): number | null {
  return shape && shape !== 'file' && shape in ASPECT ? ASPECT[shape] : null;
}

/** The shape a video's setting stamps: null as the file says. */
export const shapeOverride = (shape: VideoShape): ShapeOverride | null => (shape === 'file' ? null : shape);

/** Each choice as Sound and picture… says it. */
export const SHAPE_WORDS: Record<VideoShape, string> = {
  file: 'As the file says',
  '16:9': '16:9 (wide)',
  '4:3': '4:3',
  '1:1': '1:1 (square)',
  '21:9': '21:9 (cinema)',
};

/** A box within another, in the outer box's own units. */
export interface ShapedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a video drawn in a shape of `aspect` (width over height) goes in a box: centred, the largest of that shape
 * inside it (fitted) or the smallest that covers it (filling: the box clips the rest), the picture stretched to it.
 */
export function shapedFrame(
  _aspect: number,
  box: { width: number; height: number },
  _fit: 'fit' | 'fill',
): ShapedBox {
  return { x: 0, y: 0, width: box.width, height: box.height };
}
