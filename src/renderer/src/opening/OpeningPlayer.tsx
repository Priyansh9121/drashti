import { useLayoutEffect, useRef } from 'react';
import { type OpeningPlan, OPENING_TIMES, OPENING_ZOOM } from '../../../shared/opening';
import { cx } from '../ui/cx';
import { LitLamp } from '../ui/Mark';
import { openingSound, type OpeningSoundPlayer } from './opening-sound';

/*
 * The opening as it plays (Session 55; alpha.16, the owner's words of 11 Nov 2026: shared/opening.ts): one photo for
 * two seconds, the mandir's or Drashti's default photo, shown whole: it comes in from the dark while zooming gently,
 * settling on the whole photo, and the whole goes smoothly into the window at the end; no words, no light passing over
 * it, no sparkles. With no photo at all (the default photo's file missing), Drashti's own lamp lights, alone. Still
 * (reduced motion, or Interface motion Off): the photo comes and goes with a plain fade, nothing moving. With the
 * mandir's photo, the pack's sound plays gently beside it (opening-sound.ts), started with it.
 *
 * Every part moves by opacity and transform alone, each one Web Animation, all started at the same moment once the
 * photo is decoded and the sound can play (at most READY_WAIT), so the compositor plays them while the window
 * finishes starting underneath. The page's own motion rules (app.css: Off and reduced motion stop every CSS animation)
 * do not stop a Web Animation: the still opening's fades are its own, and nothing in it moves.
 */

/** The longest it waits for its photo and sound before it starts anyway (black until then). */
const READY_WAIT = 600;
/** The zoom is centred on the photo's upper middle, so its subject stays where it is. */
const ORIGIN = '50% 35%';

/** One of the window's motion tokens (app.css), or plain `ease` should the page have none. */
const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease';

/** Every part's Web Animation (the caller gives them all one start time, in the same task); the last ends it. */
function animate(root: HTMLElement, still: boolean): Animation[] {
  const out: Animation[] = [];
  // Each held at its first frame until it starts and at its last after.
  const run = (el: Element, frames: Keyframe[], delay: number, duration: number, easing = 'linear') => {
    out.push(el.animate(frames, { delay, duration: Math.max(1, duration), easing, fill: 'both' }));
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
      run(photo, [{ transform: `scale(${String(OPENING_ZOOM)})` }, { transform: 'scale(1)' }], 0, t.end);
    }
  }
  // The lamp lights (app.css, [data-lighting]) as the opening starts: set on its part just before the animations go.
  if (lamp && !still) lamp.setAttribute('data-lighting', '');
  // The whole goes into the window at its end.
  run(root, [{ opacity: 1 }, { opacity: 0 }], t.fadeOut.start, t.fadeOut.length, token('--ease-in-out'));
  return out;
}

/** The photo decoded and the sound ready to play, or READY_WAIT, whichever is first. */
function ready(root: HTMLElement, sound: OpeningSoundPlayer | null): Promise<unknown> {
  const photo = root.querySelector<HTMLImageElement>('[data-opening-photo]');
  return Promise.race([
    Promise.all([photo ? photo.decode().catch(() => undefined) : undefined, sound?.ready]),
    new Promise((resolve) => setTimeout(resolve, READY_WAIT)),
  ]);
}

export function OpeningPlayer({
  plan,
  still,
  held = false,
  onDone,
  className,
  testId = 'opening',
}: {
  plan: OpeningPlan;
  /** Reduced motion, or Interface motion Off: still. */
  still: boolean;
  /** Waiting for the hall's screens to draw: black, nothing started. */
  held?: boolean;
  /** It played to its end (its fade done). */
  onDone?: () => void;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  const { photo, sound: soundUrl } = plan;
  /** The pack's sound (main sends one with the mandir's photo only, never with Drashti's default photo). */
  const sound = useRef<OpeningSoundPlayer | null>(null);
  // Its sound, made once it may start (never while held), so it loads while the photo decodes; let go when it ends.
  // Before the pictures' effect, so they wait for it, and kept when only the motion changes (it never starts again).
  useLayoutEffect(() => {
    if (!soundUrl || held) return;
    const made = openingSound(soundUrl);
    sound.current = made;
    return () => {
      made?.stop();
      if (sound.current === made) sound.current = null;
    };
  }, [soundUrl, held]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || held) return;
    let stopped = false;
    let animations: Animation[] = [];
    void ready(root, sound.current).then(() => {
      if (stopped) return;
      animations = animate(root, still);
      // Every part from the same moment, and the sound with them.
      const now = document.timeline.currentTime;
      for (const a of animations) a.startTime = now;
      sound.current?.start();
      void animations
        .at(-1)
        ?.finished.then(() => {
          if (!stopped) done.current?.();
        })
        .catch(() => undefined);
    });
    return () => {
      stopped = true;
      for (const a of animations) a.cancel();
    };
  }, [photo, still, held]);
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-opening-motion={still ? 'still' : 'full'}
      data-opening-held={held ? 'true' : 'false'}
      data-photos={photo === null ? 0 : 1}
      aria-hidden="true"
      className={cx('isolate overflow-hidden bg-black', className)}
    >
      {photo !== null ? (
        <img
          data-opening-photo={0}
          src={photo}
          alt=""
          draggable={false}
          decoding="async"
          // The whole photo, never cut to the window's shape (the black around it).
          className="absolute inset-0 size-full object-contain"
          style={{ opacity: 0 }}
        />
      ) : (
        <div
          data-opening-lamp=""
          className="absolute inset-0 flex items-center justify-center"
          style={{ visibility: held ? 'hidden' : undefined }}
        >
          <LitLamp size={110} />
        </div>
      )}
    </div>
  );
}
