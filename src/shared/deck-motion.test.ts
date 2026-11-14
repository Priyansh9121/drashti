import { describe, expect, it } from 'vitest';
import { type DeckEffect, stepCount } from './deck';
import {
  builtParagraphEffects,
  deckMotionFrame,
  deckParagraphRuns,
  deckShapeShows,
  deckWipeClip,
  deckWipeInnerMask,
  deckWipeMask,
  smoothedProgress,
} from './deck-motion';
import { deckFromJson, deckMediaIds, deckToJson, mapDeckMedia } from './deck-schema';
import { deckPictureId, deckPictures, deckSlideAt, nativeStepTiming, stepOf } from './deck-show';
import type { Rect, RenderSlide, TextElement } from './model';

const effect = {
  shapeId: '7',
  step: 1,
  phase: 'in' as const,
  kind: 'fade' as const,
  delayMs: 75,
  durationMs: 225,
};

const motion = {
  effects: [effect, { ...effect, step: 2, phase: 'out' as const }],
  stepsMs: [0, 300, 300],
  approximate: false,
};

const deck = { steps: [], media: [], motion };
const card = { sourceShapeId: '7' };
const slide: RenderSlide = {
  id: 'placeholder-slide',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    {
      id: 'placeholder-card',
      ...card,
      kind: 'image',
      frame: { x: 100, y: 100, width: 600, height: 400 },
      mediaId: 'placeholder-image',
      fit: 'fit',
    },
  ],
  deck,
};

describe('a deck whose editable shapes play each click', () => {
  it('counts click groups with no baked clips and clamps the active step', () => {
    expect(stepCount(deck)).toBe(3);
    expect(stepOf({ slide, step: 50 })).toBe(2);
  });

  it('shows only shapes visible at the end of the selected click in a still preview', () => {
    expect(deckPictureId(slide)).toBeNull();
    expect(deckSlideAt(slide, 0).elements).toEqual([]);
    expect(deckSlideAt(slide, 1).elements).toEqual(slide.elements);
    expect(deckSlideAt(slide, 2).elements).toEqual([]);
  });

  it('keeps an existing baked slide and its stills even when motion for editing is available', () => {
    const baked = {
      ...slide,
      deck: { ...deck, steps: [{ clipId: 'placeholder-clip', clipMs: 500, lastId: 'placeholder-still' }] },
    };
    expect(stepCount(baked.deck)).toBe(1);
    expect(deckPictureId(baked)).toBe('placeholder-card');
    expect(deckSlideAt(baked, 0).elements[0]).toMatchObject({ mediaId: 'placeholder-still' });
  });

  it('round-trips native motion and rejects an invalid step reference', () => {
    expect(deckFromJson(deckToJson(deck))).toEqual(deck);
    const invalid = { ...deck, motion: { ...motion, effects: [{ ...effect, step: 7 }] } };
    expect(deckFromJson(deckToJson(invalid))).toBeNull();
  });

  it('round-trips Basic Zoom’s far end as PowerPoint’s own formulas, and nothing else in their place', () => {
    const out = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
    const zoomAway = { w: `${out}#ppt_w`, h: `${out}#ppt_h`, x: '0.5', y: `1+${out}#ppt_h/2` };
    const zoom = {
      ...deck,
      motion: { ...motion, effects: [{ ...effect, kind: 'zoom' as const, zoomAway }] },
    };
    expect(deckFromJson(deckToJson(zoom))).toEqual(zoom);
    for (const bad of ['', '<script>', '#ppt_w;1', 'x'.repeat(201)]) {
      const stored = {
        ...zoom,
        motion: { ...motion, effects: [{ ...effect, zoomAway: { ...zoomAway, w: bad } }] },
      };
      expect(deckFromJson(deckToJson(stored)), bad).toBeNull();
    }
  });
});

