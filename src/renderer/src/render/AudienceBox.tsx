import { memo, useMemo, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { HallPicture } from '../../../shared/stage-layouts';
import { AUDIENCE_OFF, hallView, PICTURE } from './audience-picture';
import { fontFamilyFor } from './fonts';
import { Placed } from './Placed';
import { Scene } from './Scene';
import { SceneBoundary } from './SceneBoundary';
import { useElementSize } from './useElementSize';

/*
 * The audience picture, live, as a stage layout's box (Session 50): exactly what the hall's screens show at
 * that moment, drawn by the same Scene from the same state as the hall's own output (one Scene for the box):
 * the background (a video, a video input, a window), the slide, props, the lower third, messages, the ticker
 * and anything else the Scene draws, black-out and the logo too (the stage's other boxes ignore those; here
 * they show, because the hall sees them). The hall's canvas sits in a 16:9 picture as on a 16:9 screen, and
 * the picture in the box with black around it. Boxes after it in the layout draw over it.
 *
 * With Audience off (Session 51) the hall's screens show the computer's desktop: the box keeps the picture (the
 * one the hall comes back to) and says "Audience off" in its top left corner, so the performers are not misled.
 *
 * In a phone's or tablet's browser (the stage display, Session 51) it draws the same Scene as the remote's live
 * picture does: pictures and videos as small previews (render/previews.tsx, given by the page), and no video
 * input or window, which are on Drashti's computer.
 */

/** Each engine state a page drew, numbered: a picture that failed to draw tries again with the next one. */
const numbered = new WeakMap<EngineState, number>();
let last = 0;
function revisionOf(state: EngineState): number {
  let n = numbered.get(state);
  if (n === undefined) {
    n = ++last;
    numbered.set(state, n);
  }
  return n;
}

export const AudienceBox = memo(function AudienceBox({
  state,
  hall,
}: {
  state: EngineState;
  /** The hall's group and canvas (OutputContext on a stage screen); unknown: every layer at 1920 x 1080. */
  hall: HallPicture | null | undefined;
}) {
  const area = useRef<HTMLDivElement>(null);
  const size = useElementSize(area);
  const view = useMemo(() => hallView(state.look, hall), [state.look, hall]);
  return (
    <div
      ref={area}
      data-testid="stage-audience"
      data-hall-group={view.groupId ?? ''}
      data-audience={view.off ? 'off' : 'on'}
      style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: '#000000' }}
    >
      {size.width > 0 && size.height > 0 && (
        <Placed content={PICTURE} box={size} mode="fit">
          <div
            data-hall-picture=""
            style={{
              position: 'relative',
              width: PICTURE.width,
              height: PICTURE.height,
              overflow: 'hidden',
              background: '#000000',
            }}
          >
            <SceneBoundary resetKey={revisionOf(state)}>
              <Placed content={view.canvas} box={PICTURE} mode={view.scaling}>
                <Scene state={state} canvas={view.canvas} scaling={view.scaling} look={view.look} />
              </Placed>
            </SceneBoundary>
            {/* Over the picture, in its corner, scaled with it: the status bar's words on its warning amber. */}
            {view.off && (
              <p
                data-testid="stage-audience-off"
                style={{
                  position: 'absolute',
                  left: 40,
                  top: 40,
                  margin: 0,
                  padding: '12px 28px',
                  borderRadius: 16,
                  background: '#f5a524',
                  color: '#000000',
                  fontFamily: fontFamilyFor(null, null),
                  fontSize: 64,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                {AUDIENCE_OFF}
              </p>
            )}
          </div>
        </Placed>
      )}
    </div>
  );
});
