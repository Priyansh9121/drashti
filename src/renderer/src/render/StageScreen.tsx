import type { EngineState } from '../../../shared/engine/state';
import type { LiveGroupLook } from '../../../shared/looks';
import type { Size } from '../../../shared/scaling';
import type { HallPicture } from '../../../shared/stage-layouts';
import { STAGE_HEIGHT, STAGE_WIDTH, stageShows } from '../../../shared/stage-layouts';
import { AudienceBox } from './AudienceBox';
import { Placed } from './Placed';
import { StageLayoutView } from './StageLayoutView';
import { StageView } from './StageView';
import type { ClockStyle } from '../../../shared/format';
import { lookOf } from '../../../shared/audience-timer';
import { stageBanner } from '../../../shared/stage-message';
import { AudienceTimerView } from './AudienceTimer';
import { StageMessageBanner } from './StageMessageBanner';

/**
 * What a stage screen shows over its layout (Session 55, Part 15): the stage message as a banner where the layout has
 * no message box of its own (and over the audience picture with Stage off), and a timer for the audience whose look
 * says the stage screens show it too (with Stage off the audience picture has it already).
 */
function StageOver({ state, canvas, banner }: { state: EngineState; canvas: Size; banner: boolean }) {
  const up = state.layers.timer ?? state.timerOff?.layer ?? null;
  const timer = up ? state.timers.find((t) => t.id === up.timerId) : undefined;
  return (
    <>
      {timer && lookOf(timer).stage && (
        <AudienceTimerView
          state={state}
          layer={state.layers.timer}
          off={state.timerOff}
          timers={state.timers}
          canvas={canvas}
        />
      )}
      {banner && <StageMessageBanner state={state} canvas={canvas} />}
    </>
  );
}

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
        {/* The stage message over the audience picture (Session 55): never on the hall's own screens. */}
        <StageMessageBanner state={state} canvas={canvas} />
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
        <StageOver state={state} canvas={canvas} banner={false} />
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
      <StageOver state={state} canvas={canvas} banner={stageBanner(layout)} />
    </>
  );
}
