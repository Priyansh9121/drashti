import { useEffect, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Lang } from '../../../shared/model';
import { DEFAULT_GROUP_LOOK } from '../../../shared/looks';
import { programPicture } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import type { StreamLayout } from '../../../shared/stream';
import { BackgroundMedia } from '../render/BackgroundMedia';
import { LowerThird } from '../render/LowerThird';
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
  canvas,
  camera,
}: {
  state: EngineState;
  layout: StreamLayout;
  languages: readonly Lang[] | null;
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
          look={{ ...DEFAULT_GROUP_LOOK, languages }}
          ticker={false}
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
          <BackgroundMedia layer={state.layers.background} annotate={false} />
          {picture.full === 'slide' && (
            <SlideLayerView layer={state.layers.slide} canvas={canvas} scaling="fit" languages={languages} />
          )}
        </div>
      )}
      {picture.lowerThird.length > 0 && <LowerThird lines={picture.lowerThird} canvas={canvas} />}
      {picture.props && <PropsLayer props={state.layers.props} canvas={canvas} scaling="fit" />}
      {picture.messages && (
        <MessageBanner messages={state.layers.messages} timers={state.timers} canvas={canvas} at="top" />
      )}
    </div>
  );
}
