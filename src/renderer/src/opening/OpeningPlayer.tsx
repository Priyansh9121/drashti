import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type OpeningPlan, OPENING_TIMES, OPENING_ZOOM } from '../../../shared/opening';
import { cx } from '../ui/cx';
import { LitLamp } from '../ui/Mark';
import type { OpeningFrame } from './opening-figures';
import { photoWait } from './opening-order';
import { openingSound, type OpeningSoundPlayer } from './opening-sound';

/*
 * The opening as it plays (Session 55; alpha.16, the owner's words of 11 Nov 2026: shared/opening.ts): one photo for
 * two seconds, the mandir's or Drashti's default photo, shown whole: it comes in from the dark while zooming gently,
 * settling on the whole photo, and the whole goes smoothly into the window at the end; no words, no light passing over
 * it, no sparkles. With no photo at all (the default photo's file missing), Drashti's own lamp lights, alone. Still
 * (reduced motion, or Interface motion Off): the photo comes and goes with a plain fade, nothing moving. With the
 * mandir's photo, the pack's sound plays gently beside it (opening-sound.ts), started with it.
 *
 * The photo and sound prepare together after the hall screens' hold. They can prepare while the operator window
 * starts underneath (OpeningAtStart.tsx). Once visible, the compositor runs the opacity and transform tracks on one
 * frame. Changing the motion setting cancels the zoom without moving the end of the fade.
 */

/** The longest an unreadable photo can hold up the opening, once nothing else holds it (opening-order.ts). */
const READY_WAIT = 600;
/** The most frames its figures are read from: ten seconds at 60 a second, far more than its two seconds draw. */
const FIGURE_FRAMES = 600;
/** The zoom is centred on the photo's upper middle, so its subject stays where it is. */
const ORIGIN = '50% 35%';

/** One of the window's motion tokens (app.css), or plain `ease` should the page have none. */
const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease';

/** Every part's Web Animation (the caller gives them all one start time, in the same task); the last ends it. */
function animate(root: HTMLElement, still: boolean) {
  const out: Animation[] = [];
  let zoom: Animation | undefined;
  // Each held at its first frame until it starts and at its last after.
  const run = (el: Element, frames: Keyframe[], delay: number, duration: number, easing = 'linear') => {
    const animation = el.animate(frames, { delay, duration: Math.max(1, duration), easing, fill: 'both' });
    out.push(animation);
    return animation;
  };
  const t = OPENING_TIMES;
  const photo = root.querySelector<HTMLElement>('[data-opening-photo]');
  const lamp = root.querySelector<HTMLElement>('[data-opening-lamp]');
  if (photo) {
    // In from the dark: a plain fade when still.
    run(photo, [{ opacity: 0 }, { opacity: 1 }], 0, t.fadeIn, token('--ease-out'));
    // Zooming gently the whole two seconds, from a little closer to the whole photo (the owner, 5 Nov 2026).
    if (!still) {
      photo.style.transformOrigin = ORIGIN;
      zoom = run(
        photo,
        [{ transform: `scale(${String(OPENING_ZOOM)})` }, { transform: 'scale(1)' }],
        0,
        t.end,
      );
    }
  }
  // The lamp lights (app.css, [data-lighting]) as the opening starts: set on its part just before the animations go.
  if (lamp && !still) lamp.setAttribute('data-lighting', '');
  // The whole goes into the window at its end.
  const fade = run(
    root,
    [{ opacity: 1 }, { opacity: 0 }],
    t.fadeOut.start,
    t.fadeOut.length,
    token('--ease-in-out'),
  );
  return { out, fade, zoom };
}

