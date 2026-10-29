import type { EngineState } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import type { HallPicture } from '../../../shared/stage-layouts';
import { STAGE_HEIGHT, STAGE_WIDTH, stageShows } from '../../../shared/stage-layouts';
import { AudienceBox } from './AudienceBox';
import { Placed } from './Placed';
import { StageLayoutView } from './StageLayoutView';
import { StageView } from './StageView';
import { StageEndsIn } from './StageEndsIn';
import type { ClockStyle } from '../../../shared/format';

/**
 * A stage screen: the layout chosen for every stage screen (Session 55, the engine's `stage`: boxes on 1920 x 1080,
 * scaled to the canvas), or the Standard stage screen with none; its group's languages from the live Look. With Stage
 * off (Session 55) exactly the audience picture instead, as the hall's screens show it (the audience picture box's
 * Scene, filling the screen), and nothing of the stage's own. Outputs, a node's stage screens, the stage display in a
 * browser and the operator's stage preview all draw it with this.
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
   * The hall's group and canvas, for a layout's audience picture box (Session 50) and the picture with Stage off
   * (Session 55), and whether its screens are off (Session 51), which the Standard stage screen says too; null with
   * no audience group at all, which the box says (Session 52), and a layout's box of the audience screens' state
   * (Session 53; never the Standard stage screen, screensStateNote), and left out while not known.
   */
  hall?: HallPicture | null;
}) {
  const shows = stageShows(state.stage);
  if (shows === 'audience')
    return (
      <div
        data-testid="stage-audience-picture"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: canvas.width,
          height: canvas.height,
          display: 'flex',
          flexDirection: 'column',
          background: '#000000',
        }}
      >
        <AudienceBox state={state} hall={hall} />
      </div>
    );
  const layout = shows === 'layout' ? state.stage?.layout : null;
  if (!layout)
    return (
      <>
        <StageView
          state={state}
          languages={look.languages}
          audienceOff={hall?.off === true}
          {...(clockStyle ? { clockStyle } : {})}
        />
        {/* A video's last 10 seconds (Part 6): the time left across the top. */}
        <StageEndsIn state={state} canvas={canvas} />
      </>
    );
  return (
    <>
      <Placed content={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }} box={canvas} mode="fit">
        <StageLayoutView
          layout={layout}
          state={state}
          languages={look.languages}
          hall={hall}
          {...(clockStyle ? { clockStyle } : {})}
        />
      </Placed>
      <StageEndsIn state={state} canvas={canvas} />
    </>
  );
}
