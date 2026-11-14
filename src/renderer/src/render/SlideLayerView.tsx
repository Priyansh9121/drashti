import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { nativeDeckMotion } from '../../../shared/deck';
import { type DeckNativeTransition, isDeckNativeTransition } from '../../../shared/deck-transition';
import type { EngineState, SlideLayer } from '../../../shared/engine/state';
import { languageView } from '../../../shared/language-view';
import type { Movement, SlideStyle } from '../../../shared/looks';
import type { Lang, TransitionKind } from '../../../shared/model';
import { SLOW_ZOOM_SCALE } from '../../../shared/model';
import { hasPicture, lowerThird } from '../../../shared/program';
import { placeContent, type Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { Placed } from './Placed';
import { type Reveal, type SlideText, SlideView } from './SlideView';
import type { TimerState } from '../../../shared/timers';
import { clockHeld, engineNow, onClockJump } from './clock';
import { SlideMovementContext, SlideTimersContext } from './slide-timers';
import { linesReveal, type UnitFrame, wordsReveal } from './reveal';
import { deckSlideAt, nativeStepTiming, stepTiming } from '../../../shared/deck-show';
import { DECK_FIRST_FRAME } from './DeckStep';
import { NativeDeckMotion } from './NativeDeckElement';
import {
  deckTransitionFrame,
  takesTime,
  transitionFrame,
  type SlidePlace,
  type WipeBand,
  type WipeBandStyles,
  wipeBandStyles,
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
  /** The click pressed while PowerPoint's incoming transition is still on screen. */
  afterTransition?: SlideLayer;
  /** The transition's kind and length, and when it started (null: the new slide's media is still loading). */
  fade: { kind: TransitionKind; ms: number; start: number | null; native?: DeckNativeTransition } | null;
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
  if (prev.on && keyOf(prev.on) === keyOf(layer)) {
    // A new click can have its own transition. The same slide with new content keeps its running transition.
    const moved = prev.on.step !== layer.step || prev.on.stepAt !== layer.stepAt;
    if (moved) {
      const native = nativeStepTiming(layer);
      if (native && prev.fade?.native && (prev.fade.start === null || now < prev.fade.start + prev.fade.ms))
        return { ...prev, afterTransition: layer };
      const t = native?.drashti?.transition;
      if (native && takesTime(t) && now < native.shownAt + t.durationMs)
        return {
          on: layer,
          off: prev.on,
          fade: { kind: t.kind, ms: t.durationMs, start: native.shownAt },
        };
      if (native && prev.off && keyOf(prev.off) === keyOf(layer)) return { on: layer, off: null, fade: null };
    }
    // The engine's newest is shown: a click that waited for the incoming transition is over with, so its older slide
    // never replaces this one when the transition ends (an edit meanwhile that leaves the slide no longer one Drashti
    // plays itself, C3's review LOW).
    return { on: layer, off: prev.off, fade: prev.fade };
  }
  const t = layer.transition;
  if (takesTime(t) && now < layer.shownAt + t.durationMs)
    return {
      on: layer,
      // What goes away is what is on screen: a slide still waiting for its pictures had not begun to
      // show, and the one before it was still up, whole (Session 23).
      off: prev.fade?.start === null ? prev.off : prev.on,
      fade: {
        kind: t.kind,
        ms: t.durationMs,
        start: null,
        ...(isDeckNativeTransition(t) ? { native: t } : {}),
      },
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

/**
 * A slide's two band boxes (Session 58, C2), inside its box and around what it draws: at rest they fill it and do
 * nothing; while a deck's own Wipe brings the slide in, the holder is PowerPoint's band (a mask on a box two slides long,
 * moved) and the slide box moves the slide back inside it (transition-frame.ts wipeBandStyles).
 */
export interface BandBoxes {
  holder: HTMLDivElement | null;
  slide: HTMLDivElement | null;
}

/**
 * The layers a transition draws: the two slides, the black, and the two slides' words while drawn apart; each slide's
 * band boxes too.
 */
export interface Layers {
  in: HTMLDivElement | null;
  out: HTMLDivElement | null;
  black: HTMLDivElement | null;
  wordsIn: HTMLDivElement | null;
  wordsOut: HTMLDivElement | null;
  bandIn?: BandBoxes;
  bandOut?: BandBoxes;
}

/**
 * How a transition paints: its kind (null when not in one), the group's Movement, how its words move (null:
 * whole slides), the canvas, and each slide's height against 1080 (a line's rise is the lab's, at 1080).
 */
export interface Paint {
  kind: TransitionKind | null;
  native: DeckNativeTransition | undefined;
  movement: Movement;
  move: WordsMove | null;
  width: number;
  height: number;
  scaleIn: number;
  scaleOut: number;
  /** Where the incoming slide is in the layer's box (a deck's Wipe measures its band on it). */
  placeIn: SlidePlace;
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
export function paintLayers(els: Layers, how: Paint, p: number): void {
  const { kind, movement, native } = how;
  const frame = native
    ? deckTransitionFrame(native, p, movement)
    : kind === null
      ? null
      : transitionFrame(kind, p, movement);
  const set = (el: HTMLDivElement | null, opacity: string, transform: string, clip = '') => {
    if (!el) return;
    el.style.opacity = opacity;
    el.style.transform = transform;
    el.style.clipPath = clip;
  };
  set(els.in, frame ? String(frame.in.opacity) : '', frame?.in.transform ?? '', frame?.in.clip);
  set(els.out, frame ? String(frame.out.opacity) : '', frame?.out.transform ?? '', frame?.out.clip);
  // A deck's own transition only (13 Nov 2026): PowerPoint's Wipe band (a mask) and the shade of the slide its Cover or
  // Uncover moves (a filter). Written only when set or to clear them, so nothing else ever touches them.
  const deckOnly = (el: HTMLDivElement | null, mask = '', filter = '') => {
    if (!el) return;
    if (el.style.maskImage !== mask) el.style.maskImage = mask;
    if (el.style.filter !== filter) el.style.filter = filter;
  };
  deckOnly(els.in, frame?.in.mask, frame?.in.filter);
  deckOnly(els.out, frame?.out.mask, frame?.out.filter);
  // PowerPoint's Wipe band (Session 58): on the slide's band boxes, at rest when none.
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  const bandOf = (band: WipeBand | undefined) => (band ? wipeBandStyles(band, how.placeIn, how, dpr) : null);
  paintBand(els.bandIn, bandOf(frame?.in.band), frame?.in.band?.direction ?? '');
  paintBand(els.bandOut, bandOf(frame?.out.band), frame?.out.band?.direction ?? '');
  if (els.out) els.out.style.zIndex = native?.deckEffect === 'uncover' ? '1' : '';
  if (els.black) els.black.style.opacity = frame ? String(frame.black) : '0';
  const move = kind === null ? null : how.move;
  if (move && (els.wordsIn || els.wordsOut)) {
    const words = wordsFrame(move, p, how);
    set(els.wordsIn, String(words.in.opacity), words.in.transform, words.in.clip);
    set(els.wordsOut, String(words.out.opacity), words.out.transform, words.out.clip);
    if (move === 'lines' || move === 'words') paintUnits(els, how, p);
  }
}

/** A slide's band boxes at rest, as its JSX draws them: filling the slide's box. */
const BAND_BOX = { position: 'absolute', inset: 0 } as const;

type BandStyle = 'inset' | 'width' | 'height' | 'maskImage' | 'willChange' | 'overflow';

/**
 * What paintBand last wrote on each band box: which way its band went ('' at rest) and its transform. A box is written
 * only when they change: its mask and size once as a Wipe starts and once as it ends, its transform each frame. (Read
 * back, the page writes them its own way, 0 as 0px, a gradient's colours as rgb: never compared with what is there.)
 */
const bandWritten = new WeakMap<HTMLElement, { way: string; transform: string }>();

function writeBand(
  el: HTMLElement,
  way: string,
  styles: Readonly<Record<BandStyle, string>>,
  transform: string,
): void {
  const last = bandWritten.get(el);
  if (last?.way === way && last.transform === transform) return;
  const style = el.style as unknown as Record<BandStyle | 'transform', string>;
  if (last?.way !== way) for (const [key, value] of Object.entries(styles)) style[key as BandStyle] = value;
  if (last?.transform !== transform) style.transform = transform;
  bandWritten.set(el, { way, transform });
}

/**
 * A slide's band boxes as `s` has them while a deck's own Wipe brings the slide in, its band going `way` (each a layer
 * of its own, only their transforms changing as it runs), or at rest (null, '').
 */
function paintBand(boxes: BandBoxes | undefined, s: WipeBandStyles | null, way: string): void {
  const holder = boxes?.holder;
  const slide = boxes?.slide;
  if (!holder || !slide) return;
  writeBand(
    holder,
    way,
    {
      inset: s?.holder.inset ?? '0',
      width: s?.holder.width ?? '',
      height: s?.holder.height ?? '',
      maskImage: s?.holder.maskImage ?? '',
      willChange: s ? 'transform' : '',
      overflow: s ? 'hidden' : '',
    },
    s?.holder.transform ?? '',
  );
  writeBand(
    slide,
    way,
    {
      inset: s?.slide.inset ?? '0',
      width: s?.slide.width ?? '',
      height: s?.slide.height ?? '',
      maskImage: '',
      willChange: s ? 'transform' : '',
      overflow: '',
    },
    s?.slide.transform ?? '',
  );
}

/**
 * A deck's slide coming in by a cut, its clip not yet drawn (Session 54, C2): the slide before stays up, the new one
 * unseen, until it can be drawn. The slide before is drawn whole, as at rest: after Back during a deck's own
 * transition it is the slide that was coming in, and keeps nothing of it (its move, clip, mask, shade, place above or
 * Wipe band; TX-1, Session 58).
 */
export function paintWaiting(els: Pick<Layers, 'in' | 'out' | 'bandOut'>): void {
  if (els.in) els.in.style.opacity = '0';
  const before = els.out;
  if (!before) return;
  before.style.opacity = '';
  before.style.transform = '';
  before.style.clipPath = '';
  if (before.style.maskImage !== '') before.style.maskImage = '';
  if (before.style.filter !== '') before.style.filter = '';
  before.style.zIndex = '';
  paintBand(els.bandOut, null, '');
}

/**
 * Whether every picture and video in `root` can be drawn now; else a promise for when it can, or for
 * `deadline` (the engine's time) if that comes first.
 */
export function slideMediaReady(
  root: HTMLElement,
  deadline: number,
  layer: SlideLayer,
): true | Promise<void> {
  const native = nativeDeckMotion(layer.slide.deck) !== undefined;
  const waits: Promise<unknown>[] = [];
  for (const img of root.querySelectorAll('img'))
    if (!img.complete) waits.push(img.decode().catch(() => undefined));
  const videos = Array.from(root.querySelectorAll('video'));
  const first = videos.find((video) => video.dataset['deckFirstFrame'] !== undefined);
  for (const video of videos)
    if (
      video === first
        ? video.dataset['deckFirstFrame'] === 'loading'
        : video.readyState < 2 &&
          video.dataset['deckVideo'] !== 'preparing' &&
          (!first || video.dataset['deckVideo'] !== 'hold') &&
          (!native || (video.dataset['deckCover'] !== 'poster' && video.dataset['deckCover'] !== 'hidden'))
    )
      waits.push(
        new Promise<void>((resolve) => {
          // The clip's own notification waits for the frame at the seek position. A hold or the next click does
          // not draw while this first clip plays.
          for (const event of video === first ? [DECK_FIRST_FRAME] : ['loadeddata', 'canplay', 'error'])
            video.addEventListener(event, () => resolve(), { once: true });
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
  settled = false,
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
  /** The previous click's final frame while a new click uses Drashti's own transition. */
  settled?: boolean;
}) {
  const { slide, step: index, stepAt, stepFromMs, shownAt } = layer;
  const { step, native } = useMemo(() => {
    if (settled) return { step: null, native: null };
    const timing = { slide, step: index, stepAt, stepFromMs, shownAt };
    return { step: stepTiming(timing), native: nativeStepTiming(timing) };
  }, [slide, index, stepAt, stepFromMs, shownAt, settled]);
  const drawn = useMemo(
    () => languageView(settled ? deckSlideAt(slide, index ?? 0) : slide, languages),
    [slide, settled, index, languages],
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
        <Placed content={drawn} box={canvas} mode={scaling}>
          <NativeDeckMotion slide={drawn} timing={native}>
            <SlideView
              slide={drawn}
              media={settled ? 'still' : 'live'}
              startedAt={layer.shownAt}
              // Its videos between their files' start and end points, the engine's (Session 52), from where the
              // time bar left them (Session 54).
              clips={layer.clips}
              seeks={layer.seeks}
              text={text}
              reveal={reveal}
              step={step}
            />
          </NativeDeckMotion>
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
  // Each slide's band boxes (Session 58, C2): a deck's own Wipe draws PowerPoint's band on the incoming slide's.
  const inHolderRef = useRef<HTMLDivElement>(null);
  const inBandSlideRef = useRef<HTMLDivElement>(null);
  const outHolderRef = useRef<HTMLDivElement>(null);
  const outBandSlideRef = useRef<HTMLDivElement>(null);

  // Start the fade once the new slide's pictures and videos can be drawn: at shownAt if they
  // already could (every screen at the same point), else when they can.
  const waiting = fade !== null && fade.start === null;
  const native = fade?.native;
  const onKey = on ? keyOf(on) : null;
  useEffect(() => {
    if (!waiting || !on || !inRef.current) return;
    const shownAt = on.shownAt;
    const ready = slideMediaReady(inRef.current, shownAt + MEDIA_WAIT_MS, on);
    const begin = (start: number) => {
      setShowing((s) =>
        s.on && keyOf(s.on) === onKey && s.fade?.start === null ? { ...s, fade: { ...s.fade, start } } : s,
      );
    };
    if (ready === true) {
      begin(shownAt);
      return;
    }
    let live = true;
    void ready.then(() => {
      if (live) begin(native ? shownAt : Math.max(shownAt, engineNow()));
    });
    return () => {
      live = false;
    };
  }, [waiting, on, onKey, native]);

  // Run the transition, frame by frame, from the clock every screen shares.
  const start = fade?.start ?? null;
  const ms = fade?.ms ?? 0;
  const kind = fade?.kind ?? 'cut';
  // How its words move while it runs (Session 27): never word by word on a kirtan's slide; slides as designed
  // only (a lower third has its own way).
  const moveNow =
    fade !== null && !native && on !== null && slides === 'designed'
      ? wordsMove(kind, movement, on.slide.kirtan === true)
      : null;
  const { width, height } = canvas;
  // Where the incoming slide is in the layer's box, as Placed puts it (a deck's Wipe measures its band on it).
  const placed = on ? placeContent(on.slide, canvas, scaling) : null;
  const inX = placed?.x ?? 0;
  const inY = placed?.y ?? 0;
  const inWidth = on && placed ? on.slide.width * placed.scaleX : width;
  const inHeight = on && placed ? on.slide.height * placed.scaleY : height;
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
      const now = engineNow();
      const p = fadeAt({ ms, start }, now);
      paintLayers(
        {
          in: inRef.current,
          out: outRef.current,
          black: blackRef.current,
          wordsIn: wordsInRef.current,
          wordsOut: wordsOutRef.current,
          bandIn: { holder: inHolderRef.current, slide: inBandSlideRef.current },
          bandOut: { holder: outHolderRef.current, slide: outBandSlideRef.current },
        },
        {
          kind,
          native,
          movement,
          move: moveNow,
          width,
          height,
          scaleIn,
          scaleOut,
          placeIn: { x: inX, y: inY, width: inWidth, height: inHeight },
        },
        p,
      );
      rootRef.current?.setAttribute('data-fade', p.toFixed(3));
      if (p >= 1) {
        setShowing((s) => {
          if (s.fade?.start !== start) return s;
          const done = { on: s.on, off: null, fade: null };
          return s.afterTransition ? nextShowing(done, s.afterTransition, now) : done;
        });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    start,
    ms,
    kind,
    native,
    movement,
    moveNow,
    width,
    height,
    scaleIn,
    scaleOut,
    inX,
    inY,
    inWidth,
    inHeight,
  ]);

  // After every render, before it is painted: where the transition is now (the frames between renders set
  // it too). A deck's slide coming in by a cut (Session 54, C2) shows nothing of itself until it starts.
  const fading = fade !== null;
  useLayoutEffect(() => {
    if (kind === 'cut' && start === null && fading) {
      paintWaiting({
        in: inRef.current,
        out: outRef.current,
        bandOut: { holder: outHolderRef.current, slide: outBandSlideRef.current },
      });
      return;
    }
    paintLayers(
      {
        in: inRef.current,
        out: outRef.current,
        black: blackRef.current,
        wordsIn: wordsInRef.current,
        wordsOut: wordsOutRef.current,
        bandIn: { holder: inHolderRef.current, slide: inBandSlideRef.current },
        bandOut: { holder: outHolderRef.current, slide: outBandSlideRef.current },
      },
      {
        kind: fading ? kind : null,
        native,
        movement,
        move: moveNow,
        width,
        height,
        scaleIn,
        scaleOut,
        placeIn: { x: inX, y: inY, width: inWidth, height: inHeight },
      },
      start !== null ? fadeAt({ ms, start }, engineNow()) : 0,
    );
  });

  if (!on && !off) return null;
  // One list, keyed by slide and time, so the slide going away keeps its elements (its videos play on); a timer
  // going off alone (Session 50), only it.
  const shown = on ? (fading && off ? [off, on] : [on]) : off ? [off] : [];
  // A fade adds the new slide light for light over the old; the others draw it over.
  const adds =
    fading &&
    off !== null &&
    (native ? deckTransitionFrame(native, 0, movement) : transitionFrame(kind, 0, movement)).add;
  // A Bold move (Session 27): the words drawn apart, above both slides' pictures, shapes and colour, which
  // only dissolve. Slides as designed only (a lower third has its own); none for a cut or a Calm dissolve.
  const move = fading ? moveNow : null;
  // Two independently moving edges can expose a corner of the canvas. Keep the outgoing still under both.
  const underlay =
    fading &&
    native?.over?.kind === 'slide' &&
    native.deckEffect !== 'dissolve' &&
    native.deckEffect !== 'fade-black'
      ? off
      : null;
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
        overflow: fading && (kind === 'slide' || native?.over?.kind === 'slide') ? 'hidden' : undefined,
      }}
    >
      {underlay && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <DrawnSlide
            layer={underlay}
            canvas={canvas}
            scaling={scaling}
            languages={languages}
            slides={slides}
            movement={movement}
            timers={timers}
            settled
          />
        </div>
      )}
      {shown.map((l) => {
        const incoming = l === on;
        const settled = !incoming && on !== null && keyOf(l) === keyOf(on);
        return (
          <div
            key={settled ? `${keyOf(l)}:settled` : keyOf(l)}
            ref={incoming ? inRef : outRef}
            data-slide-in={incoming ? '' : undefined}
            data-slide-out={incoming ? undefined : ''}
            style={{
              position: 'absolute',
              inset: 0,
              mixBlendMode: adds && incoming ? 'plus-lighter' : undefined,
            }}
          >
            {/* Its band boxes (Session 58, C2): at rest they only fill its box; a deck's own Wipe draws its band on
                them. Always there, so a Wipe starting or ending never draws the slide anew. */}
            <div ref={incoming ? inHolderRef : outHolderRef} data-band="" style={BAND_BOX}>
              <div ref={incoming ? inBandSlideRef : outBandSlideRef} data-band-slide="" style={BAND_BOX}>
                <Zoomed layer={l}>
                  <DrawnSlide
                    layer={l}
                    canvas={canvas}
                    scaling={scaling}
                    languages={languages}
                    slides={slides}
                    text={move ? 'hidden' : 'shown'}
                    settled={settled}
                    movement={movement}
                    timers={timers}
                  />
                </Zoomed>
              </div>
            </div>
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
            const settled = !incoming && on !== null && keyOf(l) === keyOf(on);
            return (
              <div
                key={settled ? `${keyOf(l)}:settled` : keyOf(l)}
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
                  settled={settled}
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
      {fading && (kind === 'fade-black' || native?.over?.kind === 'fade-black') && (
        <div
          ref={blackRef}
          data-slide-black=""
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            opacity: 0,
            zIndex: native ? 2 : undefined,
          }}
        />
      )}
    </div>
  );
}
