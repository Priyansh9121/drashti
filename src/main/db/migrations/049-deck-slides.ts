/**
 * Migration 49: a deck shown as it was (Session 54, C2; shared/deck.ts). `slides.deck` is what a slide made from a
 * PowerPoint or Keynote deck with its animations carries beside its one picture: its steps' clips and last frames,
 * the deck's own transition, and its real videos and sounds (JSON of a DeckSlide, shared/deck-schema.ts); NULL, as
 * every slide made before has it, for any other slide. The clips and pictures it names are media rows like a deck's
 * pages (Drashti's own, out of the Media list: migration 37). An alpha.12 library, and a backup of one, gains the
 * column empty: nothing else changes, and every slide looks and plays as it did.
 */
export const up = `
ALTER TABLE slides ADD COLUMN deck TEXT CHECK (deck IS NULL OR json_valid(deck));
`;
