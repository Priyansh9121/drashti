import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
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
import { decodeSlideImage, slideImageDecoded } from './slide-image-decoding';
import { CanvasClip, OwnLayers } from './canvas-clip';
import { type Reveal, type SlideText, SlideView } from './SlideView';
import type { TimerState } from '../../../shared/timers';
import { clockHeld, engineNow, onClockJump } from './clock';
import { SlideMovementContext, SlideTimersContext } from './slide-timers';
import { linesReveal, type UnitFrame, wordsReveal } from './reveal';
import { deckSlideAt, nativeStepTiming, stepTiming } from '../../../shared/deck-show';
import { DECK_FIRST_FRAME } from './DeckStep';
import { NativeDeckMotion } from './NativeDeckElement';
import { drawsWithoutChip } from './chipless';
import { ScreenPictures } from './picture-looks';
import { type SlideBacking, slideBacking } from './slide-backing';
import {
  deckSlideClip,
  deckTransitionFrame,
  takesTime,
  transitionFrame,
  type SlideFrame,
  type SlidePlace,
  type SlideShift,
  type WipeBand,
  wipeSlideClip,
  wipeSlideMask,
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
  fade: {
    kind: TransitionKind;
    ms: number;
    start: number | null;
    native?: DeckNativeTransition;
    /**
     * A cut on the stream's page that waits for the slide's pictures (Session 58, Q57-35): the latest it waits to, by
     * the engine's clock. It is made in the very frame its pictures can be drawn in.
     */
    picturesBy?: number;
    /** A new scene prepares its own DOM images, even when the initial preloader decoded their addresses. */
    initial?: true;
  } | null;
}

/** The slide just taken off on its own, and when (the engine's slideOff). */
type Leaving = EngineState['slideOff'];

/**
 * What to show for a new state of the layer (`leaving`: the slide just taken off on its own, if any; `picturesFirst`:
 * a slide cut in waits for its pictures: the stream's page, and the hall's screens since Session 59, X19).
 */
export function nextShowing(
  prev: Showing,
  layer: SlideLayer | null,
  now: number,
  leaving: Leaving = null,
  picturesFirst = false,
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
  // The stream's page (Session 58, Q57-35) draws a slide cut in only once its pictures can be drawn, keeping what is
  // on screen until then (MEDIA_WAIT_MS at most), as a transition waits for them: its encoder never takes a frame of
  // the slide black where a picture goes, or with part of it. Loading what Next shows ahead, as the hall's screens do
  // (output/Preloader.tsx), it waits only for a picture it has not loaded.
  if (picturesFirst)
    return {
      on: layer,
      off: prev.fade?.start === null ? prev.off : prev.on,
      fade: { kind: 'cut', ms: 1, start: null, picturesBy: now + MEDIA_WAIT_MS },
    };
  return { on: layer, off: null, fade: null };
}

/**
 * What a screen shows of the layer it first draws: the slide as it is (a screen that comes along later), on the
 * stream's page once its pictures can be drawn (`picturesFirst`, Session 58, Q57-35: Session 57's black frames were
 * the first slide drawn as the stream's page came up, its picture still loading).
 */
export function firstShowing(layer: SlideLayer | null, now: number, picturesFirst = false): Showing {
  if (picturesFirst && layer)
    return {
      on: layer,
      off: null,
      fade: { kind: 'cut', ms: 1, start: null, picturesBy: now + MEDIA_WAIT_MS, initial: true },
    };
  return { on: layer, off: null, fade: null };
}

/** The longest the fade waits for a slide's media before it starts anyway. */
const MEDIA_WAIT_MS = 3000;

/** How far a fade is (0 to 1) at `now`. */
export const fadeAt = (fade: { ms: number; start: number }, now: number): number =>
  Math.min(1, Math.max(0, (now - fade.start) / fade.ms));

/**
 * The layers a transition draws: the two slides, the black, and the two slides' words while drawn apart; each slide's
 * shade box too.
 */
