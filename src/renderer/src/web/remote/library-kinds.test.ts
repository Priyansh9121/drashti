import { describe, expect, it } from 'vitest';
import { libraryKinds, shownKind } from './library-kinds';

/* The library's choices on a phone (Session 54, D5 and D3): Shared from Drashti only while something is shared. */

describe('the library’s choices on a phone', () => {
  it('are Presentations and Media, and Shared from Drashti while a playlist is shared', () => {
    expect(libraryKinds(false)).toEqual(['presentations', 'media']);
    expect(libraryKinds(true)).toEqual(['presentations', 'media', 'shared']);
  });

  it('show the one chosen while it is there, and Presentations once nothing is shared', () => {
    expect(shownKind('media', false)).toBe('media');
    expect(shownKind('shared', true)).toBe('shared');
    expect(shownKind('shared', false)).toBe('presentations');
    expect(shownKind('presentations', true)).toBe('presentations');
  });
});
