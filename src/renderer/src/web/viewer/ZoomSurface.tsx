import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react';
import { cx } from '../../ui/cx';
import {
  clampView,
  nudged,
  panned,
  pinched,
  type Point,
  type Size,
  type View,
  viewTransform,
  WHOLE,
  zoomedAt,
} from './zoom-math';

/*
 * Two fingers zoom and pan, on this device only (Session 54, D1): what the phone looks at, drawn at its own size
 * and moved by one transform. Two fingers zoom about the point between them; one finger moves it once zoomed; two
 * quick taps zoom in where they are, or back to the whole; on a tablet with a keyboard or a computer's browser, the
 * wheel zooms and + − 0 and the arrows do the same. The buttons under it are the way without gestures
 * (DeviceViewer.tsx). Nothing here reaches the screens.
 */

const TAP_MOVES = 8;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_REACH = 40;
/** Zoomed in this far by two quick taps, from the whole. */
const TAP_ZOOM = 2.5;
const WHEEL_SETTLES_MS = 250;

/** Every move of this finger comes here, even off the picture (a pointer the browser no longer knows: none). */
function capture(e: PointerEvent<HTMLElement>): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Lifted already: nothing to follow.
  }
}

type Gesture =
  | { kind: 'pan'; from: View; at: Point; id: number; moved: boolean }
  | { kind: 'pinch'; from: View; a: Point; b: Point; ids: [number, number] };

export function ZoomSurface({
  ref,
  screen,
  content,
  view,
  maxZoom,
  label,
  onView,
  onSettle,
  children,
}: {
  ref: RefObject<HTMLDivElement | null>;
  /** The surface's own size on the screen. */
  screen: Size;
  /** What it draws: its size. */
  content: Size;
  view: View;
  maxZoom: number;
  /** What it shows, read out. */
  label: string;
  onView: (view: View) => void;
  /** A gesture has ended: the pictures are asked for at the size they are drawn now. */
  onSettle: () => void;
  children: ReactNode;
}) {
  const fingers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const shown = clampView(view, content, screen, maxZoom);
  // The wheel's listener (not passive, so the page does not scroll) reads the view it zooms from here.
  const latest = useRef({ shown, content, screen, maxZoom, onView, onSettle });
  useEffect(() => {
    latest.current = { shown, content, screen, maxZoom, onView, onSettle };
  });

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  /** The gesture the fingers down now make, from the view as it is. */
  const begin = () => {
    const down = [...fingers.current.entries()];
    const [first, second] = down;
    if (first && second)
      gesture.current = { kind: 'pinch', from: shown, a: first[1], b: second[1], ids: [first[0], second[0]] };
    else if (first) gesture.current = { kind: 'pan', from: shown, at: first[1], id: first[0], moved: false };
    else gesture.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    capture(e);
    fingers.current.set(e.pointerId, local(e));
    begin();
    setMoving(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(e.pointerId)) return;
    const here = local(e);
    fingers.current.set(e.pointerId, here);
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      const a = fingers.current.get(g.ids[0]);
      const b = fingers.current.get(g.ids[1]);
      if (a && b) onView(pinched(g.from, g.a, g.b, a, b, content, screen, maxZoom));
    } else if (g?.kind === 'pan' && g.id === e.pointerId) {
      if (Math.hypot(here.x - g.at.x, here.y - g.at.y) > TAP_MOVES) g.moved = true;
      if (g.moved && g.from.zoom > 1) onView(panned(g.from, g.at, here, content, screen, maxZoom));
    }
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(e.pointerId)) return;
    const g = gesture.current;
    const here = local(e);
    fingers.current.delete(e.pointerId);
    // A finger left of two: the other carries on moving it from where it is.
    if (fingers.current.size > 0) {
      begin();
      return;
    }
    gesture.current = null;
    setMoving(false);
    if (e.type === 'pointerup' && g?.kind === 'pan' && !g.moved) {
      const before = lastTap.current;
      const now = e.timeStamp;
      if (
        before &&
        now - before.at < DOUBLE_TAP_MS &&
        Math.hypot(here.x - before.x, here.y - before.y) < DOUBLE_TAP_REACH
      ) {
        lastTap.current = null;
        onView(shown.zoom > 1.01 ? WHOLE : zoomedAt(shown, TAP_ZOOM, here, content, screen, maxZoom));
      } else lastTap.current = { at: now, x: here.x, y: here.y };
    }
    onSettle();
  };

  // The wheel (a trackpad's pinch comes as the wheel with Ctrl held): zoomed about the pointer, settling after.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { shown: v, content: c, screen: s, maxZoom: m, onView: set, onSettle: done } = latest.current;
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY / (e.ctrlKey ? 150 : 400));
      set(zoomedAt(v, factor, { x: e.clientX - r.left, y: e.clientY - r.top }, c, s, m));
      if (settle) clearTimeout(settle);
      settle = setTimeout(done, WHEEL_SETTLES_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (settle) clearTimeout(settle);
    };
  }, [ref]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const middle = { x: screen.width / 2, y: screen.height / 2 };
    const step = 0.1;
    const keys: Record<string, () => View> = {
      '+': () => zoomedAt(shown, 1.25, middle, content, screen, maxZoom),
      '=': () => zoomedAt(shown, 1.25, middle, content, screen, maxZoom),
      '-': () => zoomedAt(shown, 1 / 1.25, middle, content, screen, maxZoom),
      '0': () => WHOLE,
      ArrowLeft: () => nudged(shown, { x: -step, y: 0 }, content, screen, maxZoom),
      ArrowRight: () => nudged(shown, { x: step, y: 0 }, content, screen, maxZoom),
      ArrowUp: () => nudged(shown, { x: 0, y: -step }, content, screen, maxZoom),
      ArrowDown: () => nudged(shown, { x: 0, y: step }, content, screen, maxZoom),
    };
    const act = Object.hasOwn(keys, e.key) ? keys[e.key] : undefined;
    // The arrows are the page's (its previous and next) while it is whole.
    if (!act || (e.key.startsWith('Arrow') && shown.zoom <= 1.001)) return;
    e.preventDefault();
    onView(act());
    onSettle();
  };

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      tabIndex={0}
      data-testid="viewer-surface"
      data-zoom={shown.zoom.toFixed(3)}
      className="relative h-full w-full touch-none overflow-hidden bg-black select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {screen.width > 0 && (
        <div
          data-testid="viewer-content"
          data-a11y-picture
          className={cx(
            'absolute top-0 left-0 origin-top-left',
            // The buttons' and keys' zooms glide (the interface's own short transition); fingers move it at once.
            !moving && 'motion-safe:transition-transform',
          )}
          style={{
            width: content.width,
            height: content.height,
            transform: viewTransform(shown, content, screen),
            willChange: moving ? 'transform' : undefined,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
