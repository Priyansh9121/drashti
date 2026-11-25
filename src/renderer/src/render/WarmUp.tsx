import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EngineState, SlideLayer } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import type { LiveGroupLook, Movement } from '../../../shared/looks';
import type { PictureLook } from '../../../shared/picture-look';
import { DEFAULT_LIVE_GROUP_LOOK, MOVEMENTS } from '../../../shared/looks';
import { mediaUrl } from '../../../shared/media';
import type { Darken, RenderSlide, TextStyle, Transition, TransitionKind } from '../../../shared/model';
import { MAX_TRANSITION_MS, TRANSITION_KINDS } from '../../../shared/model';
import { WARM_UP_MARK } from '../../../shared/perf-marks';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { animationById, animationLength, cutIntoUnits } from '../../../shared/lower-third-animations';
import {
  LOWER_THIRD_MOTIONS,
  type LowerThirdMotion,
  motionAt,
  MOTION_PERIOD_MS,
  motionPieces,
} from '../../../shared/lower-third-styles';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../../shared/lower-thirds';
import { engineNow, pauseClock } from './clock';
import { deckTransitionFrame } from './transition-frame';
import { drawBeforeFrames, framesOnTime } from './frames-on-time';
import { LowerThirdView } from './LowerThirdView';
import { MediaUrls } from './media-urls';
import { Scene } from './Scene';
import {
  OFF_GRID,
  SPLIT_MS,
  WARM_DECK_TRANSITIONS,
  warmDeckTransition,
  withShapes,
  withSplits,
} from './warm-up-deck';
import { WARM_UP_FAILS } from './warm-up-mode';
import { WarmUpBoundary } from './WarmUpBoundary';

/*
 * Warming the GPU, unseen (Session 27). A GPU makes each new kind of drawing (a "pipeline") the first time
 * it is asked for one, and every window waits meanwhile: 100-600 ms each on CI's Mac, so the first Bold push
 * of a show would stutter in the hall. Before a page first shows the show, it draws every transition kind
 * in both Movements part-way, a Look's lower third coming, changing and going, messages and the ticker's band
 * coming in, a picture with a look and the background dissolving (the idle rotation's dissolve went with it in
 * Session 55; Part 6's wallpapers that go round may bring one back), a deck's own Wipe and Cover from a slide whose
 * shapes are part-way through Splits (Session 57: masks and a shade nothing else draws, warm-up-deck.ts), with
 * placeholder words and pictures made here, through the same Scene the show uses, until its frames come on
 * time (the GPU has made what they need); then it lets go. The GPU reuses those pipelines across
 * the windows.
 *
 * It draws in a shadow tree of its own, closed, so no page script or test finds its placeholder slides,
 * tickers and lower thirds among the show's (open only when a test keeps it drawn, to look at it).
 *
 * All of it under a black layer at opacity 0.999, over black, then another outside that opacity group. The
 * compositor still draws the opaque scenes underneath. A rastered tile can round the first result to level 1
 * (CI's Mac, the repaint marker's tile); the separate final cover attenuates that result to exact black too.
 * Unlike the old outer brightness(0), this leaves a Cover's own shade on its RGBA surface, as on air (X12 wide:
 * the filter flattened that pass, leaving its antialiased, analytically clipped pipeline for the first live Cover).
 * Drawing the scenes themselves at opacity 0 or 0.001 was skipped as unseen (Session 27); a cover leaves them opaque.
 *
 * A scene that fails as it draws ends it there (Session 57, WarmUpBoundary.tsx), as one drawn to its end does: the
 * page draws the show without the rest, never black for good, and Main logs the error and reloads nothing.
 */

const W = 'drashti-warm-up';
/**
 * Every way a picture is drawn, small (the GPU's pipelines do not depend on the size): a JPEG and a PNG, each
 * filling, fitting or covering its box, at a whole and at half a pixel, whole and part see-through, plain and
 * inside a rounded box. Which of these a show's frame needs depends on its pictures and on how the GPU cuts
 * the screen into parts (CI's Mac and this one differ), so the warm-up draws them all.
 */
function PictureStrip({ jpeg, png }: { jpeg: string; png: string }) {
  const cells: ReactNode[] = [];
  let n = 0;
  for (const src of [jpeg, png])
    for (const fit of ['fill', 'contain', 'cover'] as const)
      for (const half of [0, 0.5])
        for (const opacity of [1, 0.6])
          for (const rounded of [false, true]) {
            const x = (n % 12) * 160 + half;
            const y = Math.floor(n / 12) * 100 + half;
            n += 1;
            const img = (
              <img
                src={src}
                alt=""
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: fit, opacity, display: 'block' }}
              />
            );
            cells.push(
              <div
                key={n}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: 150,
                  height: 90,
                  ...(rounded ? { overflow: 'hidden', borderRadius: 12 } : {}),
                }}
              >
                {img}
              </div>,
            );
          }
  return <>{cells}</>;
}

/** The placeholder pictures' ids: a darshan-like JPEG for each slide, a PNG with see-through parts. */
const PICTURE = { a: `${W}-picture-a`, b: `${W}-picture-b`, png: `${W}-png` } as const;

/** How far through every transition it draws: part-way, both slides on screen. */
const PART = 0.4;
/** Frames drawn of the slides before the transitions (so each starts from one). */
const BEFORE_FRAMES = 2;
/**
 * Then until the GPU keeps up: its frames on time (frames-on-time.ts: six in a row, each within 50 ms of the one before,
 * or within twice the middle of every wait so far: a slow GPU drawing all this evenly), as a GPU still making what the
 * frames need keeps them waiting (on CI's Mac for seconds); MAX_MS at most each time.
 */
const MAX_MS = 5000;
/**
 * The longest a page warms up, by this computer's clock: a window that draws no frames (covered, or on a
 * screen asleep) never comes on time, and the show must still be drawn there. A page not seen at all does
 * not warm up.
 */
const CAP_MS = 8000;
/**
 * Its last step after drawing, including normal completion: remove the scenes and draw empty black frames before
 * the parent needs their tiles. A finished GPU warm-up can still hold the old tree's tile resources as the live
 * picture starts (L8, CI 61979); frames on time say it was drawn, not that its pictures have been retired.
 * Also when it ends before its frames came on time (Session 58, h-black2, fault 2): stopped (told the page
 * draws without a graphics chip), at its cap, or by a scene that failed, once a frame of it has been drawn. It lets go
 * of its drawing (nothing but black) and waits until the page's frames come on time again, SETTLE_MS at most (by this
 * computer's clock too: a window that draws no frames still draws the show), before the show is drawn. Without a chip
 * (CI's Windows, traced) the warm-up's drawing had used up the page's tile memory, and Chromium's software compositor
 * was still drawing its frames, ~0.8 s each: the show's first frames came with their tiles missing, black, then 256-px
 * parts, for up to 3.3 s. Frames on time again: the compositor has drawn the black, and the warm-up's tiles are back.
 * There the page's own compositor went on drawing the warm-up's last frames until its black could take their place,
 * 0.3 to 3.4 s (traced): ended at 3 s, the show's first frame still came with its tiles missing; 6 s lets its frames
 * end it.
 */
