import type { CSSProperties, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PlaybackClip, PlaybackClock, PlaybackSeek } from '../../../shared/media';
import { engineNow, onClockJump } from './clock';
import { fontFamilyFor } from './fonts';
import { playBarAt } from './play-bar';

/*
 * A video's play bar on the screens (Session 54: "Show the play bar on the screens", the video's own setting in the
 * slide editor, off unless ticked, a deck's video too): a thin bar along the bottom of the video, its time since its
 * start point and a play or pause mark, as a deck's video shows in a slideshow. Every frame is the engine's state and
 * time (§40, render/play-bar.ts): where the video is comes from its timing, when it went up, its start and end points
 * and the time bar's moves and pauses, never from the element; only the file's length is read from it, the same on
 * every screen. Drawn frame by frame while it plays, once while it waits; at once when the clock jumps.
 */

/** Its height for a video `height` design pixels tall: 6% of it, between 20 and 56. */
export const playBarHeight = (height: number): number => Math.max(20, Math.min(56, height * 0.06));

export function PlayBar({
  frame,
  height,
  opacity,
  video,
  startedAt,
  loop,
  clip,
  seek,
}: {
  /** The video's own frame: its place, size and turn on the slide. */
  frame: CSSProperties;
  /** The video's height in design pixels. */
  height: number;
  opacity: number;
  /** The video it is the bar of: only its file's length is read from it. */
  video: RefObject<HTMLVideoElement | null>;
  /** How the video plays, as its layer has it: from when, looping or not, its points and the time bar's last move. */
  startedAt: number;
  loop: boolean;
  clip: PlaybackClip | undefined;
  seek: PlaybackSeek | undefined;
}) {
  const [duration, setDuration] = useState<number | null>(null);
  // Drawn again when the time changes what it is: played to its end (the mark), or the clock jumped.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const fill = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useMemo<PlaybackClock>(
    () => ({ startedAt, loop, ...(clip ? { clip } : {}), ...(seek ? { seek } : {}) }),
    [startedAt, loop, clip, seek],
  );
  // The file's length, once this screen's copy has it (every screen loads the same file); asked a frame on too, for
  // a bar ticked while its video already plays (no new loadedmetadata then).
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const learn = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    };
    const first = requestAnimationFrame(learn);
    v.addEventListener('loadedmetadata', learn);
    v.addEventListener('durationchange', learn);
    return () => {
      cancelAnimationFrame(first);
      v.removeEventListener('loadedmetadata', learn);
      v.removeEventListener('durationchange', learn);
    };
  }, [video]);
  /** Its fill and time at `now`, written straight to the page: what is drawn there, or null with no length yet. */
  const paint = useCallback(
    (now: number) => {
      const drawn = duration === null ? null : playBarAt(clock, duration, now);
      if (!drawn) return null;
      if (fill.current) fill.current.style.transform = `scaleX(${String(drawn.fraction)})`;
      if (words.current && words.current.textContent !== drawn.text) words.current.textContent = drawn.text;
      // For tests: how far along it was drawn, as two screens compare it.
      if (bar.current) bar.current.dataset['fraction'] = drawn.fraction.toFixed(4);
      return drawn;
    },
    [duration, clock],
  );
  // Its mark, from the engine's state and time as this drawing is made.
  const playing = (duration === null ? null : playBarAt(clock, duration, engineNow()))?.playing ?? false;
  // After every drawing (a move, a pause, its length learned), as at the moment it is shown.
  useLayoutEffect(() => {
    paint(engineNow());
  });
  // Frame by frame while it plays, from the engine's time; at its end, drawn again with its play mark.
  useLayoutEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (paint(engineNow())?.playing === false) {
        redraw();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, paint]);
  // The clock held or set (a test, a node's offset): drawn again at once where the time puts it.
  useEffect(() => onClockJump(redraw), []);
  const h = playBarHeight(height);
  const mark = h * 0.42;
  return (
    <div
      aria-hidden="true"
      data-play-bar=""
      data-state={duration === null ? 'waiting' : playing ? 'playing' : 'paused'}
      style={{
        ...frame,
        pointerEvents: 'none',
        opacity,
        visibility: duration === null ? 'hidden' : 'visible',
      }}
    >
      <div
        ref={bar}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: h,
          display: 'flex',
          alignItems: 'center',
          gap: h * 0.3,
          padding: `0 ${String(h * 0.35)}px`,
          background: 'rgba(0, 0, 0, 0.6)',
          color: '#ffffff',
          fontFamily: fontFamilyFor(null, null),
          fontSize: h * 0.42,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {/* As a deck's video shows it: a pause mark while it plays, a play mark while it waits or has ended. */}
        <svg
          width={mark}
          height={mark}
          viewBox="0 0 10 10"
          style={{ flexShrink: 0 }}
          data-mark={playing ? 'pause' : 'play'}
        >
          {playing ? (
            <>
              <rect x={1.5} y={1} width={2.5} height={8} fill="#ffffff" />
              <rect x={6} y={1} width={2.5} height={8} fill="#ffffff" />
            </>
          ) : (
            <path d="M2 1 L9 5 L2 9 Z" fill="#ffffff" />
          )}
        </svg>
        <div
          style={{
            position: 'relative',
            flex: 1,
            height: Math.max(2, h * 0.1),
            borderRadius: 999,
            overflow: 'hidden',
            background: 'rgba(255, 255, 255, 0.35)',
          }}
        >
          <div
            ref={fill}
            data-play-bar-fill=""
            style={{ position: 'absolute', inset: 0, background: '#ffffff', transformOrigin: 'left center' }}
          />
        </div>
        <span ref={words} data-play-bar-time="" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} />
      </div>
    </div>
  );
}