export interface Layers {
  in: HTMLDivElement | null;
  out: HTMLDivElement | null;
  black: HTMLDivElement | null;
  wordsIn: HTMLDivElement | null;
  wordsOut: HTMLDivElement | null;
  /**
   * Each slide's shade box (X11): around what the slide draws, inside its box. Without a graphics chip a deck's own
   * Cover or Uncover shades the slide it moves on it, inside the slide's own layer.
   */
  shadeIn?: HTMLDivElement | null;
  shadeOut?: HTMLDivElement | null;
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
  /** Where the incoming slide is in the layer's box (a deck's Wipe measures its band on it, its Push and Cover moves). */
  placeIn: SlidePlace;
  /** Where the outgoing slide is (a deck's Push and Uncover move it by its own length). */
  placeOut: SlidePlace;
  /**
   * Device pixels a canvas pixel where the layer is drawn (the screen's scale times its pixel ratio), when known: a page
   * without a graphics chip moves a deck's own Push, Cover and Uncover in whole ones (X11).
   */
  devicePerCanvas?: number;
  /**
   * The opaque colour each slide is backed with while it is a layer of its own without a graphics chip (X11), when it
   * is known to draw no see-through pixel anywhere in its place (render/slide-backing.ts); left out: never backed.
   */
  backingIn?: string;
  backingOut?: string;
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

/**
 * Each slide's place for a deck's own transition (Session 58, Q58-16), or none: where both fill the layer's box, within
 * a pixel (there its slides move in % of the box exactly as before, the same as by their own length); and under a
 * transition of Drashti's own set over the deck's, where no clip keeps the slides inside theirs (review MEDIUM-1: the
 * old slide would sit over the bar to the end, then go in one frame), so they move off the screen as before.
 */
function slidePlaces(how: Paint): { in: SlidePlace; out: SlidePlace } | undefined {
  if (how.native?.over) return undefined;
  const fills = (place: SlidePlace) =>
    Math.abs(place.x) < 1 &&
    Math.abs(place.y) < 1 &&
    Math.abs(place.width - how.width) < 1 &&
    Math.abs(place.height - how.height) < 1;
  return fills(how.placeIn) && fills(how.placeOut) ? undefined : { in: how.placeIn, out: how.placeOut };
}

/** A layer of its own that does not move (X11): a 3D translation by nothing. */
const STILL_LAYER = 'translate3d(0px, 0px, 0px)';

/** The two slides and the black as the transition has them at `p`, the words too while apart (nothing set when not in one). */
export function paintLayers(els: Layers, how: Paint, p: number): void {
  const { kind, movement, native } = how;
  const frame = native
    ? deckTransitionFrame(native, p, movement, slidePlaces(how))
    : kind === null
      ? null
      : transitionFrame(kind, p, movement);
  const set = (el: HTMLDivElement | null, opacity: string, transform: string, clip = '') => {
    if (!el) return;
    el.style.opacity = opacity;
    el.style.transform = transform;
    el.style.clipPath = clip;
  };
  const chipless = drawsWithoutChip();
  // Without a graphics chip, a deck's own Push, Cover or Uncover alone (X11): each slide it moves is a layer of its own
  // while it moves, by a 3D translation in whole device pixels, so nothing is painted or rastered again as it crosses
  // (drawn again each frame, a moving slide cost the hall's screen, the stream's page and LIVE most of two cores while
  // streaming); its shade inside it, on its shade box, drawn into the layer once. With a chip, under Drashti's own
  // transition set over the deck's, before it starts and once it is over: as before.
  const k = how.devicePerCanvas;
  /** Device pixels a canvas pixel while it moves a slide on a layer of its own, or null when it draws as before. */
  const whole =
    chipless && native !== undefined && !native.over && k !== undefined && k > 0 && p > 0 && p < 1 ? k : null;
  const moveOf = (f: SlideFrame | undefined): string =>
    !f ? '' : whole !== null && f.shift ? wholePixelMove(f.shift, how, whole) : f.transform;
  // Without a graphics chip, while a deck's own Wipe runs alone (X11): the outgoing slide a layer of its own that never
  // moves, so that only the incoming slide, its band's mask new each frame, is drawn again (the whole layer each frame
  // without it), and that clipped where its mask shows nothing.
  const wipeAlone = chipless && native !== undefined && !native.over ? frame?.in.band : undefined;
  const stillOut = wipeAlone !== undefined;
  set(
    els.in,
    frame ? String(frame.in.opacity) : '',
    moveOf(frame?.in),
    frame?.in.clip ?? (wipeAlone ? wipeSlideClip(wipeAlone, how.placeIn, how) : undefined),
  );
  set(
    els.out,
    frame ? String(frame.out.opacity) : '',
    stillOut ? STILL_LAYER : moveOf(frame?.out),
    frame?.out.clip,
  );
  // A deck's own transition only (13 Nov 2026): PowerPoint's Wipe band (a mask) and the shade of the slide its Cover or
  // Uncover moves (a filter). Written only when set or to clear them, so nothing else ever touches them.
  const deckOnly = (el: HTMLDivElement | null, mask = '', filter = '') => {
    if (!el) return;
    if (el.style.maskImage !== mask) el.style.maskImage = mask;
    if (el.style.filter !== filter) el.style.filter = filter;
  };
  // PowerPoint's Wipe band (Session 58): a mask on the incoming slide's box, a new one each frame, with a graphics chip
  // and without (render/chipless.ts). At rest when none.
  const slideMask = (band: WipeBand | undefined) =>
    band ? wipeSlideMask(band, how.placeIn, how) : undefined;
  const inside = (f: SlideFrame | undefined) => whole !== null && f?.shift !== undefined;
  deckOnly(els.in, frame?.in.mask ?? slideMask(frame?.in.band), inside(frame?.in) ? '' : frame?.in.filter);
  deckOnly(
    els.out,
    frame?.out.mask ?? slideMask(frame?.out.band),
    inside(frame?.out) ? '' : frame?.out.filter,
  );
  shadeInside(els.shadeIn, inside(frame?.in) ? (frame?.in.filter ?? '') : '');
  shadeInside(els.shadeOut, inside(frame?.out) ? (frame?.out.filter ?? '') : '');
  // Without a graphics chip, a slide on a layer of its own (one a move moves, or the Wipe's still outgoing slide) known
  // to draw no see-through pixel anywhere in its place (render/slide-backing.ts): backed by an opaque colour in that
  // place only, so the compositor knows the layer opaque and draws nothing under it (it drew the screen's whole picture
  // there every frame, on CI's two-core Windows); a slide in part of the screen (a 4:3 deck's, between bars) has its
  // layer made its own place, its drawing kept where it was, so the bars beside it stay as they are (Q60-6).
  const layered = p > 0 && p < 1;
  backSlide(els.in, els.shadeIn, inside(frame?.in) ? how.backingIn : undefined, how.placeIn, how, k);
  backSlide(
    els.out,
    els.shadeOut,
    inside(frame?.out) || (stillOut && layered) ? how.backingOut : undefined,
    how.placeOut,
    how,
    k,
  );
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

/**
 * A deck's own move (X11) by a 3D translation in whole device pixels, `k` device pixels a canvas pixel: its own layer,
 * drawn once at the screen's own scale and only moved (a 2D move would be painted again each frame without a chip;
 * will-change would draw it at the canvas's scale and shrink it each frame on a smaller screen). Within half a device
 * pixel of PowerPoint's move.
 */
function wholePixelMove(shift: SlideShift, how: Pick<Paint, 'width' | 'height'>, k: number): string {
  const css = shift.of === 'box' ? shift.by * (shift.axis === 'x' ? how.width : how.height) : shift.by;
  const whole = Math.round(css * k) / k;
  return shift.axis === 'x'
    ? `translate3d(${String(whole)}px, 0px, 0px)`
    : `translate3d(0px, ${String(whole)}px, 0px)`;
}

/** The shade of a deck's own Cover or Uncover inside its moving slide's layer (X11): on its shade box, or none. */
function shadeInside(box: HTMLDivElement | null | undefined, filter: string): void {
  if (box && (box.style.filter || '') !== filter) box.style.filter = filter;
}

/**
 * What backSlide last made of each slide's box (X11): '' when not backed, else its colour and the place its layer was
 * made (empty when its place is the whole screen), so a box is written only when that changes.
 */
const backed = new WeakMap<HTMLDivElement, { colour: string; place: SlidePlace | null }>();

const placeBox = (el: HTMLDivElement | null | undefined, r: SlidePlace | null): void => {
  if (!el) return;
  el.style.left = r ? `${String(r.x)}px` : '0px';
  el.style.top = r ? `${String(r.y)}px` : '0px';
  el.style.width = r ? `${String(r.width)}px` : '';
  el.style.height = r ? `${String(r.height)}px` : '';
};

/** Whether a place lands on whole device pixels, `k` a canvas pixel: its edges never part of a pixel. */
const onWholeDevicePixels = (r: SlidePlace, k: number): boolean =>
  [r.x, r.y, r.width, r.height].every((v) => Math.abs(v * k - Math.round(v * k)) < 1e-6);

/**
 * A slide's box backed by `colour` in its place `place` (X11, Q60-6), or no longer (`colour` left out). Its box is the
 * screen (inset 0, as its JSX has it) unless its place is not: then the box is made its place, and its shade box (its
 * drawing's) moved back by as much, so the slide is drawn where it was and nothing beside it is backed. Only where the
 * place lands on whole device pixels: else its edge could show part of the colour.
 */
function backSlide(
  box: HTMLDivElement | null,
  shade: HTMLDivElement | null | undefined,
  colour: string | undefined,
  place: SlidePlace,
  canvas: Pick<Paint, 'width' | 'height'>,
  k: number | undefined,
): void {
  if (!box) return;
  const on = colour !== undefined && k !== undefined && k > 0 && onWholeDevicePixels(place, k);
  const whole =
    place.x === 0 && place.y === 0 && place.width === canvas.width && place.height === canvas.height;
  const want = on ? { colour, place: whole ? null : place } : null;
  const had = backed.get(box) ?? null;
  const samePlace = (a: SlidePlace | null, b: SlidePlace | null) =>
    a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
  if (had?.colour === want?.colour && samePlace(had?.place ?? null, want?.place ?? null)) return;
  if (want) backed.set(box, want);
  else backed.delete(box);
  box.style.backgroundColor = want?.colour ?? '';
  if (want?.place) {
    placeBox(box, want.place);
    placeBox(shade, { x: -want.place.x, y: -want.place.y, width: canvas.width, height: canvas.height });
  } else if (had?.place) {
    placeBox(box, null);
    placeBox(shade, null);
  }
}

/**
 * Device pixels a canvas pixel where the slide layer `root` (the canvas's size) is drawn: its scale on the screen times
 * the pixel ratio; undefined until it has a size.
 */
function devicePerCanvas(root: HTMLElement | null, canvasWidth: number): number | undefined {
  if (!root || !(canvasWidth > 0)) return undefined;
  const shown = root.getBoundingClientRect().width;
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  return shown > 0 ? (shown / canvasWidth) * dpr : undefined;
}

/** A slide's backing as its box draws it now (X11): a picture's only once that picture is drawn in it. */
function drawnBacking(b: SlideBacking | null, box: HTMLDivElement | null): string | undefined {
  if (!b) return undefined;
  if (b.picture === undefined) return b.colour;
  const img = box?.querySelector<HTMLImageElement>(`img[data-media-id="${CSS.escape(b.picture)}"]`);
  return img?.complete && img.naturalWidth > 0 ? b.colour : undefined;
}

/** A slide's two boxes, as its JSX draws them: filling the slide's box, around what it draws. */
const SLIDE_BOX = { position: 'absolute', inset: 0 } as const;

/**
 * A deck's slide coming in by a cut, its clip not yet drawn (Session 54, C2): the slide before stays up, the new one
 * unseen, until it can be drawn. The slide before is drawn whole, as at rest: after Back during a deck's own
 * transition it is the slide that was coming in, and keeps nothing of it (its move or layer, clip, mask, shade or
 * place above; TX-1, Session 58).
 */
export function paintWaiting(els: Pick<Layers, 'in' | 'out' | 'shadeOut'>): void {
  if (els.in) els.in.style.opacity = '0';
  const before = els.out;
  if (!before) return;
  before.style.opacity = '';
  before.style.transform = '';
  before.style.clipPath = '';
  if (before.style.maskImage !== '') before.style.maskImage = '';
  if (before.style.filter !== '') before.style.filter = '';
  before.style.zIndex = '';
  shadeInside(els.shadeOut, '');
  backSlide(
    before,
    els.shadeOut,
    undefined,
    { x: 0, y: 0, width: 0, height: 0 },
    { width: 0, height: 0 },
    undefined,
  );
}

/** The pictures and videos in `root` that cannot be drawn yet, and the deck's first clip among them, if any. */
function notDrawable(
  root: HTMLElement,
  layer: SlideLayer,
  decodedPictures = false,
  ownImages = false,
): { images: HTMLImageElement[]; videos: HTMLVideoElement[]; first: HTMLVideoElement | undefined } {
  const native = nativeDeckMotion(layer.slide.deck) !== undefined;
  const images = Array.from(root.querySelectorAll('img')).filter(
    (img) => !img.complete || (decodedPictures && (ownImages || !slideImageDecoded(img))),
  );
  const all = Array.from(root.querySelectorAll('video'));
  const first = all.find((video) => video.dataset['deckFirstFrame'] !== undefined);
  const videos = all.filter((video) =>
    video === first
      ? video.dataset['deckFirstFrame'] === 'loading'
      : video.readyState < 2 &&
        video.dataset['deckVideo'] !== 'preparing' &&
        (!first || video.dataset['deckVideo'] !== 'hold') &&
        (!native || (video.dataset['deckCover'] !== 'poster' && video.dataset['deckCover'] !== 'hidden')),
  );
  return { images, videos, first };
}

/** Whether every picture and video in `root` can be drawn now (Session 58: asked before a frame is painted). */
export function slideMediaDrawable(
  root: HTMLElement,
  layer: SlideLayer,
  decodedPictures = false,
  ownImages = false,
): boolean {
  const { images, videos } = notDrawable(root, layer, decodedPictures, ownImages);
  return images.length === 0 && videos.length === 0;
}

/**
 * A decode may reject before its file has loaded. That is not permission to show the slide's colour in its place:
 * wait for the real load/error, then give a loaded picture one more native decode. The caller's original deadline
 * still wins, and abort removes the fallback listeners when that wait is over.
 */
async function prepareSlideImage(img: HTMLImageElement, signal: AbortSignal): Promise<void> {
  try {
    await decodeSlideImage(img);
  } catch {
    if (!img.complete && !signal.aborted)
      await new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        signal.addEventListener('abort', done, { once: true });
        if (img.complete || signal.aborted) done();
      });
    if (!signal.aborted && img.complete && img.naturalWidth > 0)
      await decodeSlideImage(img).catch(() => undefined);
  }
}