const SETTLE_MS = 6000;
/** The longest a page warms up, all told: its cap, then its last step (the opening's window limit is longer). */
export const WARM_UP_LONGEST_MS = CAP_MS + SETTLE_MS;

/**
 * Each transition scene again under a clip-path with two notches, across the pictures, the background and
 * the words: a GPU that draws curves and slants with multisampling draws everything else in those parts of
 * the screen through other pipelines too (CI's Mac does: Session 27's first trace there). Any slide's frame
 * can hold such an edge (a wipe, a text shadow, a mask), so both ways are made.
 */
const NOTCHED = 'polygon(0 0, 100% 0, 100% 40%, 22% 50%, 100% 60%, 100% 100%, 0 100%, 0 32%, 78% 22%, 0 12%)';

/** A placeholder picture drawn in the page: a JPEG as a darshan picture is, or a PNG with see-through parts. */
function makePicture(kind: 'jpeg' | 'png', hue: number): string {
  const c = document.createElement('canvas');
  c.width = kind === 'jpeg' ? 1280 : 512;
  c.height = kind === 'jpeg' ? 720 : 256;
  const g = c.getContext('2d');
  if (!g) return '';
  const fill = g.createLinearGradient(0, 0, c.width, c.height);
  fill.addColorStop(0, `hsl(${String(hue)} 45% 40%)`);
  fill.addColorStop(1, `hsl(${String(hue + 60)} 45% 18%)`);
  g.fillStyle = fill;
  if (kind === 'jpeg') g.fillRect(0, 0, c.width, c.height);
  else {
    g.beginPath();
    g.ellipse(c.width / 2, c.height / 2, c.width / 2 - 8, c.height / 2 - 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL(kind === 'jpeg' ? 'image/jpeg' : 'image/png', 0.85);
}

const WORDS: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
};

/**
 * A placeholder slide as lyrics are, with a picture and a shape: `b` the one coming in; `darken` its darkening
 * behind the words (Sessions 31–36, SLD-3), so that drawing is warmed too.
 */
function slide(id: string, b: boolean, darken?: Darken): RenderSlide {
  return {
    id: `${W}-${id}`,
    width: 1920,
    height: 1080,
    background: b ? '#1b1030' : null,
    ...(darken ? { darken } : {}),
    elements: [
      {
        id: 'picture',
        kind: 'image',
        mediaId: b ? PICTURE.b : PICTURE.a,
        frame: { x: 1240, y: 80, width: 600, height: 338 },
        fit: 'fill',
      },
      {
        id: 'shape',
        kind: 'shape',
        shape: 'rectangle',
        fill: '#5a2a48cc',
        cornerRadius: 24,
        opacity: 1,
        frame: { x: 80, y: 760, width: 760, height: 200 },
        outline: { color: '#f3c46b', width: 4 },
      },
      {
        id: 'words',
        kind: 'text',
        text: b
          ? 'Placeholder words coming in\nA second placeholder line'
          : 'Placeholder words going\nAnother placeholder line',
        lang: 'en',
        style: WORDS,
        frame: { x: 96, y: 96, width: 1728, height: 888 },
      },
    ],
  };
}

const layerOf = (s: RenderSlide, shownAt: number, transition?: Transition): SlideLayer => ({
  presentationId: W,
  slideIndex: s.id.endsWith('b') ? 1 : 0,
  slide: s,
  shownAt,
  notes: '',
  ...(transition ? { transition } : {}),
});

/** The pages that warm up (WarmUp's `page`). */
export type WarmPage = 'output' | 'stream' | 'live';

export interface WarmScene {
  key: string;
  look: LiveGroupLook;
  /** What the engine would have up: before the change (`during` false), and once it is part-way. */
  state: (during: boolean, at: number) => EngineState;
  /** Drawn under this clip-path (NOTCHED). */
  clip?: string;
  /** Drawn moved by this transform (OFF_GRID: half a pixel off the grid, Session 58). */
  offset?: string;
  /** Separate canvas cells use normal blending, as the traced on-air quad does. */
  blend?: 'normal';
  /**
   * Drawn in place of a Scene of its state (Session 58: the moving backgrounds, each a small lower third), as a key
   * and fill pair's page draws (its matte).
   */
  draw?: (during: boolean, at: number, canvas: Size, matte: 'fill' | 'key' | null) => ReactNode;
  /** Only the pages that draw it (every page when not said). */
  pages?: readonly WarmPage[];
}

const LONG_AGO = 60_000;
/** The slide going out in the scene after a Zoom: shown this long before, by a Zoom this long (its slow zoom running). */
const ZOOMED_FOR_MS = 1500;
const ZOOM_IN_MS = 800;

/** A picture with a look (zoomed, brighter, more colourful), as the Picture editor gives one. */
const LOOKED: Record<string, PictureLook> = {
  [PICTURE.b]: { zoom: 1.2, x: 0.05, y: 0, brightness: 0.1, contrast: 0.1, colour: 0.2, sharpness: 0 },
};

/** The lower thirds' moves the warm-up draws (Session 44): one of each kind of drawing they ask for. */
export const WARM_LOWER_THIRDS = [
  'fade-steady',
  'slide-left-steady',
  'wipe-right-steady',
  'softwipe-up-steady',
  'open-centre-steady',
  'pop-steady',
  'grow-left-steady',
  'stretch-up-steady',
  'flip-up-steady',
  'flip-left-steady',
  'spin-steady',
  'swing-steady',
  'line-wipe-band-fade-steady',
  'line-slide-left-band-wipe-steady',
  'word-rise-band-slide-steady',
  'letter-pop-band-wipe-steady',
];

/**
 * The native Cover's shaded AA/analytic-clip pipeline, drawn with a canvas resource (X12 wide, traced). An image
 * or a filtered Scene did not make that combined kind. A generated RGBA canvas, rotated under a fixed rounded
 * clip and shaded by the Cover's own filter, does. Plain and notched companions draw both clipped and unclipped
 * quads, in separate cells so the GPU sees each without adding their light together.
 * All drawing is synchronous at mount, under the existing black cover; no clock or frame loop is added.
 */
function CoverShadeCanvas({
  analytic,
  notched,
  x,
  y,
  available,
}: {
  analytic: boolean;
  notched: boolean;
  x: number;
  y: number;
  available: Size;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const shade = deckTransitionFrame(warmDeckTransition('cover', MAX_TRANSITION_MS), PART).in.filter;
  const scale = Math.min(1, available.width / 960, available.height / 640);
  // These pieces use page pixels. A 320 x 180 clip shrunk with a fitted slide made a different quad
  // (traced at 1024 x 576: only counter-scaling made the native shaded AA/analytic-clip pipeline).
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const tree = el.getRootNode();
    if (!(tree instanceof ShadowRoot)) return;
    const host = tree.host;
    const update = () => {
      const box = host.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || host.clientWidth <= 0 || host.clientHeight <= 0) return;
      const transform = `scale(${String((scale * host.clientWidth) / box.width)}, ${String((scale * host.clientHeight) / box.height)})`;
      if (el.style.transform !== transform) el.style.transform = transform;
    };
    update();
    const resized = new ResizeObserver(update);
    resized.observe(host);
    const changed = new MutationObserver(update);
    for (let parent = host.parentElement; parent; parent = parent.parentElement)
      changed.observe(parent, { attributes: true, attributeFilter: ['style'] });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [scale]);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    const source = document.createElement('canvas');
    source.width = 320;
    source.height = 180;
    const g = source.getContext('2d');
    if (!ctx || !g) throw new Error('The graphics warm-up could not draw its picture.');
    g.fillStyle = 'rgba(80,48,112,0.7)';
    g.beginPath();
    g.ellipse(160, 90, 152, 82, 0, 0, Math.PI * 2);
    g.fill();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0);
  }, []);
  return (
    <div
      ref={grid}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 960,
        height: 640,
        transformOrigin: '0 0',
        transform: scale < 1 ? `scale(${String(scale)})` : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: 384,
          height: 256,
          clipPath: notched ? NOTCHED : undefined,
        }}
      >
        <div
          data-warm-cover-quad={analytic ? 'analytic-clip' : 'unclipped'}
          style={{
            position: 'absolute',
            left: 24.25,
            top: 24.25,
            width: 320,
            height: 180,
            background: '#1b1030',
            ...(analytic ? { overflow: 'hidden' as const, borderRadius: 2 } : {}),
          }}
        >
          <canvas
            ref={ref}
            width={320}
            height={180}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 320,
              height: 180,
              filter: shade,
              transform: 'translate(80.5px, 0.5px) rotate(7deg)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

