import { describe, expect, it } from 'vitest';
import type { PptxDeck } from '../pictures';
import type { PptxMedia } from './pptx-deck';
import { keynoteMusic } from './keynote-music';

/*
 * Keynote's own PowerPoint copy of a deck, its sounds across slides as the deck plays them (Session 54): what Keynote
 * wrote there, tried on the dev Mac with placeholder decks, is the input (a .key's soundtrack as a sound across 999
 * slides on the first, at 50% whatever its own volume and even when it is Off; a .pptx's sound across slides on the
 * first slide made Keynote's soundtrack, one on a later slide that slide's own). Placeholder names only.
 */

const sound = (over: Partial<PptxMedia> = {}): PptxMedia => ({
  kind: 'audio',
  shapeId: '19',
  name: 'media1.m4a',
  part: 'ppt/media/media1.m4a',
  link: null,
  box: { x: 0, y: 0, w: 0.05, h: 0.08 },
  poster: null,
  trim: null,
  fadeInMs: 0,
  fadeOutMs: 0,
  volume: 1,
  muted: false,
  loop: false,
  start: { group: 0, offsetMs: 0 },
  acrossSlides: null,
  hideWhenStopped: true,
  enterGroup: null,
  exitGroup: null,
  ...over,
});

const deck = (slides: { media: PptxMedia[]; hidden?: boolean; clicks?: number }[]): PptxDeck => ({
  size: { cx: 12_192_000, cy: 6_858_000 },
  slides: slides.map((s) => ({
    hidden: s.hidden ?? false,
    notes: '',
    animated: false,
    deck: {
      transition: null,
      groups: Array.from({ length: s.clicks ?? 0 }, () => ({
        byClick: true,
        lengthMs: 500,
        mediaOnly: false,
        repeatsMs: null,
        untilClickMs: null,
      })),
      media: s.media,
      triggers: 0,
    },
  })),
});

/** Keynote's copy of a soundtrack: on the first slide, across 999, at 50%. */
const soundtrack = (loop: boolean) => sound({ acrossSlides: 999, volume: 0.5, loop });

const media = (d: PptxDeck) =>
  d.slides.map((s) => (s.deck?.media ?? []).map((m) => [m.name, m.acrossSlides, m.volume, m.loop]));

describe('Keynote’s copy of a deck’s sounds across slides (Session 54)', () => {
  it('a .key’s soundtrack plays across every slide at full volume (its copy always says 50%), looping or once as it was set', () => {
    const copy = deck([{ media: [soundtrack(true)] }, { media: [] }, { media: [] }]);
    expect(media(keynoteMusic(copy, { original: null, movieSound: null }))).toEqual([
      [['media1.m4a', 999, 1, true]],
      [],
      [],
    ]);
    // A slide's own sound in Keynote is no soundtrack: as its copy has it.
    const own = deck([{ media: [sound({ name: 'Placeholder chime', volume: 0.7 })] }]);
    expect(media(keynoteMusic(own, { original: null, movieSound: null }))).toEqual([
      [['Placeholder chime', null, 0.7, false]],
    ]);
  });

  it('a .key’s soundtrack set to Off (Keynote’s movie of it has no sound) is left out', () => {
    const copy = deck([{ media: [soundtrack(false), sound({ name: 'Placeholder chime' })] }]);
    expect(media(keynoteMusic(copy, { original: null, movieSound: false }))).toEqual([
      [['Placeholder chime', null, 1, false]],
    ]);
    // Heard in its movie, or not known (no movie yet): it plays.
    expect(media(keynoteMusic(copy, { original: null, movieSound: true }))[0]?.[0]?.[1]).toBe(999);
  });

  it('a .key’s soundtrack on a first slide skipped in Keynote plays from the first slide shown, with it', () => {
    const copy = deck([{ media: [soundtrack(true)], hidden: true }, { media: [], clicks: 2 }, { media: [] }]);
    const kept = keynoteMusic(copy, { original: null, movieSound: null });
    expect(media(kept)).toEqual([[], [['media1.m4a', 999, 1, true]], []]);
    // With the slide, never at its first click.
    expect(kept.slides[1]?.deck?.media[0]?.start).toEqual({ group: -1, offsetMs: 0 });
  });

  it('a .pptx Keynote opened plays its sounds across slides as the .pptx itself says, slide by slide', () => {
    const original = deck([
      { media: [sound({ name: 'Placeholder music', acrossSlides: 3, volume: 0.8, loop: true })] },
      { media: [sound({ name: 'Placeholder later', acrossSlides: 2, volume: 0.6, fadeInMs: 500 })] },
      { media: [sound({ name: 'Placeholder chime' })] },
    ]);
    // Keynote made the first its soundtrack (999 slides, 50%), and the second its slide's own (numSld 1, 60%).
    const copy = deck([
      { media: [soundtrack(true)] },
      { media: [sound({ name: 'Placeholder later', volume: 0.6 })] },
      { media: [sound({ name: 'Placeholder chime' })] },
    ]);
    const kept = keynoteMusic(copy, { original, movieSound: true });
    expect(media(kept)).toEqual([
      [['Placeholder music', 3, 0.8, true]],
      [['Placeholder later', 2, 0.6, false]],
      [['Placeholder chime', null, 1, false]],
    ]);
    expect(kept.slides[1]?.deck?.media[0]?.fadeInMs).toBe(500);
    // A slide whose sounds cannot be matched one for one keeps its copy's.
    const uneven = deck([{ media: [soundtrack(true), sound({ name: 'Placeholder extra' })] }, { media: [] }]);
    expect(media(keynoteMusic(uneven, { original, movieSound: true }))[0]).toEqual([
      ['media1.m4a', 999, 1, true],
      ['Placeholder extra', null, 1, false],
    ]);
  });
});
