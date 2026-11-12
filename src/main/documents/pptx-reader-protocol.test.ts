import { expect, it } from 'vitest';
import { EDITABLE_SOURCE_LIMITS } from '../../shared/editable-source';
import { pptxPageSchema } from './pptx-reader-protocol';

it('only accepts a bounded list of distinct PowerPoint video shape IDs', () => {
  const page = {
    sourceIndex: 0,
    width: 1280,
    height: 720,
    background: null,
    elements: [],
    assets: [],
    issues: [],
  };
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