interface NativeCoverCopy {
  box: HTMLDivElement;
  incoming: HTMLElement;
  transform: string;
  moving: boolean;
  curve: SVGSVGElement | null;
}

interface NativeCoverCopies {
  root: HTMLDivElement;
  width: number;
  height: number;
  copies: NativeCoverCopy[];
}

/** The inner rounded corner (CSS px) of the nearest box that clips `el`, or 0 where none is rounded. */
function clippingCorner(el: HTMLElement): number {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const css = getComputedStyle(at);
    if (css.overflowX === 'visible' && css.overflowY === 'visible') continue;
    const inner = parseFloat(css.borderTopLeftRadius) - parseFloat(css.borderTopWidth);
    if (inner > 0) return inner;
  }
  return 0;
}

/**
 * The LIVE picture's shaded render surfaces (X12 wide, traced on CI's Mac). A filtered picture or canvas was not
 * enough: the native JPEG and words must compose their RGBA surface outside the warm-up's opacity group, under
 * that group's black result. A transformed wide copy beside a path makes the clipped MSAA passes; the moving 4:3
 * copy makes the unclipped ones. Only generated warm-up scenes are copied, never anything from the show.
 * The existing warm-up pulse calls this; it adds no frame loop or timer and keeps nothing after the warm-up.
 */
function primeNativeCovers(
  tree: ShadowRoot,
  host: HTMLDivElement,
  root: HTMLDivElement,
  previous: NativeCoverCopies | null,
  frame: number,
): NativeCoverCopies | null {
  const bounds = host.getBoundingClientRect();
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) return null;
  const sx = width / bounds.width;
  const sy = height / bounds.height;
  // Clear of the LIVE box's rounded corners (a21): a copy drawn there showed in their antialiased edge (each layer under
  // the box's rounded clip is clipped on its own, outside the black above it). A rounded clip of their own, twice the
  // box's and 2 px more, keeps the copies rounded-clipped as the show's Cover is, and off the box's edge.
  const corner = 2 * clippingCorner(root) + 2;
  const rounded = `${String(corner * sx)}px / ${String(corner * sy)}px`;
  if (root.style.borderRadius !== rounded) root.style.borderRadius = rounded;
  let made = previous;
  if (made?.root !== root || made.width !== width || made.height !== height) {
    const keys = ['deck-cover-wide/calm/off-grid', 'deck-cover-four-three/calm/off-grid'];
    const sources = keys.map((key) => tree.querySelector<HTMLElement>(`[data-warm-scene="${key}"]`));
    // During's native layers paint from the paused clock before their first copy is taken.
    if (
      sources.some(
        (source) =>
          !source?.querySelector<HTMLElement>('[data-slide-in]')?.style.filter.startsWith('brightness('),
      )
    )
      return null;
    root.replaceChildren();
    const copies = sources.map((source, i): NativeCoverCopy => {
      if (!source) throw new Error('The graphics warm-up could not draw its picture.');
      const box = document.createElement('div');
      Object.assign(box.style, { position: 'absolute', inset: '0', visibility: 'hidden' });
      box.dataset['warmUiCover'] = i === 0 ? 'wide' : 'four-three';
      const clone = source.cloneNode(true) as HTMLElement;
      clone.style.mixBlendMode = 'normal';
      box.append(clone);
      const incoming = clone.querySelector<HTMLElement>('[data-slide-in]');
      if (!incoming) throw new Error('The graphics warm-up could not draw its picture.');
      if (i === 0) incoming.style.willChange = 'transform';
      let curve: SVGSVGElement | null = null;
      if (i === 0) {
        curve = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        curve.setAttribute('viewBox', '0 0 320 180');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 12 30 C 70 180 160 -30 308 150');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#224466');
        path.setAttribute('stroke-width', '3');
        curve.append(path);
        box.append(curve);
      }
      root.append(box);
      return { box, incoming, transform: incoming.style.transform, moving: i !== 0, curve };
    });
    made = { root, width, height, copies };
  }
  // Both surfaces are drawn, two frames at a time: one cannot hide the other's leading edge from the GPU.
  const shown = Math.floor(frame / 2) % made.copies.length;
  made.copies.forEach((copy, i) => {
    copy.box.style.visibility = i === shown ? 'visible' : 'hidden';
    if (copy.curve)
      Object.assign(copy.curve.style, {
        position: 'absolute',
        left: String(20 * sx) + 'px',
        top: String(20 * sy) + 'px',
        width: String(240 * sx) + 'px',
        height: String(135 * sy) + 'px',
      });
    if (i === shown && copy.moving) {
      copy.incoming.style.transform = copy.transform + ` translateX(${String((frame % 2) * sx)}px)`;
      copy.incoming.style.filter = frame % 2 ? 'brightness(0.986)' : 'brightness(0.985)';
    }
  });
  return made;
}

