import type { KeyboardEvent, PointerEvent } from 'react';
import { useRef, useState } from 'react';
import { formatDuration } from '../../../shared/format';
import { cx } from './cx';
import { barFraction, barSpan, keyTarget, leftText, timeAt, timeWords } from './time-bar';

/*
 * The time bar (Session 54): a file's time, as LIVE, Music and a phone show what plays, and as a phone shows a video
 * played on the phone alone. The bar is the whole file: the part outside its start and end points dimmed, a short
 * upright line at each point it has, a tick at each marker, what has played from the start point filled, and the play
 * head; the elapsed time (into the file) before it and the time left (to the end point) after it. Given `onMove`, a
 * click or a drag moves it, once, on release: while dragging, the time under the finger shows above it and nothing
 * moves (Esc, or the pointer taken away, moves nothing); and it is a slider for the keyboard (the arrows 5 s, Page Up
 * and Page Down 30 s, Home and End its points), each key a move. Without it, the bar only shows (Simple Mode). Purely
 * what it is given: where it is now comes from its parent, each drawing.
 */

/** A marker of the file, a tick on the bar. */
export interface TimeBarMarker {
  id: string;
  name: string;
  atMs: number;
}

export interface TimeBarProps {
  /** What it is, for screen readers ("The background video"). */
  label: string;
  /** Where it is now (ms into its file). */
  atMs: number;
  /** Its file's length (ms); null while not known: the bar waits, dimmed, and nothing moves it. */
  durationMs: number | null;
  /** Its start point (ms into the file); left out, the file's start. */
  startMs?: number;
  /** Its end point (ms into the file); left out or null, the file's end. */
  endMs?: number | null;
  /** The file's markers: ticks along the bar. */
  markers?: readonly TimeBarMarker[];
  /** Move it there (ms into the file, between its points), once, on release; left out, the bar only shows. */
  onMove?: (ms: number) => void;
  /** 'lg' for a finger (a phone's: 44 px tall, larger words); 'sm' beside LIVE's small buttons. */
  size?: 'sm' | 'lg';
  /** The elapsed time before the bar (Simple Mode shows the time left alone). */
  elapsed?: boolean;
  className?: string;
  /** Tests find the bar itself (the slider) by this; its parts are named after it. */
  testId?: string;
}

const SIZES = {
  sm: { box: 'gap-1.5 text-xs', track: 'h-7', line: 'h-1', head: 'size-3', point: 'h-3', tick: 'h-2' },
  lg: { box: 'gap-2 text-base', track: 'h-11', line: 'h-1.5', head: 'size-5', point: 'h-5', tick: 'h-3' },
} as const;

/** A time along the bar, as a CSS left. */
const left = (ms: number, durationMs: number) => `${String(barFraction(ms, durationMs) * 100)}%`;

