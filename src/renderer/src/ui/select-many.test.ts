import type { KeyboardEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { clickedMany } from '../music/music-store';
import { removingWhat } from '../playlists/playlist-store';
import { boxChoice, isSelectAll, laidOutTouching } from './select-many';

/* Choosing many (Session 44): what a box, a click and Cmd-A choose, and what deleting many says. */

const key = (k: Partial<KeyboardEvent>) =>
  ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: 'a', ...k }) as KeyboardEvent;

describe('choosing many', () => {
  it('a box chooses the rows it touches, or adds them to what was chosen with Cmd/Ctrl or Shift', () => {
    expect(boxChoice(['a'], ['b', 'c'], false)).toEqual(['b', 'c']);
    expect(boxChoice(['a', 'b'], ['b', 'c'], true)).toEqual(['a', 'b', 'c']);
  });

  it('a list that draws only the rows in view is chosen by where its rows lie, headings left out', () => {
    const ids = ['h', 'a', 'b', 'c'];
    const offsets = [0, 30, 90, 150];
    const heights = [30, 60, 60, 60];
    // The heading above (0 to 30) is not touched; the rows from 30 to 90 and 90 to 150 are.
    expect(laidOutTouching(ids, offsets, heights, { top: 40, bottom: 100, left: 0, right: 10 })).toEqual([
      'a',
      'b',
    ]);
    expect(
      laidOutTouching([null, 'a', 'b'], [0, 30, 90], [30, 60, 60], {
        top: 0,
        bottom: 200,
        left: 0,
        right: 1,
      }),
    ).toEqual(['a', 'b']);
  });

  it('Cmd-A on a Mac, Ctrl-A elsewhere; with another key held it is not', () => {
    expect(isSelectAll(key({ metaKey: true }), 'darwin')).toBe(true);
    expect(isSelectAll(key({ ctrlKey: true }), 'darwin')).toBe(false);
    expect(isSelectAll(key({ ctrlKey: true }), 'win32')).toBe(true);
    expect(isSelectAll(key({ ctrlKey: true, shiftKey: true }), 'win32')).toBe(false);
    expect(isSelectAll(key({ metaKey: true, key: 'b' }), 'darwin')).toBe(false);
  });

  it('Cmd-click adds or takes one away; Shift-click takes the range from the last one clicked', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(clickedMany(order, ['a'], 'a', 'c', { toggle: true, range: false })).toEqual({
      marked: ['a', 'c'],
      anchor: 'c',
    });
    expect(clickedMany(order, ['a', 'c'], 'c', 'a', { toggle: true, range: false }).marked).toEqual(['c']);
    expect(clickedMany(order, ['b'], 'b', 'e', { toggle: false, range: true }).marked).toEqual([
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('deleting many playlists says how many, and what kinds', () => {
    const base = { name: '', template: false, inside: 0 };
    expect(removingWhat({ ...base, ids: ['p'], name: 'Sunday', folder: false })).toBe('playlist “Sunday”');
    expect(removingWhat({ ...base, ids: ['a', 'b', 'c'], folder: false, folders: 0 })).toBe('3 playlists');
    expect(removingWhat({ ...base, ids: ['a', 'b'], folder: true, folders: 2 })).toBe('2 folders');
    expect(removingWhat({ ...base, ids: ['a', 'b', 'c'], folder: true, folders: 1 })).toBe(
      '2 playlists and a folder',
    );
  });
});