/** Every scene the warm-up draws (a unit test reads them: render/warm-up.test.ts). */
export function warmScenes(): WarmScene[] {
  const base = initialEngineState();
  const look = (movement: Movement, more: Partial<LiveGroupLook> = {}): LiveGroupLook => ({
    ...DEFAULT_LIVE_GROUP_LOOK,
    movement,
    ...more,
  });
  const background = (b: boolean, at: number, fade: boolean): EngineState['layers']['background'] => ({
    kind: 'media',
    mediaId: b ? PICTURE.b : PICTURE.a,
    media: 'image',
    fit: 'fill',
    loop: false,
    startedAt: fade ? at - PART * MAX_TRANSITION_MS : at - LONG_AGO,
    ...(fade ? { fade: { at: at - PART * MAX_TRANSITION_MS, durationMs: MAX_TRANSITION_MS } } : {}),
  });
  const list: WarmScene[] = [];
  const transitions: WarmScene[] = [];
  for (const movement of MOVEMENTS) {
    // Every kind that takes time, part-way: the slides, the background behind them, and on the fades the
    // rest of what comes in (a message, the ticker's band, a picture with a look; a prop until Session 55).
    for (const kind of TRANSITION_KINDS.filter((k): k is Exclude<TransitionKind, 'cut'> => k !== 'cut')) {
      const all = kind === 'dissolve';
      transitions.push({
        key: `${kind}/${movement}`,
        look: look(movement),
        state: (during, at) => ({
          ...base,
          pictures: all && movement === 'bold' ? LOOKED : {},
          layers: {
            ...base.layers,
            background: background(during, at, during),
            // The dissolve's slide coming in darkens the whole picture behind its words, the fade through
            // black's a band behind them.
            slide: during
              ? layerOf(
                  slide(
                    `${kind}-${movement}-b`,
                    true,
                    all
                      ? { kind: 'whole', strength: 0.6 }
                      : kind === 'fade-black'
                        ? { kind: 'band', strength: 0.6 }
                        : undefined,
                  ),
                  at - PART * MAX_TRANSITION_MS,
                  {
                    kind,
                    durationMs: MAX_TRANSITION_MS,
                  },
                )
              : layerOf(slide(`${kind}-${movement}-a`, false), at - LONG_AGO),
            messages:
              all && during ? [{ id: `${W}-message`, text: 'Placeholder message', shownAt: at - 100 }] : [],
            ticker:
              all && during
                ? {
                    items: [{ id: `${W}-ticker`, text: 'Placeholder announcement' }],
                    startedAt: at - 100,
                    shownAt: at - 100,
                  }
                : null,
          },
        }),
      });
    }
    // A Look's lower third coming in, changing as its box holds, and going (messages along the top).
    for (const phase of ['in', 'change', 'out'] as const)
      list.push({
        key: `lower-third-${phase}/${movement}`,
        look: look(movement, { slides: 'lowerThird' }),
        state: (during, at) => {
          const before =
            phase === 'in' ? null : layerOf(slide(`lt-${phase}-${movement}-a`, false), at - LONG_AGO);
          const after =
            phase === 'out'
              ? null
              : layerOf(slide(`lt-${phase}-${movement}-b`, true), at - (phase === 'in' ? 100 : 150));
          return {
            ...base,
            slideOff: during && phase === 'out' && before ? { layer: before, at: at - 90 } : null,
            layers: {
              ...base.layers,
              slide: during ? after : before,
              messages: during ? [{ id: `${W}-top`, text: 'Placeholder message', shownAt: at - 100 }] : [],
            },
          };
        },
      });
  }
  // A deck Drashti plays itself (Session 57, warm-up-deck.ts): its own Wipe (PowerPoint's band since Session 58) and
  // Cover (the slide coming in a shade darker), part-way, from its slide whose picture, shape and words are each
  // part-way through a Split (a mask the size of each), for the Cover through a Shape (Session 58: a Circle's radial
  // mask, a Box's and a Diamond's two). Once: a deck's own transitions move alike on Calm and Bold.
  for (const effect of WARM_DECK_TRANSITIONS)
    transitions.push({
      key: `deck-${effect}/calm`,
      look: look('calm'),
      state: (during, at) => ({
        ...base,
        layers: {
          ...base.layers,
          slide: during
            ? layerOf(
                slide(`deck-${effect}-b`, true),
                at - PART * MAX_TRANSITION_MS,
                warmDeckTransition(effect, MAX_TRANSITION_MS),
              )
            : layerOf(
                (effect === 'cover' ? withShapes : withSplits)(slide(`deck-${effect}-a`, false)),
                at - SPLIT_MS,
              ),
        },
      }),
    });
  // A lower third from the Lower Thirds panel (Session 44) part-way through each kind of move: fading, sliding,
  // wiping and opening (a clip), growing, flipping (a perspective) and turning, and lines, words and letters
  // each moving on a band that slides or wipes in.
  for (const id of WARM_LOWER_THIRDS)
    list.push({
      key: `lower-third-panel/${id}`,
      look: look('calm'),
      state: (during, at) => {
        const a = animationById(id);
        const lines = ['Placeholder name', 'Placeholder title'];
        const units = cutIntoUnits(lines, a).units;
        return {
          ...base,
          layers: {
            ...base.layers,
            lowerThird: during
              ? {
                  id: `${W}-lower-third-${id}`,
                  lines,
                  look: DEFAULT_LOWER_THIRD_LOOK,
                  where: 'both',
                  animation: id,
                  shownAt: at - animationLength(a, 'in', units) * PART,
                }
              : null,
          },
        };
      },
    });
  // Every moving background of the Lower Thirds studio (Session 58, Q58-18): one scene of small lower thirds, each
  // background at the moments of its loop where every piece shows, from the registry, so one added there is warmed
  // too. The hall's screens and the stream's page draw it; the LIVE picture does not (the operator's own, and the
  // opening waits for its warm-up).
  list.push({
    key: WARM_BACKGROUNDS_SCENE,
    look: look('calm'),
    state: () => base,
    draw: (during, at, canvas, matte) =>
      during ? <WarmBackgrounds at={at} canvas={canvas} matte={matte} /> : null,
    pages: ['output', 'stream'],
  });
  // A deck's own Wipe again half a pixel off the grid (Session 58, review-c2 MEDIUM-2), once: its mask drawn as an
  // anti-aliased rect, a kind of drawing of its own (warm-up-deck.ts OFF_GRID). A 4:3 deck's Cover likewise, between
  // bars, off the grid (C24, X12): its slide moved, shaded, drawn with anti-aliased edges under the bars' clip, as on
  // air (traced on CI's Mac: a pipeline of its own, its first use a frame of 184-416 ms there, 30-34 ms once warmed).
  const deckWipe = transitions.find((t) => t.key === 'deck-wipe/calm');
  const deckCover = transitions.find((t) => t.key === 'deck-cover/calm');
  const offGrid = (t: WarmScene | undefined, key: string): WarmScene[] =>
    t ? [{ ...t, key, offset: OFF_GRID }] : [];
  // The measured deck's full-slide picture and native words compose the shaded RGBA surface (X12 wide).
  // Both render-pass kinds, first: an image alone can use a YUV pipeline instead. Keep the ordinary Cover too,
  // whose outgoing Shapes warm their masks.
  const wideCover: WarmScene = {
    key: 'deck-cover-wide/calm/off-grid',
    look: look('calm'),
    offset: OFF_GRID,
    state: (during, at) => ({
      ...base,
      layers: {
        ...base.layers,
        slide: layerOf(
          fullPictureSlide(during),
          during ? at - PART * MAX_TRANSITION_MS : at - LONG_AGO,
          during ? warmDeckTransition('cover', MAX_TRANSITION_MS) : undefined,
        ),
      },
    }),
  };
  const shadeCanvas = (
    key: string,
    analytic: boolean,
    notched: boolean,
    x: number,
    y: number,
  ): WarmScene => ({
    key,
    look: look('calm'),
    blend: 'normal',
    state: () => base,
    draw: (_during, _at, canvas) => (
      <CoverShadeCanvas analytic={analytic} notched={notched} x={x} y={y} available={canvas} />
    ),
  });
  // A slide going out under its slow zoom while a slide with none comes in by the dissolve (a22-cue): the first change
  // after a Zoom. On CI's Mac the plain Performance check drew one frame over 60 ms at its first wipe 800 after the Zoom
  // runs in 306 of 308 checks (51-600 ms, median 169; a Calm slide Wipe is drawn as a dissolve), never in the streaming
  // check that follows on the same Mac, as the GPU's other first-use drawings; the Zoom scene above has its zoom only
  // coming in. Calm, as a show's screens move: the slide going out came on by a Zoom 1.5 s before, part-way through its
  // slow zoom (held still as the Zoom scene's is); the slide coming in has no colour of its own, as the measured one (a
  // see-through layer), over one background in both phases (a22-review-firstwipe S1-S4, N2-N3). The pipeline it makes:
  // the zoomed slide going out at the dissolve's opacity, added light for light (Plus), on the screen's own surface
  // (trace a22-cue-macos-15). Drawn right after the transition scenes, so before the warm-up's cap; again under the
  // notched clip, that twin last of all (QA23-FIRSTWIPE-3).
  const zoomGoingBackground = background(false, LONG_AGO, false);
  const zoomGoing: WarmScene = {
    key: 'zoom-going/calm',
    look: look('calm'),
    state: (during, at) => ({
      ...base,
      layers: {
        ...base.layers,
        background: zoomGoingBackground,
        slide: during
          ? layerOf({ ...slide('zoom-going-b', true), background: null }, at - PART * MAX_TRANSITION_MS, {
              kind: 'dissolve',
              durationMs: MAX_TRANSITION_MS,
            })
          : layerOf(slide('zoom-going-a', false), at - ZOOMED_FOR_MS, {
              kind: 'zoom',
              durationMs: ZOOM_IN_MS,
            }),
      },
    }),
  };
  return [
    shadeCanvas('cover-shaded-quad', true, false, 0, 0),
    shadeCanvas('cover-shaded-quad-notched', true, true, 480, 0),
    shadeCanvas('cover-shaded-quad-unclipped', false, false, 0, 320),
    shadeCanvas('cover-shaded-quad-unclipped-notched', false, true, 480, 320),
    wideCover,
    { ...wideCover, key: `${wideCover.key}/clipped`, clip: NOTCHED },
    ...transitions,
    // Among the transition scenes, before their notched twins: drawn last, it was never reached on CI's Mac, where the
    // hall's warm-up hit its cap making the twins' multisampled pipelines (QA23-FIRSTWIPE-3, trace a22-cue-macos-15).
    zoomGoing,
    ...transitions.map((t) => ({ ...t, key: `${t.key}/clipped`, clip: NOTCHED })),
    ...offGrid(deckWipe, 'deck-wipe/calm/off-grid'),
    ...offGrid(deckCover && fourThreeScene(deckCover), 'deck-cover-four-three/calm/off-grid'),
    ...list,
    { ...zoomGoing, key: `${zoomGoing.key}/clipped`, clip: NOTCHED },
  ];
}

