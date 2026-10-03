import { useEffect, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Lang } from '../../../shared/model';
import type { LowerThirdLine } from '../../../shared/program';
import { programPicture } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import type { StreamLayout } from '../../../shared/stream';
import { BackgroundMedia } from '../render/BackgroundMedia';
import { fontFamilyFor, HTML_LANG } from '../render/fonts';
import { MessageBanner, PropsLayer, Scene } from '../render/Scene';
import { SlideLayerView } from '../render/SlideLayerView';

/** The live slide's words along the bottom of the camera's picture. */
function LowerThird({ lines, canvas }: { lines: LowerThirdLine[]; canvas: Size }) {
  const size = canvas.height * (lines.length <= 2 ? 0.05 : lines.length === 3 ? 0.044 : 0.037);
  return (
    <div
      data-testid="lower-third"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: canvas.height * 0.06,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: canvas.width * 0.88,
          padding: `${size * 0.35}px ${size * 0.9}px`,
          borderRadius: size * 0.3,
          background: 'rgba(0, 0, 0, 0.62)',
          color: '#ffffff',
          textAlign: 'center',
          fontSize: size,
          fontWeight: 600,
          lineHeight: 1.3,
          textShadow: '0 2px 6px rgba(0, 0, 0, 0.6)',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            data-lang={line.lang ?? ''}
            lang={line.lang ? HTML_LANG[line.lang] : undefined}
            style={{ fontFamily: fontFamilyFor(null, line.lang) }}
          >
            {line.runs.map((run, j) => (
              // Words typed in a legacy font keep their font; everything else takes the lower third's look.
              <span
                key={j}
                style={
                  run.legacy ? { fontFamily: fontFamilyFor(run.font ?? line.boxFont, line.lang) } : undefined
                }
              >
                {run.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

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
        <Scene state={state} canvas={canvas} scaling="fit" languages={languages} />
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
