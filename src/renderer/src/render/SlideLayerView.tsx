import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EngineState, SlideLayer } from '../../../shared/engine/state';
import { languageView } from '../../../shared/language-view';
import type { Movement, SlideStyle } from '../../../shared/looks';
import type { Lang, TransitionKind } from '../../../shared/model';
import { SLOW_ZOOM_SCALE } from '../../../shared/model';
import { hasPicture, lowerThird } from '../../../shared/program';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { Placed } from './Placed';
import { type Reveal, type SlideText, SlideView } from './SlideView';
import type { TimerState } from '../../../shared/timers';
import { clockHeld, engineNow, onClockJump } from './clock';
import { SlideMovementContext, SlideTimersContext } from './slide-timers';
import { linesReveal, type UnitFrame, wordsReveal } from './reveal';
import { stepTiming } from '../../../shared/deck-show';
import {
  takesTime,
  transitionFrame,
  wordsFrame,
  wordsMove,
  type WordsMove,
  zoomSpan,
} from './transition-frame';

/*
 * The slide layer on a screen, with its transition (PLAN.md 5.2, Session
 * 7). A cut shows the new slide at once. A dissolve (a fade) fades the old
 * slide out and the new one in, the new one added light for light over the
 * old (plus-lighter, in a group of their own), so where both are the same
 * the picture never dips, and nothing goes black. Session 26d added a fade
 * through black, a slide in from the right and a slow zoom
 * (transition-frame.ts draws each). Every transition is timed from the
 * engine's shownAt, so every screen is at the same point; it starts once
 * the new slide's pictures and videos are ready (until then the old slide
 * stays), and a screen that comes along after it has finished shows the
 * new slide as it is. Clearing is immediate, but for a timer shown alone (Session 50), which fades out over
 * its transition's length from when it was taken off.
 */

const keyOf = (l: SlideLayer) => `${l.slide.id}@${l.shownAt}`;

interface Showing {
  on: SlideLayer | null;
  /** The slide going away while `on` comes in. */
  off: SlideLayer | null;
  /** The transition's kind and length, and when it started (null: the new slide's media is still loading). */
  fade: { kind: TransitionKind; ms: number; start: number | null } | null;
}

/** The slide just taken off on its own, and when (the engine's slideOff). */
type Leaving = EngineState['slideOff'];

/** What to show for a new state of the layer (`leaving`: the slide just taken off on its own, if any). */
export function nextShowing(
  prev: Showing,
  layer: SlideLayer | null,
  now: number,
  leaving: Leaving = null,
): Showing {
  if (!layer) {
    // A timer shown alone goes off as it came on, fading over its transition's length from when it was taken
    // off (Session 50), on the screen that was showing it; anything else goes at once.
    const t = leaving?.layer.transition;
    if (
      leaving?.layer.timer &&
      prev.on &&
      keyOf(prev.on) === keyOf(leaving.layer) &&
      takesTime(t) &&
      now < leaving.at + t.durationMs
    )
      return { on: null, off: prev.on, fade: { kind: 'dissolve', ms: t.durationMs, start: leaving.at } };
    return { on: null, off: null, fade: null };
  }
  // The same slide with new content (an edit): no new transition.
  if (prev.on && keyOf(prev.on) === keyOf(layer)) return { ...prev, on: layer };
  const t = layer.transition;
  if (takesTime(t) && now < layer.shownAt + t.durationMs)
    return {
      on: layer,
      // What goes away is what is on screen: a slide still waiting for its pictures had not begun to
      // show, and the one before it was still up, whole (Session 23).
      off: prev.fade?.start === null ? prev.off : prev.on,
      fade: { kind: t.kind, ms: t.durationMs, start: null },
    };
  // A deck's slide coming in by a cut (Session 54, C2: in order, its deck's own transition in its clip, which begins
  // on the slide before's last frame) keeps the slide before up until its clip can be drawn, as a transition waits for
  // a slide's pictures, then cuts: never a moment of nothing between them.
  if (layer.slide.deck && prev.on && now < layer.shownAt + MEDIA_WAIT_MS)
    return {
      on: layer,
      off: prev.fade?.start === null ? prev.off : prev.on,
      fade: { kind: 'cut', ms: 1, start: null },
    };
  return { on: layer, off: null, fade: null };
}

