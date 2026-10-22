import type { CSSProperties, ReactNode } from 'react';
import { Fragment, memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarDay, CalendarLang } from '../../../shared/calendar';
import { festivalsLine, samvatLine } from '../../../shared/calendar';
import type {
  BackgroundLayer,
  EngineState,
  MessageItem,
  PipLayer,
  PropItem,
  TickerLayer,
} from '../../../shared/engine/state';
import type { LiveGroupLook, LookLayer, Movement } from '../../../shared/looks';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import type { Mask } from '../../../shared/masks';
import { maskCoverUrl } from '../../../shared/masks';
import type { TimerState } from '../../../shared/timers';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { BackgroundMedia } from './BackgroundMedia';
import { LiveWindowView } from './LiveWindowView';
import { useEntrance } from './entrance';
import { IdleRotation } from './IdleRotation';
import { clockHeld, engineFrameNow, onClockJump } from './clock';
import { LANG_FONT_STACK } from './fonts';
import { textLang } from './lang';
import { Placed } from './Placed';
import { SlideLayerView } from './SlideLayerView';
import { SlideLowerThird } from './LowerThird';
import { LowerThirdView } from './LowerThirdView';
import { ScreenPictures } from './picture-looks';
import { ElementView } from './SlideView';
import { TimerText } from './TimerText';
import { useLiveHere } from './live-here';
import {
  pipMainMove,
  pipMainPlaces,
  type PipPicture,
  type PipRun,
  pipShownFor,
  pipShowsHere,
  type PipSlot,
} from './pip';
import { PipBox, PipSourcePicture, usePipMainMove, usePipRun } from './PipLayerView';
import { MESSAGE_TEXT, TICKER_HEIGHT } from '../../../shared/safe-areas';

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
  movement = 'calm',
}: {
  messages: MessageItem[];
  timers: readonly TimerState[];
  /** Today's calendar entry, for a message's Samvat field. */
  calendar?: CalendarDay | null;
  canvas: Size;
  at?: 'top' | 'bottom';
  /** Canvas pixels to leave at that edge (the ticker's band). */
  above?: number;
  /** How this screen's group moves (Session 27): the banner's entrance. */
  movement?: Movement;
}) {
  const size = Math.round(canvas.height * MESSAGE_TEXT);
  const ref = useRef<HTMLDivElement>(null);
  // In from when the first of its messages went up (Session 27); another joining, or an update, never
  // plays it again. A message put back after a restart has no time: the banner is simply there.
  const times = messages.map((m) => m.shownAt);
  const start = times.some((t) => t === undefined) ? undefined : Math.min(...(times as number[]));
  useEntrance(ref, start, at === 'top' ? 'banner-top' : 'banner', movement, canvas.height / 1080);
  return (
    <div
      ref={ref}
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
          {/* Its words' language (Sessions 31–36, I18N-4), by their letters. */}
          <span lang={textLang(m.text)}>
            <MessageText message={m} timers={timers} calendar={calendar} />
          </span>
        </span>
      ))}
    </div>
  );
}

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
 * The announcements ticker along the bottom of the picture: the words come in
 * at the right edge and go out at the left, again and again. Where they are
 * comes from the engine's clock, so every screen shows the same place; the
 * browser moves them (an animation), and each screen checks every few seconds
 * that it is still in step.
 */