describe('PowerPoint effects from the engine step clock', () => {
  const bounds = { x: 100, y: 100, width: 600, height: 400 };
  const at = (step: number, elapsedMs: number, effects: readonly DeckEffect[] = motion.effects) =>
    deckMotionFrame(effects, step, elapsedMs, bounds, slide);

  it('waits for the precise delay, finishes each effect, and settles prior groups on a quick Next', () => {
    expect(at(0, Infinity)).toMatchObject({ opacity: 0, moving: false, nextAt: null });
    expect(at(1, 74)).toMatchObject({ opacity: 0, moving: false, nextAt: 75 });
    expect(at(1, 75)).toMatchObject({ opacity: 0, moving: true });
    expect(at(1, 187.5).opacity).toBe(0.5);
    expect(at(1, 300)).toMatchObject({ opacity: 1, moving: false });
    expect(at(2, 0)).toMatchObject({ opacity: 1, moving: false, nextAt: 75 });
    expect(at(2, 187.5).opacity).toBe(0.5);
    expect(at(2, 300)).toMatchObject({ opacity: 0, moving: false });
  });

  it('applies an instantaneous effect at its timestamp, with the step clock independent of slide entry', () => {
    const appear: DeckEffect = { ...effect, kind: 'appear', delayMs: 0, durationMs: 0 };
    expect(at(1, -1, [appear])).toMatchObject({ opacity: 0, nextAt: 0, moving: false });
    expect(at(1, 0, [appear])).toMatchObject({ opacity: 1, nextAt: null, moving: false });
    expect(nativeStepTiming({ slide, shownAt: 1000, step: 1, stepAt: 1300 })).toMatchObject({
      index: 1,
      clipAt: 1300,
      endsAt: 1600,
      still: false,
    });
    expect(nativeStepTiming({ slide, shownAt: 1000, step: 1, stepAt: 1400, stepFromMs: 300 })).toMatchObject({
      index: 1,
      clipAt: 1100,
      endsAt: 1400,
      still: true,
    });
  });

  it('flies up from below the slide and zooms from the shape’s center', () => {
    const fly: DeckEffect = { ...effect, kind: 'fly', direction: 'up' };
    expect(at(1, 75, [fly])).toMatchObject({ opacity: 1, x: 0, y: 980, moving: true });
    expect(at(1, 187.5, [fly]).y).toBe(490);
    expect(at(1, 300, [fly])).toMatchObject({ x: 0, y: 0, moving: false });
    const zoom: DeckEffect = { ...effect, kind: 'zoom' };
    expect(at(1, 187.5, [zoom]).scale).toBe(0.5);
    expect(at(1, 300, [zoom]).scale).toBe(1);
  });

  it('travels along both axes for diagonal Fly In and Fly Out', () => {
    const into: DeckEffect = { ...effect, kind: 'fly', direction: 'right', verticalDirection: 'up' };
    const out: DeckEffect = { ...into, phase: 'out', direction: 'left', verticalDirection: 'down' };
    expect(at(1, 75, [into])).toMatchObject({ x: -700, y: 980, moving: true });
    expect(at(1, 187.5, [out])).toMatchObject({ x: -350, y: 490, moving: true });
    expect(at(1, 300, [out])).toMatchObject({ opacity: 0, x: 0, y: 0, moving: false });
  });

  it('wipes away the top edge first when a PowerPoint Wipe up exits', () => {
    const wipe: DeckEffect = { ...effect, kind: 'wipe', phase: 'out', direction: 'up' };
    const middle = at(1, 187.5, [wipe]);
    expect(deckWipeClip(middle.wipe, bounds, bounds)).toBe('inset(50% 0% 0% 0%)');
    expect(at(1, 300, [wipe]).opacity).toBe(0);
  });

  it('fades while scaling the gallery Zoom', () => {
    const zoom: DeckEffect = { ...effect, kind: 'zoom', fade: true };
    expect(at(1, 187.5, [zoom])).toMatchObject({ opacity: 0.5, scale: 0.5, moving: true });
    expect(at(1, 300, [zoom])).toMatchObject({ opacity: 1, scale: 1, moving: false });
  });

  it('round-trips Float, Split and Grow/Shrink, then draws their midpoint and final pose', () => {
    const saved = {
      ...deck,
      motion: {
        ...motion,
        effects: [
          { ...effect, kind: 'float', direction: 'up', distance: 0.08 },
          { ...effect, kind: 'split', splitAxis: 'x' },
          { ...effect, kind: 'grow-shrink', phase: 'emphasis', scale: 1.5 },
        ],
      },
    };
    const loaded = deckFromJson(JSON.stringify(saved));
    expect(loaded).toEqual(saved);
    const [float, split, grow] = loaded?.motion?.effects ?? [];
    if (!float || !split || !grow || !loaded?.motion) throw new Error('The stored effects were not read.');
    const floating = at(1, 187.5, [float]);
    expect(floating).toMatchObject({ opacity: 0.5, x: 0, moving: true });
    expect(floating.y).toBeCloseTo(43.2, 4);
    // Split: its middle shows half-way, with PowerPoint's soft edges, as a mask (never a clip).
    expect(deckWipeClip(at(1, 187.5, [split]).wipe, bounds, bounds)).toBe('');
    expect(deckWipeMask(at(1, 187.5, [split]).wipe, bounds, bounds)).toBe(
      'linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 21.625%, rgb(0 0 0 / 1) 28.375%, rgb(0 0 0 / 1) 71.625%, rgb(0 0 0 / 0) 78.375%, rgb(0 0 0 / 0) 100%)',
    );
    expect(at(1, 187.5, [grow]).scale).toBe(1.25);
    expect(at(2, 0, [grow])).toMatchObject({ scale: 1.5, moving: false });
    const resized = { ...slide, deck: { ...loaded, motion: { ...loaded.motion, effects: [grow] } } };
    expect(deckSlideAt(resized, 1).elements[0]?.frame).toEqual({ x: -50, y: 0, width: 900, height: 600 });
  });

  it('wipes a group with one edge across its separately drawn shapes', () => {
    const wipe: DeckEffect = { ...effect, kind: 'wipe', direction: 'left' };
    const frame = at(1, 187.5, [wipe]);
    expect(deckWipeClip(frame.wipe, bounds, { ...bounds, width: 200 })).toBe('inset(0% 0% 0% 100%)');
    expect(deckWipeClip(frame.wipe, bounds, { ...bounds, x: 300, width: 200 })).toBe('inset(0% 0% 0% 50%)');
    expect(deckWipeClip(frame.wipe, bounds, { ...bounds, x: 500, width: 200 })).toBe('inset(0% 0% 0% 0%)');
    expect(at(1, 300, [wipe]).wipe).toBeNull();
  });

  it('keeps a spin’s final rotation across clicks while a pulse returns to its original size', () => {
    const spin: DeckEffect = { ...effect, phase: 'emphasis', kind: 'spin', degrees: 90 };
    const pulse: DeckEffect = { ...effect, phase: 'emphasis', kind: 'pulse' };
    expect(at(1, 187.5, [spin, pulse])).toMatchObject({ rotation: 45, scale: 1.12 });
    expect(at(2, 0, [spin, pulse])).toMatchObject({ rotation: 90, scale: 1, moving: false });
  });

  it('retains and remaps the original still needed by a following baked transition', () => {
    const native = { ...deck, sourceStillId: 'placeholder-last' };
    expect(deckMediaIds(native)).toEqual(['placeholder-last']);
    expect(deckPictures(native)).toEqual(['placeholder-last']);
    expect(mapDeckMedia(native, (id) => id + '-copy').sourceStillId).toBe('placeholder-last-copy');
  });
});