export function OpeningPlayer({
  plan,
  still,
  held = false,
  prepare = true,
  onDone,
  coverWhilePreparing = false,
  onFrame,
  className,
  testId = 'opening',
}: {
  plan: OpeningPlan;
  /** Reduced motion, or Interface motion Off: still. */
  still: boolean;
  /** Waiting for the hall's screens to draw: black, nothing started. */
  held?: boolean;
  /** Whether the hall screens allow the photo and sound to load. */
  prepare?: boolean;
  /** It played to its end (its fade done). */
  onDone?: () => void;
  /** Black while its photo prepares (at start, over the window starting underneath), else nothing shown till then. */
  coverWhilePreparing?: boolean;
  /** Each frame the window draws while it runs, until its end, for its figures (at start: opening-figures.ts). */
  onFrame?: (frame: OpeningFrame) => void;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  const framed = useRef(onFrame);
  const motion = useRef(still);
  const zoom = useRef<Animation | undefined>(undefined);
  useLayoutEffect(() => {
    done.current = onDone;
    framed.current = onFrame;
    motion.current = still;
    if (still) {
      zoom.current?.cancel();
      ref.current?.querySelector('[data-opening-lamp]')?.removeAttribute('data-lighting');
    }
  });
  const { photo, sound: soundUrl } = plan;
  /** The pack's sound (main sends one with the mandir's photo only, never with Drashti's default photo). */
  const sound = useRef<OpeningSoundPlayer | null>(null);
  const [prepared, setPrepared] = useState<{ photo: string | null; decoded: boolean } | null>(null);
  const selected = prepared?.photo === photo ? prepared : null;
  const ready = prepare && selected !== null;
  const showPhoto = prepare && photo !== null && selected?.decoded !== false;

  // Keep the first result, including a fallback if the photo cannot be decoded in time.
  useLayoutEffect(() => {
    if (!prepare) return;
    const image = ref.current?.querySelector<HTMLImageElement>('[data-opening-photo]');
    const made = soundUrl ? openingSound(soundUrl) : null;
    sound.current = made;
    let cancelled = false;
    const decoding = image
      ? image.decode().then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
    void decoding.then((decoded) => {
      if (!cancelled) setPrepared((was) => (was?.photo === photo ? was : { photo, decoded }));
    });
    return () => {
      cancelled = true;
      made?.stop();
      if (sound.current === made) sound.current = null;
    };
  }, [photo, prepare, soundUrl]);
  // Not ready, it waits READY_WAIT at most, counted once nothing else holds it: then the lamp lights in its place.
  useEffect(() => {
    const wait = photoWait(held, READY_WAIT);
    if (!prepare || ready || wait === null) return;
    const timer = setTimeout(() => {
      setPrepared((was) => (was?.photo === photo ? was : { photo, decoded: false }));
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [held, photo, prepare, ready]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !ready || held) return;
    const playing = animate(root, motion.current);
    zoom.current = playing.zoom;
    let cancelled = false;
    // Its figures: at every frame from here, how far into its two seconds it is, until its end (a few seconds of
    // frames at most: a test that pauses it keeps it from its end).
    let frame = 0;
    if (framed.current) {
      let left = FIGURE_FRAMES;
      const tick = (at: number) => {
        const t = playing.fade.currentTime;
        const progress = typeof t === 'number' ? t : null;
        framed.current?.({ at, progress });
        left -= 1;
        if (left > 0 && (progress === null || progress < OPENING_TIMES.end))
          frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    void playing.fade.ready
      .then(() => {
        if (!cancelled && showPhoto) sound.current?.start();
      })
      .catch(() => undefined);
    void playing.fade.finished
      .then(() => {
        if (cancelled) return;
        // The frame it ended at, for its figures: its end is said before that frame's own callbacks run.
        const at = document.timeline.currentTime;
        if (typeof at === 'number') framed.current?.({ at, progress: OPENING_TIMES.end });
        done.current?.();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      for (const animation of playing.out) animation.cancel();
      zoom.current = undefined;
    };
  }, [held, photo, ready, showPhoto]);
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-opening-motion={still ? 'still' : 'full'}
      data-opening-held={held ? 'true' : 'false'}
      data-photos={showPhoto ? 1 : 0}
      aria-hidden="true"
      className={cx(
        'isolate overflow-hidden bg-black',
        coverWhilePreparing && 'will-change-[opacity]',
        className,
      )}
      style={{ visibility: !held && !ready && !coverWhilePreparing ? 'hidden' : undefined }}
    >
      {prepare &&
        (showPhoto ? (
          <img
            data-opening-photo={0}
            src={photo}
            alt=""
            draggable={false}
            decoding="async"
            // The whole photo, never cut to the window's shape (the black around it).
            className={cx(
              'absolute inset-0 size-full object-contain',
              coverWhilePreparing && 'will-change-[opacity,transform]',
            )}
            style={{ opacity: 0 }}
          />
        ) : (
          <div
            data-opening-lamp=""
            className="absolute inset-0 flex items-center justify-center"
            style={{ visibility: held || !ready ? 'hidden' : undefined }}
          >
            <LitLamp size={110} />
          </div>
        ))}
    </div>
  );
}
