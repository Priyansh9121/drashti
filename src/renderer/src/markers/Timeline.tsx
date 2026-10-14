import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { markerTime } from '../../../shared/markers';
import { cx } from '../ui/cx';

/*
 * A video's start and end on a timeline (Session 26e): a strip of stills
 * along it, the part chosen bright and the rest dimmed, a handle at its
 * start and its end to drag (or move with the arrow keys), the play head,
 * and the clean frame a saved MP4 begins at. A click on the strip moves the
 * preview there.
 */

/** How many stills the strip has. */
const STILLS = 10;

/**
 * Stills along a video, drawn from a hidden copy of it (seeking it from one to the next), as small
 * pictures: filled in one by one, as they come.
 */
export function useStills(src: string, durationMs: number | null): (string | null)[] {
  const [stills, setStills] = useState<(string | null)[]>(() => Array<string | null>(STILLS).fill(null));
  useEffect(() => {
    if (durationMs === null || durationMs <= 0) return;
    // Its stills stop coming once it is gone (a box, as the loop reads it after each await).
    const still = { wanted: true };
    const gone = () => !still.wanted;
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = src;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    const seek = (s: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener('seeked', done);
          video.removeEventListener('error', done);
          resolve();
        };
        video.addEventListener('seeked', done);
        video.addEventListener('error', done);
        video.currentTime = s;
      });
    void (async () => {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error', () => resolve(), { once: true });
      });
      for (let i = 0; i < STILLS && !gone(); i++) {
        await seek(((i + 0.5) * durationMs) / STILLS / 1000);
        if (gone() || !ctx || video.videoWidth === 0) continue;
        // Fitted in the still's box, black about it.
        const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const w = video.videoWidth * scale;
        const h = video.videoHeight * scale;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        const url = canvas.toDataURL('image/jpeg', 0.7);
        setStills((was) => was.map((s, j) => (j === i ? url : s)));
      }
    })();
    return () => {
      still.wanted = false;
      video.removeAttribute('src');
      video.load();
    };
  }, [src, durationMs]);
  return stills;
}

/** Where a time is along the strip, 0 to 100 (%). */
const at = (ms: number, durationMs: number) => Math.min(100, Math.max(0, (ms / durationMs) * 100));

function Handle({
  label,
  valueMs,
  durationMs,
  min,
  max,
  onChange,
  side,
  testId,
}: {
  label: string;
  valueMs: number;
  durationMs: number;
  min: number;
  max: number;
  onChange: (ms: number) => void;
  side: 'start' | 'end';
  testId: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const clamp = (ms: number) => Math.round(Math.min(max, Math.max(min, ms)));
  const fromPointer = (e: PointerEvent<HTMLButtonElement>) => {
    const strip = ref.current?.parentElement?.getBoundingClientRect();
    if (!strip || strip.width === 0) return;
    onChange(clamp(((e.clientX - strip.left) / strip.width) * durationMs));
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 1000 : 100;
    const moves: Record<string, number> = {
      ArrowLeft: -step,
      ArrowDown: -step,
      ArrowRight: step,
      ArrowUp: step,
    };
    const by = moves[e.key];
    if (by !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      onChange(clamp(valueMs + by));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    }
  };
  return (
    <button
      ref={ref}
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={Math.round(min / 100) / 10}
      aria-valuemax={Math.round(max / 100) / 10}
      aria-valuenow={Math.round(valueMs / 100) / 10}
      aria-valuetext={markerTime(valueMs)}
      data-testid={testId}
      className={cx(
        'absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent-strong outline-offset-2',
        side === 'start' ? 'rounded-r-none' : 'rounded-l-none',
      )}
      style={{ left: `${at(valueMs, durationMs)}%` }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
      }}
      onKeyDown={onKey}
    >
      <span aria-hidden="true" className="mx-auto block h-4 w-0.5 rounded bg-white/80" />
    </button>
  );
}

export function Timeline({
  src,
  durationMs,
  startMs,
  endMs,
  playheadMs,
  keyframeMs,
  onStart,
  onEnd,
  onSeek,
}: {
  src: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  playheadMs: number;
  /** Where a saved MP4 begins (the clean frame at or before the start), when known. */
  keyframeMs: number | null;
  onStart: (ms: number) => void;
  onEnd: (ms: number) => void;
  onSeek: (ms: number) => void;
}) {
  const stills = useStills(src, durationMs);
  const strip = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-1" data-testid="timeline">
      <div
        ref={strip}
        className="relative h-14 overflow-hidden rounded-md border border-line bg-black"
        onPointerDown={(e) => {
          // A click on the strip (not a handle) moves the preview there.
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset['still']) return;
          const box = strip.current?.getBoundingClientRect();
          if (box && box.width > 0) onSeek(Math.round(((e.clientX - box.left) / box.width) * durationMs));
        }}
      >
        <div aria-hidden="true" className="absolute inset-0 flex">
          {stills.map((s, i) =>
            s ? (
              <img
                key={i}
                src={s}
                alt=""
                data-still=""
                draggable={false}
                className="h-full min-w-0 flex-1 object-cover"
              />
            ) : (
              <span key={i} data-still="" className="h-full flex-1 bg-panel-3" />
            ),
          )}
        </div>
        {/* What is left out, dimmed. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/65"
          style={{ width: `${at(startMs, durationMs)}%` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/65"
          style={{ width: `${100 - at(endMs, durationMs)}%` }}
        />
        {/* The clean frame a saved MP4 begins at. */}
        {keyframeMs !== null && keyframeMs < startMs && (
          <div
            aria-hidden="true"
            data-testid="timeline-keyframe"
            className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-warning"
            style={{ left: `${at(keyframeMs, durationMs)}%` }}
          />
        )}
        <div
          aria-hidden="true"
          data-testid="timeline-playhead"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
          style={{ left: `${at(playheadMs, durationMs)}%` }}
        />
        <Handle
          label="Start"
          side="start"
          testId="timeline-start"
          valueMs={startMs}
          durationMs={durationMs}
          min={0}
          max={Math.max(0, endMs - 100)}
          onChange={onStart}
        />
        <Handle
          label="End"
          side="end"
          testId="timeline-end"
          valueMs={endMs}
          durationMs={durationMs}
          min={Math.min(durationMs, startMs + 100)}
          max={durationMs}
          onChange={onEnd}
        />
      </div>
      <div className="flex justify-between text-2xs text-muted tabular-nums" aria-hidden="true">
        <span>0:00</span>
        <span>{markerTime(durationMs)}</span>
      </div>
    </div>
  );
}
