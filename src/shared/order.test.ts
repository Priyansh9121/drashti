import { describe, expect, it } from 'vitest';
import type { GroupInfo } from './library';
import { findArrangement, orderSlides, remapPosition } from './order';

const slide = (id: string, index: number) => ({
  id,
  index,
  label: '',
  notes: '',
  cues: [],
  slide: { id, width: 1920, height: 1080, background: null, elements: [] },
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});
const groups: GroupInfo[] = [
  { id: 'v1', name: 'Verse 1', color: null, slides: [slide('v1a', 0), slide('v1b', 1)] },
  { id: 'ch', name: 'Chorus', color: '#ff0000', slides: [slide('cha', 2)] },
  { id: 'v2', name: 'Verse 2', color: null, slides: [slide('v2a', 3)] },
  { id: 'end', name: 'Ending', color: null, slides: [] },
];
const ids = (order: ReturnType<typeof orderSlides>) => order.map((o) => o.slide.id);

describe('slide order', () => {
  it('plays every slide once, in order, without an arrangement', () => {
    const order = orderSlides(groups, null);
    expect(ids(order)).toEqual(['v1a', 'v1b', 'cha', 'v2a']);
    expect(order.map((o) => o.position)).toEqual([0, 1, 2, 3]);
  });

  it('plays an arrangement with its repeats, telling each occurrence apart', () => {
    const order = orderSlides(groups, {
      id: 'a',
      name: 'Usual',
      groupIds: ['v1', 'ch', 'v2', 'ch', 'gone', 'ch'],
    });
    expect(ids(order)).toEqual(['v1a', 'v1b', 'cha', 'v2a', 'cha', 'cha']);
    expect(order.filter((o) => o.group.id === 'ch').map((o) => [o.position, o.occurrence])).toEqual([
      [2, 0],
      [4, 1],
      [5, 2],
    ]);
  });

  it('plays every slide when an arrangement leaves none', () => {
    expect(ids(orderSlides(groups, { id: 'a', name: 'Empty', groupIds: ['end', 'gone'] }))).toEqual([
      'v1a',
      'v1b',
      'cha',
      'v2a',
    ]);
  });

  it('finds an arrangement by id, or none', () => {
    const list = [{ id: 'a', name: 'A', groupIds: [] }];
    expect(findArrangement(list, 'a')?.name).toBe('A');
    expect(findArrangement(list, 'b')).toBeNull();
    expect(findArrangement(list, null)).toBeNull();
  });

  it('keeps the live slide when the order changes', () => {
    const all = orderSlides(groups, null);
    const usual = orderSlides(groups, { id: 'a', name: 'Usual', groupIds: ['v1', 'ch', 'v2', 'ch'] });
    // The chorus nearest where it was.
    expect(remapPosition(all, usual, 2)).toBe(2);
    expect(remapPosition(usual, all, 4)).toBe(2);
    expect(remapPosition(usual, usual, 4)).toBe(4);
    // A slide the new order leaves out: stay about where it was.
    const short = orderSlides(groups, { id: 'b', name: 'Short', groupIds: ['ch'] });
    expect(remapPosition(all, short, 3)).toBe(0);
  });
});
