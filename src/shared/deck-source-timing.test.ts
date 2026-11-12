import { describe, expect, it } from 'vitest';
import type { DeckMotion, DeckSlide } from './deck';
import {
  sourceTimingDeck,
  sourceTimingPages,
  wantsSourceTiming,
  withSourceTiming,
} from './deck-source-timing';
import type { EditSlide } from './slide-edit';

/* W6's review N4: which slides have their clicks read from the kept file, and how they are kept. */

const HASH = 'a'.repeat(64);
const motion: DeckMotion = {
  approximate: false,
  stepsMs: [0, 500, 300],
  effects: [
    { shapeId: '3', step: 1, phase: 'in', kind: 'fade', delayMs: 0, durationMs: 500 },
    { shapeId: '3', step: 2, phase: 'out', kind: 'fade', delayMs: 0, durationMs: 300 },
  ],
};
/** What alpha.17's import reads for the page: no clips, its clicks and its transition. */
const read: DeckSlide = {
  steps: [],
  media: [],
  motion,
  transition: {
    name: 'p:fade',
    durationMs: 400,
    nativeTransition: { kind: 'dissolve', deckEffect: 'dissolve', durationMs: 400 },
  },
};
/** A slide alpha.16 imported: the clips of PowerPoint's movie, coming in and then each click. */
const old: DeckSlide = {
  transition: { name: 'p:fade', durationMs: 400, soundId: 'placeholder-chime' },
  deckAdvanceMs: 5000,
  after: 'placeholder-before',
  steps: [0, 1, 2].map((n) => ({
    clipId: `placeholder-clip-${String(n)}`,
    clipMs: 600,
    ...(n === 0 ? { transitionMs: 400 } : {}),
    lastId: `placeholder-last-${String(n)}`,
  })),
  media: [
    {
      kind: 'audio',
      mediaId: 'placeholder-tone',
      box: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
      loop: false,
      volume: 1,
      start: { step: 1, offsetMs: 0 },
    },
  ],
};

function slide(
  deck: DeckSlide | undefined,
  page: Partial<NonNullable<EditSlide['documentPage']>> = {},
): EditSlide {
  return {
    id: `placeholder-slide-${String(page.page ?? 0)}`,
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
    documentPage: { sha256: HASH, ext: 'pptx', page: 0, ...page },
    ...(deck ? { deck } : {}),
  };
}

describe('a slide imported before alpha.17, and its kept PowerPoint file', () => {
  it('asks for the clicks of a slide that plays PowerPoint’s clips, from the presentation’s own .pptx only', () => {
    expect(wantsSourceTiming(slide(old), HASH)).toBe(true);
    // Its clicks are its own already (alpha.17), it has none to keep, or it is Drashti's own now.
    expect(wantsSourceTiming(slide({ ...old, motion }), HASH)).toBe(false);
    expect(wantsSourceTiming(slide({ ...old, steps: [] }), HASH)).toBe(false);
    expect(wantsSourceTiming(slide(undefined), HASH)).toBe(false);
    expect(wantsSourceTiming(slide(old, { edited: true }), HASH)).toBe(false);
    // A Keynote deck's slide names the PowerPoint copy Keynote saved, never the deck itself; a PDF or old .ppt page.
    expect(wantsSourceTiming(slide(old), 'b'.repeat(64))).toBe(false);
    expect(wantsSourceTiming(slide(old), null)).toBe(false);
    for (const ext of ['pdf', 'ppt', 'key'] as const)
      expect(wantsSourceTiming(slide(old, { ext }), HASH)).toBe(false);
    // Each page once, the hash as the database holds it.
    expect(
      sourceTimingPages([slide(old), slide(old), slide(old, { page: 3 }), slide({ ...old, motion })], HASH),
    ).toEqual([0, 3]);
    expect(sourceTimingPages([slide(old)], undefined)).toEqual([]);
  });

  it('keeps the read clicks and the deck’s transition beside the slide’s clips, as the import keeps them', () => {
    expect(withSourceTiming(old, read)).toEqual({
      ...old,
      motion,
      transition: {
        name: 'p:fade',
        durationMs: 400,
        soundId: 'placeholder-chime',
        nativeTransition: { kind: 'dissolve', deckEffect: 'dissolve', durationMs: 400 },
      },
    });
    // A transition the file has where the clips had none comes with it; one Drashti can't draw has no native part.
    const { transition: _none, ...plain } = old;
    expect(withSourceTiming(plain, read)?.transition).toEqual(read.transition);
    const { nativeTransition: _native, ...undrawn } = read.transition ?? { name: '', durationMs: 0 };
    expect(withSourceTiming(old, { ...read, transition: undrawn })?.transition).toEqual(old.transition);
    // Approximate clicks are kept too: the editor then names the closest effects before the first change.
    expect(
      withSourceTiming(old, { ...read, motion: { ...motion, approximate: true } })?.motion?.approximate,
    ).toBe(true);
  });

  it('leaves the slide as it was where the read clicks don’t fit', () => {
    expect(withSourceTiming(old, undefined)).toBe(old);
    expect(withSourceTiming(undefined, read)).toBeUndefined();
    const { motion: _motion, ...noMotion } = read;
    expect(withSourceTiming(old, noMotion)).toBe(old);
    const own = { ...old, motion: { ...motion, approximate: true } };
    expect(withSourceTiming(own, read)).toBe(own);
    // Its clicks must be its clips' clicks: the same Next and Back.
    expect(withSourceTiming(old, { ...read, motion: { ...motion, stepsMs: [0, 500] } })).toBe(old);
    const one = { ...old, steps: old.steps.slice(0, 1) };
    const still: DeckSlide = {
      steps: [],
      media: [],
      motion: { approximate: false, stepsMs: [0], effects: [] },
    };
    expect(withSourceTiming(one, still)).toBe(one);
    // Never a deck that doesn't read.
    expect(withSourceTiming(old, { ...read, motion: { ...motion, stepsMs: [0, -1, 300] } })).toBe(old);
  });

  it('takes from the reader only what reads as a slide’s clicks', () => {
    expect(sourceTimingDeck(read)).toEqual(read);
    expect(sourceTimingDeck(undefined)).toBeUndefined();
    expect(sourceTimingDeck('Placeholder')).toBeUndefined();
    expect(sourceTimingDeck({ ...read, motion: undefined })).toBeUndefined();
    expect(sourceTimingDeck({ ...read, steps: old.steps })).toBeUndefined();
    expect(
      sourceTimingDeck({ ...read, motion: { ...motion, effects: [{ ...motion.effects[0], step: 7 }] } }),
    ).toBeUndefined();
  });
});
