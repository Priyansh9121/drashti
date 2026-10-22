import type { EngineState } from '../../../shared/engine/state';
import type { LookLayer } from '../../../shared/looks';

/*
 * The hall's picture at full frame in the stream's Camera layout (shared/program.ts: a picture or video going
 * live, or a picture slide). Since Session 51 it is drawn by the same Scene as the Slides layout's, so the
 * picture-in-picture box shows with it as the hall's screens have it, coming, swapping and going as theirs do.
 * Only the background, the slide and the box: the props, the Lower Thirds panel's lower third and the messages
 * are the Camera layout's own, drawn over it, and masks are for the hall's screens. A video input never takes the
 * camera's place: the stream keeps its own camera (which may be the same input).
 */

/** The layers the Camera layout's full-frame picture draws. */
export const FULL_FRAME_LAYERS: readonly LookLayer[] = ['background', 'slide', 'pip'];

/** The engine's state as the full-frame picture draws it: without what the Camera layout draws itself. */
export function fullFrameState(state: EngineState): EngineState {
  const { layers } = state;
  return {
    ...state,
    layers: {
      ...layers,
      background: layers.background?.kind === 'input' ? null : layers.background,
      lowerThird: null,
    },
    lowerThirdOff: null,
  };
}
