import { useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Button } from '../../ui/Button';
import { Pause, Play } from '../../ui/icons';

/*
 * A video's time bar for a video played on a phone or tablet only (Session 54, D1): Play or Pause, the time gone
 * and the time left, and a track to tap or drag (the time under the finger shown while dragging, moved there once,
 * as the finger lifts). It only draws and says what was asked: the video is the caller's. It is drawn as Part B's
 * bar (ui/TimeBar.tsx, 'lg', as a phone shows what plays on the screens) is drawn, built beside it; once both are
 * in, DeviceVideoControls draws B's TimeBar (onMove: the video's own time) with this Play and Pause, and this file
 * goes.
 */

/** "1:05", or "1:02:05" past an hour; whole seconds, never below 0. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

/** Where on the track a point is, as a time. */
const timeAt = (clientX: number, track: DOMRect, durationMs: number): number =>
  Math.min(durationMs, Math.max(0, ((clientX - track.left) / Math.max(1, track.width)) * durationMs));

export function DeviceTimeBar({
  currentMs,
  durationMs,
  playing,
  disabled = false,
  onPlay,
  onPause,
  onSeek,
}: {
  currentMs: number;
  /** 0 until the video says how long it is. */
  durationMs: number;
  playing: boolean;
  disabled?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (ms: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const known = durationMs > 0;
  const at = dragging ?? Math.min(currentMs, durationMs || currentMs);
  const share = known ? Math.min(1, Math.max(0, at / durationMs)) : 0;
  const pointer = (e: PointerEvent<HTMLDivElement>) =>
    timeAt(e.clientX, e.currentTarget.getBoundingClientRect(), durationMs);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowLeft: -5000,
      ArrowRight: 5000,
      PageDown: -30_000,
      PageUp: 30_000,
    };
    let to: number | null = null;
    if (Object.hasOwn(by, e.key)) to = currentMs + (by[e.key] ?? 0);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = durationMs;
    if (to === null || !known) return;
    e.preventDefault();
    onSeek(Math.min(durationMs, Math.max(0, to)));
  };
  return (
    <div
      className="flex items-center gap-3 border-t border-line bg-panel px-3 py-2"
      data-testid="viewer-time-bar"
    >
      <Button
        size="lg"
        className="min-h-12"
        icon={playing ? Pause : Play}
        disabled={disabled}
        data-testid="viewer-play"
        onClick={playing ? onPause : onPlay}
      >
        {playing ? 'Pause' : 'Play'}
      </Button>
      <span className="shrink-0 text-base text-muted tabular-nums" data-testid="viewer-time">
        {clockText(at)}
      </span>
      <div
        role="slider"
        tabIndex={disabled || !known ? -1 : 0}
        aria-label="Where the video is, on this phone"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(at / 1000)}
        aria-valuetext={known ? `${clockText(at)} of ${clockText(durationMs)}` : 'Not loaded yet'}
        aria-disabled={disabled || !known}
        data-testid="viewer-track"
        className="relative h-11 min-w-11 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          if (disabled || !known) return;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Lifted already: the tap alone moves it.
          }
          setDragging(pointer(e));
        }}
        onPointerMove={(e) => {
          if (dragging !== null) setDragging(pointer(e));
        }}
        onPointerUp={(e) => {
          if (dragging === null) return;
          setDragging(null);
          onSeek(pointer(e));
        }}
        onPointerCancel={() => {
          setDragging(null);
        }}
        onKeyDown={onKey}
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-panel-3"
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ width: `${String(share * 100)}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-fg"
          style={{ left: `${String(share * 100)}%` }}
        />
        {dragging !== null && (
          <span
            aria-hidden="true"
            className="absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md border border-line-strong bg-panel-2 px-1.5 py-0.5 whitespace-nowrap text-base text-fg tabular-nums shadow-card"
            style={{ left: `${String(share * 100)}%` }}
          >
            {clockText(dragging)}
          </span>
        )}
      </div>
      <span className="shrink-0 text-base text-muted tabular-nums" data-testid="viewer-left">
        {known ? `−${clockText(durationMs - at)}` : '−:--'}
      </span>
    </div>
  );
}