export function TimeBar({
  label,
  atMs,
  durationMs,
  startMs = 0,
  endMs = null,
  markers = [],
  onMove,
  size = 'sm',
  elapsed = true,
  className,
  testId = 'time-bar',
}: TimeBarProps) {
  const track = useRef<HTMLDivElement>(null);
  // The time under the finger while a drag (or a press) is held, and which pointer holds it.
  const [held, setHeld] = useState<number | null>(null);
  const pointer = useRef<number | null>(null);
  const known = durationMs !== null && durationMs > 0;
  const span = barSpan(known ? durationMs : 0, startMs, endMs);
  const at = Math.min(span.endMs, Math.max(0, atMs));
  const movable = onMove !== undefined && known;
  const s = SIZES[size];

  /** The time under a point on the screen, kept between the points. */
  const timeUnder = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return at;
    return timeAt((clientX - box.left) / box.width, span);
  };
  const letGo = (moveTo: number | null) => {
    const el = track.current;
    const id = pointer.current;
    pointer.current = null;
    setHeld(null);
    if (el && id !== null && el.hasPointerCapture(id)) el.releasePointerCapture(id);
    if (moveTo !== null && movable) onMove(moveTo);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!movable || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = e.pointerId;
    setHeld(timeUnder(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pointer.current === e.pointerId) setHeld(timeUnder(e.clientX));
  };
  // Let go: it moves there, once. Taken away (the system's own gesture, a phone's scroll): nothing moves.
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (pointer.current === e.pointerId) letGo(timeUnder(e.clientX));
  };
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (pointer.current === e.pointerId) letGo(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A drag under way: Esc lets go of it, moving nothing.
    if (held !== null && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      letGo(null);
      return;
    }
    if (!movable || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = keyTarget(e.key, at, span);
    if (to === null) return;
    // The bar's keys are its own: the show's keys (the arrows are Next and Back) never hear them.
    e.preventDefault();
    e.stopPropagation();
    if (to !== at) onMove(to);
  };

  const head = held ?? at;
  const words = known ? timeWords(at, span) : 'Its length is not known yet';
  // A slider while it can move; a bar that only shows otherwise (Simple Mode, or its length not known yet).
  const role = movable
    ? {
        role: 'slider',
        tabIndex: 0,
        'aria-valuemin': Math.floor(span.startMs / 1000),
        'aria-valuemax': Math.floor(span.endMs / 1000),
        'aria-valuenow': Math.floor(at / 1000),
        'aria-valuetext': words,
        'aria-orientation': 'horizontal' as const,
      }
    : {
        role: 'progressbar',
        'aria-valuemin': Math.floor(span.startMs / 1000),
        'aria-valuemax': Math.max(Math.floor(span.startMs / 1000), Math.floor(span.endMs / 1000)),
        'aria-valuenow': Math.floor(at / 1000),
        'aria-valuetext': words,
      };
  return (
    <div className={cx('flex min-w-0 items-center tabular-nums', s.box, className)}>
      {elapsed && (
        <span className="shrink-0 text-muted" aria-hidden="true" data-testid={`${testId}-elapsed`}>
          {known ? formatDuration(at) : '–:––'}
        </span>
      )}
      <div
        ref={track}
        aria-label={label}
        {...role}
        data-testid={testId}
        data-at={Math.round(at)}
        data-held={held === null ? undefined : String(held)}
        className={cx(
          'relative min-w-0 flex-1 rounded-sm',
          s.track,
          movable ? 'cursor-pointer touch-pan-y' : 'cursor-default',
          !known && 'opacity-40',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={(e) => {
          if (pointer.current === e.pointerId) letGo(null);
        }}
        onKeyDown={onKeyDown}
      >
        {/* The whole file; outside its points dimmed; from its start point to where it is, filled. */}
        <div
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-panel-3',
            s.line,
          )}
        >
          {known && (
            <>
              <div
                className="absolute inset-y-0 left-0 bg-ink/60"
                style={{ width: left(span.startMs, span.durationMs) }}
              />
              <div
                className="absolute inset-y-0 right-0 bg-ink/60"
                style={{ left: left(span.endMs, span.durationMs) }}
              />
              <div
                className="absolute inset-y-0 bg-accent"
                style={{
                  left: left(span.startMs, span.durationMs),
                  width: `${String(Math.max(0, barFraction(at, span.durationMs) - barFraction(span.startMs, span.durationMs)) * 100)}%`,
                }}
              />
            </>
          )}
        </div>
        {known &&
          [
            span.startMs > 0 ? { which: 'start', ms: span.startMs } : null,
            span.endMs < span.durationMs ? { which: 'end', ms: span.endMs } : null,
          ].map(
            (point) =>
              point && (
                <span
                  key={point.which}
                  aria-hidden="true"
                  data-point={point.which}
                  className={cx(
                    'pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg',
                    s.point,
                  )}
                  style={{ left: left(point.ms, span.durationMs) }}
                />
              ),
          )}
        {known &&
          markers.map((m) => (
            <span
              key={m.id}
              aria-hidden="true"
              data-marker={m.id}
              className={cx(
                'pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted',
                s.tick,
              )}
              style={{ left: left(m.atMs, span.durationMs) }}
            />
          ))}
        {known && (
          <span
            aria-hidden="true"
            data-testid={`${testId}-head`}
            className={cx(
              'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-fg',
              s.head,
            )}
            style={{ left: left(head, span.durationMs) }}
          />
        )}
        {/* The time under the finger while dragging: above the bar, never past its ends. */}
        {held !== null && (
          <span
            aria-hidden="true"
            data-testid={`${testId}-under`}
            className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md border border-line-strong bg-panel-2 px-1.5 py-0.5 whitespace-nowrap text-fg shadow-card"
            style={{
              left: left(held, span.durationMs),
              transform: `translateX(-${String(barFraction(held, span.durationMs) * 100)}%)`,
            }}
          >
            {formatDuration(held)}
          </span>
        )}
      </div>
      <span className="shrink-0 text-muted" aria-hidden="true" data-testid={`${testId}-left`}>
        {known ? leftText(at, span) : '–:––'}
      </span>
    </div>
  );
}
