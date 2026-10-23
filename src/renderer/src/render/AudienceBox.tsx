import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { HallPicture } from '../../../shared/stage-layouts';
import {
  AUDIENCE_OFF,
  fittedSize,
  hallView,
  NO_AUDIENCE,
  noAudienceLine,
  PICTURE,
  WORDS_CORNER,
} from './audience-picture';
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
 * one the hall comes back to) and says "Audience off" in its bottom left corner (Session 52: in the top left, a
 * stage message along the top covered it), so the performers are not misled.
 *
 * In a phone's or tablet's browser (the stage display, Session 51) it draws the same Scene as the remote's live
 * picture does: pictures and videos as small previews (render/previews.tsx, given by the page), and no video
 * input or window, which are on Drashti's computer. There, and on a node, the box names a video input or a window
 * the hall's picture holds, in a small muted line under "Audience off", in the phone remote's words
 * (render/named-background.ts), so the performers see why it is black there.
 *
 * With no audience group at all (Session 52) there is no hall's picture: the box is black, and says so in one
 * short plain line in its bottom left corner, where it drew every layer. Until a page is told the hall (a
 * tablet's, before Drashti answers) it is black alone.
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
  /**
   * The hall's group and canvas (OutputContext on a stage screen); null with no audience group at all, the box
   * black and saying so (Session 52); unknown (undefined), black alone.
   */
  hall: HallPicture | null | undefined;
}) {
  const area = useRef<HTMLDivElement>(null);
  const size = useElementSize(area);
  const view = useMemo(() => hallView(state.look, hall), [state.look, hall]);
  // A video input or a window this page cannot draw (a tablet's, a node's), named (Session 51).
  const live = useLiveHere();
  const unseen = view.kind === 'hall' ? unseenLive(state, view.look, live) : [];
  const sized = size.width > 0 && size.height > 0;
  return (
    <div
      ref={area}
      data-testid="stage-audience"
      data-hall-group={view.kind === 'hall' ? view.groupId : ''}
      data-audience={view.kind === 'hall' ? (view.off ? 'off' : 'on') : view.kind}
      style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: '#000000' }}
    >
      {sized && view.kind === 'hall' && (
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
            {/* Over the picture, in its bottom left corner, scaled with it: the status bar's words on its warning
                amber, and under them what this page cannot draw, muted. */}
            {(view.off || unseen.length > 0) && (
              <div
                style={{
                  position: 'absolute',
                  left: WORDS_CORNER.left,
                  bottom: WORDS_CORNER.bottom,
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
                      maxWidth: PICTURE.width - 2 * WORDS_CORNER.left,
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
      {sized && view.kind === 'none' && <NoAudienceLine box={size} />}
    </div>
  );
});

/**
 * With no audience group at all (Session 52): one short plain line in the box's bottom left corner, in the stage's
 * muted grey, as large as Audience off would be there but never below the stage's smallest words, so it still
 * reads in a small box (noAudienceLine). Drawn in the box itself, not on a picture scaled into it, and measured
 * as a layout's boxes fit their words (fittedSize): it wraps at its spaces, and comes down only as far as it
 * must to fit.
 */
function NoAudienceLine({ box }: { box: Size }) {
  const room = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const { size, inset } = noAudienceLine(box);
  // Measured again once a font has loaded, as a box fitting its words is: a fallback font measures otherwise.
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const loaded = () => {
      setFonts((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', loaded);
    return () => {
      document.fonts.removeEventListener('loadingdone', loaded);
    };
  }, []);
  useLayoutEffect(() => {
    const r = room.current;
    const p = line.current;
    if (!r || !p) return;
    const fitted = fittedSize(size, (px) => {
      p.style.fontSize = `${px}px`;
      return p.offsetHeight <= r.clientHeight + 0.5 && p.scrollWidth <= r.clientWidth + 0.5;
    });
    p.style.fontSize = `${fitted}px`;
    p.setAttribute('data-fit-size', String(fitted));
  }, [size, box.width, box.height, fonts]);
  return (
    <div
      ref={room}
      style={{
        position: 'absolute',
        left: inset,
        right: inset,
        top: inset,
        bottom: inset,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        overflow: 'hidden',
      }}
    >
      <p
        ref={line}
        data-testid="stage-audience-none"
        style={{
          margin: 0,
          color: '#8b93a3',
          fontFamily: fontFamilyFor(null, null),
          fontWeight: 400,
          lineHeight: 1.25,
          textAlign: 'left',
          whiteSpace: 'normal',
          overflowWrap: 'normal',
        }}
      >
        {NO_AUDIENCE}
      </p>
    </div>
  );
}
