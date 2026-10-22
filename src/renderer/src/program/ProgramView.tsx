import { useEffect, useMemo, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Lang } from '../../../shared/model';
import { DEFAULT_LIVE_GROUP_LOOK, type Movement } from '../../../shared/looks';
import { programPicture } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import type { StreamLayout } from '../../../shared/stream';
import { MovingLowerThird } from '../render/LowerThird';
import { LowerThirdView } from '../render/LowerThirdView';
import { MessageBanner, PropsLayer, Scene } from '../render/Scene';
import { FULL_FRAME_LAYERS, fullFrameState } from './full-frame';

function CameraVideo({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  return (
    <video
      ref={ref}
      data-testid="program-camera"
      data-on={stream ? 'yes' : 'no'}
      muted
      playsInline
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

/**
 * What the stream shows, on its 1920 x 1080 canvas (see shared/program.ts for the rules). A video input up as the
 * background (Session 50) is in the Slides layout's picture as the hall has it; the Camera layout keeps the
 * stream's own camera (which may be the same input). Whenever the stream shows the hall's picture, in either
 * layout, the picture-in-picture box shows with it (Session 51: the Camera layout's full-frame picture is the
 * hall's own Scene, ./full-frame.ts, a video input behind included while a box is up).
 */
export function ProgramView({
  state,
  layout,
  languages,
  movement = 'calm',
  canvas,
  camera,
}: {
  state: EngineState;
  layout: StreamLayout;
  languages: readonly Lang[] | null;
  /** The stream group's Movement in the live Look (Session 27): Calm unless chosen. */
  movement?: Movement;
  canvas: Size;
  camera: MediaStream | null;
}) {
  const picture = programPicture(state, layout, languages);
  // The Camera layout's full-frame picture draws from the state without what that layout draws itself.
  const hall = useMemo(() => fullFrameState(state), [state]);
  if (picture.kind === 'scene')
    return (
      <div data-testid="program-picture" data-kind="scene">
        <Scene
          state={state}
          canvas={canvas}
          scaling="fit"
          look={{ ...DEFAULT_LIVE_GROUP_LOOK, languages, movement }}
          ticker={false}
          place="stream"
        />
      </div>
    );
  return (
    <div
      data-testid="program-picture"
      data-kind="camera"
      data-full={picture.full ?? ''}
      style={{
        position: 'relative',
        width: canvas.width,
        height: canvas.height,
        overflow: 'hidden',
        background: '#000000',
      }}
    >
      <CameraVideo stream={camera} />
      {picture.full && (
        <div style={{ position: 'absolute', inset: 0, background: '#000000' }} data-testid="program-full">
          {/* The hall's picture (Session 51): its background, slide and props with the picture-in-picture box
              over them, as the Slides layout draws them; a video input (Session 50) only with a box up. */}
          <Scene
            state={hall}
            canvas={canvas}
            scaling="fit"
            look={{ ...DEFAULT_LIVE_GROUP_LOOK, layers: FULL_FRAME_LAYERS, languages, movement }}
            ticker={false}
            place="stream"
          />
        </div>
      )}
      {/* The Camera layout's lower third moves as a Look's does (Session 27), on the stream group's Movement. */}
      <MovingLowerThird
        lines={picture.lowerThird}
        shownKey={
          state.layers.slide ? `${state.layers.slide.slide.id}@${String(state.layers.slide.shownAt)}` : null
        }
        shownAt={state.layers.slide?.shownAt ?? 0}
        leaving={state.slideOff}
        canvas={canvas}
        movement={movement}
      />
      {/* Over the camera; at full frame the hall's picture has them, under the box. */}
      {picture.props && !picture.full && (
        <PropsLayer props={state.layers.props} canvas={canvas} scaling="fit" />
      )}
      {/* A lower third from the Lower Thirds panel, for the stream (Session 44). */}
      <LowerThirdView
        layer={state.layers.lowerThird}
        off={state.lowerThirdOff}
        canvas={canvas}
        place="stream"
      />
      {picture.messages && (
        <MessageBanner
          messages={state.layers.messages}
          timers={state.timers}
          calendar={state.calendar}
          canvas={canvas}
          at="top"
          movement={movement}
        />
      )}
    </div>
  );
}
