import { describe, expect, it } from 'vitest';
import type { PresentationDoc, SlideInfo } from './library';
import type { RenderSlide } from './model';
import { itemPlayOrder, ownOrderId, ownOrderItem } from './order';

/*
 * Session 55, Part 4b: a playlist item's own order of its presentation's slides (rows dragged within the item, or out
 * of it into an item of their own). It names its slides by id, so it survives the presentation's edits: a slide
 * deleted later drops out; a slide added later plays at the end of the item that holds the presentation's other slides
 * (the one that knew every slide when its order was made), and never in an item made of slides dragged out on their
 * own. The engine knows it as the order "item:<id>". Placeholder words only.
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

/** A deck of four slides in two groups, with an arrangement singing the chorus twice. */
const DOC: PresentationDoc = {
  id: 'p',
  name: 'Placeholder deck',
  width: 1920,
  height: 1080,
  groups: [
    { id: 'v', name: 'Verse', color: null, slides: [info('s1', 0), info('s2', 1)] },
    { id: 'c', name: 'Chorus', color: '#00aa00', slides: [info('s3', 2), info('s4', 3)] },
  ],
  arrangements: [{ id: 'a', name: 'Placeholder order', groupIds: ['c', 'v', 'c'] }],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
};

const ids = (o: { slides: readonly { slide: { id: string } }[] }) => o.slides.map((s) => s.slide.id);

describe('a playlist item’s own order of slides', () => {
  it('is named to the engine by its item: "item:<id>", read back the same', () => {
    expect(ownOrderId('i1')).toBe('item:i1');
    expect(ownOrderItem('item:i1')).toBe('i1');
    expect(ownOrderItem('a')).toBeNull();
    expect(ownOrderItem(null)).toBeNull();
    expect(ownOrderItem(undefined)).toBeNull();
  });

  it('plays its slides in its own order, positions from 0, under the order "item:<id>"', () => {
    const order = itemPlayOrder(DOC, { mode: 'slides', slideIds: ['s3', 's1', 's2', 's4'], known: [] }, 'i1');
    expect(order.arrangementId).toBe('item:i1');
    expect(ids(order)).toEqual(['s3', 's1', 's2', 's4']);
    expect(order.slides.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    // Each slide's group, and each time a group comes up again (the chorus twice): its name shows at each start.
    expect(order.slides.map((s) => `${s.group.name} ${String(s.occurrence)}`)).toEqual([
      'Chorus 0',
      'Verse 0',
      'Verse 0',
      'Chorus 1',
    ]);
  });

  it('drops a slide deleted from the presentation since, and plays one added since at the end of the item that knew the rest', () => {
    const known = ['s1', 's2', 's3', 's4', 'gone'];
    const later: PresentationDoc = {
      ...DOC,
      groups: [
        { id: 'v', name: 'Verse', color: null, slides: [info('s1', 0), info('s2', 1), info('new', 2)] },
        { id: 'c', name: 'Chorus', color: null, slides: [info('s3', 3), info('s4', 4)] },
      ],
    };
    // The item holding the deck's slides, one dragged out (s2) and one deleted since (gone).
    expect(
      ids(itemPlayOrder(later, { mode: 'slides', slideIds: ['s4', 's1', 'gone', 's3'], known }, 'i1')),
    ).toEqual(['s4', 's1', 's3', 'new']);
    // The item made of s2 alone, dragged out: never a slide added later.
    expect(ids(itemPlayOrder(later, { mode: 'slides', slideIds: ['s2'] }, 'i2'))).toEqual(['s2']);
    // Every slide of its own deleted: nothing to play.
    expect(ids(itemPlayOrder(later, { mode: 'slides', slideIds: ['gone'] }, 'i3'))).toEqual([]);
  });

  it('keeps a slide named twice twice (an arrangement’s chorus sung again, its order made from it)', () => {
    expect(ids(itemPlayOrder(DOC, { mode: 'slides', slideIds: ['s3', 's4', 's1', 's3'] }, 'i1'))).toEqual([
      's3',
      's4',
      's1',
      's3',
    ]);
  });

  it('plays the other orders as before: the presentation’s own, every slide, an arrangement', () => {
    expect(ids(itemPlayOrder(DOC, { mode: 'presentation' }, 'i1'))).toEqual(['s1', 's2', 's3', 's4']);
    expect(ids(itemPlayOrder(DOC, { mode: 'all' }, 'i1'))).toEqual(['s1', 's2', 's3', 's4']);
    const arranged = itemPlayOrder(DOC, { mode: 'arrangement', arrangementId: 'a' }, 'i1');
    expect(arranged.arrangementId).toBe('a');
    expect(ids(arranged)).toEqual(['s3', 's4', 's1', 's2', 's3', 's4']);
  });
});
