import { expect, it } from 'vitest';
import { EDITABLE_SOURCE_LIMITS } from '../../shared/editable-source';
import { pptxFramesWithinLimit, pptxPageSchema } from './pptx-reader-protocol';

const page = {
  sourceIndex: 0,
  width: 1280,
  height: 720,
  background: null,
  elements: [],
  assets: [],
  issues: [],
};
const frame = { x: 0, y: 0, width: 100, height: 100 };

it('only accepts a bounded list of distinct PowerPoint video shape IDs', () => {
  expect(pptxPageSchema.safeParse({ ...page, sourceVideoShapeIds: ['4', '6'] }).success).toBe(true);
  for (const sourceVideoShapeIds of [
    ['video'],
    ['12345678901'],
    ['4', '4'],
    Array.from({ length: EDITABLE_SOURCE_LIMITS.pageElements + 1 }, (_, i) => String(i)),
  ]) {
    expect(pptxPageSchema.safeParse({ ...page, sourceVideoShapeIds }).success).toBe(false);
  }
});

// C25's review NIT-2: Main's bound itself, at its edge, as Main checks it (service.ts keeps its own copy).
it.each([
  [1_000_000, true],
  [-1_000_000, true],
  [1_000_001, false],
])('keeps a drawing placed at %s only within 1,000,000 either way', (x, kept) => {
  const shape = {
    id: 'placeholder-shape',
    kind: 'shape',
    frame: { ...frame, x },
    fill: '#123456',
    opacity: 1,
    cornerRadius: 0,
  };
  expect(pptxPageSchema.safeParse({ ...page, elements: [shape] }).success).toBe(kept);
});

// C25's review LOW-1: the worker also asks this of a page the schema refused, as the reader made it. A drawing with
// no frame, or not a drawing at all, is not within the bound, and the answer never throws: that page alone fails.
it('answers for any drawing without throwing', () => {
  expect(pptxFramesWithinLimit([{ frame }, { frame: { ...frame, x: -1_000_000 } }])).toBe(true);
  for (const element of [
    { frame: null },
    {},
    null,
    'placeholder',
    { frame: { ...frame, x: '0' } },
    { frame: { ...frame, width: Number.NaN } },
    { frame: { ...frame, height: Number.POSITIVE_INFINITY } },
  ])
    expect(pptxFramesWithinLimit([{ frame }, element])).toBe(false);
});