/** The longest the fade waits for a slide's media before it starts anyway. */
const MEDIA_WAIT_MS = 3000;

/** How far a fade is (0 to 1) at `now`. */
export const fadeAt = (fade: { ms: number; start: number }, now: number): number =>
  Math.min(1, Math.max(0, (now - fade.start) / fade.ms));

/** The layers a transition draws: the two slides, the black, and the two slides' words while drawn apart. */
interface Layers {
  in: HTMLDivElement | null;
  out: HTMLDivElement | null;
  black: HTMLDivElement | null;
  wordsIn: HTMLDivElement | null;
  wordsOut: HTMLDivElement | null;
}

/**
 * How a transition paints: its kind (null when not in one), the group's Movement, how its words move (null:
 * whole slides), the canvas, and each slide's height against 1080 (a line's rise is the lab's, at 1080).
 */
interface Paint {
  kind: TransitionKind | null;
  movement: Movement;
  move: WordsMove | null;
  width: number;
  height: number;
  scaleIn: number;
  scaleOut: number;
}

/** Each line, or word, of the two slides' words as a reveal has it at `p` (Session 27, render/reveal.ts). */
function paintUnits(els: Layers, how: Paint, p: number): void {
  const lines = (root: HTMLElement | null) =>
    root
      ? [...root.querySelectorAll<HTMLElement>('[data-reveal-line]')].filter(
          (line) => line.dataset['revealEmpty'] === undefined,
        )
      : [];
  const place = (el: HTMLElement, f: UnitFrame, scale: number) => {
    el.style.opacity = String(f.opacity);
    el.style.top = f.rise === 0 ? '' : `${String(f.rise * scale)}px`;
  };
  const fresh = lines(els.wordsIn);
  if (how.move === 'lines') {
    const old = lines(els.wordsOut);
    const r = linesReveal(how.movement, fresh.length, old.length);
    const t = p * r.total;
    fresh.forEach((line, i) => {
      place(line, r.in(i, t), how.scaleIn);
    });
    old.forEach((line, i) => {
      place(line, r.out(i, t), how.scaleOut);
    });
    return;
  }
  const words = fresh.map((line) => [...line.querySelectorAll<HTMLElement>('[data-reveal-word]')]);
  const r = wordsReveal(
    how.movement,
    words.map((w) => w.length),
  );
  const t = p * r.total;
  words.forEach((ws, li) => {
    ws.forEach((w, wi) => {
      place(w, r.in(li, wi, t), how.scaleIn);
    });
  });
  if (els.wordsOut) els.wordsOut.style.opacity = String(r.out(t));
}

/** The two slides and the black as the transition has them at `p`, the words too while apart (nothing set when not in one). */
function paintLayers(els: Layers, how: Paint, p: number): void {
  const { kind, movement } = how;
  const frame = kind === null ? null : transitionFrame(kind, p, movement);
  const set = (el: HTMLDivElement | null, opacity: string, transform: string, clip = '') => {
    if (!el) return;
    el.style.opacity = opacity;
    el.style.transform = transform;
    el.style.clipPath = clip;
  };
  set(els.in, frame ? String(frame.in.opacity) : '', frame?.in.transform ?? '');
  set(els.out, frame ? String(frame.out.opacity) : '', frame?.out.transform ?? '');
  if (els.black) els.black.style.opacity = frame ? String(frame.black) : '0';
  const move = kind === null ? null : how.move;
  if (move && (els.wordsIn || els.wordsOut)) {
    const words = wordsFrame(move, p, how);
    set(els.wordsIn, String(words.in.opacity), words.in.transform, words.in.clip);
    set(els.wordsOut, String(words.out.opacity), words.out.transform, words.out.clip);
    if (move === 'lines' || move === 'words') paintUnits(els, how, p);
  }
}

