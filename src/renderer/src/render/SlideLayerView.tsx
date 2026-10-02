import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SlideLayer } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { Placed } from './Placed';
import { SlideView } from './SlideView';

/*
 * The slide layer on a screen, with its transition (PLAN.md 5.2, Session
 * 7). A cut shows the new slide at once. A dissolve fades the old slide out
 * and the new one in, the new one added light for light over the old
 * (plus-lighter, in a group of their own), so where both are the same the
 * picture never dips, and nothing goes black. The fade is timed from the
 * engine's shownAt, so every screen is at the same point; it starts once
 * the new slide's pictures and videos are ready (until then the old slide
 * stays), and a screen that comes along after it has finished shows the
 * new slide as it is. Clearing is immediate.
 */

const keyOf = (l: SlideLayer) => `${l.slide.id}@${l.shownAt}`;

interface Showing {
  on: SlideLayer | null;
  /** The slide going away while `on` dissolves in. */
  off: SlideLayer | null;
  /** The dissolve's length, and when it started (null: the new slide's media is still loading). */
  fade: { ms: number; start: number | null } | null;
}

/** What to show for a new state of the layer. */
export function nextShowing(prev: Showing, layer: SlideLayer | null, now: number): Showing {
  if (!layer) return { on: null, off: null, fade: null };
  // The same slide with new content (an edit): no new fade.
  if (prev.on && keyOf(prev.on) === keyOf(layer)) return { ...prev, on: layer };
  const t = layer.transition;
  if (t?.kind === 'dissolve' && t.durationMs > 0 && now < layer.shownAt + t.durationMs)
    return { on: layer, off: prev.on, fade: { ms: t.durationMs, start: null } };
  return { on: layer, off: null, fade: null };
}

/** How far a fade is (0 to 1) at `now`. */
export const fadeAt = (fade: { ms: number; start: number }, now: number): number =>
  Math.min(1, Math.max(0, (now - fade.start) / fade.ms));

/** The longest the fade waits for a slide's media before it starts anyway. */
const MEDIA_WAIT_MS = 3000;

/** Whether every picture and video in `root` can be drawn now; else a promise for when it can. */
function mediaReady(root: HTMLElement): true | Promise<void> {
  const waits: Promise<unknown>[] = [];
  for (const img of root.querySelectorAll('img'))
    if (!img.complete) waits.push(img.decode().catch(() => undefined));
  for (const video of root.querySelectorAll('video'))
    if (video.readyState < 2)
      waits.push(
        new Promise<void>((resolve) => {
          video.addEventListener('loadeddata', () => resolve(), { once: true });
          video.addEventListener('error', () => resolve(), { once: true });
        }),
      );
  if (waits.length === 0) return true;
  return Promise.race([
    Promise.all(waits).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, MEDIA_WAIT_MS)),
  ]);
}

export function SlideLayerView({
  layer,
  canvas,
  scaling,
}: {
  layer: SlideLayer | null;
  canvas: Size;
  scaling: ScalingMode;
}) {
  // A screen that comes along later shows the slide as it is (no fade).
  const [showing, setShowing] = useState<Showing>(() => ({ on: layer, off: null, fade: null }));
  const [seen, setSeen] = useState(layer);
  if (seen !== layer) {
    setSeen(layer);
    setShowing((prev) => nextShowing(prev, layer, Date.now()));
  }
  const { on, off, fade } = showing;
  const inRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Start the fade once the new slide's pictures and videos can be drawn: at shownAt if they
  // already could (every screen at the same point), else when they can.
  const waiting = fade !== null && fade.start === null;
  const onKey = on ? keyOf(on) : null;
  useEffect(() => {
    if (!waiting || !on || !inRef.current) return;
    const shownAt = on.shownAt;
    const ready = mediaReady(inRef.current);
    const begin = (start: number) => {
      setShowing((s) => (s.on && keyOf(s.on) === onKey && s.fade ? { ...s, fade: { ...s.fade, start } } : s));
    };
    if (ready === true) {
      begin(shownAt);
      return;
    }
    let live = true;
    void ready.then(() => {
      if (live) begin(Math.max(shownAt, Date.now()));
    });
    return () => {
      live = false;
    };
  }, [waiting, on, onKey]);

  // Run the fade, frame by frame, from the clock every screen shares.
  const start = fade?.start ?? null;
  const ms = fade?.ms ?? 0;
  useEffect(() => {
    if (start === null) return;
    let frame = 0;
    const tick = () => {
      const p = fadeAt({ ms, start }, Date.now());
      if (inRef.current) inRef.current.style.opacity = String(p);
      if (outRef.current) outRef.current.style.opacity = String(1 - p);
      rootRef.current?.setAttribute('data-fade', p.toFixed(3));
      if (p >= 1) {
        setShowing((s) => (s.fade?.start === start ? { on: s.on, off: null, fade: null } : s));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [start, ms]);

  // After every render, before it is painted: where the fade is now (the frames between renders set it too).
  const fading = fade !== null;
  useLayoutEffect(() => {
    const p = start !== null ? fadeAt({ ms, start }, Date.now()) : 0;
    if (inRef.current) inRef.current.style.opacity = fading ? String(p) : '';
    if (outRef.current) outRef.current.style.opacity = fading ? String(1 - p) : '';
  });

  if (!on) return null;
  // One list, keyed by slide and time, so the slide going away keeps its elements (its videos play on).
  const shown = fading && off ? [off, on] : [on];
  return (
    <div
      ref={rootRef}
      data-layer="slide"
      data-fading={fading ? 'true' : undefined}
      data-fade-start={fade?.start ?? undefined}
      // The two slides blend with each other only, then go over the background as one.
      style={{ position: 'absolute', inset: 0, isolation: fading ? 'isolate' : undefined }}
    >
      {shown.map((l) => {
        const incoming = l === on;
        return (
          <div
            key={keyOf(l)}
            ref={incoming ? inRef : outRef}
            data-slide-in={incoming ? '' : undefined}
            data-slide-out={incoming ? undefined : ''}
            style={{
              position: 'absolute',
              inset: 0,
              mixBlendMode: fading && off && incoming ? 'plus-lighter' : undefined,
            }}
          >
            <Placed content={l.slide} box={canvas} mode={scaling}>
              <SlideView slide={l.slide} startedAt={l.shownAt} />
            </Placed>
          </div>
        );
      })}
    </div>
  );
}
