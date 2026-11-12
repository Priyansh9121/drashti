import { describe, expect, it } from 'vitest';
import type { DeckEffect, DeckMotion, DeckSlide } from './deck';
import {
  sourceTimingDeck,
  sourceTimingPages,
  wantsSourceTiming,
  withSourceTiming,
  withSourceVideoShapes,
} from './deck-source-timing';
import type { SlideElement } from './model';
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
/** The same slide with a video that starts at the first click. */
const withVideo: DeckSlide = {
  ...old,
  media: [
    ...old.media,
    {
      kind: 'video',
      mediaId: 'placeholder-video',
      box: { x: 0.5, y: 0.1, w: 0.3, h: 0.3 },
      loop: false,
      volume: 1,
      start: { step: 1, offsetMs: 0 },
    },
  ],
};
const video = (own: string | null, mediaId = 'placeholder-video'): SlideElement => ({
  id: `placeholder-element-${mediaId}`,
  kind: 'video',
  frame: { x: 640, y: 72, width: 384, height: 216 },
  mediaId,
  fit: 'stretch',
  ...(own ? { sourceShapeId: own } : {}),
});

function slide(
  deck: DeckSlide | undefined,
  page: Partial<NonNullable<EditSlide['documentPage']>> = {},
  elements: SlideElement[] = [],
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
    elements,
    cues: [],
    documentPage: { sha256: HASH, ext: 'pptx', page: 0, ...page },
    ...(deck ? { deck } : {}),
  };
}

/** Keys of the reader's own at every level of its clicks, and a sound it made up (the review of 0663a204, MEDIUM-1). */
function dirty(deck: DeckSlide): unknown {
  const junk = { placeholderExtra: 'Placeholder key of the reader’s own' };
  const { motion: clicks, transition } = deck;
  return {
    ...deck,
    ...junk,
    deckAdvanceMs: 5000,
    after: 'placeholder-reader-still',
    preparing: true,
    ...(clicks
      ? { motion: { ...clicks, ...junk, effects: clicks.effects.map((effect) => ({ ...effect, ...junk })) } }
      : {}),
    transition: {
      ...transition,
      ...junk,
      soundId: 'placeholder-made-up-sound',
      ...(transition?.nativeTransition
        ? { nativeTransition: { ...transition.nativeTransition, ...junk } }
        : {}),
    },
  };
}