/** The measured wide deck's picture and native words, generated here (X12 wide; perf-animations.ts). */
function fullPictureSlide(b: boolean): RenderSlide {
  return {
    id: `${W}-deck-cover-wide-${b ? 'b' : 'a'}`,
    width: 1920,
    height: 1080,
    background: null,
    deck: { steps: [], media: [], motion: { effects: [], stepsMs: [0], approximate: false } },
    elements: [
      {
        id: 'picture',
        kind: 'image',
        mediaId: PICTURE.b,
        fit: 'fill',
        sourceShapeId: '2',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      {
        id: 'title',
        kind: 'text',
        text: b ? 'Placeholder title coming in' : 'Placeholder title going',
        lang: 'en',
        style: { ...WORDS, shrinkToFit: true },
        sourceShapeId: '3',
        frame: { x: 160, y: 120, width: 1600, height: 200 },
      },
      {
        id: 'line',
        kind: 'text',
        text: 'A placeholder line on the slide',
        lang: 'en',
        style: { ...WORDS, fontSize: 56, shrinkToFit: true },
        sourceShapeId: '4',
        frame: { x: 160, y: 360, width: 1600, height: 140 },
      },
    ],
  };
}

/** A 4:3 deck's slide (1440 x 1080, as a deck of that shape gives), its parts placed across it as across a 16:9 one. */
function fourThree(s: RenderSlide): RenderSlide {
  const across = FOUR_THREE.width / s.width;
  return {
    ...s,
    id: `${s.id}-four-three`,
    ...FOUR_THREE,
    elements: s.elements.map((e) => ({
      ...e,
      frame: { ...e.frame, x: e.frame.x * across, width: e.frame.width * across },
    })),
  };
}

/** A 4:3 deck's slide size. */
const FOUR_THREE = { width: 1440, height: 1080 } as const;

/** A scene with its slides (before and coming in) 4:3: on a 16:9 screen, between bars (C24). */
function fourThreeScene(t: WarmScene): WarmScene {
  return {
    ...t,
    key: `${t.key}/four-three`,
    state: (during, at) => {
      const state = t.state(during, at);
      const layer = state.layers.slide;
      return layer
        ? { ...state, layers: { ...state.layers, slide: { ...layer, slide: fourThree(layer.slide) } } }
        : state;
    },
  };
}

/** The scene that draws every moving background (Session 58, Q58-18). */
export const WARM_BACKGROUNDS_SCENE = 'lower-third-backgrounds';

/** Moments of its loop the warm-up may draw a background at (parts of the way round): the first two always. */
const WARM_MOMENTS = [0.3, 0.8, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20)];

/**
 * Where in its loop the warm-up draws a background: at two moments, and at more only until every piece has shown at
 * one of them (one still to burst, or out of sight then, is drawn at another), so none is left for the show to make.
 */
function warmMomentsOf(motion: LowerThirdMotion): number[] {
  const count = motionPieces(motion, { ...DEFAULT_LOWER_THIRD_LOOK, motion }).length;
  const shown = Array.from({ length: count }, () => false);
  const moments: number[] = [];
  for (const part of WARM_MOMENTS) {
    const seen = motionAt(motion, MOTION_PERIOD_MS[motion] * part, count).map((p) => p.opacity > 0.05);
    if (moments.length >= 2 && !seen.some((s, i) => s && !shown[i])) continue;
    moments.push(part);
    for (const [i, s] of seen.entries()) if (s) shown[i] = true;
    if (moments.length >= 2 && shown.every(Boolean)) break;
  }
  return moments;
}

