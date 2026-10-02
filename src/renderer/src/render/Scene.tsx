import { memo } from 'react';
import type { EngineState, MaskLayer, MessageItem } from '../../../shared/engine/state';
import type { TimerState } from '../../../shared/timers';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { BackgroundMedia } from './BackgroundMedia';
import { LANG_FONT_STACK } from './fonts';
import { Placed } from './Placed';
import { SlideLayerView } from './SlideLayerView';
import { ElementView } from './SlideView';
import { TimerText } from './TimerText';

/** A message's words and live timers. */
function MessageText({ message, timers }: { message: MessageItem; timers: readonly TimerState[] }) {
  if (!message.parts) return <>{message.text}</>;
  return (
    <>
      {message.parts.map((part, i) =>
        part.kind === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <TimerText key={i} timer={timers.find((t) => t.id === part.timerId)} />
        ),
      )}
    </>
  );
}

function MessageBanner({
  messages,
  timers,
  canvas,
}: {
  messages: MessageItem[];
  timers: readonly TimerState[];
  canvas: Size;
}) {
  const size = Math.round(canvas.height * 0.045);
  return (
    <div
      data-layer="messages"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: `${size * 0.5}px ${size}px`,
        background: 'rgba(0, 0, 0, 0.72)',
        color: '#ffffff',
        fontFamily: LANG_FONT_STACK.default,
        fontSize: size,
        fontWeight: 500,
        textAlign: 'center',
      }}
    >
      {messages.map((m, i) => (
        <span key={m.id} data-message={m.id}>
          {i > 0 && '   ·   '}
          <MessageText message={m} timers={timers} />
        </span>
      ))}
    </div>
  );
}

function Mask({ mask, canvas }: { mask: MaskLayer; canvas: Size }) {
  const v = mask.visible;
  const black = { position: 'absolute', background: '#000000' } as const;
  return (
    <div data-layer="masks" style={{ position: 'absolute', inset: 0 }}>
      <div style={{ ...black, left: 0, top: 0, width: canvas.width, height: Math.max(0, v.y) }} />
      <div
        style={{
          ...black,
          left: 0,
          top: v.y + v.height,
          width: canvas.width,
          height: Math.max(0, canvas.height - v.y - v.height),
        }}
      />
      <div style={{ ...black, left: 0, top: v.y, width: Math.max(0, v.x), height: v.height }} />
      <div
        style={{
          ...black,
          left: v.x + v.width,
          top: v.y,
          width: Math.max(0, canvas.width - v.x - v.width),
          height: v.height,
        }}
      />
    </div>
  );
}

/**
 * Everything one screen shows, drawn on that screen's canvas (in canvas
 * pixels). Bottom to top: background, slide, props, messages, masks, black-out.
 * The operator preview and every output use this same component; the preview
 * sets `annotate` to mark problems the audience never sees.
 */
export const Scene = memo(function Scene({
  state,
  canvas,
  scaling,
  annotate = false,
}: {
  state: EngineState;
  canvas: Size;
  scaling: ScalingMode;
  annotate?: boolean;
}) {
  const { layers } = state;
  return (
    <div
      data-testid="scene"
      data-canvas={`${canvas.width}x${canvas.height}`}
      style={{
        position: 'relative',
        width: canvas.width,
        height: canvas.height,
        overflow: 'hidden',
        background: '#000000',
      }}
    >
      {layers.background?.kind === 'color' && (
        <div
          data-layer="background"
          style={{ position: 'absolute', inset: 0, background: layers.background.color }}
        />
      )}
      <BackgroundMedia layer={layers.background} annotate={annotate} />
      <SlideLayerView layer={layers.slide} canvas={canvas} scaling={scaling} />
      {layers.props.map((prop) => {
        const size = { width: prop.width ?? 1920, height: prop.height ?? 1080 };
        return (
          <div
            key={prop.id}
            data-layer="props"
            data-prop={prop.id}
            style={{ position: 'absolute', inset: 0 }}
          >
            <Placed content={size} box={canvas} mode={scaling}>
              <div style={{ position: 'relative', width: size.width, height: size.height }}>
                {prop.elements.map((el) => (
                  <ElementView key={el.id} el={el} />
                ))}
              </div>
            </Placed>
          </div>
        );
      })}
      {layers.messages.length > 0 && (
        <MessageBanner messages={layers.messages} timers={state.timers} canvas={canvas} />
      )}
      {layers.masks && <Mask mask={layers.masks} canvas={canvas} />}
      {state.logo && (
        // The logo instead of the picture: drawn over the layers, which carry on underneath, so
        // taking it down brings back exactly what was there. Black-out covers it in turn.
        <div
          data-layer="logo"
          data-testid="logo"
          style={{ position: 'absolute', inset: 0, background: '#000000' }}
        >
          <Placed
            content={{ width: state.logo.width ?? 1920, height: state.logo.height ?? 1080 }}
            box={canvas}
            mode={scaling}
          >
            <div
              style={{
                position: 'relative',
                width: state.logo.width ?? 1920,
                height: state.logo.height ?? 1080,
              }}
            >
              {state.logo.elements.map((el) => (
                <ElementView key={el.id} el={el} />
              ))}
            </div>
          </Placed>
        </div>
      )}
      {state.blackout && (
        <div
          data-layer="blackout"
          data-testid="blackout"
          style={{ position: 'absolute', inset: 0, background: '#000000' }}
        />
      )}
    </div>
  );
});
