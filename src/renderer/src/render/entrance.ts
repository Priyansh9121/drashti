import { useCallback, useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import type { Movement } from '../../../shared/looks';
import { engineNow, onClockJump } from './clock';
import { EASE, seg } from './easing';

/*
 * How a message banner and the ticker's band come in (Session 27, the design lab's): Calm fades in in
 * 250 ms; Bold fades in over 300 ms rising from its edge (a banner along the bottom from below, one along
 * the top settling from above, the ticker's band from below). Timed by the engine's clock from when it went
 * up (a message's shownAt, the band's own), so every screen draws the same; an update never plays it again.
 * They go at once (a cut), as before.
 */

export type EntranceKind = 'banner' | 'banner-top' | 'band';

export const entranceLength = (movement: Movement): number => (movement === 'bold' ? 300 : 250);

/** An entrance `t` ms in: its opacity, and how far from its place it still is (canvas px at 1080). */
export function entranceFrame(
  kind: EntranceKind,
  movement: Movement,
  t: number,
): { opacity: number; offset: number } {
  const p = seg(t, 0, entranceLength(movement), EASE.out);
  if (movement !== 'bold') return { opacity: p, offset: 0 };
  const rise = (kind === 'band' ? 24 : 16) * (1 - p);
  return { opacity: p, offset: kind === 'banner-top' ? -rise : rise };
}

/**
 * Draw an element's entrance frame by frame from the engine's time (`start`: when it went up; undefined for
 * one that is simply there, put back after a restart), until it is in place. `scale`: canvas px per 1080.
 */
export function useEntrance(
  ref: RefObject<HTMLElement | null>,
  start: number | undefined,
  kind: EntranceKind,
  movement: Movement,
  scale: number,
): void {
  const paint = useCallback((): boolean => {
    const el = ref.current;
    if (!el) return false;
    const t = start === undefined ? Infinity : engineNow() - start;
    if (t >= entranceLength(movement)) {
      el.style.opacity = '';
      el.style.transform = '';
      el.removeAttribute('data-entrance-at');
      return false;
    }
    const f = entranceFrame(kind, movement, t);
    el.style.opacity = String(f.opacity);
    el.style.transform = f.offset === 0 ? '' : `translateY(${String(f.offset * scale)}px)`;
    // How far into its entrance it was drawn (ms), for tests (a held clock).
    el.setAttribute('data-entrance-at', String(Math.round(t)));
    return true;
  }, [ref, start, kind, movement, scale]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      cancelAnimationFrame(frame);
      if (paint()) frame = requestAnimationFrame(tick);
    };
    tick();
    // The clock held or set (a test, a node's offset): drawn again from its time, even after it was in place.
    const off = onClockJump(tick);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [paint]);
  // After every render, before it is painted.
  useLayoutEffect(() => {
    paint();
  });
}
