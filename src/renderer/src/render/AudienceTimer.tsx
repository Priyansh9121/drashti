import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import {
  AUDIENCE_TIMER_FADE_MS,
  audienceTimerShows,
  audienceTimerText,
  lookOf,
  timeColor,
  timeLeftShare,
  timerDimmed,
  timeSize,
} from '../../../shared/audience-timer';
import type { AudienceTimerLayer, EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import { FLASH_DIM } from '../../../shared/stage-timer';
import type { AudienceTimerLook } from '../../../shared/timer-look';
import type { TimerState } from '../../../shared/timers';
import { clockHeld, engineNow, onClockJump } from './clock';
import { ClockStyleContext } from './clock-style';
import { EASE, seg } from './easing';
import { fontFamilyFor } from './fonts';
import { NothingUp, nothingUpShows } from './NothingUp';
import { useNow } from './useNow';

/*
 * A timer for the audience (Session 55, Part 15, shared/audience-timer.ts) as every screen draws it: full screen or in
 * a corner, over the wallpaper (black until Part 6 brings the chosen one) or over what is up, its label above the time,
 * a ring round it or a bar under it of the time left, its warning colour and slow flash near the end, and at zero its
 * message, the wallpaper alone, or nothing (the engine takes it off). It fades in from when it went up and out from
 * when it was hidden, by the engine's clock, so every screen, a node and a phone's picture draw the same frame. The
 * Timers panel's small picture of a look draws it too.
 */

/** The ring's circle (a viewBox of 100): its radius and its whole length. */
const RING_R = 46;
const RING_LENGTH = 2 * Math.PI * RING_R;

/** A font size at which `chars` digits fit `width` (tabular digits are about 0.56 of the size wide). */
const fitting = (size: number, chars: number, width: number): number =>
  Math.min(size, Math.floor(width / Math.max(1, chars * 0.56)));

/**
 * The wallpaper behind it: what a screen shows with nothing up (render/NothingUp.tsx, where Part 6 draws the chosen
 * one; black until one is chosen), over black, covering what is up.
 */
function WallpaperBackdrop({ state, canvas }: { state: EngineState | undefined; canvas: Size }) {
  return (
    <div data-wallpaper-backdrop="" style={{ position: 'absolute', inset: 0, background: '#000000' }}>
      {state && <NothingUp shows={nothingUpShows(state)} state={state} canvas={canvas} />}
    </div>
  );
}

/** Its opacity `t` ms into its fade in (or out), by the engine's clock. */
function useFade(ref: RefObject<HTMLElement | null>, from: number, out: boolean): void {
  const paint = useCallback((): boolean => {
    const el = ref.current;
    if (!el) return false;
    const t = engineNow() - from;
    if (t >= AUDIENCE_TIMER_FADE_MS) {
      el.style.opacity = out ? '0' : '';
      return false;
    }
    const p = seg(t, 0, AUDIENCE_TIMER_FADE_MS, EASE.out);
    el.style.opacity = String(out ? 1 - p : p);
    return !clockHeld();
  }, [ref, from, out]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      cancelAnimationFrame(frame);
      if (paint()) frame = requestAnimationFrame(tick);
    };
    tick();
    const off = onClockJump(tick);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [paint]);
  useLayoutEffect(() => {
    paint();
  });
}

/** The time, its label and its ring or bar, as one block (full screen: in the middle; else in its corner). */
function TimeBlock({
  look,
  timer,
  now,
  shownAt,
  canvas,
}: {
  look: AudienceTimerLook;
  timer: TimerState;
  now: number;
  shownAt: number;
  canvas: Size;
}) {
  const style = useContext(ClockStyleContext);
  const size = timeSize(look, canvas.height);
  const text = audienceTimerText(look, timer, now, style);
  const color = timeColor(look, timer, now);
  const share = look.timeLeft === 'none' ? null : timeLeftShare(timer, now, shownAt);
  const font = fontFamilyFor(look.font, null);
  const label =
    look.label.trim() === '' ? null : (
      <div
        data-testid="audience-timer-label"
        style={{
          color: look.labelColor,
          fontSize: size * 0.3,
          fontWeight: 500,
          lineHeight: 1.2,
          textAlign: 'center',
        }}
      >
        {look.label}
      </div>
    );
  let time: ReactNode;
  if (share !== null && look.timeLeft === 'ring') {
    const d = look.place === 'full' ? Math.round(canvas.height * 0.62) : Math.round(size * 2.6);
    time = (
      <div style={{ position: 'relative', width: d, height: d, display: 'grid', placeItems: 'center' }}>
        <svg
          data-time-left="ring"
          viewBox="0 0 100 100"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            transform: 'rotate(-90deg)',
          }}
        >
          <circle cx="50" cy="50" r={RING_R} fill="none" stroke="rgba(255, 255, 255, 0.18)" strokeWidth="4" />
          <circle
            cx="50"
            cy="50"
            r={RING_R}
            fill="none"
            stroke={color === look.warn?.color ? color : look.timeLeftColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${String(Math.round(share * RING_LENGTH * 100) / 100)} ${String(Math.round(RING_LENGTH * 100) / 100)}`}
          />
        </svg>
        <span
          data-testid="audience-timer-time"
          data-time={text}
          style={{
            color,
            fontSize: fitting(size, text.length, d * 0.78),
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {text}
        </span>
      </div>
    );
  } else {
    const width = look.place === 'full' ? canvas.width * 0.9 : canvas.width * 0.4;
    time = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: size * 0.1 }}>
        <span
          data-testid="audience-timer-time"
          data-time={text}
          style={{
            color,
            fontSize: fitting(size, text.length, width),
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.05,
            textAlign: 'center',
          }}
        >
          {text}
        </span>
        {share !== null && look.timeLeft === 'bar' && (
          <div
            data-time-left="bar"
            style={{
              height: Math.max(4, Math.round(size * 0.07)),
              borderRadius: size,
              background: 'rgba(255, 255, 255, 0.18)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${String(Math.round(share * 1000) / 10)}%`,
                background: color === look.warn?.color ? color : look.timeLeftColor,
              }}
            />
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: size * 0.12,
        fontFamily: font,
        fontWeight: 700,
        textShadow: look.over === 'content' ? '0 0.03em 0.15em rgba(0, 0, 0, 0.8)' : undefined,
      }}
    >
      {label}
      {time}
    </div>
  );
}

