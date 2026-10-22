import type { CSSProperties, RefObject } from 'react';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Movement } from '../../../shared/looks';
import type { TimerElement } from '../../../shared/model';
import { changesAt, type TimerState } from '../../../shared/timers';
import { clockHeld, engineNow, onClockJump } from './clock';
import { ClockStyleContext } from './clock-style';
import { SlideMovementContext, useSlideTimer } from './slide-timers';
import { digitFrame, digitLength, drawnTime, lastMinuteColor } from './timer-digits';

/*
 * A Timer on a slide (Session 50): its timer's time, live, in its box as words are drawn, worked out here from
 * the engine's timers (start, pause and reset are all the engine sends). Kept small: only this draws again,
 * when what the timer shows changes (once a second, a clock once a minute), and only its digits that changed
 * move, frame by frame from the engine's clock while they do (render/timer-digits.ts). Its box and look come
 * from SlideView (timerBoxStyle), as a text box's do.
 */

/** The longest a Timer waits before it looks at its time again (a countdown to a time at midnight, say). */
const LOOK_AGAIN_MS = 60_000;

/**
 * The engine's time, drawn again as the timer's time changes, and at once when the clock jumps. A new timer
 * state (started, paused, reset) draws with the time last drawn, which shows what it shows now: nothing it
 * shows has changed since (it is drawn again at every change).
 */
function useTimerNow(timer: TimerState | undefined): number {
  const [now, setNow] = useState(() => engineNow());
  useEffect(() => {
    let wait: ReturnType<typeof setTimeout> | undefined;
    const plan = () => {
      clearTimeout(wait);
      const at = engineNow();
      const next = timer ? changesAt(timer, at) : null;
      const ms = next === null ? LOOK_AGAIN_MS : Math.min(LOOK_AGAIN_MS, next - at + 1);
      // eslint-disable-next-line no-restricted-syntax -- only asks for a new drawing: the time it draws is the engine's (engineNow)
      wait = setTimeout(tick, Math.max(0, ms));
    };
    const tick = () => {
      setNow(engineNow());
      plan();
    };
    plan();
    const off = onClockJump(tick);
    return () => {
      clearTimeout(wait);
      off();
    };
  }, [timer]);
  return now;
}

/**
 * The changed digits' frames, from when they changed by the engine's clock, until they are at rest: drawn
 * again at each frame meanwhile, and after every render, before it is painted. Held (a test), it stays put.
 */
function useDigitMotion(
  ref: RefObject<HTMLElement | null>,
  changing: number | null,
  movement: Movement,
): void {
  const paint = useCallback((): boolean => {
    const root = ref.current;
    if (!root) return false;
    const t = changing === null ? Infinity : engineNow() - changing;
    const moving = t < digitLength(movement);
    const f = digitFrame(movement, t);
    for (const el of root.querySelectorAll<HTMLElement>('[data-changed] > [data-digit-now]')) {
      el.style.opacity = moving ? String(f.in.opacity) : '';
      el.style.transform = moving && f.in.rise !== 0 ? `translateY(${String(f.in.rise)}em)` : '';
    }
    // The old digits, gone once they have moved out: not drawn, and not read.
    for (const el of root.querySelectorAll<HTMLElement>('[data-digit-was]')) {
      el.style.display = moving ? '' : 'none';
      el.style.opacity = moving ? String(f.out.opacity) : '0';
      el.style.transform = moving && f.out.rise !== 0 ? `translateY(${String(f.out.rise)}em)` : '';
    }
    return moving && !clockHeld();
  }, [ref, changing, movement]);
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

export function TimerElementView({
  el,
  box,
  animate,
  band,
}: {
  el: TimerElement;
  /** Its box, as SlideView draws a Timer's (timerBoxStyle). */
  box: CSSProperties;
  /** Its digits move when they change (the screens, LIVE); a thumbnail's and the editor's do not. */
  animate: boolean;
  /** A band behind its digits this dark (the slide's darkening behind the words), or none. */
  band?: number;
}) {
  const timer = useSlideTimer(el.timerId);
  const movement = useContext(SlideMovementContext);
  // A clock in Main's way of writing the time (Sessions 31–36, I18N-8), as a message's timer.
  const style = useContext(ClockStyleContext);
  const now = useTimerNow(timer);
  const shown = drawnTime(timer, now, style, movement);
  const changing = animate ? shown.changing : null;
  const color = lastMinuteColor(el, timer, now);
  const digits = useRef<HTMLSpanElement>(null);
  useDigitMotion(digits, changing, movement);
  return (
    <div
      data-element={el.id}
      data-timer-element={el.timerId}
      data-time={shown.text}
      data-last-minute={color === null ? undefined : ''}
      style={color === null ? box : { ...box, color }}
    >
      <div
        data-darken={band ? 'band' : undefined}
        style={{
          width: '100%',
          flexShrink: 0,
          ...(band
            ? {
                background: `rgba(0, 0, 0, ${String(band)})`,
                boxShadow: `0 0 0 0.3em rgba(0, 0, 0, ${String(band)})`,
              }
            : {}),
        }}
      >
        <span ref={digits} data-timer-digits="" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {shown.cells.map((c) => {
            const moves = changing !== null && c.was !== null;
            return (
              <span
                key={c.key}
                data-digit={c.key}
                data-changed={moves ? '' : undefined}
                style={{ position: 'relative', display: 'inline-block' }}
              >
                <span data-digit-now="">{c.char}</span>
                {moves && (
                  <span
                    data-digit-was=""
                    aria-hidden="true"
                    style={{ position: 'absolute', left: 0, top: 0 }}
                  >
                    {c.was}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}
