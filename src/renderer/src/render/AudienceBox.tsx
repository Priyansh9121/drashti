import { memo, useMemo, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { HallPicture } from '../../../shared/stage-layouts';
import { AUDIENCE_OFF, hallView, PICTURE } from './audience-picture';
import { fontFamilyFor } from './fonts';
import { textLang } from './lang';
import { useLiveHere } from './live-here';
import { unseenLive } from './named-background';
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
 * input or window, which are on Drashti's computer. There, and on a node, the box names a video input or a window
 * the hall's picture holds, in a small muted line under "Audience off", in the phone remote's words
 * (render/named-background.ts), so the performers see why it is black there.
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
  // A video input or a window this page cannot draw (a tablet's, a node's), named (Session 51).
  const live = useLiveHere();
  const unseen = unseenLive(state, view.look, live);
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
            {/* Over the picture, in its corner, scaled with it: the status bar's words on its warning amber, and
                under them what this page cannot draw, muted. */}
            {(view.off || unseen.length > 0) && (
              <div
                style={{
                  position: 'absolute',
                  left: 40,
                  top: 40,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 16,
                  fontFamily: fontFamilyFor(null, null),
                  whiteSpace: 'nowrap',
                }}
              >
                {view.off && (
                  <p
                    data-testid="stage-audience-off"
                    style={{
                      margin: 0,
                      padding: '12px 28px',
                      borderRadius: 16,
                      background: '#f5a524',
                      color: '#000000',
                      fontSize: 64,
                      fontWeight: 700,
                      lineHeight: 1.2,
                    }}
                  >
                    {AUDIENCE_OFF}
                  </p>
                )}
                {unseen.map((line) => (
                  <p
                    key={line}
                    data-testid="stage-audience-unseen"
                    lang={textLang(line)}
                    style={{
                      margin: 0,
                      maxWidth: PICTURE.width - 80,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      padding: '8px 20px',
                      borderRadius: 12,
                      background: 'rgba(0, 0, 0, 0.6)',
                      color: '#8b93a3',
                      fontSize: 40,
                      lineHeight: 1.25,
                    }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Placed>
      )}
    </div>
  );
});
