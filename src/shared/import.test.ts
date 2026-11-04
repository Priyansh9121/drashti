import { describe, expect, it } from 'vitest';
import { type ImportFormat, type ItemOutcome, loadedBooks } from './import';

/*
 * An import that brought a book in or updated one (alpha.15, the owner's answer of 4 Nov 2026): the playlists are read
 * again, so a passage of it in a playlist open in the window or on a phone is there at once, as it goes missing at once
 * when its book is removed.
 */

const report = (...items: [ImportFormat, ItemOutcome][]) => ({
  items: items.map(([format, outcome]) => ({ format, outcome })),
});

describe('an import that loaded a book', () => {
  it('is one that brought a book in or updated one', () => {
    expect(loadedBooks(report(['media', 'imported'], ['shastra', 'imported']))).toBe(true);
    expect(loadedBooks(report(['shastra', 'replaced']))).toBe(true);
  });

  it('is not one whose book was already there unchanged, failed, or that brought only other things', () => {
    expect(loadedBooks(report(['shastra', 'skipped']))).toBe(false);
    expect(loadedBooks(report(['shastra', 'failed']))).toBe(false);
    expect(loadedBooks(report(['media', 'imported'], ['text', 'replaced']))).toBe(false);
    expect(loadedBooks(report())).toBe(false);
    expect(loadedBooks(null)).toBe(false);
  });
});
