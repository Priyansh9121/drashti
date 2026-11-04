import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  cutLine,
  OPENING_FONT,
  OPENING_WEIGHT,
  type OpeningPlan,
  openingSparkles,
  openingTimes,
  wordFrames,
} from '../../../shared/opening';
import { cx } from '../ui/cx';
import { LitLamp } from '../ui/Mark';

/*
 * The opening as it plays (Session 55, shared/opening.ts): the photos, each coming in over the one before and slowly
 * zooming, a soft light sweeping across each once, a few sparkles, and the lines coming in word by word with the Lower
 * Thirds studio's move, in the studio's Noto Serif; with no photo, Drashti's own lamp lighting. Still (reduced motion,
 * or Interface motion Off): the first photo, or the lamp lit, and the lines fading in, nothing moving.
 *
 * Every part moves by opacity and transform alone, each one Web Animation, all started at the same moment once the
 * first photo is decoded and the words' fonts are in (at most READY_WAIT), so the compositor plays them while the
 * window finishes starting underneath. The page's own motion rules (app.css: Off and reduced motion stop every CSS
 * animation) do not stop a Web Animation: the still opening's fades are its own, and nothing in it moves.
 */

/** The longest it waits for its first photo and fonts before it starts anyway (black until then). */
const READY_WAIT = 600;
/** The words' fonts: the studio's Noto Serif (with its Gujarati and Devanagari faces), Drashti's Noto after them. */
const WORDS_FONT = [...OPENING_FONT.families, 'Noto Sans', 'Noto Sans Gujarati', 'Noto Sans Devanagari']
  .map((f) => `"${f}"`)
  .join(', ');
/** Where each photo zooms towards, in turn. */
const ORIGINS = ['30% 40%', '70% 35%', '50% 62%', '35% 65%', '65% 55%', '45% 30%', '60% 45%', '40% 50%'];
const ZOOM = 1.08;

/** Each word's span in a line (the studio's own cutting: a Gujarati or Devanagari conjunct never split). */
function Line({ line, index, still }: { line: string; index: number; still: boolean }) {
  const { pieces } = useMemo(() => cutLine(line), [line]);
  return (
    <p
      data-opening-line={index}
      className="absolute inset-x-[6%] bottom-[10%] text-center leading-tight text-balance text-white"
      style={{
        fontFamily: WORDS_FONT,
        fontWeight: OPENING_WEIGHT,
        fontSize: 'clamp(26px, 5.4vmin, 72px)',
        opacity: 0,
      }}
    >
      {pieces.map((piece, i) =>
        piece.unit === null || still ? (
          piece.text
        ) : (
          <span key={i} data-opening-word={piece.unit} className="inline-block" style={{ opacity: 0 }}>
            {piece.text}
          </span>
        ),
      )}
    </p>
  );
}

/** Its parts, as the page drew them. */
function partsOf(root: HTMLElement) {
  const all = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
  return {
    photos: all('[data-opening-photo]'),
    sweeps: all('[data-opening-sweep]'),
    sparkles: all('[data-opening-sparkle]'),
    lines: all('[data-opening-line]'),
    lamp: root.querySelector<HTMLElement>('[data-opening-lamp]'),
  };
}

/** One of the window's motion tokens (app.css), or plain `ease` should the page have none. */
const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease';

/** Every part's Web Animation, as `times` says (the caller gives them all one start time, in the same task). */
function animate(root: HTMLElement, plan: OpeningPlan, still: boolean): Animation[] {
  const parts = partsOf(root);
  const times = openingTimes(
    plan.photos.length,
    parts.lines.map((l) => l.querySelectorAll('[data-opening-word]').length || 1),
  );
  const out: Animation[] = [];
  // Each held at its first frame until it starts and at its last after; a part's going (`out`) only after, so its
  // coming in governs until then.
  const run = (
    el: Element,
    frames: Keyframe[],
    delay: number,
    duration: number,
    easing = 'linear',
    fill: FillMode = 'both',
  ) => {
    out.push(el.animate(frames, { delay, duration: Math.max(1, duration), easing, fill }));
  };
  // The window's own easings (app.css): settling into place, and the light passing across.
  const easeOut = token('--ease-out');
  const inOut = token('--ease-in-out');
  if (still) {
    // The first photo (or the lamp) simply there; each line fading in, then out before the next.
    for (const [i, el] of parts.lines.entries()) {
      const t = times.lines[i];
      if (!t) continue;
      run(el, [{ opacity: 0 }, { opacity: 1 }], t.start + 100, 600, easeOut);
      if (t.lineOut !== null) run(el, [{ opacity: 1 }, { opacity: 0 }], t.lineOut, 200, 'linear', 'forwards');
    }
  } else {
    for (const [i, el] of parts.photos.entries()) {
      const t = times.photos[i];
      if (!t) continue;
      run(el, [{ opacity: 0 }, { opacity: 1 }], t.start, t.fadeIn, easeOut);
      // Zooming slowly from its coming in until the next has covered it.
      const covered = (times.photos[i + 1]?.start ?? times.end) + (times.photos[i + 1]?.fadeIn ?? 0);
      el.style.transformOrigin = ORIGINS[i % ORIGINS.length] ?? 'center';
      run(
        el,
        [{ transform: 'scale(1)' }, { transform: `scale(${String(ZOOM)})` }],
        t.start,
        covered - t.start,
      );
      const sweep = parts.sweeps[i];
      if (sweep)
        run(
          sweep,
          [
            { transform: 'translateX(-100%) skewX(-16deg)', opacity: 0 },
            { opacity: 1, offset: 0.25 },
            { opacity: 1, offset: 0.75 },
            { transform: 'translateX(220%) skewX(-16deg)', opacity: 0 },
          ],
          t.sweep.start,
          t.sweep.length,
          inOut,
        );
    }
    for (const [i, s] of openingSparkles().entries()) {
      const el = parts.sparkles[i];
      if (el)
        run(
          el,
          [
            { opacity: 0, transform: 'scale(0.4) rotate(0deg)' },
            { opacity: 0.9, transform: 'scale(1) rotate(45deg)', offset: 0.45 },
            { opacity: 0, transform: 'scale(0.6) rotate(90deg) translateY(-8px)' },
          ],
          s.start,
          s.length,
          easeOut,
        );
    }
    for (const [i, el] of parts.lines.entries()) {
      const t = times.lines[i];
      if (!t) continue;
      el.style.opacity = '';
      for (const [j, word] of [...el.querySelectorAll('[data-opening-word]')].entries())
        run(word, wordFrames(j), t.words.start + j * t.words.stagger, t.words.each);
      if (t.lineOut !== null) run(el, [{ opacity: 1 }, { opacity: 0 }], t.lineOut, 200, 'linear', 'forwards');
    }
  }
  // The lamp lights (app.css, [data-lighting]) as the opening starts: set on its part just before the animations go.
  if (parts.lamp && !still) parts.lamp.setAttribute('data-lighting', '');
  // The whole opening fades at its end, back to the window.
  run(root, [{ opacity: 1 }, { opacity: 0 }], times.fadeOut.start, times.fadeOut.length, 'ease-in');
  return out;
}

