import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { powerPointPlan } from '../deck/plan';
import { type PptxDeck, readPptxDeck } from '../pictures';
import { readZipEntries } from '../zip';
import {
  COMPARISON_SLIDES,
  COMPARISON_STANDARD,
  type ComparisonSlide,
  writeComparisonDeck,
} from './powerpoint-comparison-deck';

const dir = mkdtempSync(join(tmpdir(), 'drashti-comparison-deck-'));
let file = '';
let deck: PptxDeck;
let parts: Awaited<ReturnType<typeof readZipEntries>>;
beforeAll(async () => {
  file = await writeComparisonDeck(dir);
  deck = await readPptxDeck(file);
  parts = await readZipEntries(file, (name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const indexOf = (name: string) => {
  const index = COMPARISON_SLIDES.findIndex((slide) => slide.name === name);
  expect(index, name).toBeGreaterThanOrEqual(0);
  return index;
};
const motion = (name: string) => deck.slides[indexOf(name)]?.deck?.motion;
const xmlOf = (name: string) =>
  parts.get(`ppt/slides/slide${String(indexOf(name) + 1)}.xml`)?.toString('utf8') ?? '';
const slideOf = (name: string): ComparisonSlide => {
  const slide = COMPARISON_SLIDES.find((s) => s.name === name);
  if (!slide) throw new Error(`No slide ${name}`);
  return slide;
};

const DIRECTIONS = ['left', 'right', 'up', 'down'];
/** Run 1's slides (12 Nov 2026), in order: PowerPoint's own movie of them was measured (s57-notes, 13 Nov). */
const RUN1 = [
  'Float In Up',
  'Float In Down',
  'Float Out Up',
  'Float Out Down',
  ...['in', 'out'].flatMap((phase) =>
    ['in', 'out'].flatMap((edge) =>
      ['Vertical', 'Horizontal'].map((axis) => `Split ${phase} · ${edge}${axis}`),
    ),
  ),
  'Grow & Turn',
  'Shrink & Turn',
  'Grow/Shrink 150%',
  'Grow/Shrink 50%',
  'Fly with smooth start and end',
  'Basic Zoom · In',
  'Basic Zoom · Out',
  'Basic Zoom · In Slightly',
  'Basic Zoom · In From Screen Center',
  'Basic Zoom · Out From Screen Bottom',
  ...['push', 'wipe', 'cover', 'uncover'].flatMap((kind) =>
    DIRECTIONS.flatMap((direction) => [`Reference for ${kind} ${direction}`, `${kind} ${direction}`]),
  ),
];
const OUTLINES = ['Circle', 'Box', 'Diamond', 'Plus'];
/** Run 2's slides, after run 1's: the effects run 1 did not measure. */
const RUN2 = [
  'Float In Up · smooth start and end',
  'Float Out Down · smooth start and end',
  'Grow/Shrink 150% · smooth start and end',
  'Grow/Shrink 50% · smooth start and end',
  'Basic Zoom exit · Out',
  'Basic Zoom exit · In Slightly',
  'Basic Zoom exit · In To Screen Center',
  'Basic Zoom exit · Out To Screen Bottom',
  ...['in', 'out'].flatMap((phase) =>
    OUTLINES.flatMap((outline) => ['In', 'Out'].map((way) => `Shape ${phase} · ${outline} ${way}`)),
  ),
];
const TRANSITIONS = ['push', 'wipe', 'cover', 'uncover'];
const transitionsOf = (ms: number) =>
  TRANSITIONS.flatMap((kind) =>
    DIRECTIONS.flatMap((direction) => [
      `Reference for ${kind} ${direction} · ${String(ms)} ms`,
      `${kind} ${direction} · ${String(ms)} ms`,
    ]),
  );
/**
 * Run 3's slides (Session 58, 14 Nov 2026), after run 2's: the Zoom exit Out To Screen Bottom at 750 ms (its end
 * between two of the movie's frames) and 1 s, Shape at 2 s, and every transition at 1 s (their markers from 24); then
 * every transition at 2 s (their markers from 26).
 */
const RUN3_A = [
  'Basic Zoom exit · Out To Screen Bottom · 750 ms',
  'Basic Zoom exit · Out To Screen Bottom · 1000 ms',
  'Shape in · Circle Out · 2000 ms',
  'Shape out · Box In · 2000 ms',
  ...transitionsOf(1000),
];
const RUN3_B = transitionsOf(2000);

describe('the deck PowerPoint’s own movie is compared against', () => {
  it('writes each effect as PowerPoint itself does, so Drashti reads it as PowerPoint plays it', () => {
    expect(deck.slides).toHaveLength(COMPARISON_SLIDES.length);
    // A whole size is written #ppt_w and #ppt_h, as PowerPoint writes it, never #ppt_w*1 (PowerPoint plays both the
    // same, but Drashti reads only its own form as the shape's own size: run 1's deck lost Grow & Turn's turn so).
    expect(parts.size).toBe(COMPARISON_SLIDES.length);
    for (const [name, xml] of parts) expect(xml.toString('utf8'), name).not.toMatch(/#ppt_[wh]\*1"/u);
    expect(motion('Grow & Turn')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'in', kind: 'zoom', fade: true, scale: 0, degrees: 90, durationMs: 700 }],
    });
    expect(motion('Shrink & Turn')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'out', kind: 'zoom', fade: true, scale: 0, degrees: 90, durationMs: 700 }],
    });
    expect(motion('Basic Zoom · In')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'in', kind: 'zoom', durationMs: 700 }],
    });
    expect(motion('Float In Up')).toMatchObject({
      approximate: false,
      effects: [{ phase: 'in', kind: 'float', direction: 'up', distance: 0.08, durationMs: 700 }],
    });
  });

  it('keeps run 1’s slides first, as they were, and marks run 2’s between run 1’s markers', () => {
    expect(COMPARISON_SLIDES.map((slide) => slide.name)).toEqual([...RUN1, ...RUN2, ...RUN3_A, ...RUN3_B]);
    // Each slide's gray marker 4 lighter than the one before it: run 1's from 20 (as its movie has them), run 2's from
    // 22, run 3's from 24 and 26, so that every marker stays a gray (at most 255) and a probe finds each slide in order.
    expect(COMPARISON_SLIDES.map((slide) => slide.marker)).toEqual([
      ...RUN1.map((_, i) => 20 + 4 * i),
      ...RUN2.map((_, i) => 22 + 4 * i),
      ...RUN3_A.map((_, i) => 24 + 4 * i),
      ...RUN3_B.map((_, i) => 26 + 4 * i),
    ]);
    expect(Math.max(...COMPARISON_SLIDES.map((slide) => slide.marker))).toBeLessThanOrEqual(255);
  });

  it('adds what run 1 left unmeasured, each as PowerPoint writes it', () => {
    // A smooth start of 25 % and end of 50 % on the effect itself, as run 1's eased Fly had them.
    const eased = { accel: 0.25, decel: 0.5, durationMs: 700 };
    expect(motion('Float In Up · smooth start and end')).toMatchObject({
      effects: [{ phase: 'in', kind: 'float', direction: 'up', distance: 0.08, ...eased }],
    });
    expect(motion('Float Out Down · smooth start and end')).toMatchObject({
      effects: [{ phase: 'out', kind: 'float', direction: 'down', distance: 0.08, ...eased }],
    });
    expect(motion('Grow/Shrink 150% · smooth start and end')).toMatchObject({
      effects: [{ phase: 'emphasis', kind: 'grow-shrink', scale: 1.5, ...eased }],
    });
    expect(motion('Grow/Shrink 50% · smooth start and end')).toMatchObject({
      effects: [{ phase: 'emphasis', kind: 'grow-shrink', scale: 0.5, ...eased }],
    });
    for (const name of RUN2.slice(0, 4))
      expect(xmlOf(name), name).toMatch(/<p:cTn [^>]*presetClass="[^"]+"[^>]*accel="25000" decel="50000"/u);

    // Basic Zoom leaving: each the entrance of that name played backwards, from where the shape rests to where that
    // entrance starts, in PowerPoint's own formulas (Out: 8 times a shape under 0.3 of the slide).
    const big = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
    const leaving = (name: string) => motion(`Basic Zoom exit · ${name}`)?.effects[0];
    expect(leaving('Out')).toMatchObject({
      phase: 'out',
      kind: 'zoom',
      zoomAway: { w: `${big}#ppt_w`, h: `${big}#ppt_h` },
      durationMs: 700,
    });
    expect(leaving('In Slightly')).toMatchObject({
      phase: 'out',
      kind: 'zoom',
      zoomAway: { w: '2/3*#ppt_w', h: '2/3*#ppt_h' },
    });
    expect(leaving('In To Screen Center')).toMatchObject({
      phase: 'out',
      kind: 'zoom',
      zoomAway: { w: '0', h: '0', x: '0.5', y: '0.5' },
    });
    expect(leaving('Out To Screen Bottom')).toMatchObject({
      phase: 'out',
      kind: 'zoom',
      zoomAway: { w: `${big}#ppt_w`, h: `${big}#ppt_h`, x: '0.5', y: `1+${big}#ppt_h/2` },
    });

    // Shape: circle, box, diamond and plus, In and Out, coming in and leaving: PowerPoint's own filter on each.
    const presets = { Circle: 6, Box: 4, Diamond: 8, Plus: 13 };
    for (const [phase, cls, transition] of [
      ['in', 'entr', 'in'],
      ['out', 'exit', 'out'],
    ] as const)
      for (const outline of OUTLINES)
        for (const way of ['In', 'Out'] as const) {
          const name = `Shape ${phase} · ${outline} ${way}`;
          const filter = `${outline.toLowerCase()}(${way.toLowerCase()})`;
          expect(motion(name)?.effects, name).toEqual([
            expect.objectContaining({
              phase,
              kind: 'shape',
              shape: outline.toLowerCase(),
              durationMs: 700,
              ...(way === 'In' ? { inward: true } : {}),
            }),
          ]);
          if (way === 'Out') expect(motion(name)?.effects[0], name).not.toHaveProperty('inward');
          const xml = xmlOf(name);
          expect(xml, name).toContain(
            `presetID="${String(presets[outline as keyof typeof presets])}" presetClass="${cls}"`,
          );
          expect(xml, name).toContain(`<p:animEffect transition="${transition}" filter="${filter}">`);
        }

    // Every slide of run 2 one click of one 700 ms effect, as the export checks before PowerPoint makes the movie.
    const plan = powerPointPlan(deck.slides);
    expect(plan.slides).toHaveLength(COMPARISON_SLIDES.length);
    for (const name of RUN2) {
      expect(motion(name)?.effects, name).toHaveLength(1);
      const groups = plan.slides[indexOf(name)]?.groups ?? [];
      expect(
        groups.map((group) => group.endMs - group.startMs),
        name,
      ).toEqual([700]);
    }
  });

  it('adds run 3’s lengths: the Zoom exit at 750 ms and 1 s, Shape at 2 s, every transition at 1 s and 2 s', () => {
    const plan = powerPointPlan(deck.slides);
    const big = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
    for (const ms of [750, 1000]) {
      const name = `Basic Zoom exit · Out To Screen Bottom · ${String(ms)} ms`;
      expect(motion(name)?.effects, name).toEqual([
        expect.objectContaining({
          phase: 'out',
          kind: 'zoom',
          zoomAway: { w: `${big}#ppt_w`, h: `${big}#ppt_h`, x: '0.5', y: `1+${big}#ppt_h/2` },
          durationMs: ms,
        }),
      ]);
      expect(slideOf(name).duration, name).toBe(ms);
      expect(
        plan.slides[indexOf(name)]?.groups.map((group) => group.endMs - group.startMs),
        name,
      ).toEqual([ms]);
    }
    expect(motion('Shape in · Circle Out · 2000 ms')?.effects).toEqual([
      expect.objectContaining({ phase: 'in', kind: 'shape', shape: 'circle', durationMs: 2000 }),
    ]);
    expect(motion('Shape out · Box In · 2000 ms')?.effects).toEqual([
      expect.objectContaining({ phase: 'out', kind: 'shape', shape: 'box', inward: true, durationMs: 2000 }),
    ]);
    for (const ms of [1000, 2000])
      for (const kind of TRANSITIONS)
        for (const direction of DIRECTIONS) {
          const name = `${kind} ${direction} · ${String(ms)} ms`;
          const native = deck.slides[indexOf(name)]?.deck?.transition?.native?.transition;
          expect(native, name).toMatchObject({ deckEffect: kind, direction, durationMs: ms });
          expect(slideOf(name).duration, name).toBe(ms);
          expect(plan.slides[indexOf(name)]?.transitionMs, name).toBe(ms);
          // The reference before it comes in by a cut.
          expect(plan.slides[indexOf(name) - 1]?.transitionMs, name).toBe(0);
          // PowerPoint's own length (p14:dur) on the transition, its old speed beside it for older readers.
          expect(xmlOf(name), name).toContain(`p14:dur="${String(ms)}"`);
        }
  });
});

