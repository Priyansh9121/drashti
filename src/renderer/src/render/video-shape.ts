import { useContext } from 'react';
import type { CSSProperties } from 'react';
import type { MediaFit } from '../../../shared/engine/state';
import type { MediaElement } from '../../../shared/model';
import { shapeAspect, type ShapedBox, type ShapeOverride } from '../../../shared/video-shape';
import { ScreenPictures } from './picture-looks';

/*
 * Sound and picture…'s Shape on a screen (alpha.20, x55, slice 6b; shared/video-shape.ts): a video whose shape the
 * state names (EngineState.videoShapes) is drawn in a box of that shape, fitted or filling its place as its layer says,
 * the picture stretched to the box (object-fit: fill). CSS alone: the box is laid out with the page, never measured,
 * and no frame costs more than today's fit (the same one video layer, clipped as a filling video always is).
 */

/** This screen's videos' shapes, as its state carries them; none off a screen (a thumbnail, the slide editor). */
export function useVideoShapes(): Readonly<Record<string, ShapeOverride>> | undefined {
  return useContext(ScreenPictures)?.videoShapes;
}

/**
 * The shape (width over height) a video is drawn in: its own in the state, while fitted or filling its place; null as
 * its file says, and when stretched to its place (a stretched video takes its place's shape whatever it says).
 */
export function shapeFor(
  shapes: Readonly<Record<string, ShapeOverride>> | undefined,
  mediaId: string,
  fit: MediaFit,
): number | null {
  return fit === 'stretch' ? null : shapeAspect(shapes?.[mediaId]);
}

/** A number as CSS writes it here: to a ten-thousandth (a thousandth of a pixel on a 4K screen). */
const css = (v: number) => String(Math.round(v * 10_000) / 10_000);

/** A background video's place while it has a shape: the container its box is laid out in, clipping a filling one. */
export const SHAPED_PLACE: CSSProperties = { containerType: 'size', overflow: 'hidden' };

/**
 * A background video's box in its shape (`aspect`), inside its place (SHAPED_PLACE: the screen's whole picture, or the
 * picture-in-picture box's): the largest of that shape inside it (fit) or the smallest over it (fill), centred, in
 * the place's own query units, so it is right from the first frame however large the place is drawn.
 */
export function shapedVideoStyle(aspect: number, fit: 'fit' | 'fill'): CSSProperties {
  const pick = fit === 'fit' ? 'min' : 'max';
  // As wide as its place, or as tall times the shape, whichever is smaller (fitted) or larger (filling); its height
  // the same way, so the two always make the shape.
  const width = `${pick}(100cqw, ${css(aspect * 100)}cqh)`;
  const height = `${pick}(100cqh, ${css(100 / aspect)}cqw)`;
  return {
    position: 'absolute',
    left: `calc((100cqw - ${width}) / 2)`,
    top: `calc((100cqh - ${height}) / 2)`,
    width,
    height,
    objectFit: 'fill',
  };
}

/**
 * A slide's video in a shape of its own: its clip in its shape's box (`box`, in its frame's pixels, so the frame starts
 * at −box.x, −box.y in the box's own), keeping what showed of it on the slide: the frame's own shape (an ellipse,
 * rounded corners, a symbol's outline) where it was, and the frame's edge for a video filling it. Undefined: no clip
 * (a fitted video whose frame has no shape of its own).
 */
export function shapedClip(
  _frame: { width: number; height: number },
  _box: ShapedBox,
  _clip: MediaElement['pictureClip'],
): string | undefined {
  return undefined;
}