describe('the common PowerPoint effects Drashti draws itself', () => {
  const bounds = { x: 100, y: 100, width: 600, height: 400 };
  const at = (elapsedMs: number, effects: readonly DeckEffect[]) =>
    deckMotionFrame(effects, 1, elapsedMs, bounds, slide);
  const clipAt = (elapsedMs: number, one: DeckEffect) =>
    deckWipeClip(at(elapsedMs, [one]).wipe, bounds, bounds);

  it('turns Grow & Turn as it grows and fades in', () => {
    const turn: DeckEffect = { ...effect, kind: 'zoom', fade: true, scale: 0, degrees: 90 };
    expect(at(187.5, [turn])).toMatchObject({ opacity: 0.5, scale: 0.5, rotation: 45, moving: true });
    expect(at(300, [turn])).toMatchObject({ opacity: 1, scale: 1, rotation: 0, moving: false });
  });

  it('opens Shape from the centre, or closes it in from the edges, softly, and leaves nothing masked at the end', () => {
    // Its soft edge is 0.142 of the way (from the middle to the corners, in its outline's own measure) wide, its middle
    // running evenly from half that before the middle to half past the corners: half-way, at half the way. No clip.
    const box: DeckEffect = { ...effect, kind: 'shape', shape: 'box' };
    const half = at(187.5, [box]).wipe;
    expect(clipAt(187.5, box)).toBe('');
    expect(deckShapeShows(half, 0, 0)).toBe(1);
    expect(deckShapeShows(half, 0.5, 0.2)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(half, 0.2, -0.5)).toBeCloseTo(0.5, 6);
    // Its corners square: as much on the diagonal as across the middle.
    expect(deckShapeShows(half, -0.5, -0.5)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(half, 0.75, 0)).toBe(0);
    // A diamond closing in from its corners: what the edge has passed shows.
    const closing = at(187.5, [{ ...box, shape: 'diamond', inward: true }]).wipe;
    expect(deckShapeShows(closing, 1, 1)).toBe(1);
    expect(deckShapeShows(closing, 0.6, 0.4)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(closing, 0, 0)).toBe(0);
    // PowerPoint's circle is an ellipse of the shape's own proportions, through its corners at the end.
    const circle = at(187.5, [{ ...box, shape: 'circle' }]).wipe;
    expect(deckShapeShows(circle, Math.SQRT1_2, 0)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(circle, 0.5, -0.5)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(circle, 1, 1)).toBe(0);
    // PowerPoint's plus: two bars across the whole shape, widening from its middle lines.
    const plus = at(187.5, [{ ...box, shape: 'plus' }]).wipe;
    expect(deckShapeShows(plus, 0.5, 0.95)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(plus, 0.1, 1)).toBe(1);
    expect(deckShapeShows(plus, 0.8, 0.8)).toBe(0);
    expect(at(300, [box]).wipe).toBeNull();
  });

  it('leaves by Shape the way PowerPoint does: its soft edge travels as it comes in, hiding what it passes', () => {
    // Out: a hole opening from the middle, the corners last (a quarter of the way through: its edge's middle at 0.2145).
    const box: DeckEffect = { ...effect, kind: 'shape', shape: 'box', phase: 'out' };
    const quarter = at(131.25, [box]).wipe;
    expect(clipAt(131.25, box)).toBe('');
    expect(deckShapeShows(quarter, 0, 0)).toBe(0);
    expect(deckShapeShows(quarter, 0.2145, -0.1)).toBeCloseTo(0.5, 6);
    expect(deckShapeShows(quarter, 1, 1)).toBe(1);
    // In: closing from the edges to the middle, the middle last.
    const closing = at(131.25, [{ ...box, shape: 'diamond', inward: true }]).wipe;
    expect(deckShapeShows(closing, 0, 0)).toBe(1);
    expect(deckShapeShows(closing, 1, 1)).toBe(0);
    expect(at(300, [box])).toMatchObject({ opacity: 0, wipe: null });
  });

  it('steps a Box’s, a Plus’s and a Diamond’s two masks on the very same lines, so a pixel on a seam is on one side in both', () => {
    // Each mask is a ramp over two half-planes, a step each, laid by `exclude`; the four steps' exclusive-or must be 1
    // everywhere, so that between them the shape's mask and the element's within it let each ramp through beside its
    // own sides once. A pixel whose centre lies on a seam (a square on PowerPoint's grid at 1080p: its falling diagonal
    // through pixel centres) is exactly at a step, and a renderer gives it one of the step's two colours, the same for
    // the same gradient. So the element within draws each seam with the shape's own gradient, the one as it is and the
    // other with its colours swapped: a step pointing the other way got its second colour too (Chromium, 14 Nov 2026),
    // everything showed there, a white line across what is hidden (C1's review, HIGH-1).
    const layersOf = (mask: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === '(') depth++;
        if (mask[i] === ')') depth--;
        if (mask[i] === ',' && depth === 0) {
          out.push(mask.slice(start, i).trim());
          start = i + 1;
        }
      }
      if (mask.trim()) out.push(mask.slice(start).trim());
      return out;
    };
    /** A step (two stops at one place, one colour each side) with its colours swapped. */
    const swapped = (step: string): string => {
      const m =
        /^linear-gradient\((-?[\d.]+deg), (rgb\(0 0 0 \/ [01]\)) (-?[\d.]+%), (rgb\(0 0 0 \/ [01]\)) (-?[\d.]+%)\)$/u.exec(
          step,
        );
      expect(m, step).not.toBeNull();
      expect(m?.[3], step).toBe(m?.[5]);
      expect(m?.[2], step).not.toBe(m?.[4]);
      return `linear-gradient(${m?.[1] ?? ''}, ${m?.[4] ?? ''} ${m?.[3] ?? ''}, ${m?.[2] ?? ''} ${m?.[5] ?? ''})`;
    };
    // The whole shape, a square one, and one part of a group (its right half, a little lower).
    const square = { x: 216, y: 144, width: 432, height: 432 };
    const cases: [Rect, Rect][] = [
      [bounds, bounds],
      [square, square],
      [bounds, { x: 400, y: 150, width: 300, height: 350 }],
    ];
    for (const shape of ['box', 'plus', 'diamond'] as const)
      for (const inward of [false, true])
        for (const leaving of [false, true])
          for (const progress of [0.03, 0.3, 0.5, 0.92])
            for (const [target, part] of cases) {
              const wipe = { shape, inward, leaving, progress };
              const name = `${shape} ${inward ? 'In' : 'Out'} ${leaving ? 'leaving' : 'coming in'} at ${String(progress)}, ${JSON.stringify(part)}`;
              const outer = layersOf(deckWipeMask(wipe, target, part));
              const inner = layersOf(deckWipeInnerMask(wipe, target, part));
              expect(outer, name).toHaveLength(3);
              expect(inner, name).toHaveLength(3);
              const [first = '', second = ''] = outer.slice(1);
              const steps = inner.slice(1).sort();
              expect([[swapped(first), second].sort(), [first, swapped(second)].sort()], name).toContainEqual(
                steps,
              );
            }
  });

  it('sweeps Wheel’s spokes clockwise from twelve o’clock', () => {
    const wheel: DeckEffect = { ...effect, kind: 'wheel', spokes: 2 };
    const points = clipAt(75, wheel).slice('polygon('.length, -1).split(', ');
    // Each spoke starts at the centre, then at its own twelve or six o'clock, straight above or below it.
    expect(points.filter((point) => point === '50% 50%')).toHaveLength(2);
    expect(points[0]).toBe('50% 50%');
    expect(points[1]?.startsWith('50% -')).toBe(true);
    expect(points.at(-1)?.startsWith('50% 1')).toBe(true);
    expect(at(300, [wheel]).wipe).toBeNull();
  });

  it('shows Random Bars one bar at a time, none at the start and all by the end', () => {
    const bars: DeckEffect = { ...effect, kind: 'bars', bars: 'horizontal' };
    expect(clipAt(75, bars)).toBe('inset(50% 50% 50% 50%)');
    const half = clipAt(187.5, bars);
    expect(half.split(', ').length).toBe(4 * 24);
    expect(at(300, [bars]).wipe).toBeNull();
  });

  it('never draws a Split stop that adds nothing, however far through it is (EF-1: float noise near nothing)', () => {
    // At every thousandth of the way, in and out, each way round: its middle, its two soft edges and its ends at most.
    for (const inward of [false, true])
      for (const phase of ['in', 'out'] as const)
        for (const axis of ['x', 'y'] as const)
          for (let k = 1; k < 1000; k++) {
            const split: DeckEffect = {
              ...effect,
              kind: 'split',
              splitAxis: axis,
              phase,
              ...(inward ? { inward: true as const } : {}),
            };
            const mask = deckWipeMask(at(75 + (225 * k) / 1000, [split]).wipe, bounds, bounds);
            const stops = mask.match(/rgb\(/gu)?.length ?? 0;
            expect(
              stops,
              `${phase} ${axis} ${inward ? 'In' : 'Out'} at ${String(k / 10)} %`,
            ).toBeLessThanOrEqual(6);
          }
  });

  it('brings Split in from both edges, the gap closing in the middle, with PowerPoint’s soft edges', () => {
    const split: DeckEffect = { ...effect, kind: 'split', splitAxis: 'x', inward: true };
    expect(clipAt(187.5, split)).toBe('');
    expect(deckWipeMask(at(187.5, [split]).wipe, bounds, bounds)).toBe(
      'linear-gradient(to right, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 21.625%, rgb(0 0 0 / 0) 28.375%, rgb(0 0 0 / 0) 71.625%, rgb(0 0 0 / 1) 78.375%, rgb(0 0 0 / 1) 100%)',
    );
    // Leaving the same way (PowerPoint's In): hidden from both edges in, so the middle goes last.
    const leaving = deckWipeMask(at(187.5, [{ ...split, phase: 'out' }]).wipe, bounds, bounds);
    expect(leaving).toBe(
      'linear-gradient(to right, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 21.625%, rgb(0 0 0 / 1) 28.375%, rgb(0 0 0 / 1) 71.625%, rgb(0 0 0 / 0) 78.375%, rgb(0 0 0 / 0) 100%)',
    );
    // Up and down, and nothing to mask once it has come in, or before it starts to leave.
    expect(deckWipeMask(at(187.5, [{ ...split, splitAxis: 'y' }]).wipe, bounds, bounds)).toMatch(
      /^linear-gradient\(to bottom, /u,
    );
    expect(at(300, [split]).wipe).toBeNull();
    expect(deckWipeMask(at(75, [{ ...split, phase: 'out' }]).wipe, bounds, bounds)).toBe('');
  });

  it('drops Bounce in from above the slide and lands it in place', () => {
    const bounce: DeckEffect = { ...effect, kind: 'bounce' };
    expect(at(75, [bounce]).y).toBe(-500);
    expect(at(300, [bounce])).toMatchObject({ y: 0, moving: false });
  });

  it('eases a smooth start and end as PowerPoint does, its speed rising and falling along half-cosines, ending on time', () => {
    // A smooth end over the whole effect, half-way: 1/2 + 1/π of the way (SMIL's straight ramp would be 3/4).
    expect(smoothedProgress(0.5, 0, 1)).toBeCloseTo(0.5 + 1 / Math.PI, 12);
    expect(smoothedProgress(0.5, 1, 0)).toBeCloseTo(0.5 - 1 / Math.PI, 12);
    expect(smoothedProgress(0.25, 0.5, 0.5)).toBeCloseTo(0.25 - 0.5 / Math.PI, 12);
    // The even middle, at the speed that makes up for the ramps.
    expect(smoothedProgress(0.5, 0.25, 0.25)).toBeCloseTo(0.5, 12);
    expect(smoothedProgress(0.3, 0.25, 0.5)).toBeCloseTo(1.6 * (0.3 - 0.125), 12);
    expect(smoothedProgress(1, 0.5, 0.5)).toBe(1);
    expect(smoothedProgress(0, 0.5, 0.5)).toBe(0);
    const fly: DeckEffect = { ...effect, kind: 'fly', direction: 'up', decel: 1 };
    expect(at(187.5, [fly]).y).toBeCloseTo(980 * (0.5 - 1 / Math.PI), 9);
  });
});