export function TickerBand({
  ticker,
  canvas,
  movement = 'calm',
}: {
  ticker: TickerLayer;
  canvas: Size;
  /** How this screen's group moves (Session 27): the band's entrance. */
  movement?: Movement;
}) {
  const words = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  // The band comes in from its own time, once; the words start again with each announcement (Session 27).
  useEntrance(band, ticker.shownAt, 'band', movement, canvas.height / 1080);
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
      const want = tickerPhase(engineFrameNow(), startedAt, passMs);
      const now = Number(animation.currentTime ?? 0) % passMs;
      const off = Math.abs(want - now);
      if (Math.min(off, passMs - off) > TICKER_STEP_MS) animation.currentTime = want;
    };
    // The clock held (a test) or set: the words go where its time puts them at once, and stay there while
    // it is held (Session 27), as the slow zoom does.
    const jumped = () => {
      if (!animation || passMs <= 0) return;
      // Paused before it is placed: a pause only lands at the next frame, a frame further on.
      if (clockHeld()) animation.pause();
      animation.currentTime = tickerPhase(engineFrameNow(), startedAt, passMs);
      if (!clockHeld()) animation.play();
    };
    const start = () => {
      animation?.cancel();
      // The words' width in canvas pixels (the scene is scaled around them); it changes as fonts arrive.
      const width = el.offsetWidth;
      passMs = tickerPassMs({ width: canvasWidth, height: canvasHeight }, width);
      el.dataset['passMs'] = String(Math.round(passMs));
      // eslint-disable-next-line no-restricted-syntax -- seeked from the engine's time at once below (tickerPhase), and checked every few seconds
      animation = el.animate(
        [{ transform: `translateX(${canvasWidth}px)` }, { transform: `translateX(${-width}px)` }],
        { duration: passMs, iterations: Infinity, easing: 'linear' },
      );
      if (clockHeld()) animation.pause();
      animation.currentTime = tickerPhase(engineFrameNow(), startedAt, passMs);
    };
    start();
    const offJump = onClockJump(jumped);
    const resized = new ResizeObserver(start);
    resized.observe(el);
    // eslint-disable-next-line no-restricted-syntax -- only checks the words are still where the engine's time puts them
    const timer = setInterval(inStep, 5000);
    return () => {
      offJump();
      resized.disconnect();
      clearInterval(timer);
      animation?.cancel();
    };
  }, [text, startedAt, canvasWidth, canvasHeight]);
  return (
    <div
      ref={band}
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
        {/* Each announcement in its own language (Sessions 31–36, I18N-4), by its letters. */}
        {ticker.items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && TICKER_GAP}
            <span data-ticker-item="" lang={textLang(item.text)}>
              {item.text}
            </span>
          </Fragment>
        ))}
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
                {/* Its videos play from when it went up, in step on every screen (Session 27). */}
                {prop.elements.map((el) => (
                  <ElementView key={el.id} el={el} startedAt={prop.shownAt} />
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
 * The background layer as a screen draws it: a colour, a picture or a video, or another app's window (Session
 * 48). On the main picture, or in the picture-in-picture box when the box and the main picture are swapped
 * (Session 50). Session 50: section 1's video input background is drawn here too, in either place.
 */
function BackgroundPicture({
  background,
  annotate,
  movement,
}: {
  background: BackgroundLayer | null;
  annotate: boolean;
  movement: Movement;
}) {
  return (
    <>
      {background?.kind === 'color' && (
        <div
          data-layer="background"
          style={{ position: 'absolute', inset: 0, background: background.color }}
        />
      )}
      <BackgroundMedia layer={background} annotate={annotate} movement={movement} />
      {background?.kind === 'window' && <LiveWindowView layer={background} />}
    </>
  );
}

/**
 * One of the main picture's pictures (Session 50): always in its own place, so a background or a slide never
 * loads again as the box comes and goes; drawn, or ready unseen while a swap goes out (render/pip.ts pipPlaces).
 * Session 51: in a swap, the one that changes there moves with the box, never a cut at the middle (render/pip.ts
 * pipMainMove), whole on the screen's black (a key and fill pair's on nothing: black there would be keyed).
 */
function MainSlot({
  slot,
  swap,
  children,
}: {
  slot: PipSlot | undefined;
  /** The box up's run (null when this screen draws none) and the screen it moves over. */
  swap: { run: PipRun | null; canvas: Size; keyed: boolean };
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const moving = slot !== undefined && swap.run !== null && pipMainMove(swap.run)?.picture === slot.picture;
  usePipMainMove(ref, moving ? swap.run : null, swap.canvas);
  if (!slot) return null;
  return (
    <div
      ref={ref}
      data-pip-main={slot.picture}
      data-pip-ready={slot.shown ? undefined : ''}
      data-pip-moving={moving ? '' : undefined}
      style={{ ...FULL, visibility: slot.shown ? undefined : 'hidden' }}
    >
      {moving && !swap.keyed && <div data-pip-base="" style={{ ...FULL, background: '#000000' }} />}
      {children}
    </div>
  );
}

/**
 * Everything one screen shows, drawn on that screen's canvas (in canvas
 * pixels). Bottom to top: background, slide, props, the picture-in-picture box (Session 50), a lower third (Session 44,
 * on the pictures it is for), messages, the ticker, masks, the logo, black-out. The operator preview and every output use this
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
  place = 'hall',
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
  /** Which picture this is, for a lower third (Session 44): a hall screen, or the stream (a key and fill pair feeds it). */
  place?: 'hall' | 'stream';
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
  // The picture-in-picture box (Session 50, render/pip.ts): where this group's Look shows it (else drawn as if
  // there were none), a video input or a window only on this computer's own pages, and the slides in it only
  // while a slide is up and the group shows the slides.
  const live = useLiveHere();
  const boxHere = (box: PipLayer | null): box is PipLayer =>
    box !== null &&
    pipShownFor(look) &&
    pipShowsHere(box.source, live) &&
    (box.source.kind !== 'slides' || (layers.slide !== null && shown('slide')));
  // Worked out at every drawing from the engine's time, kept while it draws the same (Session 51).
  const [run, refreshRun] = usePipRun(layers.pip, state.pipOff, look.movement, canvas);
  const up = boxHere(layers.pip) ? layers.pip : null;
  // The idle rotation, where this group's Look shows it, while nothing is up on these screens (the box counts).
  const nothingUp = background === null && (layers.slide === null || !shown('slide')) && up === null;
  const idle =
    nothingUp && (look.idle === 'always' || (look.idle === 'started' && state.idle.startedAt !== null));
  const content: CSSProperties = matte === 'key' ? { ...FULL, filter: 'brightness(0) invert(1)' } : FULL;
  // The pictures' looks and the live zoom, as the state carries them (Session 26e): every screen alike.
  const pictures = useMemo(
    () => ({ pictures: state.pictures, liveZoom: state.liveZoom }),
    [state.pictures, state.liveZoom],
  );
  // The box as drawn: the one up, or the one going out (Take off) over the main picture, already whole again.
  const boxRun = run.layer !== null && boxHere(run.layer) ? run : null;
  // The main picture as the box up has it; while it swaps, as drawn (they change places at the swap's middle),
  // the picture that changes there moving with the box (Session 51, render/pip.ts pipMainPlaces).
  const upRun = up !== null && run.layer === up ? run : null;
  const main = pipMainPlaces(up?.source.kind ?? null, upRun, up?.swapped ?? false);
  const swap = { run: upRun, canvas, keyed };
  const slotOf = (picture: PipPicture) => main.find((s) => s.picture === picture);
  /** One of the screen's pictures in the box, at the box's size: the slide there as designed, made small. */
  const inBox = (picture: PipPicture, size: Size): ReactNode => {
    if (picture === 'background')
      return <BackgroundPicture background={background} annotate={false} movement={look.movement} />;
    if (picture === 'slide')
      return (
        <SlideLayerView
          layer={shown('slide') ? layers.slide : null}
          canvas={size}
          scaling={scaling}
          languages={look.languages}
          slides="designed"
          movement={look.movement}
          // A Timer on the slide in the box counts from the state drawn, as the main picture's does (Session 50).
          timers={state.timers}
        />
      );
    const box = boxRun?.layer;
    return box ? <PipSourcePicture source={box.source} shownAt={box.shownAt} size={size} /> : null;
  };
  return (
    <ScreenPictures.Provider value={pictures}>
      <div
        data-testid="scene"
        data-canvas={`${canvas.width}x${canvas.height}`}
        data-look-layers={look.layers.join(',')}
        data-movement={look.movement}
        data-pip={up ? (up.swapped ? 'swapped' : 'up') : 'none'}
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
                <MainSlot slot={slotOf('background')} swap={swap}>
                  <BackgroundPicture background={background} annotate={annotate} movement={look.movement} />
                </MainSlot>
                {/* The box's own picture in the background's place, once swapped (Session 50). */}
                <MainSlot slot={slotOf('source')} swap={swap}>
                  {up && <PipSourcePicture source={up.source} shownAt={up.shownAt} size={canvas} />}
                </MainSlot>
                {idle && <IdleRotation idle={state.idle} languages={look.languages} canvas={canvas} />}
                <MainSlot slot={slotOf('slide')} swap={swap}>
                  <SlideLayerView
                    layer={shown('slide') ? layers.slide : null}
                    canvas={canvas}
                    scaling={scaling}
                    languages={look.languages}
                    slides={look.slides}
                    movement={look.movement}
                    // A timer shown alone fades out as it came on; its Timers' time from this state (Session 50).
                    leaving={shown('slide') ? state.slideOff : null}
                    timers={state.timers}
                  />
                  {lowerThirds && shown('slide') && (
                    <SlideLowerThird
                      layer={layers.slide}
                      slideOff={state.slideOff}
                      languages={look.languages}
                      canvas={canvas}
                      lift={bandHeight}
                      movement={look.movement}
                    />
                  )}
                </MainSlot>
                {shown('props') && <PropsLayer props={layers.props} canvas={canvas} scaling={scaling} />}
                {boxRun && <PipBox run={boxRun} onRun={refreshRun} canvas={canvas} draw={inBox} />}
                <LowerThirdView
                  layer={layers.lowerThird}
                  off={state.lowerThirdOff}
                  canvas={canvas}
                  place={matte === null ? place : 'stream'}
                  lift={bandHeight}
                />
                {shown('messages') && layers.messages.length > 0 && (
                  <MessageBanner
                    messages={layers.messages}
                    timers={state.timers}
                    calendar={state.calendar}
                    canvas={canvas}
                    at={lowerThirds ? 'top' : 'bottom'}
                    above={lowerThirds ? 0 : bandHeight}
                    movement={look.movement}
                  />
                )}
                {band && <TickerBand ticker={band} canvas={canvas} movement={look.movement} />}
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
                        <ElementView key={el.id} el={el} startedAt={state.logo?.shownAt} />
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
    </ScreenPictures.Provider>
  );
});