/** The 4:3 deck (run 3): the effects whose drawing depends on the slide's shape, and two controls. */
const STANDARD = [
  'Float In Up',
  'Grow/Shrink 150%',
  'Basic Zoom · In From Screen Center',
  'Basic Zoom · Out From Screen Bottom',
  'Basic Zoom exit · Out',
  'Basic Zoom exit · In To Screen Center',
  'Basic Zoom exit · Out To Screen Bottom',
  ...['in', 'out'].flatMap((phase) =>
    OUTLINES.flatMap((outline) => ['In', 'Out'].map((way) => `Shape ${phase} · ${outline} ${way}`)),
  ),
  ...TRANSITIONS.flatMap((kind) =>
    DIRECTIONS.flatMap((direction) => [`Reference for ${kind} ${direction}`, `${kind} ${direction}`]),
  ),
];

describe('the 4:3 deck PowerPoint’s own movie is compared against', () => {
  const where = mkdtempSync(join(tmpdir(), 'drashti-comparison-deck-4x3-'));
  let standard: PptxDeck;
  let standardFile = '';
  beforeAll(async () => {
    standardFile = await writeComparisonDeck(where, COMPARISON_STANDARD);
    standard = await readPptxDeck(standardFile);
  });
  afterAll(() => {
    rmSync(where, { recursive: true, force: true });
  });
  const at = (name: string) => {
    const index = COMPARISON_STANDARD.slides.findIndex((slide) => slide.name === name);
    expect(index, name).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('is a 4:3 deck of its own, 240 × 180 on the probe’s grid, the box at the same scale as the wide deck’s', async () => {
    expect(standardFile.endsWith('Placeholder PowerPoint motion 4x3.pptx')).toBe(true);
    expect(standard.size).toEqual({ cx: 9_144_000, cy: 6_858_000 });
    expect(COMPARISON_STANDARD).toMatchObject({
      width: 240,
      height: 180,
      box: { x: 54, y: 51, width: 64, height: 38 },
    });
    expect(COMPARISON_STANDARD.slides.map((slide) => slide.name)).toEqual(STANDARD);
    expect(COMPARISON_STANDARD.slides.map((slide) => slide.marker)).toEqual(
      STANDARD.map((_, i) => 20 + 4 * i),
    );
    expect(Math.max(...COMPARISON_STANDARD.slides.map((slide) => slide.marker))).toBeLessThanOrEqual(255);
    // The red box: 64 × 38 of the grid's 240 × 180, at (54, 51): 38,100 EMU a grid pixel, as the wide deck's.
    const parts4 = await readZipEntries(standardFile, (name) => name === 'ppt/slides/slide1.xml');
    const xml = parts4.get('ppt/slides/slide1.xml')?.toString('utf8') ?? '';
    expect(xml).toContain('<a:off x="2057400" y="1943100"/><a:ext cx="2438400" cy="1447800"/>');
  });

  it('reads every effect as one click of one 700 ms effect and every transition as written', () => {
    const plan = powerPointPlan(standard.slides);
    expect(plan.slides).toHaveLength(STANDARD.length);
    for (const [index, slide] of COMPARISON_STANDARD.slides.entries()) {
      const parsed = standard.slides[index]?.deck;
      if (slide.motion) {
        expect(parsed?.motion?.effects, slide.name).toHaveLength(1);
        expect(
          plan.slides[index]?.groups.map((group) => group.endMs - group.startMs),
          slide.name,
        ).toEqual([700]);
      }
      if (slide.transition)
        expect(parsed?.transition?.native?.transition, slide.name).toMatchObject({
          deckEffect: slide.transition.kind,
          direction: slide.transition.direction,
          durationMs: 700,
        });
    }
    const big = '(6*min(max(#ppt_w*#ppt_h,.3),1)-7.4)/-.7*';
    expect(
      standard.slides[at('Basic Zoom exit · Out To Screen Bottom')]?.deck?.motion?.effects[0],
    ).toMatchObject({
      phase: 'out',
      kind: 'zoom',
      zoomAway: { w: `${big}#ppt_w`, h: `${big}#ppt_h`, x: '0.5', y: `1+${big}#ppt_h/2` },
    });
    expect(standard.slides[at('Shape out · Plus In')]?.deck?.motion?.effects[0]).toMatchObject({
      phase: 'out',
      kind: 'shape',
      shape: 'plus',
      inward: true,
    });
  });
});
