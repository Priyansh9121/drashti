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
 * time (the GPU has made what they need); then it lets go. The pipelines are kept by the GPU for every
 * window after.
 *
 * It draws in a shadow tree of its own, closed, so no page script or test finds its placeholder slides,
 * tickers and lower thirds among the show's (open only when a test keeps it drawn, to look at it).
 *
 * All of it under one brightness(0) filter over black: the audience sees black throughout. Measured
 * (Session 27, a page drawing a Bold-like slide after each way of warming up, the pipelines it then made):
 * none 15; the same drawing at opacity 0, 16, or 0.001, 15 (skipped as unseen); in a window not yet shown,
 * 16 (nothing is composited until it shows); under brightness(0), 0.
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
/** The same Cover pace used on the hall screen by the performance check. */
const COVER_MS = 700;
/** Start the isolated Cover just before the first pixels of the incoming slide appear. */
const COVER_START = 0.1;
/**
 * Then until the GPU keeps up: this many frames in a row, each within ON_TIME_MS of the one before, or within
 * twice the middle of every wait so far (a slow GPU drawing all this evenly), as a GPU still making what the
 * frames need keeps them waiting (on CI's Mac for seconds); MAX_MS at most each time.
 */
const STEADY_FRAMES = 6;
const ON_TIME_MS = 50;
const MAX_MS = 5000;
/**
 * The longest a page warms up, by this computer's clock: a window that draws no frames (covered, or on a
 * screen asleep) never comes on time, and the show must still be drawn there. A page not seen at all does
 * not warm up.
 */
const CAP_MS = 8000;

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
  /** Drawn alone before the other scenes, through the same compositing path as the show's wide Cover. */
  pass?: 'cover';
  /**
   * Drawn in place of a Scene of its state (Session 58: the moving backgrounds, each a small lower third), as a key
   * and fill pair's page draws (its matte).
   */
  draw?: (during: boolean, at: number, canvas: Size, matte: 'fill' | 'key' | null) => ReactNode;
  /** Only the pages that draw it (every page when not said). */
  pages?: readonly WarmPage[];
}

const LONG_AGO = 60_000;

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
  // anti-aliased rect, a kind of drawing of its own (warm-up-deck.ts OFF_GRID). Its Cover likewise (C24): the slide it
  // moves, shaded, drawn with anti-aliased edges as on air, where it moves between pixels; and a 4:3 deck's Cover
  // between bars, off the grid, its slides drawn under the bars' clip (traced on CI's Mac: each a pipeline of its own).
  const deckWipe = transitions.find((t) => t.key === 'deck-wipe/calm');
  const deckCover = transitions.find((t) => t.key === 'deck-cover/calm');
  const offGrid = (t: WarmScene | undefined, key: string): WarmScene[] =>
    t ? [{ ...t, key, offset: OFF_GRID }] : [];
  return [
    // The wide Cover as it goes on air, by itself before the other scenes can take the warm-up's frame budget.
    {
      key: 'deck-cover-full-picture',
      pass: 'cover',
      look: look('calm'),
      state: (during, at) => ({
        ...base,
        layers: {
          ...base.layers,
          slide: layerOf(
            fullPictureSlide(during),
            during ? at - COVER_START * COVER_MS : at - LONG_AGO,
            during ? warmDeckTransition('cover', COVER_MS) : undefined,
          ),
        },
      }),
    },
    ...transitions,
    ...transitions.map((t) => ({ ...t, key: `${t.key}/clipped`, clip: NOTCHED })),
    ...offGrid(deckWipe, 'deck-wipe/calm/off-grid'),
    ...offGrid(deckCover, 'deck-cover/calm/off-grid'),
    ...offGrid(deckCover && fourThreeScene(deckCover), 'deck-cover-four-three/calm/off-grid'),
    ...list,
  ];
}

