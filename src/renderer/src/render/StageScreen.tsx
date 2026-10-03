import type { EngineState } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../../shared/stage-layouts';
import { Placed } from './Placed';
import { StageLayoutView } from './StageLayoutView';
import { StageView } from './StageView';

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
}: {
  state: EngineState;
  look: LiveGroupLook;
  canvas: Size;
  clockStyle?: { locale: string; timeZone: string } | null;
}) {
  if (!look.stageLayout)
    return <StageView state={state} languages={look.languages} {...(clockStyle ? { clockStyle } : {})} />;
  return (
    <Placed content={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }} box={canvas} mode="fit">
      <StageLayoutView
        layout={look.stageLayout}
        state={state}
        languages={look.languages}
        {...(clockStyle ? { clockStyle } : {})}
      />
    </Placed>
  );
}
