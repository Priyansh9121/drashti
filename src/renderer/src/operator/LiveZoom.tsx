import { useRef } from 'react';
import type { PointerEvent, ReactNode, WheelEvent } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import {
  backgroundShowing,
  framed,
  liveZoomAt,
  PLAIN,
  slideShowing,
  ZOOM,
} from '../../../shared/picture-look';
import { useEngine } from '../engine/engine-store';
import { engineNow } from '../render/clock';
import { Button, IconButton } from '../ui/Button';
import { RotateCcw, ZoomIn, ZoomOut } from '../ui/icons';
import { useNotice } from './actions';
import { useMode } from './mode-store';

/*
 * The live zoom (Session 26e): the picture on the screens zoomed and moved
 * from the LIVE preview, for this showing only (the next slide shows as
 * kept). Scroll or pinch over the preview to zoom, drag to move,
 * or + / − / Reset; the screens glide there in step (the engine's state).
 * Keep this zoom saves it to the picture (Pro Mode's).
 *
 * Session 55 (Part 5): Simple Mode's too, and on a touch screen two fingers
 * pinch and move it; a double click or a double tap puts it back as kept.
 */

/** Two taps this close in time and place are a double tap (a double click is two clicks). */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;

/** Where two fingers are: their distance apart and their middle. */
const spanOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  distance: Math.hypot(a.x - b.x, a.y - b.y),
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** The picture a live zoom would zoom: a slide's own picture, else the background picture (as the engine has it). */
export function zoomTarget(state: EngineState | null): { mediaId: string; showing: string } | null {
  const slide = state?.layers.slide;
  const picture = slide?.slide.elements.find((e) => e.kind === 'image');
  if (slide && picture?.kind === 'image')
    return { mediaId: picture.mediaId, showing: slideShowing(slide.shownAt) };
  const bg = state?.layers.background;
  if (bg?.kind === 'media' && bg.media === 'image')
    return { mediaId: bg.mediaId, showing: backgroundShowing(bg.startedAt) };
  return null;
}

/** Where the picture on the screens is zoomed to now: its live zoom, else its kept look. */
function zoomNow(state: EngineState | null): { zoom: number; x: number; y: number } | null {
  const target = zoomTarget(state);
  if (!state || !target) return null;
  const z = state.liveZoom;
  if (z?.mediaId === target.mediaId && z.showing === target.showing) return { zoom: z.zoom, x: z.x, y: z.y };
  const kept = state.pictures[target.mediaId] ?? PLAIN;
  return { zoom: kept.zoom, x: kept.x, y: kept.y };
}

const send = (to: { zoom: number; x: number; y: number }) => {
  const f = framed({ ...PLAIN, ...to });
  void window.drashti.engine.dispatch({ type: 'zoomLive', zoom: f.zoom, x: f.x, y: f.y }).then((r) => {
    if (!r.ok) useNotice.setState({ text: r.message });
  });
};

/**
 * The LIVE preview with the live zoom's mouse, trackpad and touch (`children`: the preview picture), in Pro Mode
 * and Simple Mode (Session 55, Part 5).
 */
