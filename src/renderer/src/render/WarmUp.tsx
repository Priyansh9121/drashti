import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EngineState, SlideLayer } from '../../../shared/engine/state';
import { initialEngineState } from '../../../shared/engine/state';
import type { LiveGroupLook, Movement } from '../../../shared/looks';
import type { PictureLook } from '../../../shared/picture-look';
import { DEFAULT_LIVE_GROUP_LOOK, MOVEMENTS } from '../../../shared/looks';
import { mediaUrl } from '../../../shared/media';
import type { RenderSlide, TextStyle, Transition, TransitionKind } from '../../../shared/model';
import { MAX_TRANSITION_MS, TRANSITION_KINDS } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import type { ScalingMode } from '../../../shared/screens';
import { engineNow } from './clock';
import { MediaUrls } from './media-urls';
import { Scene } from './Scene';

/*
 * Warming the GPU, unseen (Session 27). A GPU makes each new kind of drawing (a "pipeline") the first time
 * it is asked for one, and every window waits meanwhile: 100-600 ms each on CI's Mac, so the first Bold push
 * of a show would stutter in the hall. Before a page first shows the show, it draws every transition kind
 * in both Movements part-way, a Look's lower third coming, changing and going, messages and the ticker's band
 * coming in, a picture with a look, the background dissolving and the idle rotation dissolving, with
 * placeholder words and pictures made here, through the same Scene the show uses, for a few frames; then it
 * lets go. The pipelines are kept by the GPU for every window after.
 *
 * It draws in a shadow tree of its own, closed, so no page script or test finds its placeholder slides,
 * tickers and lower thirds among the show's (open only when a test keeps it drawn, to look at it).
 *
 * All of it under one brightness(0) filter over black: the audience sees black throughout. Measured
 * (Session 27, a page drawing a Bold-like slide after each way of warming up, the pipelines it then made):
 * none 15; the same drawing at opacity 0, 16, or 0.001, 15 (skipped as unseen); in a window not yet shown,
 * 16 (nothing is composited until it shows); under brightness(0), 0.
 */

const W = 'drashti-warm-up';
/** The placeholder pictures' ids: a darshan-like JPEG for each slide, a prop's PNG with see-through parts. */
const PICTURE = { a: `${W}-picture-a`, b: `${W}-picture-b`, prop: `${W}-prop` } as const;

/** How far through every transition it draws: part-way, both slides on screen. */
const PART = 0.4;
/** Frames drawn of the slides before the transitions (so each starts from one), and of the transitions. */
const BEFORE_FRAMES = 2;
const DURING_FRAMES = 6;

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