/** The two native slides in the wide Cover. The same full-bleed JPEG sits under a title and a line on each. */
function fullPictureSlide(during: boolean): RenderSlide {
  const width = 1920;
  const height = 1080;
  return {
    id: `${W}-cover-full-${during ? 'b' : 'a'}`,
    width,
    height,
    background: null,
    deck: { steps: [], media: [], motion: { effects: [], stepsMs: [0], approximate: false } },
    elements: [
      {
        id: 'picture',
        kind: 'image',
        mediaId: PICTURE.b,
        fit: 'fill',
        sourceShapeId: '2',
        frame: { x: 0, y: 0, width, height },
      },
      {
        id: 'title',
        kind: 'text',
        text: during ? 'Placeholder title coming in' : 'Placeholder title going',
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
  cover,
  during,
  at,
  canvas,
  scaling,
  matte,
  ticker,
}: {
  page: WarmPage;
  cover: boolean;
  during: boolean;
  at: number;
  canvas: Size;
  scaling: ScalingMode;
  matte: 'fill' | 'key' | null;
  ticker: boolean;
}) {
  const list = useMemo(
    () => warmScenes().filter((s) => (s.pass === 'cover') === cover && (s.pages?.includes(page) ?? true)),
    [cover, page],
  );
  return (
    <>
      {list.map((s) => (
        // The regular scenes add together light for light so none hides another. The wide Cover is drawn alone.
        <div
          key={s.key}
          data-warm-scene={s.key}
          style={{ position: 'absolute', inset: 0, mixBlendMode: cover ? undefined : 'plus-lighter' }}
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

/** This computer's clock for a length of time, how long a warm-up took (for the log: it times nothing drawn). */
// eslint-disable-next-line no-restricted-properties -- a length of time for the log, never a time anything is drawn at
const lengthClock = (): number => performance.now();

/**
 * Draws the warm-up for a few frames, then calls `onDone` (never, when `hold`: a test looks at it); at once when one
 * of its scenes fails as it draws (Session 57). The parent shows the show once it is done; nothing of the show is
 * drawn meanwhile. `onEnded` hears how it ended and how long it took from its start (ms), once.
 */
export function WarmUp({
  page,
  canvas,
  scaling,
  matte = null,
  ticker = true,
  hold = false,
  onDone,
  onEnded,
}: {
  /** Which page it warms up (its marks for a trace say so). */
  page: WarmPage;
  canvas: Size;
  scaling: ScalingMode;
  matte?: 'fill' | 'key' | null;
  ticker?: boolean;
  hold?: boolean;
  onDone: () => void;
  onEnded?: (how: WarmUpEnd, ms: number) => void;
}) {
  const [step, setStep] = useState<{
    phase: 'pictures' | 'cover-before' | 'cover' | 'before' | 'during';
    at: number;
  }>({
    phase: 'pictures',
    at: 0,
  });
  const done = useRef(onDone);
  const ended = useRef(onEnded);
  useLayoutEffect(() => {
    done.current = onDone;
    ended.current = onEnded;
  });
  // When it began, for how long it took (Session 58, WU-2: the log's).
  const began = useRef(lengthClock());
  // Done once, however it ends: drawn, at its cap, not seen, or a scene that failed as it drew (Session 57); marked
  // for a trace (`-cut` when it is taken away before then: the LIVE picture, as something goes up).
  const mark = `${WARM_UP_MARK}:${page}`;
  const finished = useRef(false);
  const finish = useCallback(
    (how: 'drawn' | 'cap' | 'unseen' | 'error') => {
      if (finished.current || hold) return;
      finished.current = true;
      pauseClock(null);
      if (how !== 'drawn') performance.mark(`${mark}-${how}`);
      performance.mark(`${mark}-end`);
      ended.current?.(how, lengthClock() - began.current);
      done.current();
    },
    [hold, mark],
  );
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
  const host = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const made = trees.get(el) ?? el.attachShadow({ mode: hold ? 'open' : 'closed' });
      trees.set(el, made);
      setTree(made);
    },
    [hold],
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
      if (!live) return;
      // For a trace (the Performance check's): what the GPU made while it warmed up.
      performance.mark(mark);
      setStep({ phase: hold ? 'before' : 'cover-before', at: engineNow() });
    });
    return () => {
      live = false;
    };
  }, [pictures, mark, hold]);
  // Then frame by frame: the slides before for two frames; then every change part-way, the page's clock
  // paused so the GPU draws it all once (not again at every frame), until the frames come on time; again once
  // every picture in it is decoded where the screen draws it; again a moment on (what is drawn again in part);
  // then done.
  const pulse = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Nothing more once it has ended: a scene that failed as its step was drawn (Session 57) ends it before this
    // step's frames would begin, so the clock it let go stays free for the show.
    if (step.phase === 'pictures' || finished.current) return;
    let frame = 0;
    // False once this step is left (read through a function: the checker cannot follow the cleanup).
    const run = { live: true };
    const live = () => run.live;
    if (step.phase === 'cover' || step.phase === 'cover-before' || step.phase === 'before') {
      const next = { 'cover-before': 'cover', cover: 'before', before: 'during' } as const;
      const phase = step.phase;
      const coverMark = `drashti-deck-cover-warm-up:${page}`;
      if (phase === 'cover') performance.mark(coverMark);
      let left = BEFORE_FRAMES;
      const tick = () => {
        left -= 1;
        // The wide Cover advances on the engine clock while the regular scenes use held frames.
        if (phase === 'cover' ? engineNow() < step.at + COVER_MS * (1 - COVER_START) : left > 0) {
          frame = requestAnimationFrame(tick);
        } else {
          if (phase === 'cover') performance.mark(`${coverMark}-end`);
          setStep({ phase: next[phase], at: engineNow() });
        }
      };
      frame = requestAnimationFrame(tick);
    } else {
      /**
       * Frames until they come on time (or MAX_MS). A speck moves at each one, so every frame is a new one
       * for the GPU, which waits for the one before it to be drawn: on time, all of it has been.
       */
      const steadyFrames = () =>
        new Promise<void>((resolve) => {
          let steady = 0;
          let last: number | null = null;
          let first: number | null = null;
          const gaps: number[] = [];
          const tick = (t: number) => {
            if (!live()) return;
            first ??= t;
            if (pulse.current) pulse.current.style.transform = `translateX(${String(gaps.length % 2)}px)`;
            if (last !== null) {
              const gap = t - last;
              gaps.push(gap);
              // The middle wait only once there are enough to say how this GPU draws it (the first wait longest).
              const middle =
                gaps.length >= 10 ? ([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0) : 0;
              steady = gap <= Math.max(ON_TIME_MS, 2 * middle) ? steady + 1 : 0;
            }
            last = t;
            if (steady < STEADY_FRAMES && t - first < MAX_MS) frame = requestAnimationFrame(tick);
            else resolve();
          };
          frame = requestAnimationFrame(tick);
        });
      void (async () => {
        pauseClock(step.at);
        await steadyFrames();
        // The screen's compositor decodes a big picture on its own after its first frames, drawing nothing of
        // it until then (Session 27: the pictures' pipelines came after the warm-up, measured); a picture's
        // decode() is the compositor's, so once they are all done its frames draw every one.
        const drawn = [...(tree?.querySelectorAll('img') ?? [])];
        await Promise.all(drawn.map((img) => img.decode().catch(() => undefined)));
        if (!live()) return;
        await steadyFrames();
        // A moment on: every change drawn again in part, as a show's next frame is.
        pauseClock(step.at + 50);
        await steadyFrames();
        if (live()) finish('drawn');
      })();
    }
    return () => {
      run.live = false;
      cancelAnimationFrame(frame);
      pauseClock(null);
    };
  }, [step, tree, finish, page]);
  const urlOf = useCallback(
    (id: string, attempt?: number) => pictures[id] ?? mediaUrl(id, attempt),
    [pictures],
  );
  // A scene that failed as it drew (WarmUpBoundary): the warm-up ends there, and the page draws the show.
  const failed = useCallback(() => {
    finish('error');
  }, [finish]);
  const cover = step.phase === 'cover-before' || step.phase === 'cover';
  return (
    <div
      ref={host}
      data-warm-up={step.phase}
      aria-hidden="true"
      // Black throughout: every colour to black, over black (see above).
      style={{
        position: 'absolute',
        inset: 0,
        filter: 'brightness(0)',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {tree &&
        createPortal(
          <>
            <div style={{ position: 'absolute', inset: 0, background: '#000000' }} />
            <div
              ref={pulse}
              style={{ position: 'absolute', left: 0, top: 0, width: 2, height: 2, background: '#000000' }}
            />
            {step.phase !== 'pictures' && (
              // Everything it draws, its scenes made inside: one that fails ends the warm-up (Session 57).
              <WarmUpBoundary onError={failed}>
                {!cover && (
                  <>
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
                  </>
                )}
                <MediaUrls.Provider value={urlOf}>
                  <WarmScenes
                    page={page}
                    cover={cover}
                    during={step.phase === 'during' || step.phase === 'cover'}
                    at={step.at}
                    canvas={canvas}
                    scaling={scaling}
                    matte={matte}
                    ticker={ticker}
                  />
                </MediaUrls.Provider>
              </WarmUpBoundary>
            )}
          </>,
          tree,
        )}
    </div>
  );
}
