import type { EngineState } from '../../../shared/engine/state';
import { placeContent, type Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { frameInCanvas, type Framing, FULL_FRAME, moveInFrame, type ZoomFrame } from '../web/viewer/live-zoom';

/*
 * The live zoom's drag and two fingers' move over the LIVE preview (Session 26e; Session 55, Part 5): the picture on
 * the screens moved as the pointer moved over LIVE's picture of them. The screens move a picture in its own box,
 * unturned, its box then turned and flipped as its slide places it; so a move over LIVE is turned back into the box
 * and measured in its widths and heights, as a phone's zoom is (web/viewer/live-zoom.ts): on a page turned with Turn
 * page right, a page cropped with Crop page…, a picture smaller than its slide or with a crop of its own, it follows
 * the pointer (a22-review-zoomturn: on a turned page a drag right moved it down, on a cropped page too fast). Pure
 * arithmetic, tested on its own (live-drag.test.ts).
 */

/**
 * The box the live zoom moves its picture in, in LIVE's picture (the first screen's canvas, its slide placed by that
 * screen's `scaling`), as fractions of it: the slide's own picture's (frameInCanvas), else the whole canvas, which the
 * background picture is zoomed in.
 */
export function liveDragFrame(state: EngineState | null, canvas: Size, scaling: ScalingMode): ZoomFrame {
  const slide = state?.layers.slide;
  if (!slide?.slide.elements.some((e) => e.kind === 'image')) return FULL_FRAME;
  return frameInCanvas(state, canvas, scaling) ?? FULL_FRAME;
}

/**
 * The live zoom after a drag of `moved` pixels over LIVE's picture, `box` pixels big (the first screen's canvas,
 * fitted in it, its slide placed by that screen's `scaling`), from `from`: the picture moved on the screens as far
 * and as the pointer went.
 */
export function draggedTo(
  state: EngineState | null,
  from: Framing,
  moved: { x: number; y: number },
  box: Size,
  canvas: Size,
  scaling: ScalingMode,
): Framing {
  const p = placeContent(canvas, box, 'fit');
  const width = canvas.width * p.scaleX;
  const height = canvas.height * p.scaleY;
  if (!(width > 0 && height > 0)) return from;
  const m = moveInFrame(moved.x / width, moved.y / height, liveDragFrame(state, canvas, scaling));
  return { ...from, x: from.x + m.x, y: from.y + m.y };
}
