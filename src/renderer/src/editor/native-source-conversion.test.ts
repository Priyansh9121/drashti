import { describe, expect, it } from 'vitest';
import type { DeckMotion, DeckSlide } from '../../../shared/deck';
import { renderEditedSlide } from '../../../shared/slide-design';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { convertSourceContent, needsSourceConversion } from './source-conversion';

const motion: DeckMotion = {
  approximate: false,
  stepsMs: [0, 400],
  effects: [{ shapeId: '2', step: 1, phase: 'in', kind: 'fade', delayMs: 0, durationMs: 400 }],
};
const baked: DeckSlide = {
  media: [],
  steps: [
    { clipId: 'placeholder-first', clipMs: 300, lastId: 'placeholder-still-1' },
    { clipId: 'placeholder-click', clipMs: 400, lastId: 'placeholder-still-2' },
  ],
};

function source(deck: DeckSlide): { doc: EditDoc; page: EditSlide } {
  const page: EditSlide = {
    id: 'placeholder-page',
    label: '',
    notes: '',
    background: null,
    darken: null,
    enabled: true,
    transition: null,
    autoAdvanceMs: null,
    macroId: null,
    elements: [],
    cues: [],
    documentPage: { sha256: '0'.repeat(64), ext: 'pptx', page: 0 },
    deck,
  };
  return {
    page,
    doc: {
      presentationId: 'placeholder-source',
      name: 'Placeholder animation',
      width: 1920,
      height: 1080,
      transition: null,
      loop: false,
      groups: [{ id: 'placeholder-group', name: 'Placeholder', color: null, slides: [page] }],
    },
  };
}

describe('editing a source slide with click animations', () => {
  it('keeps supported timing and switches from the baked clips without a warning', () => {
    const { doc, page } = source({ ...baked, motion });
    expect(needsSourceConversion(page)).toBe(false);
    const saved = slidesOf(convertSourceContent(doc, [page.id]))[0];
    expect(saved?.documentPage?.edited).toBe(true);
    expect(saved?.deck?.steps).toEqual([]);
    expect(saved?.deck?.motion).toEqual(motion);
    expect(page.deck?.steps).toEqual(baked.steps);
  });

  it('asks before replacing a baked effect it cannot play exactly, then keeps the closest timeline', () => {
    const approximate = { ...motion, approximate: true };
    const { doc, page } = source({ ...baked, motion: approximate });
    expect(needsSourceConversion(page)).toBe(true);
    const saved = slidesOf(convertSourceContent(doc, [page.id]))[0];
    expect(saved?.deck?.steps).toEqual([]);
    expect(saved?.deck?.motion).toEqual(approximate);
    expect(saved && needsSourceConversion(saved)).toBe(false);
  });

  it('still asks before changing an older baked slide without source timing', () => {
    const { doc, page } = source(baked);
    expect(needsSourceConversion(page)).toBe(true);
    const saved = slidesOf(convertSourceContent(doc, [page.id]))[0];
    expect(saved?.deck).toBeUndefined();
  });

  it('draws the whole slide once editable shapes are the source of the click playback', () => {
    const { doc, page } = source({ ...baked, motion, steps: [] });
    expect(needsSourceConversion(page)).toBe(false);
    expect(renderEditedSlide(doc, page).fullSlide).toBe(true);
  });
});
