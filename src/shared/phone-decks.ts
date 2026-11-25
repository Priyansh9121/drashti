import type { PresentationDoc } from './library';

/**
 * A PowerPoint or a PDF, as a phone may put it up and step through it (alpha.23, QA23-PHONE-1: the owner's "Only PPT
 * and PDF"): a presentation made from a document's pages (a PDF, PowerPoint or Keynote file: ImportSource 'pictures',
 * Q5's default counting Keynote as PowerPoint), or one holding a deck's slide with its clicks (Session 54, C2) wherever
 * it came from. Never a kirtan or a presentation of words, and never a Shastra passage or Repeat Slides' steps (made
 * from a text or a playlist, Repeat Slides going round), even of a deck's slides.
 */
export function isPhoneDeck(
  doc: Pick<PresentationDoc, 'source' | 'groups' | 'passage' | 'repeat'> | null | undefined,
): boolean {
  if (!doc || doc.passage || doc.repeat) return false;
  return (
    doc.source?.kind === 'pictures' ||
    doc.groups.some((group) => group.slides.some((item) => item.slide.deck !== undefined))
  );
}
