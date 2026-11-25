import type { PresentationDoc } from './library';

/**
 * A PowerPoint or a PDF, as a phone may put it up and step through it (alpha.23, QA23-PHONE-1: the owner's "Only PPT
 * and PDF"): a presentation made from a document's pages (a PDF, PowerPoint or Keynote file: ImportSource 'pictures',
 * Q5's default counting Keynote as PowerPoint), or one holding a deck's slide with its clicks (Session 54, C2) wherever
 * it came from. Never a kirtan (a deck made one too) or a presentation of words, and never a Shastra passage or Repeat
 * Slides' steps (made from a text or a playlist, Repeat Slides going round), even of a deck's slides. The library's
 * quick form of this, for many presentations at once: db/presentations.ts phoneDecks (a test keeps the two agreeing).
 */
export function isPhoneDeck(
  doc: Pick<PresentationDoc, 'source' | 'groups' | 'passage' | 'repeat' | 'kirtan'> | null | undefined,
): boolean {
  // A deck made a kirtan in the library is a kirtan (the owner's Q4: kirtans refused; the review's MUST-1).
  if (!doc || doc.passage || doc.repeat || doc.kirtan) return false;
  return (
    doc.source?.kind === 'pictures' ||
    doc.groups.some((group) => group.slides.some((item) => item.slide.deck !== undefined))
  );
}