/**
 * Whether every picture and video in `root` can be drawn now; else a promise for when it can, or for
 * `deadline` (the engine's time) if that comes first.
 */
function mediaReady(root: HTMLElement, deadline: number): true | Promise<void> {
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
    new Promise<void>((resolve) =>
      // eslint-disable-next-line no-restricted-syntax -- its deadline is the engine's (3 s after the slide went up), so every screen still waiting starts at once
      setTimeout(resolve, Math.max(0, deadline - engineNow())),
    ),
  ]);
}

/**
 * A slide that came on by a slow zoom grows slowly about its middle while it is up, from when it came on,
 * by the engine's clock (Session 26d). The browser runs it (a transform, off the page's own work), kept at
 * the engine's time; anything else is drawn as it is.
 */
function Zoomed({ layer, children }: { layer: SlideLayer; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = layer.transition;
  const span = t?.kind === 'zoom' ? zoomSpan(t) : 0;
  const shownAt = layer.shownAt;
  useLayoutEffect(() => {
    const el = ref.current;
    if (span <= 0 || !el || typeof el.animate !== 'function') return;
    // eslint-disable-next-line no-restricted-syntax -- seeked to the engine's time below and at every clock jump (keep), paused when held
    const zoom = el.animate([{ transform: 'scale(1)' }, { transform: `scale(${String(SLOW_ZOOM_SCALE)})` }], {
      duration: span,
      fill: 'forwards',
      easing: 'linear',
    });
    const keep = () => {
      const at = Math.min(span, Math.max(0, engineNow() - shownAt));
      // Held (a test), or finished: it stays where it is (playing a finished one would start it again). Paused
      // before it is placed: a pause only lands at the next frame, a frame further on.
      const still = clockHeld() || at >= span;
      if (still) zoom.pause();
      zoom.currentTime = at;
      if (!still) zoom.play();
    };
    keep();
    const off = onClockJump(keep);
    return () => {
      off();
      zoom.cancel();
    };
  }, [span, shownAt]);
  if (span <= 0) return <>{children}</>;
  return (
    <div ref={ref} data-zoom="" style={{ position: 'absolute', inset: 0, transformOrigin: '50% 50%' }}>
      {children}
    </div>
  );
}

/**
 * One slide as a screen draws it: as designed, or (a Look's lower third) its
 * words in a box along the bottom; a slide with no words but a picture or
 * video is drawn as designed either way.
 */
function DrawnSlide({
  layer,
  canvas,
  scaling,
  languages,
  slides,
  text = 'shown',
  reveal,
  movement,
  timers,
}: {
  layer: SlideLayer;
  canvas: Size;
  scaling: ScalingMode;
  languages: readonly Lang[] | null;
  slides: SlideStyle;
  /** While a Bold move runs: its pictures with the words hidden, or its words alone (Session 27). */
  text?: SlideText;
  /** Its words alone, line by line or word by word. */
  reveal?: Reveal;
  /** The screen's Movement and the state's timers, for its Timers (Session 50). */
  movement: Movement;
  timers: readonly TimerState[] | undefined;
}) {
  // A deck's slide (Session 54, C2): the step showing, drawn in its picture's place from the engine's time.
  const { slide, step: index, stepAt, stepFromMs, shownAt } = layer;
  const step = useMemo(
    () => stepTiming({ slide, step: index, stepAt, stepFromMs, shownAt }),
    [slide, index, stepAt, stepFromMs, shownAt],
  );
  if (slides === 'lowerThird') {
    const lines = lowerThird(layer.slide, languages);
    // Its words are drawn apart, by the Look's moving lower third (render/LowerThird.tsx, Session 27).
    if (lines.length > 0) return null;
    if (!hasPicture(layer.slide)) return null;
  }
  return (
    <SlideMovementContext.Provider value={movement}>
      <SlideTimersContext.Provider value={timers ?? null}>
        <Placed content={layer.slide} box={canvas} mode={scaling}>
          <SlideView
            slide={languageView(layer.slide, languages)}
            startedAt={layer.shownAt}
            // Its videos between their files' start and end points, the engine's (Session 52), from where the time
            // bar left them (Session 54).
            clips={layer.clips}
            seeks={layer.seeks}
            text={text}
            reveal={reveal}
            step={step}
          />
        </Placed>
      </SlideTimersContext.Provider>
    </SlideMovementContext.Provider>
  );
}

export function SlideLayerView({
  layer,
  canvas,
  scaling,
  languages = null,
  slides = 'designed',
  movement = 'calm',
  leaving = null,
  timers,
}: {
  layer: SlideLayer | null;
  canvas: Size;
  scaling: ScalingMode;
  /** The languages this screen shows of a kirtan's slides (language-view.ts); null for all. */
  languages?: readonly Lang[] | null;
  /** How this screen draws slides (its group's Look): as designed, or as a lower third. */
  slides?: SlideStyle;
  /** How this screen's group moves (its Look, Session 27): Calm or Bold. */
  movement?: Movement;
  /** The slide just taken off on its own (the engine's slideOff): a timer shown alone fades out (Session 50). */
  leaving?: Leaving;
  /** The timers of the state drawn, for the slides' Timers (Session 50); left out: this page's own. */
  timers?: readonly TimerState[];
}) {
  // A screen that comes along later shows the slide as it is (no fade).
  const [showing, setShowing] = useState<Showing>(() => ({ on: layer, off: null, fade: null }));
  const [seen, setSeen] = useState(layer);
  if (seen !== layer) {
    setSeen(layer);
    setShowing((prev) => nextShowing(prev, layer, engineNow(), leaving));
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
    const ready = mediaReady(inRef.current, shownAt + MEDIA_WAIT_MS);
    const begin = (start: number) => {
      setShowing((s) => (s.on && keyOf(s.on) === onKey && s.fade ? { ...s, fade: { ...s.fade, start } } : s));
    };
    if (ready === true) {
      begin(shownAt);
      return;
    }
    let live = true;
    void ready.then(() => {
      if (live) begin(Math.max(shownAt, engineNow()));
    });
    return () => {
      live = false;
    };
  }, [waiting, on, onKey]);

  // Run the transition, frame by frame, from the clock every screen shares.
  const start = fade?.start ?? null;
  const ms = fade?.ms ?? 0;
  const kind = fade?.kind ?? 'cut';
  // How its words move while it runs (Session 27): never word by word on a kirtan's slide; slides as designed
  // only (a lower third has its own way).
  const moveNow =
    fade !== null && on !== null && slides === 'designed'
      ? wordsMove(kind, movement, on.slide.kirtan === true)
      : null;
  const { width, height } = canvas;
  const scaleIn = (on?.slide.height ?? 1080) / 1080;
  const scaleOut = (off?.slide.height ?? 1080) / 1080;
  const blackRef = useRef<HTMLDivElement>(null);
  // The two slides' words, while a Bold move draws them apart (Session 27).
  const wordsInRef = useRef<HTMLDivElement>(null);
  const wordsOutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (start === null) return;
    let frame = 0;
    const tick = () => {
      const p = fadeAt({ ms, start }, engineNow());
      paintLayers(
        {
          in: inRef.current,
          out: outRef.current,
          black: blackRef.current,
          wordsIn: wordsInRef.current,
          wordsOut: wordsOutRef.current,
        },
        { kind, movement, move: moveNow, width, height, scaleIn, scaleOut },
        p,
      );
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
  }, [start, ms, kind, movement, moveNow, width, height, scaleIn, scaleOut]);

  // After every render, before it is painted: where the transition is now (the frames between renders set
  // it too). A deck's slide coming in by a cut (Session 54, C2) shows nothing of itself until it starts.
  const fading = fade !== null;
  useLayoutEffect(() => {
    if (kind === 'cut' && start === null && fading) {
      if (inRef.current) inRef.current.style.opacity = '0';
      if (outRef.current) outRef.current.style.opacity = '';
      return;
    }
    paintLayers(
      {
        in: inRef.current,
        out: outRef.current,
        black: blackRef.current,
        wordsIn: wordsInRef.current,
        wordsOut: wordsOutRef.current,
      },
      { kind: fading ? kind : null, movement, move: moveNow, width, height, scaleIn, scaleOut },
      start !== null ? fadeAt({ ms, start }, engineNow()) : 0,
    );
  });

  if (!on && !off) return null;
  // One list, keyed by slide and time, so the slide going away keeps its elements (its videos play on); a timer
  // going off alone (Session 50), only it.
  const shown = on ? (fading && off ? [off, on] : [on]) : off ? [off] : [];
  // A fade adds the new slide light for light over the old; the others draw it over.
  const adds = fading && off !== null && transitionFrame(kind, 0, movement).add;
  // A Bold move (Session 27): the words drawn apart, above both slides' pictures, shapes and colour, which
  // only dissolve. Slides as designed only (a lower third has its own); none for a cut or a Calm dissolve.
  const move = fading ? moveNow : null;
  return (
    <div
      ref={rootRef}
      data-layer="slide"
      data-slides={slides}
      data-fading={fading ? 'true' : undefined}
      data-fade-start={fade?.start ?? undefined}
      data-transition={fading ? kind : undefined}
      // The two slides blend with each other only, then go over the background as one; a slide coming
      // in from the side stays inside the screen.
      style={{
        position: 'absolute',
        inset: 0,
        isolation: fading ? 'isolate' : undefined,
        overflow: fading && kind === 'slide' ? 'hidden' : undefined,
      }}
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
              mixBlendMode: adds && incoming ? 'plus-lighter' : undefined,
            }}
          >
            <Zoomed layer={l}>
              <DrawnSlide
                layer={l}
                canvas={canvas}
                scaling={scaling}
                languages={languages}
                slides={slides}
                text={move ? 'hidden' : 'shown'}
                movement={movement}
                timers={timers}
              />
            </Zoomed>
          </div>
        );
      })}
      {/* The words, while a Bold move runs: one layer above both slides' pictures, the new words added
          light for light over the old (an unchanged word never dips). Gone when the move is over, and the
          slide is drawn as designed again. */}
      {move && (
        <div data-words-apart={move} style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
          {shown.map((l) => {
            const incoming = l === on;
            return (
              <div
                key={keyOf(l)}
                ref={incoming ? wordsInRef : wordsOutRef}
                data-words-in={incoming ? '' : undefined}
                data-words-out={incoming ? undefined : ''}
                style={{
                  position: 'absolute',
                  inset: 0,
                  transformOrigin: '50% 50%',
                  mixBlendMode: incoming && off !== null ? 'plus-lighter' : undefined,
                }}
              >
                <DrawnSlide
                  layer={l}
                  canvas={canvas}
                  scaling={scaling}
                  languages={languages}
                  slides={slides}
                  text="only"
                  reveal={move === 'lines' || move === 'words' ? move : undefined}
                  movement={movement}
                  timers={timers}
                />
              </div>
            );
          })}
        </div>
      )}
      {/* A fade through black: black over both, whole half-way. */}
      {fading && kind === 'fade-black' && (
        <div
          ref={blackRef}
          data-slide-black=""
          style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0 }}
        />
      )}
    </div>
  );
}
