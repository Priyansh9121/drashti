import { describe, expect, it } from 'vitest';
import type { PresentationDoc, SlideInfo } from '../../../shared/library';
import type { RenderSlide } from '../../../shared/model';
import type { PlaylistItemInfo } from '../../../shared/playlists';
import { moveSlideWithin, takeSlideOut } from './slide-order';

/*
 * Session 55, Part 4b: a slide's row dragged in the playlist. Within its deck or presentation it changes this item's
 * own order of slides; out of it, anywhere else in the playlist, it becomes an item of its own (the same
 * presentation, that slide alone), the deck's item keeping the rest. What is sent to the main process: the item's new
 * own order (and the new item's); never the library's presentation. Placeholder names only.
 */

const slide = (id: string): RenderSlide => ({
  id,
  width: 1920,
  height: 1080,
  background: null,
  elements: [],
});
const info = (id: string, index: number): SlideInfo => ({
  id,
  index,
  label: '',
  notes: '',
  slide: slide(id),
  cues: [],
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});
const DOC: PresentationDoc = {
  id: 'p',
  name: 'Placeholder deck',
  width: 1920,
  height: 1080,
  groups: [{ id: 'g', name: '', color: null, slides: ['s1', 's2', 's3', 's4'].map(info) }],
  arrangements: [{ id: 'a', name: 'Placeholder order', groupIds: ['g', 'g'] }],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
};
const item = (
  order: Extract<PlaylistItemInfo, { kind: 'presentation' }>['order'],
): Extract<PlaylistItemInfo, { kind: 'presentation' }> => ({
  id: 'i1',
  kind: 'presentation',
  label: 'Placeholder deck',
  presentationId: 'p',
  presentationName: 'Placeholder deck',
  order,
  arrangementName: null,
  timers: [],
});
const ALL = ['s1', 's2', 's3', 's4'];

describe('a slide’s row dragged within its deck', () => {
  it('gives the item an own order, the slide moved to where it was dropped; the item knows every slide', () => {
    // The third slide dropped before the first.
    expect(moveSlideWithin(item({ mode: 'presentation' }), DOC, 2, 0)).toEqual({
      mode: 'slides',
      slideIds: ['s3', 's1', 's2', 's4'],
      known: ALL,
    });
    // The first dropped after the last (before the place past the end).
    expect(moveSlideWithin(item({ mode: 'presentation' }), DOC, 0, 4)).toEqual({
      mode: 'slides',
      slideIds: ['s2', 's3', 's4', 's1'],
      known: ALL,
    });
  });

  it('starts from the order the item plays (an arrangement’s repeats too), and from its own order when it has one', () => {
    expect(moveSlideWithin(item({ mode: 'arrangement', arrangementId: 'a' }), DOC, 5, 0)?.slideIds).toEqual([
      's2',
      's1',
      's2',
      's3',
      's4',
      's1',
      's3',
      's4',
    ]);
    const own = item({ mode: 'slides', slideIds: ['s4', 's3', 's2'], known: ALL });
    expect(moveSlideWithin(own, DOC, 0, 3)).toEqual({
      mode: 'slides',
      slideIds: ['s3', 's2', 's4'],
      known: ALL,
    });
  });

  it('changes nothing when dropped where it was', () => {
    expect(moveSlideWithin(item({ mode: 'presentation' }), DOC, 1, 1)).toBeNull();
    expect(moveSlideWithin(item({ mode: 'presentation' }), DOC, 1, 2)).toBeNull();
  });

  it('keeps an item made of slides dragged out on its own from taking slides added later', () => {
    const alone = item({ mode: 'slides', slideIds: ['s2', 's4'] });
    expect(moveSlideWithin(alone, DOC, 1, 0)).toEqual({ mode: 'slides', slideIds: ['s4', 's2'] });
  });
});

describe('a slide’s row dragged out of its deck', () => {
  it('leaves the deck’s item the rest, knowing every slide, and makes an item of that slide alone', () => {
    expect(takeSlideOut(item({ mode: 'presentation' }), DOC, 1)).toEqual({
      slideId: 's2',
      rest: { mode: 'slides', slideIds: ['s1', 's3', 's4'], known: ALL },
      alone: { mode: 'slides', slideIds: ['s2'] },
    });
  });

  it('takes out only the occurrence dragged, when a slide comes twice', () => {
    expect(takeSlideOut(item({ mode: 'arrangement', arrangementId: 'a' }), DOC, 4)?.rest.slideIds).toEqual([
      's1',
      's2',
      's3',
      's4',
      's2',
      's3',
      's4',
    ]);
  });

  it('has nothing to split when it is the item’s only slide: the item itself moves', () => {
    expect(takeSlideOut(item({ mode: 'slides', slideIds: ['s3'] }), DOC, 0)).toBeNull();
  });
});
