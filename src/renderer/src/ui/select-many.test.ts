import type { KeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('Cmd-A or Ctrl-A with a Gujarati or Hindi layout too, by the A key’s place (hunt S3-3); a Latin layout as before', () => {
    expect(isSelectAll(key({ ctrlKey: true, key: 'અ', code: 'KeyA' }), 'win32')).toBe(true);
    expect(isSelectAll(key({ metaKey: true, key: 'ो', code: 'KeyA' }), 'darwin')).toBe(true);
    expect(isSelectAll(key({ ctrlKey: true, key: 'અ', code: 'KeyS' }), 'win32')).toBe(false);
    expect(isSelectAll(key({ ctrlKey: true, shiftKey: true, key: 'અ', code: 'KeyA' }), 'win32')).toBe(false);
    // AZERTY: the A is where QWERTY's Q is; the key there types "a" and is Select all, as before.
    expect(isSelectAll(key({ ctrlKey: true, key: 'a', code: 'KeyQ' }), 'win32')).toBe(true);
    expect(isSelectAll(key({ ctrlKey: true, key: 'q', code: 'KeyA' }), 'win32')).toBe(false);
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

// Cmd/Ctrl+A typed in a text box inside a list (a playlist's or an audio playlist's rename box) is the box's own: it
// selects the words, never every row (hunt3fix review MUST-1, the release lead's choice: on every layout, Latin too).
describe('Select all leaves a text box its own Cmd/Ctrl+A', () => {
  /** A stand-in for the page's elements: a field is one with a field's tag name, or one that is editable. */
  class StandInElement {
    constructor(
      readonly tagName: string,
      readonly isContentEditable = false,
    ) {}
  }
  beforeEach(() => {
    Object.assign(globalThis, { HTMLElement: StandInElement });
  });
  afterEach(() => {
    delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
  });
  const at = (target: StandInElement, more: Partial<KeyboardEvent>) =>
    key({ ctrlKey: true, code: 'KeyA', target: target as unknown as EventTarget, ...more });

  it('is never Select all in a field or an editable box, with a Latin layout or a Gujarati or Hindi one', () => {
    for (const box of [
      new StandInElement('INPUT'),
      new StandInElement('TEXTAREA'),
      new StandInElement('DIV', true),
    ]) {
      expect(isSelectAll(at(box, { key: 'a' }), 'win32'), `${box.tagName} a`).toBe(false);
      expect(isSelectAll(at(box, { key: 'અ' }), 'win32'), `${box.tagName} અ`).toBe(false);
      expect(isSelectAll(at(box, { key: 'ो' }), 'win32'), `${box.tagName} ो`).toBe(false);
      expect(isSelectAll(at(box, { key: 'a', ctrlKey: false, metaKey: true }), 'darwin')).toBe(false);
    }
  });

  it('is Select all on the list itself, Latin or Gujarati', () => {
    const list = new StandInElement('UL');
    expect(isSelectAll(at(list, { key: 'a' }), 'win32')).toBe(true);
    expect(isSelectAll(at(list, { key: 'અ' }), 'win32')).toBe(true);
    expect(isSelectAll(at(list, { key: 'ो', ctrlKey: false, metaKey: true }), 'darwin')).toBe(true);
  });
});
