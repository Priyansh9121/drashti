import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import type { Framing } from '../web/viewer/live-zoom';

/*
 * The live zoom's drag and two fingers' move over the LIVE preview (Session 26e; Session 55, Part 5): the picture on
 * the screens moved as the pointer moved over LIVE's picture of them. Pure arithmetic, tested on its own
 * (live-drag.test.ts).
 */

/**
 * The live zoom after a drag of `moved` pixels over LIVE's picture, `box` pixels big (the first screen's canvas,
 * fitted in it, its slide placed by that screen's `scaling`), from `from`.
 */
export function draggedTo(
  _state: EngineState | null,
  from: Framing,
  moved: { x: number; y: number },
  box: Size,
  _canvas: Size,
  _scaling: ScalingMode,
): Framing {
  return { ...from, x: from.x + moved.x / box.width, y: from.y + moved.y / box.height };
}
