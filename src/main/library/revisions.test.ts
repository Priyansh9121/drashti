import { describe, expect, it } from 'vitest';
import type { ContentRows } from '../db/content';
import { Revisions } from './revisions';

/** A kept copy of a presentation's content, as far as these tests read it (placeholder ids only). */
const rows = (presentationId: string) => ({ presentationId }) as unknown as ContentRows;

describe('the copies kept for Undo', () => {
  it('say which presentations a kept change covers, without using it up (Session 56: Simple Mode’s lock lets its Undo through only for presentations its playlists hold)', () => {
    const kept = new Revisions();
    const id = kept.keep([rows('placeholder-one'), rows('placeholder-two')]);
    expect(kept.covers(id)).toEqual(['placeholder-one', 'placeholder-two']);
    expect(kept.covers(id)).toEqual(['placeholder-one', 'placeholder-two']);
    expect(kept.take(id)).toHaveLength(2);
    // Used up, or never kept: none.
    expect(kept.covers(id)).toBeNull();
    expect(kept.covers('placeholder-unknown')).toBeNull();
  });

  it('forget the oldest past their limit, and then cover nothing', () => {
    const kept = new Revisions(1);
    const first = kept.keep([rows('placeholder-one')]);
    const second = kept.keep([rows('placeholder-two')]);
    expect(kept.covers(first)).toBeNull();
    expect(kept.covers(second)).toEqual(['placeholder-two']);
  });
});