const CORNER: Record<Exclude<AudienceTimerLook['place'], 'full'>, CSSProperties> = {
  'top-left': { top: '5%', left: '5%' },
  'top-right': { top: '5%', right: '5%' },
  'bottom-left': { bottom: '5%', left: '5%' },
  'bottom-right': { bottom: '5%', right: '5%' },
};

/** One timer up (or fading out), in its look. */
function TimerUp({
  state,
  layer,
  off,
  timer,
  canvas,
}: {
  state: EngineState | undefined;
  layer: AudienceTimerLayer;
  off: number | null;
  timer: TimerState;
  canvas: Size;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFade(ref, off ?? layer.shownAt, off !== null);
  const now = useNow(250);
  const look = lookOf(timer);
  // One that goes by itself at zero shows its 0:00 until the engine takes it off then, and fades out from there as
  // any hidden one does; nothing once faded out.
  const said = audienceTimerShows(look, timer, now);
  const shows = said === 'gone' ? 'time' : said;
  if (off !== null && engineNow() - off >= AUDIENCE_TIMER_FADE_MS) return null;
  const warn = look.warn !== null && timeColor(look, timer, now) === look.warn.color && shows === 'time';
  const dim = shows === 'time' && timerDimmed(look, timer, now);
  const full = look.place === 'full';
  const wallpaper = look.over === 'wallpaper' || shows === 'wallpaper';
  const size = timeSize(look, canvas.height);
  let body: ReactNode = null;
  if (shows === 'time')
    body = <TimeBlock look={look} timer={timer} now={now} shownAt={layer.shownAt} canvas={canvas} />;
  else if (shows === 'message')
    body = (
      <div
        data-testid="audience-timer-message"
        style={{
          color: look.color,
          fontFamily: fontFamilyFor(look.font, null),
          fontSize: Math.round(size * (full ? 0.45 : 0.5)),
          fontWeight: 700,
          textAlign: 'center',
          maxWidth: full ? canvas.width * 0.9 : canvas.width * 0.4,
          overflowWrap: 'anywhere',
          textShadow: look.over === 'content' ? '0 0.03em 0.15em rgba(0, 0, 0, 0.8)' : undefined,
        }}
      >
        {look.zeroText}
      </div>
    );
  return (
    <div
      ref={ref}
      data-layer="timer"
      data-timer={timer.id}
      data-place={look.place}
      data-over={look.over}
      data-shows={shows}
      data-at-zero={look.atZero}
      data-warn={warn ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {wallpaper && <WallpaperBackdrop state={state} canvas={canvas} />}
      {body !== null && (
        <div
          style={{
            position: 'absolute',
            ...(full
              ? { inset: 0, display: 'grid', placeItems: 'center' }
              : CORNER[look.place as keyof typeof CORNER]),
            ...(!full && look.over === 'content'
              ? { background: 'rgba(0, 0, 0, 0.55)', padding: size * 0.25, borderRadius: size * 0.15 }
              : {}),
            opacity: dim ? FLASH_DIM : undefined,
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

/**
 * The timer for the audience up (`layer`), or the one just hidden fading out (`off`); nothing when neither, or its
 * timer is gone from the library.
 */
export function AudienceTimerView({
  state,
  layer,
  off,
  timers,
  canvas,
}: {
  /** The show, for the wallpaper behind it (left out in a small picture: black). */
  state?: EngineState;
  layer: AudienceTimerLayer | null | undefined;
  off: { layer: AudienceTimerLayer; at: number } | null | undefined;
  timers: readonly TimerState[];
  canvas: Size;
}) {
  const now = engineNow();
  const shown = layer ?? (off && now - off.at < AUDIENCE_TIMER_FADE_MS ? off.layer : null);
  const timer = shown ? timers.find((t) => t.id === shown.timerId) : undefined;
  if (!shown || !timer) return null;
  return (
    <TimerUp
      key={`${shown.timerId}@${String(shown.shownAt)}`}
      state={state}
      layer={shown}
      off={layer ? null : (off?.at ?? null)}
      timer={timer}
      canvas={canvas}
    />
  );
}