/**
 * Whether every picture and video in `root` can be drawn now; else a promise for when it can, or for
 * `deadline` (the engine's time) if that comes first.
 */
export function slideMediaReady(
  root: HTMLElement,
  deadline: number,
  layer: SlideLayer,
  decodedPictures = false,
  ownImages = false,
): true | Promise<void> {
  const { images, videos, first } = notDrawable(root, layer, decodedPictures, ownImages);
  if (images.length === 0 && videos.length === 0) return true;
  const stopImages = images.length > 0 ? new AbortController() : null;
  const waits: Promise<unknown>[] = stopImages
    ? images.map((img) => prepareSlideImage(img, stopImages.signal))
    : [];
  for (const video of videos)
    waits.push(
      new Promise<void>((resolve) => {
        // The clip's own notification waits for the frame at the seek position. A hold or the next click does
        // not draw while this first clip plays.
        for (const event of video === first ? [DECK_FIRST_FRAME] : ['loadeddata', 'canplay', 'error'])
          video.addEventListener(event, () => resolve(), { once: true });
      }),
    );
  return Promise.race([
    Promise.all(waits).then(() => undefined),
    new Promise<void>((resolve) =>
      // eslint-disable-next-line no-restricted-syntax -- its deadline is the engine's (3 s after the slide went up), so every screen still waiting starts at once
      setTimeout(resolve, Math.max(0, deadline - engineNow())),
    ),
  ]).finally(() => {
    stopImages?.abort();
  });
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
// Removing an outgoing layer keeps the incoming content and its props: avoid rebuilding its placed/native tree.
// Its children still respond to their own state and context updates.
const DrawnSlide = memo(function DrawnSlide({
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
  picturesFirst,
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
  picturesFirst: boolean;
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
              imageDecoding={picturesFirst ? 'sync' : undefined}
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
});

export function SlideLayerView({
  layer,
  canvas,
  scaling,
  languages = null,
  slides = 'designed',
  movement = 'calm',
  leaving = null,
  timers,
  picturesFirst = false,
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
  /**
   * The stream's page (Session 58, Q57-35): a slide is drawn only once its pictures can be drawn, the first one it
   * draws too; a slide cut in waits for them, keeping what is on screen.
   */
  picturesFirst?: boolean;
}) {
  // A screen that comes along later shows the slide as it is (no fade): the stream's page once its pictures can be drawn.
  const [showing, setShowing] = useState<Showing>(() => firstShowing(layer, engineNow(), picturesFirst));
  const [seen, setSeen] = useState(layer);
  if (seen !== layer) {
    setSeen(layer);
    setShowing((prev) => nextShowing(prev, layer, engineNow(), leaving, picturesFirst));
  }
  const { on, off, fade } = showing;
  const inRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Each slide's shade box (X11): without a graphics chip a deck's own Cover or Uncover shades its moving slide on it.
  const inShadeRef = useRef<HTMLDivElement>(null);
  const outShadeRef = useRef<HTMLDivElement>(null);
  // What each slide may be backed with while it is a layer of its own without a graphics chip (X11, Q60-6): a slide as
  // designed, known to draw no see-through pixel in its place (render/slide-backing.ts).
  const screen = useContext(ScreenPictures);
  // Whether its screen clips at the canvas's edges (x27): not one warped out of square (render/canvas-clip.ts).
  const canvasClip = useContext(CanvasClip);
  // Its slides as layers of their own, rastered once (x27): a screen warped out of square with a graphics chip.
  const ownLayers = useContext(OwnLayers);
  const backings = useMemo(() => {
    const backed = drawsWithoutChip() && slides === 'designed';
    return {
      in: on && backed ? slideBacking(on.slide, screen) : null,
      out: off && backed ? slideBacking(off.slide, screen) : null,
    };
  }, [on, off, slides, screen]);

  // Start the fade once the new slide's pictures and videos can be drawn: at shownAt if they
  // already could (every screen at the same point), else when they can.
  const waiting = fade !== null && fade.start === null;
  const native = fade?.native;
  // A cut waiting for its pictures (the stream's page and the hall's screens): the latest it waits to, and it is
  // made whole at once.
  const picturesBy = fade?.picturesBy;
  const initialPictures = fade?.initial === true;
  const onKey = on ? keyOf(on) : null;
  useEffect(() => {
    if (!waiting || !on || !inRef.current) return;
    const shownAt = on.shownAt;
    const ready = slideMediaReady(
      inRef.current,
      picturesBy ?? shownAt + MEDIA_WAIT_MS,
      on,
      picturesFirst,
      initialPictures,
    );
    const begin = (start: number) => {
      setShowing((s) =>
        s.on && keyOf(s.on) === onKey && s.fade?.start === null ? { ...s, fade: { ...s.fade, start } } : s,
      );
    };
    const whole = () => (picturesBy === undefined ? null : engineNow() - 1);
    if (ready === true) {
      begin(whole() ?? shownAt);
      return;
    }
    let live = true;
    void ready.then(() => {
      if (!live) return;
      const reveal = () => {
        begin(whole() ?? (native ? shownAt : Math.max(shownAt, engineNow())));
      };
      // A decoded picture is retained for this frame. Commit the cut while it is ready, before a deferred React
      // render can move that reveal to another frame. Prepared Next still takes the layout fast path below.
      if (picturesBy !== undefined) flushSync(reveal);
      else reveal();
    });
    return () => {
      live = false;
    };
  }, [waiting, on, onKey, native, picturesBy, picturesFirst, initialPictures]);

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
  // Where each slide is in the layer's box, as Placed puts it: a deck's own transition measures its moves and its Wipe's
  // band on the slide (Session 58).
  const placed = on ? placeContent(on.slide, canvas, scaling) : null;
  const inX = placed?.x ?? 0;
  const inY = placed?.y ?? 0;
  const inWidth = on && placed ? on.slide.width * placed.scaleX : width;
  const inHeight = on && placed ? on.slide.height * placed.scaleY : height;
  const placedOut = off ? placeContent(off.slide, canvas, scaling) : null;
  const outX = placedOut?.x ?? 0;
  const outY = placedOut?.y ?? 0;
  const outWidth = off && placedOut ? off.slide.width * placedOut.scaleX : width;
  const outHeight = off && placedOut ? off.slide.height * placedOut.scaleY : height;
  const scaleIn = (on?.slide.height ?? 1080) / 1080;
  const scaleOut = (off?.slide.height ?? 1080) / 1080;
  const blackRef = useRef<HTMLDivElement>(null);
  // The two slides' words, while a Bold move draws them apart (Session 27).
  const wordsInRef = useRef<HTMLDivElement>(null);
  const wordsOutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (start === null) return;
    let frame = 0;
    // Without a graphics chip, where a deck's own move lands on whole device pixels (X11), and each slide's backing (a
    // picture's once it is drawn): read once as it starts.
    const k =
      drawsWithoutChip() && native !== undefined && !native.over
        ? devicePerCanvas(rootRef.current, width)
        : undefined;
    const backingIn = k === undefined ? undefined : drawnBacking(backings.in, inRef.current);
    const backingOut = k === undefined ? undefined : drawnBacking(backings.out, outRef.current);
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
          shadeIn: inShadeRef.current,
          shadeOut: outShadeRef.current,
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
          placeOut: { x: outX, y: outY, width: outWidth, height: outHeight },
          ...(k === undefined ? {} : { devicePerCanvas: k }),
          ...(backingIn === undefined ? {} : { backingIn }),
          ...(backingOut === undefined ? {} : { backingOut }),
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
    backings,
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
    outX,
    outY,
    outWidth,
    outHeight,
  ]);

  // After every render, before it is painted: where the transition is now (the frames between renders set
  // it too). A deck's slide coming in by a cut (Session 54, C2) shows nothing of itself until it starts.
  const fading = fade !== null;
  useLayoutEffect(() => {
    if (kind === 'cut' && start === null && fading) {
      paintWaiting({
        in: inRef.current,
        out: outRef.current,
        shadeOut: outShadeRef.current,
      });
      return;
    }
    const k =
      fading && drawsWithoutChip() && native !== undefined && !native.over
        ? devicePerCanvas(rootRef.current, width)
        : undefined;
    const backingIn = k === undefined ? undefined : drawnBacking(backings.in, inRef.current);
    const backingOut = k === undefined ? undefined : drawnBacking(backings.out, outRef.current);
    paintLayers(
      {
        in: inRef.current,
        out: outRef.current,
        black: blackRef.current,
        wordsIn: wordsInRef.current,
        wordsOut: wordsOutRef.current,
        shadeIn: inShadeRef.current,
        shadeOut: outShadeRef.current,
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
        placeOut: { x: outX, y: outY, width: outWidth, height: outHeight },
        ...(k === undefined ? {} : { devicePerCanvas: k }),
        ...(backingIn === undefined ? {} : { backingIn }),
        ...(backingOut === undefined ? {} : { backingOut }),
      },
      start !== null ? fadeAt({ ms, start }, engineNow()) : 0,
    );
  });

  // A cut on the stream's page whose pictures can already be drawn (loaded ahead, as the hall's screens load them) is
  // made before this frame is painted, as every cut is. Its sync decoding preference keeps a loaded picture in that
  // paint too if Chromium discarded an earlier decoded copy. A cold loaded picture takes the asynchronous decode
  // wait above, keeping the previous slide moving instead of holding a whole frame while it decodes (X19 L7).
  useLayoutEffect(() => {
    if (!waiting || picturesBy === undefined || !on || !inRef.current) return;
    if (!slideMediaDrawable(inRef.current, on, picturesFirst, initialPictures)) return;
    const begin = (start: number) => {
      setShowing((s) =>
        s.on && keyOf(s.on) === onKey && s.fade?.start === null ? { ...s, fade: { ...s.fade, start } } : s,
      );
    };
    begin(engineNow() - 1);
  }, [waiting, picturesBy, on, onKey, picturesFirst, initialPictures]);

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
      // A deck's own transition (Session 57): which of PowerPoint's it draws (X15's EF-5: the warm-up's tests name it).
      data-deck-effect={fading && native ? native.deckEffect : undefined}
      // The two slides blend with each other only, then go over the background as one; a slide coming
      // in from the side stays inside the screen.
      style={{
        position: 'absolute',
        inset: 0,
        isolation: fading ? 'isolate' : undefined,
        // A screen warped out of square has none (x27: render/canvas-clip.ts); its page's black frame covers instead.
        overflow:
          canvasClip && fading && (kind === 'slide' || native?.over?.kind === 'slide') ? 'hidden' : undefined,
        // A deck's own Push, Cover or Uncover moves its slides inside the slide, as PowerPoint does: the screen past it
        // (a 4:3 deck's bars) stays as it is (Session 58, Q58-16).
        clipPath:
          (fading && native && off
            ? deckSlideClip(
                native,
                { x: inX, y: inY, width: inWidth, height: inHeight },
                { x: outX, y: outY, width: outWidth, height: outHeight },
                canvas,
              )
            : '') || undefined,
      }}
    >
      {underlay && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <DrawnSlide
            picturesFirst={picturesFirst}
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
              willChange: ownLayers ? 'opacity' : undefined,
            }}
          >
            {/* Its two boxes, as they have been since Session 58 (its Wipe's band boxes then; named for the Wipe alone
                since Q60-2, as the operator window's header band is data-band, whose rule in app.css would make them
                0 px tall): with a graphics chip they only fill its box, as ever, so the page draws exactly as before.
                Without one (X11) no band is drawn on them: the outer is the slide's shade box, where a deck's own
                Cover or Uncover shades the slide it moves, inside its layer, and which a 4:3 slide's drawing is moved
                back on when its box is made its own place (Q60-6). Always there, so a move starting or ending never
                draws the slide anew. */}
            <div ref={incoming ? inShadeRef : outShadeRef} data-wipe-band="" style={SLIDE_BOX}>
              <div data-wipe-band-slide="" style={SLIDE_BOX}>
                <Zoomed layer={l}>
                  <DrawnSlide
                    picturesFirst={picturesFirst}
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
                  picturesFirst={picturesFirst}
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
