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
 * kept), Pro Mode's. Scroll or pinch over the preview to zoom, drag to move,
 * or + / − / Reset; the screens glide there in step (the engine's state).
 * Keep this zoom saves it to the picture.
 */

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

/** The LIVE preview with the live zoom's mouse and trackpad (`children`: the preview picture). */
export function ZoomablePreview({ children }: { children: ReactNode }) {
  const state = useEngine((s) => s.state);
  const pro = useMode((s) => s.mode !== 'simple');
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: { zoom: number; x: number; y: number } } | null>(null);
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
  const now = pro ? zoomNow(state) : null;
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
    drag.current = { x: e.clientX, y: e.clientY, from: now };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = box.current?.getBoundingClientRect();
    if (!d || !b || b.width === 0) return;
    queue({
      ...d.from,
      x: d.from.x + (e.clientX - d.x) / b.width,
      y: d.from.y + (e.clientY - d.y) / b.height,
    });
  };
  return (
    <div
      ref={box}
      data-testid="live-zoomable"
      className="cursor-grab touch-none active:cursor-grabbing"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      {children}
    </div>
  );
}

/** Under the LIVE preview, while a picture is up: + / − / Reset, and Keep this zoom once it is zoomed live. */
export function LiveZoomControls() {
  const state = useEngine((s) => s.state);
  const pro = useMode((s) => s.mode !== 'simple');
  const now = pro ? zoomNow(state) : null;
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
      {zoomedLive && (
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