export function ZoomablePreview({ children }: { children: ReactNode }) {
  const state = useEngine((s) => s.state);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: { zoom: number; x: number; y: number } } | null>(null);
  // Touch (Session 55): the fingers down, two of them pinching from where they began, and the last tap.
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    start: { distance: number; x: number; y: number };
    from: { zoom: number; x: number; y: number };
  } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  // At most one zoom a frame: the latest wins.
  const pending = useRef<{ zoom: number; x: number; y: number } | null>(null);
  const queue = (to: { zoom: number; x: number; y: number }) => {
    const first = pending.current === null;
    pending.current = to;
    if (first)
      requestAnimationFrame(() => {
        if (pending.current) send(pending.current);
        pending.current = null;
      });
  };
  const now = zoomNow(state);
  if (!now) return <>{children}</>;
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const at = pending.current ?? now;
    // A wheel's notch (100) zooms a fifth; a pinch on a trackpad comes as a wheel with Ctrl held: finer steps, as many.
    const factor = Math.exp(-e.deltaY / (e.ctrlKey ? 150 : 500));
    queue({ ...at, zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, at.zoom * factor)) });
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const at = pending.current ?? now;
    const [a, b] = [...fingers.current.values()];
    if (a && b) {
      // A second finger: a pinch from here, never a drag.
      drag.current = null;
      pinch.current = { start: spanOf(a, b), from: at };
      moved.current = true;
      return;
    }
    moved.current = false;
    drag.current = { x: e.clientX, y: e.clientY, from: at };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const b = box.current?.getBoundingClientRect();
    if (!b || b.width === 0) return;
    const p = pinch.current;
    const [f1, f2] = [...fingers.current.values()];
    if (p && f1 && f2) {
      // Two fingers: as far apart as they are now, zoomed that much; moved as their middle moved.
      const span = spanOf(f1, f2);
      const zoom = Math.min(
        ZOOM.max,
        Math.max(ZOOM.min, p.from.zoom * (span.distance / Math.max(1, p.start.distance))),
      );
      queue({
        zoom,
        x: p.from.x + (span.x - p.start.x) / b.width,
        y: p.from.y + (span.y - p.start.y) / b.height,
      });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) moved.current = true;
    queue({
      ...d.from,
      x: d.from.x + (e.clientX - d.x) / b.width,
      y: d.from.y + (e.clientY - d.y) / b.height,
    });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    fingers.current.delete(e.pointerId);
    const wasPinch = pinch.current !== null;
    if (fingers.current.size < 2) pinch.current = null;
    drag.current = null;
    if (wasPinch || moved.current || fingers.current.size > 0) {
      lastTap.current = null;
      return;
    }
    // A tap, or a click: two close together put it back as kept.
    const t = lastTap.current;
    const nowMs = performance.now();
    if (t && nowMs - t.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      // Only while it is zoomed live: as kept already, nothing changes.
      const target = zoomTarget(state);
      const z = state?.liveZoom;
      if (target && z?.mediaId === target.mediaId && z.showing === target.showing)
        void window.drashti.engine.dispatch({ type: 'resetLiveZoom' }).then((r) => {
          if (!r.ok) useNotice.setState({ text: r.message });
        });
      return;
    }
    lastTap.current = { at: nowMs, x: e.clientX, y: e.clientY };
  };
  return (
    <div
      ref={box}
      data-testid="live-zoomable"
      title="Pinch or scroll to zoom the picture on the screens, drag to move it, double-click to put it back"
      className="cursor-grab touch-none active:cursor-grabbing"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        fingers.current.delete(e.pointerId);
        pinch.current = null;
        drag.current = null;
      }}
    >
      {children}
    </div>
  );
}

/**
 * Under the LIVE preview, while a picture is up: + / − / Reset, and Keep this zoom once it is zoomed live (Pro Mode's:
 * Simple Mode zooms the screens and never changes the library, Session 55).
 */
export function LiveZoomControls() {
  const state = useEngine((s) => s.state);
  const pro = useMode((s) => s.mode !== 'simple');
  const now = zoomNow(state);
  const target = zoomTarget(state);
  if (!now || !target || !state) return null;
  const z = state.liveZoom;
  const zoomedLive = z?.mediaId === target.mediaId && z.showing === target.showing;
  const shown = zoomedLive ? liveZoomAt(z, engineNow()) : now;
  const by = (factor: number) => {
    send({ ...now, zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, now.zoom * factor)) });
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="live-zoom"
      role="group"
      aria-label="Zoom the picture on the screens"
    >
      <IconButton
        icon={ZoomOut}
        label="Zoom out"
        size="sm"
        data-testid="live-zoom-out"
        disabled={now.zoom <= ZOOM.min}
        onClick={() => by(1 / 1.25)}
      />
      <span className="min-w-12 text-center text-xs text-muted tabular-nums" data-testid="live-zoom-level">
        {Math.round(shown.zoom * 100)}%
      </span>
      <IconButton
        icon={ZoomIn}
        label="Zoom in"
        size="sm"
        data-testid="live-zoom-in"
        disabled={now.zoom >= ZOOM.max}
        onClick={() => by(1.25)}
      />
      <IconButton
        icon={RotateCcw}
        label="Back to the picture as it is kept"
        size="sm"
        data-testid="live-zoom-reset"
        disabled={!zoomedLive}
        onClick={() => {
          void window.drashti.engine.dispatch({ type: 'resetLiveZoom' });
        }}
      />
      {zoomedLive && pro && (
        <Button
          size="sm"
          data-testid="live-zoom-keep"
          title="Keep this zoom with the picture: it shows so wherever it shows"
          onClick={() => {
            void window.drashti.media.keepLiveZoom().then((r) => {
              useNotice.setState({ text: r.ok ? null : r.message });
            });
          }}
        >
          Keep this zoom
        </Button>
      )}
    </div>
  );
}
