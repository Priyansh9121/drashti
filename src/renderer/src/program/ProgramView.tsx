import { useEffect, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Lang } from '../../../shared/model';
import { DEFAULT_LIVE_GROUP_LOOK, type Movement } from '../../../shared/looks';
import { programPicture } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import type { StreamLayout } from '../../../shared/stream';
import { BackgroundMedia } from '../render/BackgroundMedia';
import { MovingLowerThird } from '../render/LowerThird';
import { LowerThirdView } from '../render/LowerThirdView';
import { MessageBanner, PropsLayer, Scene } from '../render/Scene';
import { SlideLayerView } from '../render/SlideLayerView';

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

/** What the stream shows, on its 1920 x 1080 canvas (see shared/program.ts for the rules). */
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
          {state.layers.background?.kind === 'color' && (
            <div style={{ position: 'absolute', inset: 0, background: state.layers.background.color }} />
          )}
          <BackgroundMedia layer={state.layers.background} annotate={false} movement={movement} />
          {picture.full === 'slide' && (
            <SlideLayerView
              layer={state.layers.slide}
              canvas={canvas}
              scaling="fit"
              languages={languages}
              movement={movement}
            />
          )}
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
      {picture.props && <PropsLayer props={state.layers.props} canvas={canvas} scaling="fit" />}
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
