import { type ReactNode, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { engineNow, onClockJump } from './clock';

/*
 * Drashti stopped (Session 54, access by Gmail: revoked, rejected, unknown, or 2 minutes with no answer). The engine's
 * state says when, by its own clock (state.stopped), so every screen, node, phone's stage display and the stream's
 * picture fade to black together, frame by frame from the engine's time. Once black, a page draws nothing under it
 * at all (`black`), so no video plays on and no camera or window stays open. The cover goes last in a positioned
 * box that holds the whole picture.
 */

/** How long the screens take to fade to black. */
export const STOP_FADE_MS = 1000;

export function useStopFade(stopped: { at: number } | null | undefined): {
  black: boolean;
  cover: ReactNode;
} {
  // Drawn again when the clock jumps (a node's or a phone's clock set, a test holding it) and as the fade ends.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onClockJump(redraw), []);
  const ref = useRef<HTMLDivElement>(null);
  const at = stopped?.at ?? null;
  const t = at === null ? 0 : engineNow() - at;
  const black = at !== null && t >= STOP_FADE_MS;
  // Frame by frame from the engine's clock while it fades; at its end, drawn again, black alone.
  useLayoutEffect(() => {
    if (at === null || black) return;
    let frame = 0;
    const tick = () => {
      const now = engineNow() - at;
      if (now >= STOP_FADE_MS) {
        redraw();
        return;
      }
      if (ref.current) ref.current.style.opacity = String(Math.max(0, now / STOP_FADE_MS));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [at, black]);
  const cover =
    at === null ? null : (
      <div
        ref={ref}
        data-testid="stopped-cover"
        data-stopped={black ? 'black' : 'fading'}
        style={{
          position: 'absolute',
          inset: 0,
          background: '#000000',
          opacity: black ? 1 : Math.max(0, t / STOP_FADE_MS),
        }}
      />
    );
  return { black, cover };
}
