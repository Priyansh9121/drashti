import { memo } from 'react';
import type { EngineState, MaskLayer, MessageItem } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { LANG_FONT_STACK } from './fonts';
import { Placed } from './Placed';
import { ElementView, SlideView } from './SlideView';

function MessageBanner({ messages, canvas }: { messages: MessageItem[]; canvas: Size }) {
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
      {messages.map((m) => m.text).join('   ·   ')}
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
 * The operator preview and every output use this same component.
 */
export const Scene = memo(function Scene({
  state,
  canvas,
  scaling,
}: {
  state: EngineState;
  canvas: Size;
  scaling: ScalingMode;
}) {
  const { layers } = state;
  const slide = layers.slide?.slide;
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
      {layers.background?.kind === 'media' && (
        // Media playback is not built yet: the layer is marked, and draws nothing.
        <div
          data-layer="background"
          data-media-id={layers.background.mediaId}
          style={{ position: 'absolute', inset: 0 }}
        />
      )}
      {slide && (
        <div data-layer="slide" style={{ position: 'absolute', inset: 0 }}>
          <Placed content={slide} box={canvas} mode={scaling}>
            <SlideView slide={slide} />
          </Placed>
        </div>
      )}
      {layers.props.map((prop) => (
        <div key={prop.id} data-layer="props" style={{ position: 'absolute', inset: 0 }}>
          {prop.elements.map((el) => (
            <ElementView key={el.id} el={el} />
          ))}
        </div>
      ))}
      {layers.messages.length > 0 && <MessageBanner messages={layers.messages} canvas={canvas} />}
      {layers.masks && <Mask mask={layers.masks} canvas={canvas} />}
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
