import type { CSSProperties } from 'react';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarDay, CalendarLang } from '../../../shared/calendar';
import { festivalsLine, samvatLine } from '../../../shared/calendar';
import type { EngineState, MessageItem, PropItem, TickerLayer } from '../../../shared/engine/state';
import type { LiveGroupLook, LookLayer } from '../../../shared/looks';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import type { Mask } from '../../../shared/masks';
import { maskCoverUrl } from '../../../shared/masks';
import type { TimerState } from '../../../shared/timers';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { BackgroundMedia } from './BackgroundMedia';
import { IdleRotation } from './IdleRotation';
import { engineNow } from './clock';
import { LANG_FONT_STACK } from './fonts';
import { Placed } from './Placed';
import { SlideLayerView } from './SlideLayerView';
import { ElementView } from './SlideView';
import { TimerText } from './TimerText';

/** Today's Samvat date and tithi, with any festival; nothing when the calendars do not give today. */
export function samvatText(calendar: CalendarDay | null, lang: CalendarLang): string {
  if (!calendar) return '';
  const festivals = festivalsLine(calendar, lang);
  return festivals ? `${samvatLine(calendar, lang)} · ${festivals}` : samvatLine(calendar, lang);
}

/** A message's words, live timers and today's Samvat date. */
function MessageText({
  message,
  timers,
  calendar,
}: {
  message: MessageItem;
  timers: readonly TimerState[];
  calendar: CalendarDay | null;
}) {
  if (!message.parts) return <>{message.text}</>;
  return (
    <>
      {message.parts.map((part, i) =>
        part.kind === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === 'timer' ? (
          <TimerText key={i} timer={timers.find((t) => t.id === part.timerId)} />
        ) : (
          <span key={i} lang={part.lang} data-samvat={part.lang}>
            {samvatText(calendar, part.lang)}
          </span>
        ),
      )}
    </>
  );
}

