import type { EngineState } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import type { HallPicture } from '../../../shared/stage-layouts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../../shared/stage-layouts';
import { Placed } from './Placed';
import { StageLayoutView } from './StageLayoutView';
import { StageView } from './StageView';
import type { ClockStyle } from '../../../shared/format';

/**
 * A stage screen as its group shows it in the live Look: its own layout
 * (boxes on 1920 x 1080, scaled to the canvas), or the Standard stage screen.
 * Outputs, the stage display in a browser and the operator's stage preview
 * all draw it with this.
 */
export function StageScreen({
  state,
  look,
  canvas,
  clockStyle,
  hall,
}: {
  state: EngineState;
  look: LiveGroupLook;
  canvas: Size;
  clockStyle?: ClockStyle | null;
  /**
   * The hall's group and canvas, for a layout's audience picture box (Session 50), and whether its screens are off
   * (Session 51), which the Standard stage screen says too; null with no audience group at all, which the box says
   * (Session 52), and a layout's box of the audience screens' state (Session 53; never the Standard stage screen,
   * screensStateNote), and left out while not known.
   */
  hall?: HallPicture | null;
}) {
  if (!look.stageLayout)
    return (
      <StageView
        state={state}
        languages={look.languages}
        audienceOff={hall?.off === true}
        {...(clockStyle ? { clockStyle } : {})}
      />
    );
  return (
    <Placed content={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }} box={canvas} mode="fit">
      <StageLayoutView
        layout={look.stageLayout}
        state={state}
        languages={look.languages}
        hall={hall}
        {...(clockStyle ? { clockStyle } : {})}
      />
    </Placed>
  );
}