describe('a deck that builds a text box paragraph by paragraph', () => {
  const words: TextElement = {
    id: 'placeholder-points',
    kind: 'text',
    sourceShapeId: '9',
    frame: { x: 100, y: 100, width: 800, height: 400 },
    text: 'Placeholder first\nPlaceholder second\nPlaceholder third',
    lang: null,
    style: {
      fontFamily: null,
      fontSize: 40,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
    },
    runs: [
      { text: 'Placeholder first', color: '#ffeeaa' },
      { text: '\n' },
      { text: 'Placeholder second\nPlaceholder third', shadow: true },
    ],
  };
  const build = (paragraph: number, step: number, phase: 'in' | 'out' = 'in'): DeckEffect => ({
    shapeId: '9',
    step,
    phase,
    kind: 'fade',
    delayMs: 0,
    durationMs: 200,
    paragraphs: [paragraph, paragraph],
  });
  const built: RenderSlide = {
    ...slide,
    elements: [words],
    deck: {
      steps: [],
      media: [],
      motion: {
        effects: [build(0, 1), build(1, 2), build(2, 3), build(0, 4, 'out')],
        stepsMs: [0, 200, 200, 200, 200],
        approximate: true,
      },
    },
  };
  const hidden = {
    color: 'transparent',
    shadow: false,
    outline: null,
    glow: null,
    underline: false,
    strike: false,
  };

  it('cuts the runs where each paragraph ends, keeping every run’s look', () => {
    expect(deckParagraphRuns(words)).toEqual({
      runs: [
        { text: 'Placeholder first', color: '#ffeeaa' },
        { text: '\n' },
        { text: 'Placeholder second\n', shadow: true },
        { text: 'Placeholder third', shadow: true },
      ],
      paragraphs: [0, 0, 1, 2],
    });
    const soft = {
      ...words,
      runs: [{ text: 'Placeholder one' }, { text: '\n', softBreak: true }, { text: 'line' }],
    };
    expect(deckParagraphRuns(soft).paragraphs).toEqual([0, 0, 0]);
  });

  it('never shows a later paragraph before its click, and keeps the shown ones where they were', () => {
    expect(deckSlideAt(built, 0).elements).toEqual([]);
    expect(deckSlideAt(built, 1).elements[0]).toMatchObject({
      runs: [
        { text: 'Placeholder first', color: '#ffeeaa' },
        { text: '\n' },
        { text: 'Placeholder second\n', ...hidden },
        { text: 'Placeholder third', ...hidden },
      ],
    });
    expect(deckSlideAt(built, 3).elements[0]).toBe(words);
    expect(deckSlideAt(built, 4).elements[0]).toMatchObject({
      runs: [
        { text: 'Placeholder first', ...hidden },
        { text: '\n', ...hidden },
        { text: 'Placeholder second\n', shadow: true },
        { text: 'Placeholder third', shadow: true },
      ],
    });
  });

  it('brings a paragraph added after an edit in with the built paragraph before it, never before', () => {
    // A fourth point typed after the last one the deck builds: no effect of its own.
    const added: TextElement = {
      ...words,
      text: `${words.text}\nPlaceholder fourth`,
      runs: [...(words.runs ?? []), { text: '\nPlaceholder fourth', shadow: true }],
    };
    const edited = (element: TextElement): RenderSlide => ({ ...built, elements: [element] });
    expect(deckSlideAt(edited(added), 0).elements).toEqual([]);
    expect(deckSlideAt(edited(added), 2).elements[0]).toMatchObject({
      runs: [
        { text: 'Placeholder first', color: '#ffeeaa' },
        { text: '\n' },
        { text: 'Placeholder second\n', shadow: true },
        { text: 'Placeholder third', ...hidden },
        { text: '\n', ...hidden },
        { text: 'Placeholder fourth', ...hidden },
      ],
    });
    expect(deckSlideAt(edited(added), 3).elements[0]).toBe(added);
    // The first point goes out at click 4; the fourth stays, as the third does.
    expect(deckSlideAt(edited(added), 4).elements[0]).toMatchObject({
      runs: [
        { text: 'Placeholder first', ...hidden },
        { text: '\n', ...hidden },
        { text: 'Placeholder second\n', shadow: true },
        { text: 'Placeholder third', shadow: true },
        { text: '\n', shadow: true },
        { text: 'Placeholder fourth', shadow: true },
      ],
    });
    // Enter pressed inside the second point: the points after it move down one, the last onto no effect of its own.
    const split: TextElement = {
      ...words,
      runs: [
        { text: 'Placeholder first', color: '#ffeeaa' },
        { text: '\n' },
        { text: 'Placeholder sec\nond\nPlaceholder third', shadow: true },
      ],
    };
    expect(deckSlideAt(edited(split), 0).elements).toEqual([]);
    expect(deckSlideAt(edited(split), 2).elements[0]).toMatchObject({
      runs: [
        { text: 'Placeholder first' },
        { text: '\n' },
        { text: 'Placeholder sec\n', shadow: true },
        { text: 'ond\n', ...hidden },
        { text: 'Placeholder third', ...hidden },
      ],
    });
    // A paragraph before the first one built has none before it: it shows from the start, as in PowerPoint.
    const titled: RenderSlide = {
      ...built,
      deck: {
        steps: [],
        media: [],
        motion: { effects: [build(1, 1), build(2, 2)], stepsMs: [0, 200, 200], approximate: true },
      },
    };
    expect(deckSlideAt(titled, 0).elements[0]).toMatchObject({
      runs: [
        { text: 'Placeholder first', color: '#ffeeaa' },
        { text: '\n' },
        { text: 'Placeholder second\n', ...hidden },
        { text: 'Placeholder third', ...hidden },
      ],
    });
  });

  it('gives the screens each paragraph’s effects by the same rule as the stills', () => {
    const effects = built.deck?.motion?.effects ?? [];
    expect(builtParagraphEffects(effects, 0)).toEqual([build(0, 1), build(0, 4, 'out')]);
    expect(builtParagraphEffects(effects, 2)).toEqual([build(2, 3)]);
    // Added after an edit: the third point's, however far past it.
    expect(builtParagraphEffects(effects, 3)).toEqual([build(2, 3)]);
    expect(builtParagraphEffects(effects, 7)).toEqual([build(2, 3)]);
    // Before the first built paragraph: none, so it shows from the start.
    expect(builtParagraphEffects([build(1, 1), build(2, 2)], 0)).toEqual([]);
  });

  it('fades each paragraph by itself while the box stays', () => {
    const effects = built.deck?.motion?.effects ?? [];
    expect(deckMotionFrame([build(1, 2)], 1, Infinity, words.frame, slide).opacity).toBe(0);
    expect(deckMotionFrame([build(1, 2)], 2, 100, words.frame, slide).opacity).toBe(0.5);
    // The box's own frame ignores its paragraphs' effects.
    expect(
      deckMotionFrame(
        effects.filter((e) => !e.paragraphs),
        0,
        0,
        words.frame,
        slide,
      ).opacity,
    ).toBe(1);
    expect(deckFromJson(deckToJson(built.deck))).toEqual(built.deck);
  });
});
