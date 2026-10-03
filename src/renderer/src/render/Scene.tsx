import { memo, useLayoutEffect, useRef } from 'react';
import type {
  EngineState,
  MaskLayer,
  MessageItem,
  PropItem,
  TickerLayer,
} from '../../../shared/engine/state';
import type { Lang } from '../../../shared/model';
import type { TimerState } from '../../../shared/timers';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { BackgroundMedia } from './BackgroundMedia';
import { engineNow } from './clock';
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

/** The messages along the bottom of the picture (the stream's Camera layout puts them at the top). */
export function MessageBanner({
  messages,
  timers,
  canvas,
  at = 'bottom',
  above = 0,
}: {
  messages: MessageItem[];
  timers: readonly TimerState[];
  canvas: Size;
  at?: 'top' | 'bottom';
  /** Canvas pixels to leave at that edge (the ticker's band). */
  above?: number;
}) {
  const size = Math.round(canvas.height * 0.045);
  return (
    <div
      data-layer="messages"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [at]: above,
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

/** The ticker's band: this much of the canvas height. */
export const TICKER_HEIGHT = 0.075;
/** How fast the ticker's words move: this many canvas heights a second (about 130 px a second at 1080). */
export const TICKER_SPEED = 0.12;
const TICKER_GAP = '\u2003\u2003•\u2003\u2003';
/** A screen more than this far from where the clock says the words should be puts them right. */
const TICKER_STEP_MS = 40;

/**
 * How long one pass of the words takes, in ms: in from the right edge until
 * the last letter has gone at the left.
 */
export function tickerPassMs(canvas: Size, wordsWidth: number): number {
  return ((canvas.width + wordsWidth) / (canvas.height * TICKER_SPEED)) * 1000;
}

/** Where a pass is at this time (ms into it), from when the ticker started: the same on every screen. */
export function tickerPhase(now: number, startedAt: number, passMs: number): number {
  const into = (now - startedAt) % passMs;
  return into < 0 ? into + passMs : into;
}

/**
 * The engine's time at the frame being drawn: the clock the page's
 * animations run on, so the words land in their place even on a screen
 * that draws few frames a second.
 */
function frameNow(): number {
  const frame = Number(document.timeline.currentTime);
  return Number.isFinite(frame) ? performance.timeOrigin + frame + (engineNow() - Date.now()) : engineNow();
}

/**
 * The announcements ticker along the bottom of the picture: the words come in
 * at the right edge and go out at the left, again and again. Where they are
 * comes from the engine's clock, so every screen shows the same place; the
 * browser moves them (an animation), and each screen checks every few seconds
 * that it is still in step.
 */
export function TickerBand({ ticker, canvas }: { ticker: TickerLayer; canvas: Size }) {
  const words = useRef<HTMLDivElement>(null);
  const text = ticker.items.map((i) => i.text).join(TICKER_GAP);
  const height = Math.round(canvas.height * TICKER_HEIGHT);
  const size = Math.round(canvas.height * 0.045);
  const { startedAt } = ticker;
  const { width: canvasWidth, height: canvasHeight } = canvas;
  useLayoutEffect(() => {
    const el = words.current;
    if (!el) return;
    let animation: Animation | null = null;
    let passMs = 0;
    const inStep = () => {
      if (!animation || passMs <= 0) return;
      const want = tickerPhase(frameNow(), startedAt, passMs);
      const now = Number(animation.currentTime ?? 0) % passMs;
      const off = Math.abs(want - now);
      if (Math.min(off, passMs - off) > TICKER_STEP_MS) animation.currentTime = want;
    };
    const start = () => {
      animation?.cancel();
      // The words' width in canvas pixels (the scene is scaled around them); it changes as fonts arrive.
      const width = el.offsetWidth;
      passMs = tickerPassMs({ width: canvasWidth, height: canvasHeight }, width);
      el.dataset['passMs'] = String(Math.round(passMs));
      animation = el.animate(
        [{ transform: `translateX(${canvasWidth}px)` }, { transform: `translateX(${-width}px)` }],
        { duration: passMs, iterations: Infinity, easing: 'linear' },
      );
      animation.currentTime = tickerPhase(frameNow(), startedAt, passMs);
    };
    start();
    const resized = new ResizeObserver(start);
    resized.observe(el);
    const timer = setInterval(inStep, 5000);
    return () => {
      resized.disconnect();
      clearInterval(timer);
      animation?.cancel();
    };
  }, [text, startedAt, canvasWidth, canvasHeight]);
  return (
    <div
      data-layer="ticker"
      data-testid="ticker"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        overflow: 'hidden',
        background: 'rgba(0, 0, 0, 0.8)',
        borderTop: `${Math.max(1, Math.round(canvas.height * 0.002))}px solid rgba(255, 255, 255, 0.25)`,
      }}
    >
      <div
        ref={words}
        data-testid="ticker-words"
        data-started-at={startedAt}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height,
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          willChange: 'transform',
          transform: `translateX(${canvas.width}px)`,
          color: '#ffffff',
          fontFamily: LANG_FONT_STACK.default,
          fontSize: size,
          fontWeight: 500,
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** Props: each on its own canvas, placed on the screen's as slides are. */
export function PropsLayer({
  props,
  canvas,
  scaling,
}: {
  props: readonly PropItem[];
  canvas: Size;
  scaling: ScalingMode;
}) {
  return (
    <>
      {props.map((prop) => {
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
    </>
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
 * pixels). Bottom to top: background, slide, props, messages, the ticker,
 * masks, the logo, black-out. The operator preview and every output use this
 * same component; the preview sets `annotate` to mark problems the audience
 * never sees. The stream leaves the ticker out (`ticker`).
 */
export const Scene = memo(function Scene({
  state,
  canvas,
  scaling,
  annotate = false,
  languages = null,
  ticker = true,
}: {
  state: EngineState;
  canvas: Size;
  scaling: ScalingMode;
  annotate?: boolean;
  /** The languages this screen shows of a kirtan's slides, in order; null for all of them. */
  languages?: readonly Lang[] | null;
  /** Draw the announcements ticker (the hall's screens do; the stream does not). */
  ticker?: boolean;
}) {
  const { layers } = state;
  const band = ticker && layers.ticker ? layers.ticker : null;
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
      <SlideLayerView layer={layers.slide} canvas={canvas} scaling={scaling} languages={languages} />
      <PropsLayer props={layers.props} canvas={canvas} scaling={scaling} />
      {layers.messages.length > 0 && (
        <MessageBanner
          messages={layers.messages}
          timers={state.timers}
          canvas={canvas}
          above={band ? Math.round(canvas.height * TICKER_HEIGHT) : 0}
        />
      )}
      {band && <TickerBand ticker={band} canvas={canvas} />}
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