/** The first photo decoded and the words' fonts loaded, or READY_WAIT, whichever is first. */
function ready(root: HTMLElement, plan: OpeningPlan): Promise<unknown> {
  const first = root.querySelector<HTMLImageElement>('[data-opening-photo]');
  // The others are decoded now too, unwaited for, so none is decoded as it comes in.
  for (const img of root.querySelectorAll<HTMLImageElement>('[data-opening-photo]'))
    if (img !== first) void img.decode().catch(() => undefined);
  const words = plan.lines.join(' ') || 'Drashti';
  const fonts = OPENING_FONT.families.map((family) =>
    document.fonts.load(`${String(OPENING_WEIGHT)} 48px "${family}"`, words).catch(() => []),
  );
  return Promise.race([
    Promise.all([first ? first.decode().catch(() => undefined) : undefined, ...fonts]),
    new Promise((resolve) => setTimeout(resolve, READY_WAIT)),
  ]);
}

export function OpeningPlayer({
  plan,
  still,
  onDone,
  className,
  testId = 'opening',
}: {
  plan: OpeningPlan;
  /** Reduced motion, or Interface motion Off: still. */
  still: boolean;
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
  const photos = useMemo(() => (still ? plan.photos.slice(0, 1) : plan.photos), [plan, still]);
  // With no line and no photo, Drashti's own name comes in under its lamp.
  const lines = useMemo(
    () => (plan.lines.length > 0 ? plan.lines : plan.photos.length === 0 ? ['Drashti'] : []),
    [plan],
  );
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let stopped = false;
    let animations: Animation[] = [];
    void ready(root, { photos, lines }).then(() => {
      if (stopped) return;
      animations = animate(root, { photos, lines }, still);
      // Every part from the same moment.
      const now = document.timeline.currentTime;
      for (const a of animations) a.startTime = now;
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
  }, [photos, lines, still]);
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-opening-motion={still ? 'still' : 'full'}
      data-photos={photos.length}
      data-lines={lines.length}
      aria-hidden="true"
      className={cx('isolate overflow-hidden bg-black', className)}
    >
      {photos.map((url, i) => (
        <img
          key={i}
          data-opening-photo={i}
          src={url}
          alt=""
          draggable={false}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          style={{ opacity: still ? 1 : 0 }}
        />
      ))}
      {photos.length === 0 && (
        <div data-opening-lamp="" className="absolute inset-x-0 top-[18%] flex justify-center">
          <LitLamp size={110} />
        </div>
      )}
      {!still &&
        photos.map((_, i) => (
          <div
            key={i}
            data-opening-sweep={i}
            className="pointer-events-none absolute -inset-y-[20%] left-0 w-[45%]"
            style={{
              opacity: 0,
              background:
                'linear-gradient(90deg, rgba(255,240,205,0) 0%, rgba(255,240,205,0.16) 50%, rgba(255,240,205,0) 100%)',
            }}
          />
        ))}
      {!still &&
        openingSparkles().map((s, i) => (
          <span
            key={i}
            data-opening-sparkle={i}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: `${String(s.x)}%`,
              top: `${String(s.y)}%`,
              width: s.size,
              height: s.size,
              opacity: 0,
              background:
                'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,236,190,0.85) 35%, rgba(255,220,150,0) 70%)',
            }}
          />
        ))}
      {lines.length > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%]"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))' }}
        />
      )}
      {lines.map((line, i) => (
        <Line key={i} line={line} index={i} still={still} />
      ))}
    </div>
  );
}