describe('a slide imported before alpha.17, and its kept PowerPoint file', () => {
  it('asks for the clicks of a slide that plays PowerPoint’s clips, from the presentation’s own .pptx only', () => {
    expect(wantsSourceTiming(slide(old))).toBe(true);
    // Its clicks are its own already (alpha.17), it has none to keep, or it is Drashti's own now.
    expect(wantsSourceTiming(slide({ ...old, motion }))).toBe(false);
    expect(wantsSourceTiming(slide({ ...old, steps: [] }))).toBe(false);
    expect(wantsSourceTiming(slide(undefined))).toBe(false);
    expect(wantsSourceTiming(slide(old, { edited: true }))).toBe(false);
    // A PDF's, an old .ppt's or a Keynote file's page.
    for (const ext of ['pdf', 'ppt', 'key'] as const)
      expect(wantsSourceTiming(slide(old, { ext }))).toBe(false);
    // Each page once, the hash as the database holds it; a Keynote deck's slide names the PowerPoint copy Keynote saved,
    // never the deck itself.
    expect(
      sourceTimingPages([slide(old), slide(old), slide(old, { page: 3 }), slide({ ...old, motion })], HASH),
    ).toEqual([0, 3]);
    expect(sourceTimingPages([slide(old)], 'b'.repeat(64))).toEqual([]);
    expect(sourceTimingPages([slide(old)], null)).toEqual([]);
    expect(sourceTimingPages([slide(old)], undefined)).toEqual([]);
  });

  it('reads clicks for a legacy video it can try to match, and applies timing only with a source shape', () => {
    expect(wantsSourceTiming(slide(withVideo, {}, [video('4')]))).toBe(true);
    // alpha.16 stored a deck's video with no shape of the deck's (HIGH-1); a slide that has lost it; another video.
    expect(wantsSourceTiming(slide(withVideo, {}, [video(null)]))).toBe(false);
    expect(wantsSourceTiming(slide(withVideo))).toBe(false);
    expect(wantsSourceTiming(slide(withVideo, {}, [video('4', 'placeholder-other-video')]))).toBe(false);
    expect(sourceTimingPages([slide(withVideo, {}, [video(null)]), slide(old, { page: 1 })], HASH)).toEqual([
      0, 1,
    ]);
    // An occurrence that doesn't want them keeps its deck, whatever the reader read for its page.
    const older = slide(withVideo, {}, [video(null)]);
    expect(withSourceTiming(older, read)).toBe(withVideo);
    expect(withSourceTiming(slide(withVideo, {}, [video('4')]), read)?.motion).toEqual(motion);
  });

  it('matches two uses of the same video by their boxes on differently sized canvases', () => {
    const first = video(null);
    const second = { ...first, id: 'second', frame: { ...first.frame, x: 102 } };
    const deck = {
      ...withVideo,
      media: withVideo.media.flatMap((item) =>
        item.kind === 'video' ? [item, { ...item, box: { ...item.box, x: 0.08 } }] : [item],
      ),
    };
    const legacy = slide(deck, {}, [first, second]);
    const saved = { width: 1280, height: 720 };
    const poster = (sourceShapeId: string, x: number): SlideElement => ({
      id: `poster-${sourceShapeId}`,
      kind: 'image',
      sourceShapeId,
      mediaId: 'placeholder-poster',
      fit: 'stretch',
      frame: { x, y: 75, width: 300, height: 225 },
    });
    const source = {
      width: 1000,
      height: 750,
      sourceVideoShapeIds: ['4', '6'],
      elements: [poster('5', 500), poster('6', 80), poster('4', 500)],
    };
    const identified = withSourceVideoShapes(legacy, saved, source);
    expect(identified.elements.map((element) => element.sourceShapeId)).toEqual(['4', '6']);
    expect(wantsSourceTiming(identified)).toBe(true);
    expect(wantsSourceTiming(slide(deck, {}, [video('4'), second]))).toBe(false);

    const duplicateId = { ...source, elements: [poster('4', 700), ...source.elements] };
    expect(withSourceVideoShapes(legacy, saved, duplicateId)).toBe(legacy);

    const ambiguous = {
      ...source,
      sourceVideoShapeIds: ['4', '6', '7'],
      elements: [...source.elements, poster('7', 500)],
    };
    expect(withSourceVideoShapes(legacy, saved, ambiguous)).toBe(legacy);
    expect(
      withSourceVideoShapes(legacy, saved, { ...source, elements: [poster('4', 500), poster('6', 83)] }),
    ).toBe(legacy);
  });

  it('keeps the read clicks and the deck’s transition beside the slide’s clips, as the import keeps them', () => {
    expect(withSourceTiming(slide(old), read)).toEqual({
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
    expect(withSourceTiming(slide(plain), read)?.transition).toEqual(read.transition);
    const { nativeTransition: _native, ...undrawn } = read.transition ?? { name: '', durationMs: 0 };
    expect(withSourceTiming(slide(old), { ...read, transition: undrawn })?.transition).toEqual(
      old.transition,
    );
    // Approximate clicks are kept too: the editor then names the closest effects before the first change.
    expect(
      withSourceTiming(slide(old), { ...read, motion: { ...motion, approximate: true } })?.motion
        ?.approximate,
    ).toBe(true);
  });

  it('leaves the slide as it was where the read clicks don’t fit', () => {
    expect(withSourceTiming(slide(old), undefined)).toBe(old);
    expect(withSourceTiming(slide(undefined), read)).toBeUndefined();
    const { motion: _motion, ...noMotion } = read;
    expect(withSourceTiming(slide(old), noMotion)).toBe(old);
    const own = { ...old, motion: { ...motion, approximate: true } };
    expect(withSourceTiming(slide(own), read)).toBe(own);
    // Its clicks must be its clips' clicks: the same Next and Back.
    expect(withSourceTiming(slide(old), { ...read, motion: { ...motion, stepsMs: [0, 500] } })).toBe(old);
    const one = { ...old, steps: old.steps.slice(0, 1) };
    const still: DeckSlide = {
      steps: [],
      media: [],
      motion: { approximate: false, stepsMs: [0], effects: [] },
    };
    expect(withSourceTiming(slide(one), still)).toBe(one);
    // Never a deck that doesn't read.
    expect(withSourceTiming(slide(old), { ...read, motion: { ...motion, stepsMs: [0, -1, 300] } })).toBe(old);
  });

  it('takes from the reader only what reads as a slide’s clicks, and only their known parts', () => {
    expect(sourceTimingDeck(read)).toEqual(read);
    expect(sourceTimingDeck(undefined)).toBeUndefined();
    expect(sourceTimingDeck('Placeholder')).toBeUndefined();
    expect(sourceTimingDeck({ ...read, motion: undefined })).toBeUndefined();
    expect(sourceTimingDeck({ ...read, steps: old.steps })).toBeUndefined();
    expect(
      sourceTimingDeck({ ...read, motion: { ...motion, effects: [{ ...motion.effects[0], step: 7 }] } }),
    ).toBeUndefined();
    // Keys of the reader's own, a still or a mark of its own, and a sound it made up never come through (MEDIUM-1).
    expect(sourceTimingDeck(dirty(read))).toEqual(read);
    const { transition: _transition, ...untransitioned } = read;
    expect(sourceTimingDeck(dirty(untransitioned))).toBeUndefined();
    const { transition: _sound, ...soundless } = old;
    expect(withSourceTiming(slide(soundless), dirty(read) as DeckSlide)).toEqual({
      ...soundless,
      motion,
      transition: read.transition,
    });
    // Every part of an effect Drashti knows comes through: a part added to DeckEffect must be added to the reader's.
    const every: Required<DeckEffect> = {
      shapeId: '5',
      step: 1,
      phase: 'in',
      kind: 'zoom',
      delayMs: 100,
      durationMs: 400,
      accel: 0.25,
      decel: 0.25,
      direction: 'left',
      verticalDirection: 'up',
      degrees: 90,
      fade: true,
      distance: 0.5,
      splitAxis: 'x',
      scale: 2,
      zoomAway: { w: '2/3*#ppt_w', h: '2/3*#ppt_h', x: '0.5', y: '1+#ppt_h/2' },
      shape: 'circle',
      inward: true,
      spokes: 4,
      bars: 'vertical',
      paragraphs: [0, 1],
    };
    expect(sourceTimingDeck({ ...read, motion: { ...motion, effects: [every] } })?.motion?.effects).toEqual([
      every,
    ]);
  });
});