/**
 * The moving backgrounds the warm-up draws (Session 58, Q58-18): every one in the Lower Thirds studio's registry, each
 * at the moments of its loop where every piece of it shows.
 */
export const WARM_BACKGROUNDS: readonly { motion: LowerThirdMotion; part: number }[] =
  LOWER_THIRD_MOTIONS.filter((motion) => motion !== 'none').flatMap((motion) =>
    warmMomentsOf(motion).map((part) => ({ motion, part })),
  );

/** How many lower thirds across, how big each one's words (percent of its own picture's height), and how it came in. */
const BACKGROUNDS_ACROSS = 5;
const BACKGROUND_WORDS = 10;
const BACKGROUND_CAME_IN = 'fade-steady';

/**
 * Each a small lower third in its own fifth of the canvas, one frame at its moment as a template's thumbnail is, drawn
 * as the show draws it: its band, its words in Noto Sans (no studio font is asked for as a page starts) and its
 * moving background's pieces where they are then; on a key page white, under the key's own filter, as Scene draws one.
 * The rows overlap, each lower third clear of the next, all on the canvas (the GPU draws only what is on it).
 */
function WarmBackgrounds({ at, canvas, matte }: { at: number; canvas: Size; matte: 'fill' | 'key' | null }) {
  const size = { width: canvas.width / BACKGROUNDS_ACROSS, height: canvas.height / BACKGROUNDS_ACROSS };
  const rows = Math.ceil(WARM_BACKGROUNDS.length / BACKGROUNDS_ACROSS);
  const step = rows > 1 ? (canvas.height - size.height) / (rows - 1) : 0;
  return (
    <div
      data-matte={matte ?? undefined}
      style={{
        position: 'absolute',
        inset: 0,
        ...(matte === 'key' ? { filter: 'brightness(0) invert(1)' } : {}),
      }}
    >
      {WARM_BACKGROUNDS.map(({ motion, part }, n) => {
        // Up long enough to be still, and `part` of the way round its loop at `at`.
        const shownAt = at - MOTION_PERIOD_MS[motion] * (10 + part);
        return (
          <div
            key={`${motion}/${String(part)}`}
            style={{
              position: 'absolute',
              left: (n % BACKGROUNDS_ACROSS) * size.width,
              top: Math.floor(n / BACKGROUNDS_ACROSS) * step,
              ...size,
            }}
          >
            <LowerThirdView
              layer={{
                id: `${W}-background-${motion}`,
                lines: ['Placeholder name'],
                look: { ...DEFAULT_LOWER_THIRD_LOOK, size: BACKGROUND_WORDS, motion },
                where: 'both',
                animation: BACKGROUND_CAME_IN,
                shownAt,
              }}
              off={null}
              canvas={size}
              place="hall"
              frozenAt={at}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Each host's shadow tree: one an element (a second attachShadow is refused). */
const trees = new WeakMap<Element, ShadowRoot>();

/**
 * Tests only: an element that throws as it renders, drawn in the scene a test names as that scene comes part-way
 * (WARM_UP_FAILS, DRASHTI_TEST_WARM_UP_FAILS: a packaged Drashti never asks for it), as a bug in any scene would.
 */
function FailForTests(): never {
  throw new Error('A test asked this warm-up scene to fail as it drew');
}

/**
 * The warm-up's scenes, each through the same Scene the show uses: what is up before (`during` false), then every
 * change part-way at `at`. Made here, inside the warm-up's boundary, so a scene whose state cannot be made fails there
 * as one that cannot be drawn does.
 */
function WarmScenes({
  page,
  during,
  at,
  canvas,
  scaling,
  matte,
  ticker,
}: {
  page: WarmPage;
  during: boolean;
  at: number;
  canvas: Size;
  scaling: ScalingMode;
  matte: 'fill' | 'key' | null;
  ticker: boolean;
}) {
  const list = useMemo(() => warmScenes().filter((s) => s.pages?.includes(page) ?? true), [page]);
  return (
    <>
      {list.map((s) => (
        // Ordinary scenes add light for light. The normal-blended canvas cells occupy separate places.
        <div
          key={s.key}
          data-warm-scene={s.key}
          style={{ position: 'absolute', inset: 0, mixBlendMode: s.blend ?? 'plus-lighter' }}
        >
          <div style={{ position: 'absolute', inset: 0, clipPath: s.clip, transform: s.offset }}>
            {s.draw ? (
              s.draw(during, at, canvas, matte)
            ) : (
              <Scene
                state={s.state(during, at)}
                canvas={canvas}
                scaling={scaling}
                look={s.look}
                matte={matte}
                ticker={ticker}
              />
            )}
            {during && s.key === WARM_UP_FAILS && <FailForTests />}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * How a warm-up ended (Session 58, WU-2, for the log): it drew everything, stopped at its longest, its window was
 * hidden, a scene failed as it drew, or it was taken away before any of those (cut short).
 */
export type WarmUpEnd = 'drawn' | 'cap' | 'unseen' | 'error' | 'cut';

/** Hand the drawing's resources back before the parent draws the show, using the existing empty settling step. */
export function handOverWarmUp({
  how,
  drewFrame,
  retire,
  ready,
}: {
  how: WarmUpEnd;
  drewFrame: boolean;
  retire: (ready: () => void) => void;
  ready: () => void;
}): void {
  if (how === 'unseen' || !drewFrame) ready();
  else retire(ready);
}

/** This computer's clock for a length of time, how long a warm-up took (for the log: it times nothing drawn). */
// eslint-disable-next-line no-restricted-properties -- a length of time for the log, never a time anything is drawn at
const lengthClock = (): number => performance.now();

/**
 * Draws the warm-up for a few frames, then calls `onDone` (never, when `hold`: a test looks at it); at once when one
 * of its scenes fails as it draws (Session 57). The parent shows the show once it is done; nothing of the show is
 * drawn meanwhile. `onEnded` hears how it ended and how long it took from its start (ms), once. `stop`: the page draws
 * without a graphics chip, told after the warm-up began (Session 58, h-black2): it ends there, cut short, and calls
 * `onStopped` once its last step is over. Ended before its frames came on time (stopped, at its cap, or by a scene that
 * failed) once it has drawn anything, its last step comes first: nothing drawn until the page's frames come on time
 * again (SETTLE_MS at most), so the show's first frames never come with their tiles missing.
 */
export function WarmUp({
  page,
  canvas,
  scaling,
  matte = null,
  ticker = true,
  hold = false,
  stop = false,
  onDone,
  onEnded,
  onStopped,
}: {
  /** Which page it warms up (its marks for a trace say so). */
  page: WarmPage;
  canvas: Size;
  scaling: ScalingMode;
  matte?: 'fill' | 'key' | null;
  ticker?: boolean;
  hold?: boolean;
  stop?: boolean;
  onDone: () => void;
  onEnded?: (how: WarmUpEnd, ms: number) => void;
  onStopped?: () => void;
}) {
  const [step, setStep] = useState<{ phase: 'pictures' | 'before' | 'during' | 'settle'; at: number }>({
    phase: 'pictures',
    at: 0,
  });
  const done = useRef(onDone);
  const ended = useRef(onEnded);
  const stopped = useRef(onStopped);
  useLayoutEffect(() => {
    done.current = onDone;
    ended.current = onEnded;
    stopped.current = onStopped;
  });
  // Whether it has had a frame of its scenes drawn (read as it ends): one that never had (not drawing yet, or its window
  // covered or asleep, drawing no frames) has nothing to let go of.
  const drewFrame = useRef(false);
  // What follows its last step: the parent told it is done, or that it has stopped.
  const afterSettle = useRef<() => void>(() => undefined);
  // When it began, for how long it took (Session 58, WU-2: the log's).
  const began = useRef(lengthClock());
  // Done once, however it ends: drawn, at its cap, not seen, or a scene that failed as it drew (Session 57); marked
  // for a trace (`-cut` when it is taken away before then: the LIVE picture, as something goes up).
  const mark = `${WARM_UP_MARK}:${page}`;
  const finished = useRef(false);
  const finish = useCallback(
    (how: 'drawn' | 'cap' | 'unseen' | 'error' | 'cut') => {
      // A test's held warm-up ends only when stopped (DRASHTI_TEST_GPU_SAID=late: until told).
      if (finished.current || (hold && how !== 'cut')) return;
      finished.current = true;
      pauseClock(null);
      if (how !== 'drawn') performance.mark(`${mark}-${how}`);
      // Cut short: marked as when it is taken away (no end of its own).
      if (how !== 'cut') performance.mark(`${mark}-end`);
      ended.current?.(how, lengthClock() - began.current);
      const then = how === 'cut' ? () => stopped.current?.() : () => done.current();
      // Retire a drawn scene before the parent needs its tiles: on-time frames do not release the old tree.
      handOverWarmUp({
        how,
        drewFrame: drewFrame.current,
        ready: then,
        retire: (ready) => {
          afterSettle.current = ready;
          setStep((s) => ({ phase: 'settle', at: s.at }));
        },
      });
    },
    [hold, mark],
  );
  // Told the page draws without a graphics chip (Session 58, h-black2): it ends here.
  useEffect(() => {
    if (stop) finish('cut');
  }, [stop, finish]);
  useEffect(() => {
    const unseen = () => {
      if (document.visibilityState === 'hidden') finish('unseen');
    };
    unseen();
    document.addEventListener('visibilitychange', unseen);
    // eslint-disable-next-line no-restricted-syntax -- the warm-up's cap (a window that draws no frames): never a frame of the show
    const cap = setTimeout(() => {
      finish('cap');
    }, CAP_MS);
    // When it began (set once, as it was made), for how long it ran if it is cut short.
    const from = began.current;
    return () => {
      document.removeEventListener('visibilitychange', unseen);
      clearTimeout(cap);
      if (!finished.current) {
        performance.mark(`${mark}-cut`);
        ended.current?.('cut', lengthClock() - from);
      }
    };
  }, [finish, mark]);
  const [tree, setTree] = useState<ShadowRoot | null>(null);
  const canvasHost = useRef<HTMLDivElement | null>(null);
  const [uiParent, setUiParent] = useState<HTMLElement | null>(null);
  const uiDrawing = useRef<HTMLDivElement | null>(null);
  const uiCopies = useRef<NativeCoverCopies | null>(null);
  useLayoutEffect(() => {
    uiCopies.current = null;
    return () => {
      uiCopies.current = null;
    };
  }, [tree, step.phase, canvas.width, canvas.height]);
  const host = useCallback(
    (el: HTMLDivElement | null) => {
      canvasHost.current = el;
      if (!el) return;
      const made = trees.get(el) ?? el.attachShadow({ mode: hold ? 'open' : 'closed' });
      trees.set(el, made);
      setTree(made);
      if (page === 'live') setUiParent(el.parentElement);
    },
    [hold, page],
  );
  const pictures = useMemo<Record<string, string>>(
    () => ({
      [PICTURE.a]: makePicture('jpeg', 30),
      [PICTURE.b]: makePicture('jpeg', 210),
      [PICTURE.png]: makePicture('png', 300),
    }),
    [],
  );
  // The placeholder pictures decoded first, so every frame below draws them.
  useEffect(() => {
    let live = true;
    const images = Object.values(pictures).map((src) => {
      const img = new Image();
      img.src = src;
      return img;
    });
    void Promise.all(images.map((img) => img.decode().catch(() => undefined))).then(() => {
      if (!live || finished.current) return;
      // For a trace (the Performance check's): what the GPU made while it warmed up.
      performance.mark(mark);
      setStep({ phase: 'before', at: engineNow() });
    });
    return () => {
      live = false;
    };
  }, [pictures, mark]);
  // Then frame by frame: the slides before for two frames; then every change part-way, the page's clock
  // paused so the GPU draws it all once (not again at every frame), until the frames come on time; again once
  // every picture in it is decoded where the screen draws it; again a moment on (what is drawn again in part);
  // then done.
  const pulse = useRef<HTMLDivElement>(null);
  // The LIVE box's rounded corners (a21): an opaque black square over the drawing at each, twice the box's inner corner
  // and 2 px more, so the group's black there is exact. Over the drawing, the translucent cover's black rounded to a
  // level now and then (see above), and the box's antialiased corners showed it in some frames on CI's Mac
  // (warm-up.spec:428's flaky level or two); the black reference, with no drawing, never did.
  const [cornerSquare, setCornerSquare] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = canvasHost.current;
    if (page !== 'live' || !el) return;
    const fit = () => {
      const bounds = el.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const side = 2 * clippingCorner(el) + 2;
      const width = (side * el.offsetWidth) / bounds.width;
      const height = (side * el.offsetHeight) / bounds.height;
      setCornerSquare((was) => (was?.width === width && was.height === height ? was : { width, height }));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [page, tree]);
  useEffect(() => {
    // Nothing more once it has ended (but its last step): a scene that failed as its step was drawn (Session 57) ends
    // it before this step's frames would begin, so the clock it let go stays free for the show.
    if (step.phase === 'pictures' || (finished.current && step.phase !== 'settle')) return;
    let frame = 0;
    // False once this step is left (read through a function: the checker cannot follow the cleanup).
    const run = { live: true };
    const live = () => run.live;
    // Finish is synchronous; passive cleanup may follow a queued frame or decode continuation.
    const warming = () => live() && !finished.current;
    const keep = (request: number) => {
      frame = request;
    };
    /** Each frame a new one for the GPU (a speck moves), which waits for the one before it to be drawn. */
    const each = (n: number) => {
      drewFrame.current = true;
      if (pulse.current) pulse.current.style.transform = `translateX(${String(n % 2)}px)`;
      const drawing = uiDrawing.current;
      const host = canvasHost.current;
      if (page === 'live' && step.phase === 'during' && tree && drawing && host) {
        try {
          uiCopies.current = primeNativeCovers(tree, host, drawing, uiCopies.current, n);
        } catch {
          finish('error');
        }
      }
    };
    let settleCap: ReturnType<typeof setTimeout> | undefined;
    if (step.phase === 'settle') {
      // Its last step (Session 58, h-black2): nothing drawn but black until the frames come on time again; the clock
      // is the show's already (let go as it ended), and nothing here reads it. SETTLE_MS at most by this computer's
      // clock too: a window that stops drawing frames (covered, or on a screen asleep) still draws the show.
      let over = false;
      const end = () => {
        if (over || !live()) return;
        over = true;
        afterSettle.current();
      };
      // eslint-disable-next-line no-restricted-syntax -- the last step's cap (a window that draws no frames): never a frame of the show
      settleCap = setTimeout(end, SETTLE_MS);
      void framesOnTime({ maxMs: SETTLE_MS, each, live, keep }).then(end);
    } else if (step.phase === 'before') {
      drawBeforeFrames({
        count: BEFORE_FRAMES,
        each: () => {
          drewFrame.current = true;
        },
        live: warming,
        keep,
        ready: () => {
          setStep({ phase: 'during', at: engineNow() });
        },
        // Tests only: a frame already queued by the browser can be delivered after the cut. A packaged page never holds.
        ...(hold
          ? {
              frame: (tick: FrameRequestCallback) => {
                const request = new CustomEvent('drashti-test-warm-up-before-frame', {
                  bubbles: true,
                  cancelable: true,
                  detail: { tick, drew: drewFrame.current },
                });
                if (canvasHost.current?.dispatchEvent(request) === false) return 0;
                return requestAnimationFrame(tick);
              },
            }
          : {}),
      });
    } else {
      /**
       * Frames until they come on time (or MAX_MS): on time, all of it has been drawn (frames-on-time.ts).
       */
      const steadyFrames = () => framesOnTime({ maxMs: MAX_MS, each, live: warming, keep });
      void (async () => {
        pauseClock(step.at);
        await steadyFrames();
        if (!warming()) return;
        // The screen's compositor decodes a big picture on its own after its first frames, drawing nothing of
        // it until then (Session 27: the pictures' pipelines came after the warm-up, measured); a picture's
        // decode() is the compositor's, so once they are all done its frames draw every one.
        const drawn = [
          ...(tree?.querySelectorAll('img') ?? []),
          ...(uiDrawing.current?.querySelectorAll('img') ?? []),
        ];
        await Promise.all(drawn.map((img) => img.decode().catch(() => undefined)));
        if (!warming()) return;
        await steadyFrames();
        if (!warming()) return;
        // A moment on: every change drawn again in part, as a show's next frame is.
        pauseClock(step.at + 50);
        await steadyFrames();
        if (warming()) finish(page === 'live' && uiParent && !uiCopies.current ? 'error' : 'drawn');
      })();
    }
    return () => {
      run.live = false;
      cancelAnimationFrame(frame);
      clearTimeout(settleCap);
      pauseClock(null);
    };
  }, [step, tree, finish, page, uiParent, hold]);
  const urlOf = useCallback(
    (id: string, attempt?: number) => pictures[id] ?? mediaUrl(id, attempt),
    [pictures],
  );
  // A scene that failed as it drew (WarmUpBoundary): the warm-up ends there, and the page draws the show.
  const failed = useCallback(() => {
    finish('error');
  }, [finish]);
  return (
    <>
      <div
        ref={host}
        data-warm-up={step.phase}
        aria-hidden="true"
        // The drawing stays opaque to the GPU; the last black layer hides it (see above).
        style={{
          position: 'absolute',
          inset: 0,
          isolation: 'isolate',
          // The native UI copies are siblings below this black result, outside its opacity group.
          zIndex: 1,
          // One surface before the page's clip: separately clipped drawing/cover edges leave a light rim.
          opacity: 0.999,
          pointerEvents: 'none',
        }}
      >
        {tree &&
          createPortal(
            <>
              <div style={{ position: 'absolute', inset: 0, background: '#000000' }} />
              {step.phase !== 'pictures' && step.phase !== 'settle' && (
                // Everything it draws, its scenes made inside: one that fails ends the warm-up (Session 57).
                <WarmUpBoundary onError={failed}>
                  {/* Contain every scene's layer below the cover: the old filter used to supply this boundary. */}
                  <div
                    data-warm-drawing=""
                    style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: canvas.width,
                        height: canvas.height,
                      }}
                    >
                      <PictureStrip jpeg={pictures[PICTURE.b] ?? ''} png={pictures[PICTURE.png] ?? ''} />
                    </div>
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: canvas.width,
                        height: canvas.height,
                        clipPath: NOTCHED,
                      }}
                    >
                      <PictureStrip jpeg={pictures[PICTURE.a] ?? ''} png={pictures[PICTURE.png] ?? ''} />
                    </div>
                    <MediaUrls.Provider value={urlOf}>
                      <WarmScenes
                        page={page}
                        during={step.phase === 'during'}
                        at={step.at}
                        canvas={canvas}
                        scaling={scaling}
                        matte={matte}
                        ticker={ticker}
                      />
                    </MediaUrls.Provider>
                  </div>
                </WarmUpBoundary>
              )}
              {cornerSquare &&
                (['left', 'right'] as const).flatMap((x) =>
                  (['top', 'bottom'] as const).map((y) => (
                    <div
                      key={`${x}-${y}`}
                      data-warm-corner=""
                      style={{
                        position: 'absolute',
                        [x]: 0,
                        [y]: 0,
                        width: cornerSquare.width,
                        height: cornerSquare.height,
                        background: '#000000',
                        zIndex: 0,
                      }}
                    />
                  )),
                )}
              {/* Above the drawing, so a moved speck still asks for a frame; below the translucent black cover. */}
              <div
                ref={pulse}
                data-warm-pulse=""
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 2,
                  height: 2,
                  background: '#000000',
                  zIndex: 1,
                }}
              />
              <div
                data-warm-cover=""
                // Beyond the drawing's clip: coincident, antialiased edges otherwise leave a light rim when scaled.
                style={{
                  position: 'absolute',
                  inset: '-1%',
                  background: '#000000',
                  opacity: 0.999,
                  zIndex: 2,
                }}
              />
            </>,
            tree,
          )}
      </div>
      {/* Compose this cover after the group's result: two covers within that group still leak on CI's Mac. */}
      <div
        data-warm-final-cover=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: '-1%',
          background: '#000000',
          opacity: 0.999,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
      {page === 'live' &&
        uiParent &&
        step.phase === 'during' &&
        createPortal(
          <div
            key={`${String(canvas.width)}x${String(canvas.height)}`}
            ref={uiDrawing}
            data-warm-ui-drawing=""
            aria-hidden="true"
            inert
            style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}
          />,
          uiParent,
        )}
    </>
  );
}