/** A placeholder slide as lyrics are, with a picture and a shape: `b` the one coming in. */
function slide(id: string, b: boolean): RenderSlide {
  return {
    id: `${W}-${id}`,
    width: 1920,
    height: 1080,
    background: b ? '#1b1030' : null,
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

interface WarmScene {
  key: string;
  look: LiveGroupLook;
  /** What the engine would have up: before the change (`during` false), and once it is part-way. */
  state: (during: boolean, at: number) => EngineState;
}

const LONG_AGO = 60_000;

/** A picture with a look (zoomed, brighter, more colourful), as the Picture editor gives one. */
const LOOKED: Record<string, PictureLook> = {
  [PICTURE.b]: { zoom: 1.2, x: 0.05, y: 0, brightness: 0.1, contrast: 0.1, colour: 0.2, sharpness: 0 },
};

function scenes(): WarmScene[] {
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
  for (const movement of MOVEMENTS) {
    // Every kind that takes time, part-way: the slides, the background behind them, and on the fades the
    // rest of what comes in (a message, the ticker's band, a prop, a picture with a look).
    for (const kind of TRANSITION_KINDS.filter((k): k is Exclude<TransitionKind, 'cut'> => k !== 'cut')) {
      const all = kind === 'dissolve';
      list.push({
        key: `${kind}/${movement}`,
        look: look(movement),
        state: (during, at) => ({
          ...base,
          pictures: all && movement === 'bold' ? LOOKED : {},
          layers: {
            ...base.layers,
            background: background(during, at, during),
            slide: during
              ? layerOf(slide(`${kind}-${movement}-b`, true), at - PART * MAX_TRANSITION_MS, {
                  kind,
                  durationMs: MAX_TRANSITION_MS,
                })
              : layerOf(slide(`${kind}-${movement}-a`, false), at - LONG_AGO),
            props: all
              ? [
                  {
                    id: `${W}-prop`,
                    name: 'Placeholder prop',
                    elements: [
                      {
                        id: 'prop-picture',
                        kind: 'image',
                        mediaId: PICTURE.prop,
                        frame: { x: 60, y: 60, width: 256, height: 128 },
                        fit: 'fit',
                      },
                    ],
                    shownAt: at - LONG_AGO,
                  },
                ]
              : [],
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
  // The idle rotation part-way through a dissolve between two pictures (nothing else up).
  list.push({
    key: 'idle',
    look: look('calm', { idle: 'always' }),
    state: (_during, at) => ({
      ...base,
      idle: {
        items: [
          { kind: 'picture', mediaId: PICTURE.a },
          { kind: 'picture', mediaId: PICTURE.b },
        ],
        secondsEach: 10,
        dissolveMs: 1500,
        // 0.4 of the way through the dissolve at the end of the first item's ten seconds.
        startedAt: at - (10_000 - 1500 + PART * 1500),
      },
    }),
  });
  return list;
}

/** Each host's shadow tree: one an element (a second attachShadow is refused). */
const trees = new WeakMap<Element, ShadowRoot>();

/**
 * Draws the warm-up for a few frames, then calls `onDone` (never, when `hold`: a test looks at it). The
 * parent shows the show once it is done; nothing of the show is drawn meanwhile.
 */
export function WarmUp({
  canvas,
  scaling,
  matte = null,
  ticker = true,
  hold = false,
  onDone,
}: {
  canvas: Size;
  scaling: ScalingMode;
  matte?: 'fill' | 'key' | null;
  ticker?: boolean;
  hold?: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState<{ phase: 'pictures' | 'before' | 'during'; at: number }>({
    phase: 'pictures',
    at: 0,
  });
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
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
      [PICTURE.prop]: makePicture('png', 300),
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
      if (live) setStep({ phase: 'before', at: engineNow() });
    });
    return () => {
      live = false;
    };
  }, [pictures]);
  // Then frame by frame: the slides before for two frames, every change part-way for six, and done.
  useEffect(() => {
    if (step.phase === 'pictures') return;
    let left = step.phase === 'before' ? BEFORE_FRAMES : DURING_FRAMES;
    let frame = 0;
    const tick = () => {
      left -= 1;
      if (left > 0) frame = requestAnimationFrame(tick);
      else if (step.phase === 'before') setStep({ phase: 'during', at: engineNow() });
      else if (!hold) done.current();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [step, hold]);
  const urlOf = useCallback(
    (id: string, attempt?: number) => pictures[id] ?? mediaUrl(id, attempt),
    [pictures],
  );
  const list = useMemo(() => scenes(), []);
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
            {step.phase !== 'pictures' && (
              <MediaUrls.Provider value={urlOf}>
                {list.map((s) => (
                  // Each scene added light for light (none of it opaque to the GPU), so none hides another.
                  <div
                    key={s.key}
                    data-warm-scene={s.key}
                    style={{ position: 'absolute', inset: 0, mixBlendMode: 'plus-lighter' }}
                  >
                    <Scene
                      state={s.state(step.phase === 'during', step.at)}
                      canvas={canvas}
                      scaling={scaling}
                      look={s.look}
                      matte={matte}
                      ticker={ticker}
                    />
                  </div>
                ))}
              </MediaUrls.Provider>
            )}
          </>,
          tree,
        )}
    </div>
  );
}