/** The messages along the bottom of the picture (at the top over a lower third, as in the stream's Camera layout). */
export function MessageBanner({
  messages,
  timers,
  calendar = null,
  canvas,
  at = 'bottom',
  above = 0,
}: {
  messages: MessageItem[];
  timers: readonly TimerState[];
  /** Today's calendar entry, for a message's Samvat field. */
  calendar?: CalendarDay | null;
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
          <MessageText message={m} timers={timers} calendar={calendar} />
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

const FULL = { position: 'absolute', inset: 0 } as const;

/**
 * A mask, drawn as its cover laid over what it masks: black where it hides
 * (the screen's black, or nothing for a key output to key), see-through
 * where the picture shows. Its own canvas is stretched over the screen's.
 * The same pixels as masking the layers below, but a still picture on top:
 * masking them instead (CSS mask-image) made the compositor draw a video
 * background through the mask again on every one of its frames (Session 15).
 */
function MaskCover({ mask, layer }: { mask: Mask; layer: 'masks' | 'look' }) {
  const style = useMemo<CSSProperties>(
    () => ({
      ...FULL,
      backgroundImage: maskCoverUrl(mask),
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
    }),
    [mask],
  );
  return layer === 'masks' ? (
    <div data-layer="masks" data-mask={mask.id} style={style} />
  ) : (
    <div data-look-mask={mask.id} style={style} />
  );
}

/**
 * Everything one screen shows, drawn on that screen's canvas (in canvas
 * pixels). Bottom to top: background, slide, props, messages, the ticker,
 * masks, the logo, black-out. The operator preview and every output use this
 * same component; the preview sets `annotate` to mark problems the audience
 * never sees. What a screen shows of it is its group's settings in the live
 * Look (`look`: its layers, languages and slide style). The stream leaves
 * the ticker out (`ticker`).
 */
export const Scene = memo(function Scene({
  state,
  canvas,
  scaling,
  annotate = false,
  look = DEFAULT_LIVE_GROUP_LOOK,
  ticker = true,
  matte = null,
}: {
  state: EngineState;
  canvas: Size;
  scaling: ScalingMode;
  annotate?: boolean;
  /** This screen's group's settings in the live Look (every layer and language when left out). */
  look?: LiveGroupLook;
  /** Draw the announcements ticker (the hall's screens do; the stream does not). */
  ticker?: boolean;
  /**
   * A key and fill pair's half: the fill is the picture, black where empty;
   * the key is white wherever the fill has something, by its opacity, black
   * elsewhere. Black-out and the logo are for the hall: they take the
   * graphics off (nothing to key).
   */
  matte?: 'fill' | 'key' | null;
}) {
  const { layers } = state;
  const shown = (layer: LookLayer) => look.layers.includes(layer);
  const band = ticker && shown('ticker') && layers.ticker ? layers.ticker : null;
  const bandHeight = band ? Math.round(canvas.height * TICKER_HEIGHT) : 0;
  // A Look's lower third keeps the bottom: messages go along the top (as in the stream's Camera
  // layout), and the words sit above the ticker's band.
  const lowerThirds = look.slides === 'lowerThird';
  const background = shown('background') ? layers.background : null;
  // The group's own mask (its screens' shape) over everything; the Masks layer over the layers below the logo.
  const groupMask = look.mask;
  const layerMask = shown('masks') ? layers.masks : null;
  // Key and fill: black-out and the logo take the graphics off; the key draws every colour white, by its opacity.
  const keyed = matte !== null;
  const off = keyed && (state.blackout || state.logo !== null);
  // The idle rotation, where this group's Look shows it, while nothing is up on these screens.
  const nothingUp = background === null && (layers.slide === null || !shown('slide'));
  const idle =
    nothingUp && (look.idle === 'always' || (look.idle === 'started' && state.idle.startedAt !== null));
  const content: CSSProperties = matte === 'key' ? { ...FULL, filter: 'brightness(0) invert(1)' } : FULL;
  return (
    <div
      data-testid="scene"
      data-canvas={`${canvas.width}x${canvas.height}`}
      data-look-layers={look.layers.join(',')}
      style={{
        position: 'relative',
        width: canvas.width,
        height: canvas.height,
        overflow: 'hidden',
        background: '#000000',
      }}
    >
      <div data-matte={matte ?? undefined} data-off={off ? 'true' : undefined} style={content}>
        {!off && (
          <>
            <div style={FULL}>
              {background?.kind === 'color' && (
                <div
                  data-layer="background"
                  style={{ position: 'absolute', inset: 0, background: background.color }}
                />
              )}
              <BackgroundMedia layer={background} annotate={annotate} />
              {idle && <IdleRotation idle={state.idle} languages={look.languages} canvas={canvas} />}
              <SlideLayerView
                layer={shown('slide') ? layers.slide : null}
                canvas={canvas}
                scaling={scaling}
                languages={look.languages}
                slides={look.slides}
                lift={bandHeight}
              />
              {shown('props') && <PropsLayer props={layers.props} canvas={canvas} scaling={scaling} />}
              {shown('messages') && layers.messages.length > 0 && (
                <MessageBanner
                  messages={layers.messages}
                  timers={state.timers}
                  calendar={state.calendar}
                  canvas={canvas}
                  at={lowerThirds ? 'top' : 'bottom'}
                  above={lowerThirds ? 0 : bandHeight}
                />
              )}
              {band && <TickerBand ticker={band} canvas={canvas} />}
            </div>
            {layerMask && !keyed && <MaskCover mask={layerMask} layer="masks" />}
            {state.logo && !keyed && (
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
            {groupMask && !keyed && <MaskCover mask={groupMask} layer="look" />}
          </>
        )}
      </div>
      {/* A key and fill pair's covers go over the key's white too: what a mask hides is never keyed. */}
      {keyed && !off && layerMask && <MaskCover mask={layerMask} layer="masks" />}
      {keyed && !off && groupMask && <MaskCover mask={groupMask} layer="look" />}
      {state.blackout && !keyed && (
        <div
          data-layer="blackout"
          data-testid="blackout"
          style={{ position: 'absolute', inset: 0, background: '#000000' }}
        />
      )}
    </div>
  );
});
